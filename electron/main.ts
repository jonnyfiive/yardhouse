import { app, BrowserWindow, shell, dialog, Menu } from 'electron'
import * as path from 'path'
import { spawn, ChildProcess, execSync } from 'child_process'
import * as fs from 'fs'
import * as net from 'net'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null
let flaskProcess: ChildProcess | null = null
const FLASK_PORT = 5050

// ---------------------------------------------------------------------------
// Paths — in production, bundled files start in Contents/Resources/server/
// but get copied to ~/Library/Application Support/Yardhouse/ so that token
// files, briefing-data.json, etc. can be written at runtime.
// In dev mode, everything lives in the project root.
// ---------------------------------------------------------------------------

/** Read-only source in the app bundle (production only) */
function getBundledServerDir(): string {
  return path.join(process.resourcesPath, 'server')
}

/** Writable server dir — used as cwd for Flask */
function getServerDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'server')
  }
  return path.join(__dirname, '..')
}

/**
 * Copy bundled server files to the writable Application Support dir.
 * Only copies files that are missing or older than the bundle version.
 * This runs once on first launch and again after app updates.
 */
function syncServerFiles(): void {
  if (!app.isPackaged) return

  const src = getBundledServerDir()
  const dest = getServerDir()

  if (!fs.existsSync(src)) {
    console.error('[Yardhouse] Bundled server dir not found:', src)
    return
  }

  // Create dest dir if needed
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  // Version marker — re-copy when app version changes
  const versionFile = path.join(dest, '.app-version')
  const currentVersion = app.getVersion()
  let installedVersion = ''
  try {
    installedVersion = fs.readFileSync(versionFile, 'utf-8').trim()
  } catch {
    // first launch
  }

  const needsFullSync = installedVersion !== currentVersion

  // Files to always sync from bundle (code + config)
  const alwaysSyncFiles = [
    'dashboard_server.py',
    'qbo_integration.py',
    'email_poller.py',
    '.env',
    'requirements.txt',
  ]

  // Files to only copy if missing (user data that gets modified at runtime)
  const copyIfMissingFiles = [
    'briefing-data.json',
    'email_poll_state.json',
    '.qbo_tokens.json',
    'production-data.json',
    'receipt-number.json',
  ]

  for (const file of alwaysSyncFiles) {
    const srcFile = path.join(src, file)
    const destFile = path.join(dest, file)
    if (fs.existsSync(srcFile) && needsFullSync) {
      fs.copyFileSync(srcFile, destFile)
      console.log(`[Yardhouse] Synced ${file}`)
    } else if (fs.existsSync(srcFile) && !fs.existsSync(destFile)) {
      fs.copyFileSync(srcFile, destFile)
      console.log(`[Yardhouse] Copied ${file} (first time)`)
    }
  }

  for (const file of copyIfMissingFiles) {
    const srcFile = path.join(src, file)
    const destFile = path.join(dest, file)
    if (fs.existsSync(srcFile) && !fs.existsSync(destFile)) {
      fs.copyFileSync(srcFile, destFile)
      console.log(`[Yardhouse] Copied ${file} (first time)`)
    }
  }

  // Write version marker
  if (needsFullSync) {
    fs.writeFileSync(versionFile, currentVersion)
    console.log(`[Yardhouse] Server files synced for v${currentVersion}`)
  }
}

function getEnvPath(): string {
  return path.join(getServerDir(), '.env')
}

// ---------------------------------------------------------------------------
// Python detection — find python3 on the system
// ---------------------------------------------------------------------------
function findPython(): string | null {
  const candidates = ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3']
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // Fallback: check PATH
  try {
    const result = execSync('which python3', { encoding: 'utf-8' }).trim()
    if (result) return result
  } catch {
    // not found
  }
  return null
}

// ---------------------------------------------------------------------------
// Check if a port is in use (Flask already running)
// ---------------------------------------------------------------------------
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

// ---------------------------------------------------------------------------
// Wait for Flask to respond to /health
// ---------------------------------------------------------------------------
function waitForFlask(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      const http = require('http')
      const req = http.get(`http://127.0.0.1:${FLASK_PORT}/health`, (res: any) => {
        resolve(true)
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          resolve(false)
        } else {
          setTimeout(check, 300)
        }
      })
      req.setTimeout(2000, () => {
        req.destroy()
        if (Date.now() - start > timeoutMs) {
          resolve(false)
        } else {
          setTimeout(check, 300)
        }
      })
    }
    check()
  })
}

// ---------------------------------------------------------------------------
// Install Python dependencies if missing
// ---------------------------------------------------------------------------
function pipInstall(pythonPath: string, packages: string): boolean {
  const pipCommands = [
    `${pythonPath} -m pip install --break-system-packages --user ${packages}`,
    `${pythonPath} -m pip install --break-system-packages ${packages}`,
    `${pythonPath} -m pip install --user ${packages}`,
    `${pythonPath} -m pip install ${packages}`,
  ]

  for (const cmd of pipCommands) {
    try {
      console.log(`[Yardhouse] Trying: ${cmd}`)
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 180000, stdio: 'pipe' })
      console.log(`[Yardhouse] pip output: ${output.slice(-200)}`)
      return true
    } catch (e: any) {
      console.log(`[Yardhouse] pip command failed: ${e.stderr?.slice?.(-300) || e.message}`)
      continue
    }
  }
  return false
}

function ensurePythonDeps(pythonPath: string): boolean {
  // Quick check: try importing flask
  try {
    execSync(`${pythonPath} -c "import flask"`, { stdio: 'ignore', timeout: 10000 })
    console.log('[Yardhouse] Flask already installed.')
    return true
  } catch {
    console.log('[Yardhouse] Flask not found, installing dependencies...')
  }

  // Check if pip is available
  try {
    execSync(`${pythonPath} -m pip --version`, { stdio: 'ignore', timeout: 10000 })
  } catch {
    console.error('[Yardhouse] pip not available')
    dialog.showErrorBox(
      'pip Not Found',
      'Yardhouse needs pip to install Python packages.\n\n' +
      'Please run this in Terminal:\n\n' +
      'python3 -m ensurepip --upgrade'
    )
    return false
  }

  // --- Tier 1: Core packages (required for the app to work) ---
  const corePackages = 'flask flask-cors requests python-dotenv'
  console.log('[Yardhouse] Installing core packages...')
  const coreOk = pipInstall(pythonPath, corePackages)

  if (!coreOk) {
    dialog.showErrorBox(
      'Dependency Install Failed',
      'Could not install core Python packages automatically.\n\n' +
      'Please run this in Terminal:\n\n' +
      `${pythonPath} -m pip install --break-system-packages ${corePackages}\n\n` +
      'Then relaunch Yardhouse.'
    )
    return false
  }

  // Verify flask is importable
  try {
    execSync(`${pythonPath} -c "import flask"`, { stdio: 'ignore', timeout: 10000 })
    console.log('[Yardhouse] Core packages installed successfully.')
  } catch {
    dialog.showErrorBox(
      'Dependency Install Failed',
      'pip ran but Flask is still not importable.\n\n' +
      'Please run this in Terminal:\n\n' +
      `${pythonPath} -m pip install --break-system-packages ${corePackages}\n\n` +
      'Then relaunch Yardhouse.'
    )
    return false
  }

  // --- Tier 2: Optional packages (QBO, email, AI chat — app works without them) ---
  const optionalPackages = 'anthropic python-quickbooks intuitlib msal'
  console.log('[Yardhouse] Installing optional packages (QBO, email, AI)...')
  const optOk = pipInstall(pythonPath, optionalPackages)
  if (optOk) {
    console.log('[Yardhouse] All optional packages installed.')
  } else {
    console.log('[Yardhouse] Some optional packages failed — QBO/email/chat may be limited.')
  }

  return true
}

// ---------------------------------------------------------------------------
// Start the Flask server
// ---------------------------------------------------------------------------
async function startFlask(): Promise<boolean> {
  // Check if Flask is already running (e.g., dev mode with manual server)
  const alreadyRunning = await isPortInUse(FLASK_PORT)
  if (alreadyRunning) {
    console.log(`[Yardhouse] Flask already running on port ${FLASK_PORT}`)
    return true
  }

  const pythonPath = findPython()
  if (!pythonPath) {
    dialog.showErrorBox(
      'Python Not Found',
      'Yardhouse requires Python 3 which should be pre-installed on macOS.\n\n' +
      'Please install Python 3 from python.org or run:\n' +
      'xcode-select --install'
    )
    return false
  }

  console.log(`[Yardhouse] Using Python: ${pythonPath}`)

  // Install dependencies if needed
  const depsOk = ensurePythonDeps(pythonPath)
  if (!depsOk) return false

  const serverDir = getServerDir()
  const serverScript = path.join(serverDir, 'dashboard_server.py')

  if (!fs.existsSync(serverScript)) {
    dialog.showErrorBox(
      'Server Not Found',
      `Could not find dashboard_server.py at:\n${serverScript}`
    )
    return false
  }

  // Build environment: inherit system env + load our .env
  const env: Record<string, string> = { ...process.env as Record<string, string> }
  const envPath = getEnvPath()
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const eq = trimmed.indexOf('=')
        if (eq > 0) {
          env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
        }
      }
    }
  }

  // Collect Flask stderr for error reporting
  let flaskStderr = ''

  console.log('[Yardhouse] Starting Flask server...')
  flaskProcess = spawn(pythonPath, [serverScript], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Log Flask output
  flaskProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[Flask] ${data.toString().trim()}`)
  })
  flaskProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    console.log(`[Flask] ${msg}`)
    flaskStderr += msg + '\n'
  })

  flaskProcess.on('error', (err) => {
    console.error('[Yardhouse] Flask process error:', err)
  })

  flaskProcess.on('exit', (code, signal) => {
    console.log(`[Yardhouse] Flask exited (code=${code}, signal=${signal})`)
    flaskProcess = null
  })

  // Wait for Flask to be ready
  const ready = await waitForFlask(25000)
  if (!ready) {
    console.error('[Yardhouse] Flask failed to start within timeout')
    // Extract useful error info
    const lastLines = flaskStderr.split('\n').filter(l => l.trim()).slice(-8).join('\n')
    dialog.showErrorBox(
      'Backend Server Failed',
      'The Yardhouse backend could not start.\n\n' +
      (lastLines
        ? `Error details:\n${lastLines}\n\n`
        : '') +
      'To fix this, open Terminal and run:\n\n' +
      `python3 -m pip install --break-system-packages flask flask-cors requests python-dotenv\n\n` +
      'Then relaunch Yardhouse.'
    )
    return false
  }

  console.log('[Yardhouse] Flask server is ready!')
  return true
}

// ---------------------------------------------------------------------------
// Kill Flask on shutdown
// ---------------------------------------------------------------------------
function stopFlask(): void {
  if (flaskProcess) {
    console.log('[Yardhouse] Stopping Flask server...')
    flaskProcess.kill('SIGTERM')
    // Force kill after 3 seconds if still running
    setTimeout(() => {
      if (flaskProcess && !flaskProcess.killed) {
        flaskProcess.kill('SIGKILL')
      }
    }, 3000)
    flaskProcess = null
  }
}

// ---------------------------------------------------------------------------
// Create the Electron window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#ECECEC',
    show: false, // Don't show until ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // In production, load the built HTML
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Show window once content is loaded
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Register Cmd+P for native print
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if ((input.meta || input.control) && input.key.toLowerCase() === 'p') {
      _event.preventDefault()
      mainWindow?.webContents.executeJavaScript('window.print()')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ---------------------------------------------------------------------------
// Application menu — adds "Check for Updates" under Yardhouse menu
// ---------------------------------------------------------------------------
function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => {
            if (!app.isPackaged) {
              dialog.showMessageBox({ message: 'Updates are only available in the packaged app.', buttons: ['OK'] })
              return
            }
            autoUpdater.checkForUpdates().then((result) => {
              if (!result || !result.updateInfo || result.updateInfo.version === app.getVersion()) {
                dialog.showMessageBox({
                  type: 'info',
                  title: 'No Updates',
                  message: `Yardhouse v${app.getVersion()} is up to date.`,
                  buttons: ['OK'],
                })
              }
            }).catch((err) => {
              dialog.showMessageBox({
                type: 'warning',
                title: 'Update Check Failed',
                message: `Could not check for updates.\n\n${err?.message || err}`,
                buttons: ['OK'],
              })
            })
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------------------
// Auto-updater — checks GitHub Releases for new versions
// ---------------------------------------------------------------------------
function setupAutoUpdater(): void {
  if (!app.isPackaged) return // skip in dev mode

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // For unsigned apps on macOS
  autoUpdater.forceDevUpdateConfig = false

  autoUpdater.on('update-available', (info) => {
    console.log(`[Yardhouse] Update available: v${info.version}`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Yardhouse] Update downloaded: v${info.version}`)
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Yardhouse v${info.version} is ready to install.`,
      detail: 'Click Restart Now to update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true)
      }
    })
  })

  autoUpdater.on('error', (err) => {
    console.log(`[Yardhouse] Auto-update error: ${err.message}`)
    // Silent fail — don't bother the user if update check fails
  })

  // Check for updates (silent, no user prompt if no update)
  autoUpdater.checkForUpdates().catch(() => {})
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  // Sync bundled server files to writable location
  syncServerFiles()

  const flaskOk = await startFlask()
  if (!flaskOk) {
    app.quit()
    return
  }
  createWindow()
  buildAppMenu()

  // Check for updates after window is shown
  setTimeout(() => setupAutoUpdater(), 3000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopFlask()
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

app.on('before-quit', () => {
  stopFlask()
})
