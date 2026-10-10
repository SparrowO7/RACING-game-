// Electron entry point for the desktop build.
//
// The game is loaded over a privileged custom `game://` scheme rather than `file://`.
// That matters because ES modules are blocked by CORS on file:// URLs, which is why this
// previously had to run with webSecurity disabled. A standard, secure scheme lets the
// module graph load normally, so web security stays ON and the two
// --disable-web-security / --allow-file-access-from-files switches are gone.
//
// Three.js is vendored in vendor/, so the window needs no network access at all.

const { app, BrowserWindow, screen, protocol, net, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const isDev = process.argv.includes('--dev');

let mainWindow = null;

// Must run before `app.ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'game',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function resolveIcon() {
  for (const name of ['icon.ico', 'icon.png']) {
    const p = path.join(ROOT, 'assets', name);
    if (fs.existsSync(p)) return p;
  }
  return undefined; // Electron falls back to its own icon rather than showing nothing
}

// Serve project files under game://app/… , refusing anything outside the project root.
function registerGameProtocol() {
  protocol.handle('game', async (request) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (!rel || rel === '/') rel = '/index.html';

    const filePath = path.normalize(path.join(ROOT, rel));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      return new Response('Not found: ' + rel, { status: 404 });
    }
  });
}

function showStartupError(message, detail) {
  dialog.showErrorBox(message, String(detail || '').slice(0, 2000));
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(900, height),
    minWidth: 1024,
    minHeight: 600,
    title: 'NEON STREET RUN',
    icon: resolveIcon(),
    backgroundColor: '#080b16', // matches the game's --ink, so no white flash on open
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // left at their secure defaults now that the game loads over game://
    },
    fullscreenable: true,
    autoHideMenuBar: true,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // --- renderer failure handling: report instead of leaving a blank window ---
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return; // aborted (normal on in-page navigation)
    showStartupError('NEON STREET RUN could not load', `${desc} (${code})\n${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    showStartupError('The game renderer stopped', `reason: ${details.reason}`);
  });
  mainWindow.webContents.on('preload-error', (_e, file, error) => {
    showStartupError('Preload failed', `${file}\n${error}`);
  });

  // keep navigation inside the game; send real links to the user's browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL('game://app/index.html').catch((err) => {
    showStartupError('NEON STREET RUN could not start', err && err.message);
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// a second launch focuses the existing window instead of opening another
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerGameProtocol();
    createWindow();
  }).catch((err) => showStartupError('NEON STREET RUN failed to start', err && err.stack));

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
