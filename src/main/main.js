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
let isVpnConnected = false;

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
            { label: 'MEB VPN v1.4.0', enabled: false },
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

// ========== SEND TO RENDERER ==========
function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// ========== CONNECTION MANAGEMENT ==========
async function handleConnect() {
    // Already connected?
    if (isVpnConnected) {
        sendToRenderer('connection-error', 'Zaten bağlısınız');
        return { success: false, error: 'Already connected' };
    }

    // Logged in?
    if (!authManager.isLoggedIn()) {
        sendToRenderer('connection-error', 'Önce giriş yapın');
        return { success: false, error: 'Not logged in' };
    }

    // VPN config available?
    if (!authManager.hasVpnConfig()) {
        sendToRenderer('connection-error', 'VPN yapılandırması bulunamadı. Lütfen tekrar giriş yapın.');
        return { success: false, error: 'No VPN config' };
    }

    // Check usage before connecting
    try {
        const usage = await authManager.fetchUsage();
        if (usage && usage.limit_exceeded) {
            sendToRenderer('limit-exceeded', 'Veri limitiniz doldu! Bağlantı kurulamaz.');
            sendToRenderer('usage-update', usage);
            return { success: false, error: 'Veri limitiniz doldu!' };
        }
        if (usage && !usage.active) {
            sendToRenderer('connection-error', 'Hesabınız devre dışı. Lütfen yöneticiyle iletişime geçin.');
            return { success: false, error: 'Hesap devre dışı' };
        }
    } catch (e) {
        // If usage check fails (e.g. no internet), allow connection attempt
        console.error('Usage check failed:', e.message);
    }

    // Start connecting
    sendToRenderer('connection-status', 'connecting');

    try {
        xrayManager.setVpnConfig(authManager.getVpnConfig());
        await xrayManager.start();
        await proxySettings.enable('127.0.0.1', 10808);

        isVpnConnected = true;
        sendToRenderer('connection-status', 'connected');
        startUsagePolling();
        return { success: true };
    } catch (error) {
        console.error('Connect error:', error.message);

        // Cleanup on failure: ensure proxy is disabled and xray is stopped
        try { await proxySettings.disable(); } catch (e) { }
        try { await xrayManager.stop(); } catch (e) { }

        isVpnConnected = false;
        sendToRenderer('connection-status', 'disconnected');
        sendToRenderer('connection-error', error.message || 'Bağlantı kurulamadı');
        return { success: false, error: error.message };
    }
}

async function handleDisconnect() {
    if (!isVpnConnected && !xrayManager.isRunning() && !proxySettings.isEnabled()) {
        // Nothing to do, but make sure UI is synced
        sendToRenderer('connection-status', 'disconnected');
        return { success: true };
    }

    stopUsagePolling();

    try {
        // Always try to disable proxy first (most important for user experience)
        try { await proxySettings.disable(); } catch (e) {
            console.error('Proxy disable error:', e.message);
        }

        // Then stop xray
        try { await xrayManager.stop(); } catch (e) {
            console.error('Xray stop error:', e.message);
        }

        isVpnConnected = false;
        sendToRenderer('connection-status', 'disconnected');
        return { success: true };
    } catch (error) {
        isVpnConnected = false;
        sendToRenderer('connection-status', 'disconnected');
        return { success: false, error: error.message };
    }
}

/**
 * Handle unexpected Xray process exit (crash)
 */
async function handleUnexpectedDisconnect(exitCode) {
    console.log(`Xray process unexpectedly exited (code: ${exitCode})`);
    isVpnConnected = false;
    stopUsagePolling();

    // Disable proxy immediately
    try { await proxySettings.disable(); } catch (e) {
        console.error('Proxy disable error after crash:', e.message);
    }

    sendToRenderer('connection-status', 'disconnected');
    sendToRenderer('connection-error', 'VPN bağlantısı beklenmedik şekilde kesildi. Lütfen tekrar bağlanın.');
}

// ========== USAGE POLLING ==========
function startUsagePolling() {
    stopUsagePolling();
    usagePollInterval = setInterval(async () => {
        if (!authManager.isLoggedIn() || !isVpnConnected) return;

        try {
            const usage = await authManager.fetchUsage();
            if (!usage) return;

            sendToRenderer('usage-update', usage);

            // Check if limit exceeded
            if (usage.limit_exceeded) {
                console.log('Data limit exceeded, disconnecting...');
                sendToRenderer('limit-exceeded', 'Veri limitiniz doldu! Bağlantı kesildi.');
                await handleDisconnect();
            }
            // Check if account deactivated by admin
            else if (!usage.active) {
                console.log('Account deactivated, disconnecting...');
                sendToRenderer('connection-error', 'Hesabınız devre dışı bırakıldı.');
                await handleDisconnect();
            }
        } catch (e) {
            console.error('Usage poll error:', e.message);
        }
    }, 2000);
}

function stopUsagePolling() {
    if (usagePollInterval) {
        clearInterval(usagePollInterval);
        usagePollInterval = null;
    }
}

// ========== APP LIFECYCLE ==========
app.whenReady().then(async () => {
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.meb.vpn');
    }

    xrayManager = new XrayManager();
    proxySettings = new ProxySettings();
    authManager = new AuthManager();
    authManager.init(app.getPath('userData'));

    // Listen for unexpected xray exit
    xrayManager.on('unexpected-exit', (code) => {
        handleUnexpectedDisconnect(code);
    });

    // Traffic data forwarding
    xrayManager.on('traffic', (data) => {
        sendToRenderer('traffic-update', data);
    });

    xrayManager.on('log', (log) => {
        console.log('[Xray]', log);
    });

    // ========== IPC: Auth ==========
    ipcMain.handle('auth:google-signin', async () => {
        try {
            const idToken = await authManager.googleSignIn(mainWindow);
            const result = await authManager.authenticateWithServer(idToken);
            sendToRenderer('auth-status', { loggedIn: true, user: result.user });
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
        sendToRenderer('auth-status', { loggedIn: false });
        return { success: true };
    });

    // ========== IPC: VPN ==========
    ipcMain.handle('vpn:connect', () => handleConnect());
    ipcMain.handle('vpn:disconnect', () => handleDisconnect());
    ipcMain.handle('vpn:status', () => ({
        connected: isVpnConnected,
        xrayRunning: xrayManager.isRunning(),
        proxyEnabled: proxySettings.isEnabled(),
        uptime: xrayManager.getUptime(),
    }));

    // ========== IPC: Usage ==========
    ipcMain.handle('usage:refresh', async () => {
        return await authManager.fetchUsage();
    });

    ipcMain.handle('usage:start-polling', () => {
        if (isVpnConnected) startUsagePolling();
        return { success: true };
    });

    ipcMain.handle('usage:stop-polling', () => {
        stopUsagePolling();
        return { success: true };
    });

    // ========== IPC: Window controls ==========
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

app.on('before-quit', async (event) => {
    if (!app.isQuitting) {
        app.isQuitting = true;
        event.preventDefault();
        await handleDisconnect();
        app.quit();
    }
});
