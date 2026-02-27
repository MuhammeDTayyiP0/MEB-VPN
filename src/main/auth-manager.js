const { BrowserWindow } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load config from project root config.json
const configPath = path.join(__dirname, '..', '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const API_BASE = config.apiUrl || 'http://localhost:5000';
const GOOGLE_CLIENT_ID = config.googleClientId || '';

class AuthManager {
    constructor() {
        this.token = null;
        this.user = null;
        this.vpnConfig = null;
        this.tokenPath = null;
    }

    init(userDataPath) {
        this.tokenPath = path.join(userDataPath, 'auth.json');
        this.loadSavedSession();
    }

    loadSavedSession() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
                this.token = data.token;
                return true;
            }
        } catch (e) {
            console.error('Failed to load saved session:', e.message);
        }
        return false;
    }

    saveSession() {
        try {
            fs.writeFileSync(this.tokenPath, JSON.stringify({ token: this.token }), 'utf8');
        } catch (e) {
            console.error('Failed to save session:', e.message);
        }
    }

    clearSession() {
        this.token = null;
        this.user = null;
        this.vpnConfig = null;
        try {
            if (fs.existsSync(this.tokenPath)) fs.unlinkSync(this.tokenPath);
        } catch (e) { }
    }

    /**
     * Open Google OAuth popup in a BrowserWindow
     * Returns the Google ID token
     */
    async googleSignIn(parentWindow) {
        return new Promise((resolve, reject) => {
            const authWindow = new BrowserWindow({
                width: 500,
                height: 650,
                parent: parentWindow,
                modal: true,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                },
            });

            // Google OAuth URL — use accounts.google.com for simplest flow
            // For desktop apps, we use a loopback redirect approach
            const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
                `client_id=${GOOGLE_CLIENT_ID}` +
                `&redirect_uri=http://127.0.0.1` +
                `&response_type=code` +
                `&scope=email%20profile` +
                `&prompt=select_account`;

            authWindow.loadURL(googleAuthUrl);
            authWindow.show();

            // Monitor title changes for the authorization code
            authWindow.webContents.on('page-title-updated', (event) => {
                const title = authWindow.webContents.getTitle();
                if (title.startsWith('Success')) {
                    // Extract auth code from title
                    const code = title.split('code=')[1];
                    authWindow.close();
                    resolve(code);
                } else if (title.includes('Denied') || title.includes('error')) {
                    authWindow.close();
                    reject(new Error('Google sign-in was cancelled'));
                }
            });

            // Also check URL redirects
            authWindow.webContents.on('will-redirect', (event, url) => {
                try {
                    const urlObj = new URL(url);
                    const code = urlObj.searchParams.get('code');
                    const error = urlObj.searchParams.get('error');
                    if (code) {
                        authWindow.close();
                        resolve(code);
                    } else if (error) {
                        authWindow.close();
                        reject(new Error('Google sign-in denied'));
                    }
                } catch (e) { }
            });

            authWindow.on('closed', () => {
                reject(new Error('Sign-in window closed'));
            });
        });
    }

    /**
     * Send Google authorization code to our server and get JWT + VPN config
     */
    async authenticateWithServer(code) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({ code });
            const url = new URL(`${API_BASE}/api/auth/google`);
            const transport = url.protocol === 'https:' ? https : http;

            const req = transport.request({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode === 200 && json.success) {
                            this.token = json.token;
                            this.user = json.user;
                            this.vpnConfig = json.vpn_config;
                            this.saveSession();
                            resolve(json);
                        } else {
                            reject(new Error(json.error || 'Authentication failed'));
                        }
                    } catch (e) {
                        reject(new Error('Invalid server response'));
                    }
                });
            });

            req.on('error', (e) => reject(new Error(`Connection error: ${e.message}`)));
            req.write(postData);
            req.end();
        });
    }

    /**
     * Validate existing session token with server
     */
    async validateSession() {
        if (!this.token) return false;

        return new Promise((resolve) => {
            const url = new URL(`${API_BASE}/api/auth/me`);
            const transport = url.protocol === 'https:' ? https : http;

            const req = transport.request({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${this.token}` },
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const json = JSON.parse(data);
                            this.user = json.user;
                            this.vpnConfig = json.vpn_config;
                            resolve(true);
                        } else {
                            this.clearSession();
                            resolve(false);
                        }
                    } catch (e) {
                        this.clearSession();
                        resolve(false);
                    }
                });
            });

            req.on('error', () => {
                resolve(false);
            });
            req.end();
        });
    }

    isLoggedIn() { return !!this.token && !!this.user; }
    getUser() { return this.user; }
    getVpnConfig() { return this.vpnConfig; }
}

module.exports = AuthManager;
