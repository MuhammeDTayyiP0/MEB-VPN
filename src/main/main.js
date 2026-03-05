const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const XrayManager = require('./xray-manager');
const ProxySettings = require('./proxy-settings');
const AuthManager = require('./auth-manager');

// Global references
let mainWindow;
let tray;
let xrayManager;
let proxySettings;
let authManager;
let usagePollInterval = null;
let dragOffset = null;

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function createWindow() {
    const iconPath = path.join(__dirname, '..', '..', 'resources', 'icon.png');
    const isLinux = process.platform === 'linux';

    // Load and resize icon properly for Linux
    let appIcon = null;
    if (fs.existsSync(iconPath)) {
        appIcon = nativeImage.createFromPath(iconPath);
        if (!appIcon.isEmpty() && isLinux) {
            appIcon = appIcon.resize({ width: 256, height: 256 });
        }
    }

    mainWindow = new BrowserWindow({
        width: 420,
        height: 700,
        minWidth: 420,
        minHeight: 700,
        resizable: false,
        maximizable: false,
        frame: false,
        transparent: !isLinux,
        backgroundColor: isLinux ? '#0a0f1e' : '#00000000',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: 'MEB VPN',
        icon: appIcon || iconPath,
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        if (isLinux) {
            mainWindow.webContents.executeJavaScript(`document.body.classList.add('platform-linux');`);
        }
    });

    if (appIcon && !appIcon.isEmpty()) {
        mainWindow.setIcon(appIcon);
    }

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
    const iconPath = path.join(__dirname, '..', '..', 'resources', 'icon.png');
    const isLinux = process.platform === 'linux';
    let trayIcon;

    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
        // Linux tray icons should be small (22x22 or 24x24)
        if (!trayIcon.isEmpty() && isLinux) {
            trayIcon = trayIcon.resize({ width: 22, height: 22 });
        }
    }

    if (!trayIcon || trayIcon.isEmpty()) {
        const fallback = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAADhJREFUOE9jZKAQMFKon2HUAIYGBgaG/0D8H4j/A/E/IP6PST6E8X8Yv8HoP4zfYfQfRn8mEAfG/6H4PxSfuAb8Z2D4D8YnrgH/Gf6PST6E8X8Yv8HoP4zfYfQfRn8mEAcA3c0vIdat6r8AAAAASUVORK5CYII=';
        trayIcon = nativeImage.createFromDataURL(fallback);
    }

    try {
        tray = new Tray(trayIcon);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'MEB VPN v1.2.4', enabled: false },
            { type: 'separator' },
            { label: 'Göster', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
            { type: 'separator' },
            { label: 'Bağlan', click: () => handleConnect() },
            { label: 'Bağlantıyı Kes', click: () => handleDisconnect() },
            { type: 'separator' },
            { label: 'Çıkış', click: () => { app.isQuitting = true; handleDisconnect().then(() => app.quit()); } },
        ]);

        tray.setToolTip('MEB VPN');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
    } catch (err) {
        console.error('Tray creation error:', err.message);
    }
}

async function handleConnect() {
    if (!authManager.isLoggedIn()) {
        if (mainWindow) mainWindow.webContents.send('connection-error', 'Önce giriş yapın');
        return { success: false, error: 'Not logged in' };
    }

    // Check usage before connecting
    try {
        const usage = await authManager.fetchUsage();
        if (usage && usage.limit_exceeded) {
            if (mainWindow) {
                mainWindow.webContents.send('limit-exceeded', 'Veri limitiniz doldu! Bağlantı kurulamaz.');
                mainWindow.webContents.send('usage-update', usage);
            }
            return { success: false, error: 'Veri limitiniz doldu!' };
        }
        if (usage && !usage.active) {
            if (mainWindow) {
                mainWindow.webContents.send('connection-error', 'Hesabınız devre dışı. Lütfen yöneticiyle iletişime geçin.');
            }
            return { success: false, error: 'Hesap devre dışı' };
        }
    } catch (e) {
        // If usage check fails (e.g. no internet), allow connection attempt
        console.error('Usage check failed:', e.message);
    }

    try {
        if (mainWindow) mainWindow.webContents.send('connection-status', 'connecting');
        xrayManager.setVpnConfig(authManager.getVpnConfig());
        await xrayManager.start();
        await proxySettings.enable('127.0.0.1', 10808);
        if (mainWindow) mainWindow.webContents.send('connection-status', 'connected');
        return { success: true };
    } catch (error) {
        if (mainWindow) {
            mainWindow.webContents.send('connection-status', 'disconnected');
            mainWindow.webContents.send('connection-error', error.message);
        }
        return { success: false, error: error.message };
    }
}

async function handleDisconnect() {
    try {
        await proxySettings.disable();
        await xrayManager.stop();
        if (mainWindow) mainWindow.webContents.send('connection-status', 'disconnected');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function startUsagePolling() {
    stopUsagePolling();
    usagePollInterval = setInterval(async () => {
        if (!authManager.isLoggedIn()) return;
        try {
            const usage = await authManager.fetchUsage();
            if (!usage) return;

            // Send usage update to renderer
            if (mainWindow) mainWindow.webContents.send('usage-update', usage);

            // Check if limit exceeded
            if (usage.limit_exceeded) {
                console.log('Data limit exceeded, disconnecting...');
                if (mainWindow) {
                    mainWindow.webContents.send('limit-exceeded', 'Veri limitiniz doldu! Bağlantı kesildi.');
                }
                await handleDisconnect();
            }
            // Check if account deactivated by admin
            else if (!usage.active) {
                console.log('Account deactivated, disconnecting...');
                if (mainWindow) {
                    mainWindow.webContents.send('connection-error', 'Hesabınız devre dışı bırakıldı.');
                }
                await handleDisconnect();
            }
        } catch (e) {
            console.error('Usage poll error:', e.message);
        }
    }, 2000); // Check every 2 seconds
}

function stopUsagePolling() {
    if (usagePollInterval) {
        clearInterval(usagePollInterval);
        usagePollInterval = null;
    }
}

app.whenReady().then(async () => {
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.meb.vpn');
    }

    xrayManager = new XrayManager();
    proxySettings = new ProxySettings();
    authManager = new AuthManager();
    authManager.init(app.getPath('userData'));

    // Traffic data forwarding
    xrayManager.on('traffic', (data) => {
        if (mainWindow) mainWindow.webContents.send('traffic-update', data);
    });

    xrayManager.on('log', (log) => {
        console.log('[Xray]', log);
    });

    // IPC: Auth
    ipcMain.handle('auth:google-signin', async () => {
        try {
            const idToken = await authManager.googleSignIn(mainWindow);
            const result = await authManager.authenticateWithServer(idToken);
            if (mainWindow) mainWindow.webContents.send('auth-status', { loggedIn: true, user: result.user });
            return { success: true, user: result.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('auth:get-session', async () => {
        if (authManager.token) {
            const valid = await authManager.validateSession();
            if (valid) {
                return { loggedIn: true, user: authManager.getUser() };
            }
        }
        return { loggedIn: false };
    });

    ipcMain.handle('auth:logout', async () => {
        stopUsagePolling();
        await handleDisconnect();
        authManager.clearSession();
        if (mainWindow) mainWindow.webContents.send('auth-status', { loggedIn: false });
        return { success: true };
    });

    // IPC: VPN
    ipcMain.handle('vpn:connect', () => handleConnect());
    ipcMain.handle('vpn:disconnect', () => handleDisconnect());
    ipcMain.handle('vpn:status', () => ({
        connected: xrayManager.isRunning(),
        uptime: xrayManager.getUptime(),
    }));

    // IPC: Usage
    ipcMain.handle('usage:refresh', async () => {
        const usage = await authManager.fetchUsage();
        return usage;
    });

    // IPC: Start/stop polling from renderer
    ipcMain.handle('usage:start-polling', () => {
        startUsagePolling();
        return { success: true };
    });

    ipcMain.handle('usage:stop-polling', () => {
        stopUsagePolling();
        return { success: true };
    });

    // IPC: Window controls
    ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
    ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.hide(); });

    // IPC: Window drag for Linux/smart boards
    ipcMain.handle('window:start-drag', (event, { x, y }) => {
        if (!mainWindow) return;
        const [winX, winY] = mainWindow.getPosition();
        dragOffset = { x: x - winX, y: y - winY };
    });

    ipcMain.handle('window:drag-move', (event, { x, y }) => {
        if (!mainWindow || !dragOffset) return;
        mainWindow.setPosition(x - dragOffset.x, y - dragOffset.y);
    });

    ipcMain.handle('window:end-drag', () => {
        dragOffset = null;
    });

    createWindow();
    createTray();
});

app.on('window-all-closed', () => { });
app.on('activate', () => { if (mainWindow === null) createWindow(); });
app.on('before-quit', async () => {
    app.isQuitting = true;
    await handleDisconnect();
});
