'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set(['stroke:start', 'stroke:points', 'stroke:end', 'tool:set', 'undo', 'clear', 'quit']);
const RECV = new Set(['stroke:start', 'stroke:points', 'stroke:end', 'undo', 'clear', 'tool:state']);

contextBridge.exposeInMainWorld('kresleni', {
  ready: () => ipcRenderer.invoke('ready'),
  save: (buffer) => ipcRenderer.invoke('save', buffer),
  send: (channel, data) => {
    if (SEND.has(channel)) ipcRenderer.send(channel, data);
  },
  on: (channel, callback) => {
    if (RECV.has(channel) && typeof callback === 'function') {
      ipcRenderer.on(channel, (_event, data) => callback(data));
    }
  },
});
