// Desktop shell (Steam Deck / Linux, Windows, macOS). Serves the Vite build
// from dist/ over a privileged custom scheme rather than file://, so fetch,
// media streaming and localStorage behave exactly as they do on the web.
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEME = 'app';
// The host stays fixed on purpose: it is the page origin, so every saved
// high score is filed under it. Renaming it would orphan existing scores.
const ORIGIN = `${SCHEME}://antivirus-95`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'dist');

// A plain-text trail of the launch, for when the game won't show up (Steam
// Deck: ~/.config/Antivirus 95/). Chromium's own log, which carries the GPU
// process's errors, goes next to it.
const LOG_DIR = app.getPath('userData');
const LOG = path.join(LOG_DIR, 'antivirus-95.log');
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try {
    appendFileSync(LOG, line);
  } catch {
    /* logging must never take the game down */
  }
}
try {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG, '');
} catch {
  /* read-only home: run without a log */
}

app.commandLine.appendSwitch('enable-logging', 'file');
app.commandLine.appendSwitch('log-file', path.join(LOG_DIR, 'chromium.log'));
log('start', {
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: process.platform,
  argv: process.argv.slice(1),
  env: Object.fromEntries(
    ['XDG_SESSION_TYPE', 'DISPLAY', 'WAYLAND_DISPLAY', 'GAMESCOPE_WAYLAND_DISPLAY', 'SteamDeck', 'SteamGameId', 'LD_PRELOAD'].map(
      (k) => [k, process.env[k] ?? null],
    ),
  ),
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// A game launched from a library is already the player's gesture: start the
// music at boot instead of asking for a key press (see autoplayAllowed()).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// SteamOS: WebGL through ANGLE's Vulkan backend (RADV). Its default OpenGL
// backend drops part of the final full-screen pass on the Deck, leaving a
// black triangle in the lower right. Other Linux keeps Chromium's default;
// `--use-angle=…` on the command line overrides either way.
function isSteamOS() {
  try {
    return /^ID=steamos$/m.test(readFileSync('/etc/os-release', 'utf8'));
  } catch {
    return false;
  }
}
if (process.platform === 'linux' && isSteamOS() && !app.commandLine.hasSwitch('use-angle')) {
  app.commandLine.appendSwitch('use-angle', 'vulkan');
  app.commandLine.appendSwitch('enable-features', 'Vulkan,VulkanFromANGLE,DefaultANGLEVulkan');
  log('SteamOS: ANGLE on Vulkan');
}

app.on('child-process-gone', (_event, details) => log('child process gone', details));
app.on('gpu-info-update', () => log('gpu feature status', app.getGPUFeatureStatus()));

function serveDist() {
  protocol.handle(SCHEME, (req) => {
    const { pathname } = new URL(req.url);
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname);
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    // Forward the headers so <audio> Range requests reach the file loader.
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    fullscreen: true,
    // Shown straight away rather than on 'ready-to-show': a window that
    // waits for its first frame never appears if that frame never comes.
    show: true,
    title: 'Antivirus 95',
    backgroundColor: '#0a0318',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The game loop must keep running at full rate even when unfocused.
      backgroundThrottling: false,
    },
  });

  const wc = win.webContents;
  win.once('ready-to-show', () => log('ready to show'));
  win.on('unresponsive', () => log('window unresponsive'));
  wc.on('did-finish-load', () => log('page loaded'));
  wc.on('did-fail-load', (_e, code, desc, url) => log('page failed', { code, desc, url }));
  wc.on('render-process-gone', (_e, details) => log('renderer gone', details));
  wc.on('console-message', (e) => log(`console.${e.level}`, e.message, `${e.sourceId}:${e.lineNumber}`));

  // F11 / Alt+Enter toggle fullscreen (F alone is the in-game FPS toggle).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // Never navigate away from the game; external links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });

  void win.loadURL(`${ORIGIN}/`);
  return win;
}

app.on('window-all-closed', () => app.quit());

// QUIT GAME on the pause screen (src/desktop.ts).
ipcMain.on('quit', (event) => {
  if (event.senderFrame?.url.startsWith(ORIGIN)) app.quit();
});

app.whenReady().then(() => {
  // macOS keeps the default menu for Cmd+Q / Cmd+Ctrl+F; elsewhere it would
  // only show up as a stray bar.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  log('ready', { gpu: app.getGPUFeatureStatus() });
  serveDist();
  createWindow();
  log('window created');
  app.getGPUInfo('basic').then(
    (info) => log('gpu info', info),
    (err) => log('gpu info failed', String(err)),
  );
});
