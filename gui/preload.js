// 预加载脚本：通过 contextBridge 暴露安全的 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('echos', {
  getState: () => ipcRenderer.invoke('get-state'),
  start: () => ipcRenderer.invoke('start'),
  stop: () => ipcRenderer.invoke('stop'),
  restart: () => ipcRenderer.invoke('restart'),
  setSystemProxy: (enabled) => ipcRenderer.invoke('set-system-proxy', enabled),
  getSystemProxySummary: () => ipcRenderer.invoke('get-system-proxy-summary'),
  setRouteMode: (mode) => ipcRenderer.invoke('set-route-mode', mode),
  saveServer: (server) => ipcRenderer.invoke('save-server', server),
  deleteServer: (id) => ipcRenderer.invoke('delete-server', id),
  selectServer: (id) => ipcRenderer.invoke('select-server', id),
  importServers: (list) => ipcRenderer.invoke('import-servers', list),
  exportServers: () => ipcRenderer.invoke('export-servers'),
  importFromFile: () => ipcRenderer.invoke('import-from-file'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  selfCheck: () => ipcRenderer.invoke('self-check'),
  revealLogs: () => ipcRenderer.invoke('reveal-logs'),
  openUpdateUrl: (url) => ipcRenderer.invoke('open-update-url', url),
  subscribeKernelLogs: (on) => ipcRenderer.invoke('subscribe-kernel-logs', on),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onLogLine: (cb) => ipcRenderer.on('log-line', (_e, l) => cb(l)),
  onKernelLog: (cb) => ipcRenderer.on('kernel-log', (_e, l) => cb(l)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, r) => cb(r))
});