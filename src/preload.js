const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mebAPI', {
    // Auth
    googleSignIn: () => ipcRenderer.invoke('auth:google-signin'),
    getSession: () => ipcRenderer.invoke('auth:get-session'),
    logout: () => ipcRenderer.invoke('auth:logout'),

    // VPN Controls
    connect: () => ipcRenderer.invoke('vpn:connect'),
    disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
    getStatus: () => ipcRenderer.invoke('vpn:status'),

    // Window Controls
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),

    // Window Drag (for Linux/smart boards)
    startDrag: (x, y) => ipcRenderer.invoke('window:start-drag', { x, y }),
    moveDrag: (x, y) => ipcRenderer.invoke('window:drag-move', { x, y }),
    endDrag: () => ipcRenderer.invoke('window:end-drag'),

    // Usage Polling Control
    startPolling: () => ipcRenderer.invoke('usage:start-polling'),
    stopPolling: () => ipcRenderer.invoke('usage:stop-polling'),

    // Platform
    platform: process.platform,

    // Events from main process
    onAuthStatus: (callback) => {
        ipcRenderer.on('auth-status', (event, data) => callback(data));
    },
    onConnectionStatus: (callback) => {
        ipcRenderer.on('connection-status', (event, status) => callback(status));
    },
    onConnectionError: (callback) => {
        ipcRenderer.on('connection-error', (event, error) => callback(error));
    },
    onTrafficUpdate: (callback) => {
        ipcRenderer.on('traffic-update', (event, data) => callback(data));
    },
    onLimitExceeded: (callback) => {
        ipcRenderer.on('limit-exceeded', (event, message) => callback(message));
    },
    onUsageUpdate: (callback) => {
        ipcRenderer.on('usage-update', (event, data) => callback(data));
    },
    refreshUsage: () => ipcRenderer.invoke('usage:refresh'),
});
