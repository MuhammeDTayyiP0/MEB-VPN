const { execFile, exec } = require('child_process');
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
                await this._winRegSet('ProxyEnable', 'REG_DWORD', '1');
                await this._winRegSet('ProxyServer', 'REG_SZ', proxyAddress);
                await this._winRegSet('ProxyOverride', 'REG_SZ', 'localhost;127.*;10.*;192.168.*;<local>');
                // Notify system of proxy change
                await this._notifyWindowsProxyChange();
            } else if (this.platform === 'linux') {
                await this._enableLinuxProxy(host, port, httpPort);
            }
            this.enabled = true;
        } catch (error) {
            console.error('Proxy enable error:', error);
            // Attempt rollback on failure
            try { await this.disable(); } catch (e) { }
            throw new Error(`Proxy ayarları yapılamadı: ${error.message}`);
        }
    }

    async disable() {
        console.log('Disabling system proxy');
        try {
            if (this.platform === 'win32') {
                await this._winRegSet('ProxyEnable', 'REG_DWORD', '0');
                // Also clear the proxy server value
                await this._winRegDelete('ProxyServer');
                await this._winRegDelete('ProxyOverride');
                await this._notifyWindowsProxyChange();
            } else if (this.platform === 'linux') {
                await this._disableLinuxProxy();
            }
            this.enabled = false;
        } catch (error) {
            console.error('Proxy disable error:', error);
            // Force mark as disabled even if cleanup fails
            this.enabled = false;
            throw new Error(`Proxy ayarları kaldırılamadı: ${error.message}`);
        }
    }

    isEnabled() {
        return this.enabled;
    }

    // ========== WINDOWS HELPERS ==========
    _winRegSet(name, type, value) {
        const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
        return this._execCommand(`reg add "${regPath}" /v ${name} /t ${type} /d "${value}" /f`);
    }

    _winRegDelete(name) {
        const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
        return this._execCommand(`reg delete "${regPath}" /v ${name} /f`).catch(() => {
            // Ignore error if key doesn't exist
        });
    }

    _notifyWindowsProxyChange() {
        // Use PowerShell to notify system of internet settings change
        // This ensures browsers and apps pick up the change immediately
        return this._execCommand(
            'powershell -NoProfile -Command "[System.Net.WebRequest]::DefaultWebProxy = [System.Net.WebRequest]::GetSystemWebProxy()"'
        ).catch(() => {
            // Non-critical — proxy still works, just might need time to propagate
        });
    }

    // ========== LINUX HELPERS ==========
    async _enableLinuxProxy(host, port, httpPort) {
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
            await this._execCommand(`dbus-send --type=signal /KIO/Scheduler org.kde.KIO.Scheduler.reparseSlaveConfiguration string:''`);
            console.log('KDE proxy settings applied');
        } catch (e) {
            console.log('KDE kwriteconfig5 failed:', e.message);
        }
    }

    async _disableLinuxProxy() {
        // Disable GNOME
        try { await this._execCommand(`gsettings set org.gnome.system.proxy mode 'none'`); } catch (e) { }

        // Disable KDE
        try {
            await this._execCommand(`kwriteconfig5 --file kioslaverc --group "Proxy Settings" --key "ProxyType" 0`);
            await this._execCommand(`dbus-send --type=signal /KIO/Scheduler org.kde.KIO.Scheduler.reparseSlaveConfiguration string:''`);
        } catch (e) { }
    }

    // ========== EXEC ==========
    _execCommand(command) {
        return new Promise((resolve, reject) => {
            const child = exec(command, { timeout: 5000, windowsHide: true }, (error, stdout) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });
    }
}

module.exports = ProxySettings;
