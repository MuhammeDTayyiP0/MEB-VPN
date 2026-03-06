const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const ConfigGenerator = require('./config-generator');
const sudo = require('@vscode/sudo-prompt');

class XrayManager extends EventEmitter {
    constructor() {
        super();
        this.process = null;
        this.running = false;
        this.configGenerator = new ConfigGenerator();
        this.startTime = null;
    }

    setVpnConfig(vpnConfig) {
        this.configGenerator.setServerConfig(vpnConfig);
    }

    getXrayBinaryPath() {
        const platform = process.platform;
        const binaryName = platform === 'win32' ? 'xray.exe' : 'xray';

        // Check in resources directory (for packaged app)
        const packagedPath = path.join(process.resourcesPath || '', 'xray', binaryName);
        if (fs.existsSync(packagedPath)) return packagedPath;

        // Check in project resources directory (for development)
        const devPath = path.join(__dirname, '..', '..', 'resources', 'xray', binaryName);
        if (fs.existsSync(devPath)) return devPath;

        throw new Error(
            `Xray-core binary bulunamadı!\n` +
            `Lütfen xray binary dosyasını şu konuma yerleştirin:\n` +
            `${devPath}\n\nİndirmek için: https://github.com/XTLS/Xray-core/releases`
        );
    }

    getConfigPath() {
        const { app } = require('electron');
        const userDataPath = app.getPath('userData');
        const configDir = path.join(userDataPath, 'xray-config');
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        return path.join(configDir, 'config.json');
    }

    async start() {
        if (this.running) {
            this.emit('log', 'Xray-core zaten çalışıyor.');
            return;
        }

        try {
            const configPath = this.getConfigPath();
            this.configGenerator.generateConfig(configPath);
            this.emit('log', 'Config oluşturuldu.');

            const binaryPath = this.getXrayBinaryPath();
            this.emit('log', `Xray-core başlatılıyor: ${binaryPath}`);

            if (process.platform !== 'win32') {
                try { fs.chmodSync(binaryPath, '755'); } catch (e) { }
            }

            return new Promise((resolve, reject) => {
                const binaryDir = path.dirname(binaryPath);

                // To create a TUN interface, Xray requires Root/Administrator privileges
                const sudoOption = {
                    name: 'MEB VPN'
                };

                // Because sudo-prompt runs the process in the background effectively without real-time stdout piping
                // we will start it and assume success if it doesn't immediately fail.
                const command = `"${binaryPath}" -c "${configPath}"`;

                sudo.exec(command, sudoOption, (error, stdout, stderr) => {
                    if (error) {
                        this.running = false;
                        this.startTime = null;
                        this.stopStatsPolling();
                        this.emit('log', `[SUDO ERROR] ${error.message}`);
                        reject(error);
                    } else {
                        // This callback actually triggers when Xray CLOSES, since it's a long-running process
                        // which means Xray stopped.
                        this.running = false;
                        this.startTime = null;
                        this.stopStatsPolling();
                        this.emit('log', `Xray kapandı.`);
                    }
                });

                // Since sudo-prompt doesn't give us stdout chunks for a long running process until exit,
                // we assume it started after the prompt is accepted (give it 3 seconds)
                setTimeout(() => {
                    this.running = true;
                    this.startTime = Date.now();
                    this.startStatsPolling();
                    resolve();
                }, 3000);
            });
        } catch (error) {
            this.emit('error', error.message);
            throw error;
        }
    }

    startStatsPolling() {
        this.stopStatsPolling();
        this.lastStats = { up: 0, down: 0, time: Date.now() };
        this.statsInterval = setInterval(() => {
            if (!this.running) return;
            this.queryStats();
        }, 1000);
    }

    stopStatsPolling() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    queryStats() {
        try {
            const binaryPath = this.getXrayBinaryPath();
            const binaryDir = path.dirname(binaryPath);

            const apiProcess = spawn(binaryPath, ['api', 'statsquery', '--server=127.0.0.1:10085'], {
                cwd: binaryDir,
            });

            let output = '';
            apiProcess.stdout.on('data', (data) => { output += data.toString(); });
            apiProcess.on('close', (code) => {
                if (code === 0 && output.trim()) {
                    try {
                        this.processStats(JSON.parse(output));
                    } catch (e) { }
                }
            });
        } catch (e) { }
    }

    processStats(data) {
        if (!data || !data.stat) return;
        let up = 0, down = 0;

        data.stat.forEach(item => {
            const val = parseInt(item.value);
            if (!isNaN(val)) {
                if (item.name.includes('uplink')) up += val;
                if (item.name.includes('downlink')) down += val;
            }
        });

        const now = Date.now();
        const deltaTime = (now - this.lastStats.time) / 1000;
        let upSpeed = deltaTime > 0 ? Math.max(0, (up - this.lastStats.up) / deltaTime) : 0;
        let downSpeed = deltaTime > 0 ? Math.max(0, (down - this.lastStats.down) / deltaTime) : 0;

        this.lastStats = { up, down, time: now };

        this.emit('traffic', {
            upSpeed: isNaN(upSpeed) ? 0 : upSpeed,
            downSpeed: isNaN(downSpeed) ? 0 : downSpeed,
            totalUp: up,
            totalDown: down,
            total: up + down,
        });
    }

    async stop() {
        if (!this.running) {
            this.stopStatsPolling();
            return;
        }

        return new Promise((resolve) => {
            this.running = false;
            this.startTime = null;
            this.stopStatsPolling();

            // Kill xray instance using system commands
            const sudoOption = { name: 'MEB VPN' };
            if (process.platform === 'win32') {
                sudo.exec('taskkill /IM xray.exe /F /T', sudoOption, () => { resolve(); });
            } else {
                sudo.exec('killall -9 xray', sudoOption, () => { resolve(); });
            }

            // Failsafe resolution
            setTimeout(resolve, 3000);
        });
    }

    isRunning() { return this.running; }
    getUptime() { return this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0; }
}

module.exports = XrayManager;
