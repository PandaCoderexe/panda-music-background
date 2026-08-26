const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panda', {
  platform: process.platform,
  forcedAudioSource: process.env.PANDA_AUDIO || null,
  onNowPlaying: (cb) => ipcRenderer.on('now-playing', (_e, info) => cb(info)),
  onLyrics: (cb) => ipcRenderer.on('lyrics', (_e, payload) => cb(payload)),
  refreshNowPlaying: () => ipcRenderer.invoke('refresh-now-playing')
});
