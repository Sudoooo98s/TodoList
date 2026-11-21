const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('data:get'),
  addTask: (task) => ipcRenderer.invoke('task:add', task),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', { id, patch }),
  toggleTask: (id) => ipcRenderer.invoke('task:toggle', id),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),
  restoreTask: (task) => ipcRenderer.invoke('task:restore', task),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  confirmImport: () => ipcRenderer.invoke('data:import-confirm'),
  cancelImport: () => ipcRenderer.invoke('data:import-cancel'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  closeFloat: () => ipcRenderer.invoke('float:close'),
  testNotify: () => ipcRenderer.invoke('notify:test'),
  focusTask: (id) => ipcRenderer.send('task:focus', id),
  showMain: () => ipcRenderer.send('win:show'),
  hideMain: () => ipcRenderer.send('win:hide'),
  minimizeMain: () => ipcRenderer.send('win:minimize'),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', (e, d) => cb(d)),
  onTaskFocus: (cb) => ipcRenderer.on('task:focus', (e, id) => cb(id)),
});
