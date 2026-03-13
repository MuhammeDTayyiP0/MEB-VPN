const { contextBridge, ipcRenderer } = require('electron');

// Helper: create a one-time removable listener
function createListener(channel) {
    const listeners = new Set();
    return {
        on: (callback) => {
            const handler = (event, ...args) => callback(...args);
            listeners.add(handler);
            ipcRenderer.on(channel, handler);
        },
        removeAll: () => {
            listeners.forEach(handler => {
                ipcRenderer.removeListener(channel, handler);
            });
            listeners.clear();
        }
    };
}

// Pre-create all listener managers
const authStatusListener = createListener('auth-status');
const connectionStatusListener = createListener('connection-status');
const connectionErrorListener = createListener('connection-error');
const trafficUpdateListener = createListener('traffic-update');
const limitExceededListener = createListener('limit-exceeded');
const usageUpdateListener = createListener('usage-update');

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

    // Usage
    startPolling: () => ipcRenderer.invoke('usage:start-polling'),
    stopPolling: () => ipcRenderer.invoke('usage:stop-polling'),
    refreshUsage: () => ipcRenderer.invoke('usage:refresh'),

    // Platform
    platform: process.platform,

    // Events from main process
    onAuthStatus: (callback) => authStatusListener.on(callback),
    onConnectionStatus: (callback) => connectionStatusListener.on(callback),
    onConnectionError: (callback) => connectionErrorListener.on(callback),
    onTrafficUpdate: (callback) => trafficUpdateListener.on(callback),
    onLimitExceeded: (callback) => limitExceededListener.on(callback),
    onUsageUpdate: (callback) => usageUpdateListener.on(callback),

    // Cleanup: remove all listeners (call on page unload)
    removeAllListeners: () => {
        authStatusListener.removeAll();
        connectionStatusListener.removeAll();
        connectionErrorListener.removeAll();
        trafficUpdateListener.removeAll();
        limitExceededListener.removeAll();
        usageUpdateListener.removeAll();
    },
});
