const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !!process.env.VITE_DEV_SERVER_URL

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
    },
  })

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    const index = path.join(__dirname, '..', 'dist', 'index.html')
    if (!fs.existsSync(index)) {
      throw new Error('dist/index.html not found. Run "npm run build" first.')
    }
    win.loadFile(index)
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
