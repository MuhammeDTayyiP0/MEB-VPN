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
            // Deprecated: Xray TUN mode handles system routing natively.
            // We no longer need to write to Windows Registry or GNOME gsettings.
            this.enabled = true;
        } catch (error) {
            throw new Error(`Proxy ayarları yapılamadı: ${error.message}`);
        }
    }

    async disable() {
        try {
            // Deprecated: Xray TUN mode handles system routing natively.
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
