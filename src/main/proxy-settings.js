const { exec } = require('child_process');
const os = require('os');

class ProxySettings {
    constructor() {
        this.platform = os.platform();
        this.enabled = false;
    }

    async enable(host, port) {
        const proxyAddress = `${host}:${port + 1}`; // HTTP proxy port (10809)

        try {
            if (this.platform === 'win32') {
                await this._execCommand(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`
                );
                await this._execCommand(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyAddress}" /f`
                );
                await this._execCommand(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>" /f`
                );
            } else if (this.platform === 'linux') {
                try {
                    await this._execCommand(`gsettings set org.gnome.system.proxy mode 'manual'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.http host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.http port ${port + 1}`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.https host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.https port ${port + 1}`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.socks host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.socks port ${port}`);
                } catch {
                    console.log('GNOME proxy settings not available, using env vars only');
                }
            }
            this.enabled = true;
        } catch (error) {
            throw new Error(`Proxy ayarları yapılamadı: ${error.message}`);
        }
    }

    async disable() {
        try {
            if (this.platform === 'win32') {
                await this._execCommand(
                    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`
                );
            } else if (this.platform === 'linux') {
                try {
                    await this._execCommand(`gsettings set org.gnome.system.proxy mode 'none'`);
                } catch {
                    console.log('GNOME proxy settings not available');
                }
            }
            this.enabled = false;
        } catch (error) {
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
