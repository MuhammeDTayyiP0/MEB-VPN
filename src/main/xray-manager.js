const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const ConfigGenerator = require('./config-generator');

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
                let stderrOutput = '';

                this.process = spawn(binaryPath, ['-c', configPath], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    cwd: binaryDir,
                });

                let started = false;
                const startTimeout = setTimeout(() => {
                    if (!started) {
                        started = true;
                        this.running = true;
                        this.startTime = Date.now();
                        this.startStatsPolling();
                        resolve();
                    }
                }, 3000);

                this.process.stdout.on('data', (data) => {
                    const output = data.toString().trim();
                    this.emit('log', output);
                    if (!started && output.includes('started')) {
                        started = true;
                        clearTimeout(startTimeout);
                        this.running = true;
                        this.startTime = Date.now();
                        this.startStatsPolling();
                        resolve();
                    }
                });

                this.process.stderr.on('data', (data) => {
                    stderrOutput += data.toString().trim() + '\n';
                    this.emit('log', `[STDERR] ${data.toString().trim()}`);
                });

                this.process.on('error', (error) => {
                    this.running = false;
                    this.startTime = null;
                    clearTimeout(startTimeout);
                    this.stopStatsPolling();
                    if (!started) { started = true; reject(error); }
                });

                this.process.on('close', (code) => {
                    this.running = false;
                    this.startTime = null;
                    this.stopStatsPolling();
                    if (!started) {
                        started = true;
                        clearTimeout(startTimeout);
                        if (code !== 0) reject(new Error(stderrOutput.trim() || `Xray exited: ${code}`));
                    }
                });
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
        if (!this.process || !this.running) {
            this.running = false;
            this.stopStatsPolling();
            return;
        }

        return new Promise((resolve) => {
            this.process.on('close', () => {
                this.running = false;
                this.startTime = null;
                this.process = null;
                this.stopStatsPolling();
                resolve();
            });

            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', this.process.pid, '/f', '/t']);
            } else {
                this.process.kill('SIGTERM');
            }

            setTimeout(() => {
                if (this.process) {
                    try { this.process.kill('SIGKILL'); } catch (e) { }
                }
                resolve();
            }, 5000);
        });
    }

    isRunning() { return this.running; }
    getUptime() { return this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0; }
}

module.exports = XrayManager;
