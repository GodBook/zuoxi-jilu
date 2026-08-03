import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '../shared/类型'

const api: AppApi = {
  getDay: (date) => ipcRenderer.invoke('get-day', date),
  upsertSleep: (record) => ipcRenderer.invoke('upsert-sleep', record),
  upsertMeal: (record) => ipcRenderer.invoke('upsert-meal', record),
  deleteRecord: (type, id, permanent) => ipcRenderer.invoke('delete-record', type, id, permanent),
  restoreRecord: (type, id) => ipcRenderer.invoke('restore-record', type, id),
  listCalendar: (range) => ipcRenderer.invoke('list-calendar', range),
  listTrash: () => ipcRenderer.invoke('list-trash'),
  getAnalysis: (range) => ipcRenderer.invoke('get-analysis', range),
  exportCsv: (range) => ipcRenderer.invoke('export-csv', range),
  createBackup: () => ipcRenderer.invoke('create-backup'),
  restoreBackup: () => ipcRenderer.invoke('restore-backup'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme)
}

contextBridge.exposeInMainWorld('作息记录', api)
