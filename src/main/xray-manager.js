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
        this.statsInterval = null;
        this.lastStats = null;
        this._stopping = false;
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

        this._stopping = false;

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
                let settled = false;

                const settle = (success, error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(startTimeout);
                    if (success) {
                        this.running = true;
                        this.startTime = Date.now();
                        this._startStatsPolling();
                        resolve();
                    } else {
                        this.running = false;
                        this.startTime = null;
                        reject(error || new Error('Xray başlatılamadı'));
                    }
                };

                this.process = spawn(binaryPath, ['-c', configPath], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    cwd: binaryDir,
                    windowsHide: true,
                });

                // 5 second timeout — if Xray doesn't report "started", reject
                const startTimeout = setTimeout(() => {
                    if (!settled) {
                        // Check if process is still alive
                        if (this.process && !this.process.killed) {
                            // Process alive but no "started" message — likely config error
                            // Kill it and reject
                            this.emit('log', 'Xray 5sn içinde başlamadı, sonlandırılıyor...');
                            this._killProcess();
                            settle(false, new Error(stderrOutput.trim() || 'Xray 5 saniye içinde başlatılamadı'));
                        } else {
                            settle(false, new Error(stderrOutput.trim() || 'Xray process sonlandı'));
                        }
                    }
                }, 5000);

                this.process.stdout.on('data', (data) => {
                    const output = data.toString().trim();
                    this.emit('log', output);
                    if (!settled && output.includes('started')) {
                        settle(true);
                    }
                });

                this.process.stderr.on('data', (data) => {
                    const text = data.toString().trim();
                    stderrOutput += text + '\n';
                    this.emit('log', `[STDERR] ${text}`);
                });

                this.process.on('error', (error) => {
                    this.emit('log', `[ERROR] Xray process hatası: ${error.message}`);
                    settle(false, error);
                    this._cleanup();
                });

                this.process.on('close', (code) => {
                    this.emit('log', `Xray process kapandı (code: ${code})`);

                    // If not yet settled (startup phase), reject
                    if (!settled) {
                        settle(false, new Error(stderrOutput.trim() || `Xray çıkış kodu: ${code}`));
                    }

                    // If was running and not intentionally stopped, emit unexpected-exit
                    const wasRunning = this.running;
                    this._cleanup();

                    if (wasRunning && !this._stopping) {
                        this.emit('log', 'Xray beklenmedik şekilde kapandı!');
                        this.emit('unexpected-exit', code);
                    }
                });
            });
        } catch (error) {
            this.emit('error', error.message);
            throw error;
        }
    }

    /**
     * Clean up all state after process exit
     */
    _cleanup() {
        this.running = false;
        this.startTime = null;
        this.process = null;
        this._stopStatsPolling();
    }

    /**
     * Kill the xray process forcefully
     */
    _killProcess() {
        if (!this.process) return;
        try {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', this.process.pid.toString(), '/f', '/t'], { windowsHide: true });
            } else {
                this.process.kill('SIGKILL');
            }
        } catch (e) {
            this.emit('log', `Kill hatası: ${e.message}`);
        }
    }

    // ========== STATS POLLING ==========
    _startStatsPolling() {
        this._stopStatsPolling();
        this.lastStats = { up: 0, down: 0, time: Date.now() };
        this.statsInterval = setInterval(() => {
            if (!this.running) return;
            this._queryStats();
        }, 1000);
    }

    _stopStatsPolling() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
        this.lastStats = null;
    }

    _queryStats() {
        try {
            const binaryPath = this.getXrayBinaryPath();
            const binaryDir = path.dirname(binaryPath);

            const apiProcess = spawn(binaryPath, ['api', 'statsquery', '--server=127.0.0.1:10085'], {
                cwd: binaryDir,
                windowsHide: true,
            });

            let output = '';
            let killed = false;

            // Timeout: kill the stats query process after 3 seconds
            const queryTimeout = setTimeout(() => {
                if (!killed) {
                    killed = true;
                    try { apiProcess.kill(); } catch (e) { }
                }
            }, 3000);

            apiProcess.stdout.on('data', (data) => { output += data.toString(); });

            apiProcess.on('close', (code) => {
                clearTimeout(queryTimeout);
                if (code === 0 && output.trim()) {
                    try {
                        this._processStats(JSON.parse(output));
                    } catch (e) { }
                }
            });

            apiProcess.on('error', () => {
                clearTimeout(queryTimeout);
            });
        } catch (e) { }
    }

    _processStats(data) {
        if (!data || !data.stat || !this.lastStats) return;
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

    // ========== STOP ==========
    async stop() {
        if (!this.process || !this.running) {
            this._cleanup();
            return;
        }

        this._stopping = true;

        return new Promise((resolve) => {
            let resolved = false;
            const done = () => {
                if (resolved) return;
                resolved = true;
                this._cleanup();
                this._stopping = false;
                resolve();
            };

            // Listen for the close event
            this.process.on('close', done);

            // Try graceful kill first
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', this.process.pid.toString(), '/f', '/t'], { windowsHide: true });
            } else {
                try { this.process.kill('SIGTERM'); } catch (e) { }
            }

            // Force kill after 3 seconds
            setTimeout(() => {
                if (!resolved && this.process) {
                    try { this.process.kill('SIGKILL'); } catch (e) { }
                }
                // Final safety: resolve after 5 seconds regardless
                setTimeout(done, 2000);
            }, 3000);
        });
    }

    isRunning() { return this.running; }
    getUptime() { return this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0; }
}

module.exports = XrayManager;
