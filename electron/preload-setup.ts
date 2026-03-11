import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('setupBridge', {
  submit: (ip: string) => ipcRenderer.send('setup-ip-submit', ip),
})
