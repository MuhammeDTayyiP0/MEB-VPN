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
});
