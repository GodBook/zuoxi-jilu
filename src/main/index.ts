import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DataStore } from './数据存储'
import type { DateRange, RecordType, ThemeMode } from '../shared/类型'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR
if (portableRoot) app.setPath('userData', path.join(portableRoot, 'data'))
else app.setPath('userData', path.join(app.getPath('appData'), '作息记录'))

let store: DataStore

function registerIpc(): void {
  ipcMain.handle('get-day', (_event, date: string) => store.getDay(date))
  ipcMain.handle('upsert-sleep', (_event, record) => store.upsertSleep(record))
  ipcMain.handle('upsert-meal', (_event, record) => store.upsertMeal(record))
  ipcMain.handle('delete-record', (_event, type: RecordType, id: string, permanent?: boolean) => store.deleteRecord(type, id, permanent))
  ipcMain.handle('restore-record', (_event, type: RecordType, id: string) => store.restoreRecord(type, id))
  ipcMain.handle('list-calendar', (_event, range: DateRange) => store.listCalendar(range))
  ipcMain.handle('list-trash', () => store.listTrash())
  ipcMain.handle('get-analysis', (_event, range: DateRange) => store.getAnalysis(range))
  ipcMain.handle('get-settings', () => store.getSettings())
  ipcMain.handle('set-theme', (_event, theme: ThemeMode) => store.setTheme(theme))
  ipcMain.handle('export-csv', async (_event, range: DateRange) => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '选择导出位置' })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const directory = path.join(result.filePaths[0], `作息记录导出-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    await store.writeCsv(directory, range)
    return { canceled: false, directory }
  })
  ipcMain.handle('create-backup', async () => {
    const result = await dialog.showSaveDialog({ title: '保存作息记录备份', defaultPath: path.join(store.directory, `作息记录备份-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: '作息记录备份', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return { canceled: true }
    await store.createBackup(result.filePath)
    return { canceled: false, path: result.filePath }
  })
  ipcMain.handle('restore-backup', async () => {
    const result = await dialog.showOpenDialog({ title: '选择作息记录备份', properties: ['openFile'], filters: [{ name: '作息记录备份', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const safety = path.join(store.directory, `恢复前备份-${Date.now()}.json`)
    await fs.mkdir(store.directory, { recursive: true })
    await store.createBackup(safety)
    await store.restoreBackup(result.filePaths[0])
    return { canceled: false, restored: true, path: result.filePaths[0] }
  })
}

async function createWindow(): Promise<void> {
  store = new DataStore()
  await store.initialize()
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: '作息记录',
    backgroundColor: '#F6F8F7',
    webPreferences: {
      preload: path.join(currentDirectory, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(path.join(currentDirectory, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"] } })
  })
  registerIpc()
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
