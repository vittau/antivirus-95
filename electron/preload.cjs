// Sandboxed preload (hence CommonJS): the page's only way to reach the shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('antivirusDesktop', {
  quit: () => ipcRenderer.send('quit'),
});
