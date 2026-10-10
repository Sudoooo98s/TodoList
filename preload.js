const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('data:get'),
  addTask: (task) => ipcRenderer.invoke('task:add', task),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', { id, patch }),
  toggleTask: (id) => ipcRenderer.invoke('task:toggle', id),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  closeFloat: () => ipcRenderer.invoke('float:close'),
  testNotify: () => ipcRenderer.invoke('notify:test'),
  showMain: () => ipcRenderer.send('win:show'),
  hideMain: () => ipcRenderer.send('win:hide'),
  minimizeMain: () => ipcRenderer.send('win:minimize'),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', (e, d) => cb(d)),
});
