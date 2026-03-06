const { exec } = require('child_process');
const os = require('os');

class ProxySettings {
    constructor() {
        this.platform = os.platform();
        this.enabled = false;
    }

    async enable(host, port) {
        const proxyAddress = `${host}:${port + 1}`; // HTTP proxy port (10809)
        const socksAddress = `socks=${host}:${port}`;

        console.log(`Enabling system proxy: ${proxyAddress}`);

        try {
            if (this.platform === 'win32') {
                // Windows: Set global proxy and also per-protocol for better coverage
                await this._execCommand(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`
                );
                await this._execCommand(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyAddress}" /f`
                );
                // Force specific protocols just in case
                await this._execCommand(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "localhost;127.*;<local>" /f`
                );
            } else if (this.platform === 'linux') {
                try {
                    // GNOME / Pardus standard
                    await this._execCommand(`gsettings set org.gnome.system.proxy mode 'manual'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.http host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.http port ${port + 1}`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.https host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.https port ${port + 1}`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.socks host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.socks port ${port}`);
                    console.log('GNOME proxy settings applied via gsettings');
                } catch (e) {
                    console.log('gsettings failed, user might not be on GNOME:', e.message);
                }
            }
            this.enabled = true;
        } catch (error) {
            console.error('Proxy enable error:', error);
            throw new Error(`Proxy ayarları yapılamadı: ${error.message}`);
        }
    }

    async disable() {
        console.log('Disabling system proxy');
        try {
            if (this.platform === 'win32') {
                await this._execCommand(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`
                );
            } else if (this.platform === 'linux') {
                try {
                    await this._execCommand(`gsettings set org.gnome.system.proxy mode 'none'`);
                } catch (e) {
                    console.error('gsettings disable failed:', e.message);
                }
            }
            this.enabled = false;
        } catch (error) {
            console.error('Proxy disable error:', error);
            throw new Error(`Proxy ayarları kaldırılamadı: ${error.message}`);
        }
    }

    isEnabled() {
        return this.enabled;
    }

    _execCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });
    }
}

module.exports = ProxySettings;
