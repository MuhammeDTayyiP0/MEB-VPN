const { exec } = require('child_process');
const os = require('os');

class ProxySettings {
    constructor() {
        this.platform = os.platform();
        this.enabled = false;
    }

    async enable(host, port) {
        const httpPort = port + 1;
        const proxyAddress = `${host}:${httpPort}`;

        console.log(`Enabling system proxy: HTTP=${proxyAddress}, SOCKS=${host}:${port}`);

        try {
            if (this.platform === 'win32') {
                await this._execCommand(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`);
                await this._execCommand(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyAddress}" /f`);
                await this._execCommand(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "localhost;127.*;<local>" /f`);
            } else if (this.platform === 'linux') {
                // Try GNOME (gsettings)
                try {
                    await this._execCommand(`gsettings set org.gnome.system.proxy mode 'manual'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.http host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.http port ${httpPort}`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.https host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.https port ${httpPort}`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.socks host '${host}'`);
                    await this._execCommand(`gsettings set org.gnome.system.proxy.socks port ${port}`);
                    console.log('GNOME proxy settings applied');
                } catch (e) {
                    console.log('GNOME gsettings failed:', e.message);
                }

                // Try KDE (kwriteconfig5)
                try {
                    await this._execCommand(`kwriteconfig5 --file kioslaverc --group "Proxy Settings" --key "ProxyType" 1`);
                    await this._execCommand(`kwriteconfig5 --file kioslaverc --group "Proxy Settings" --key "httpProxy" "http://${host} ${httpPort}"`);
                    await this._execCommand(`kwriteconfig5 --file kioslaverc --group "Proxy Settings" --key "httpsProxy" "http://${host} ${httpPort}"`);
                    await this._execCommand(`kwriteconfig5 --file kioslaverc --group "Proxy Settings" --key "socksProxy" "socks://${host} ${port}"`);
                    // Notify KDE about the change
                    await this._execCommand(`dbus-send --type=signal /KIO/Scheduler org.kde.KIO.Scheduler.reparseSlaveConfiguration string:''`);
                    console.log('KDE proxy settings applied');
                } catch (e) {
                    console.log('KDE kwriteconfig5 failed:', e.message);
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
                await this._execCommand(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`);
            } else if (this.platform === 'linux') {
                // Disable GNOME
                try { await this._execCommand(`gsettings set org.gnome.system.proxy mode 'none'`); } catch (e) { }

                // Disable KDE
                try {
                    await this._execCommand(`kwriteconfig5 --file kioslaverc --group "Proxy Settings" --key "ProxyType" 0`);
                    await this._execCommand(`dbus-send --type=signal /KIO/Scheduler org.kde.KIO.Scheduler.reparseSlaveConfiguration string:''`);
                } catch (e) { }
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
