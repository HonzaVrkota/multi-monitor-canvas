'use strict';

/**
 * Kreslení přes všechny monitory.
 *
 * Princip: na každém monitoru běží jedno okno bez rámečku, které ho celé zakrývá.
 * Kresba je jedna a sdílená – tahy se ukládají v globálních souřadnicích plochy
 * (stejné, jaké používá Electron v display.bounds) a každé okno si vykreslí jen
 * svůj výřez. Díky tomu lze tah vést plynule z jednoho monitoru na druhý.
 */

const { app, BrowserWindow, screen, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Na Linuxu je pro přesné umístění oken potřeba X11 (Wayland polohu oken ignoruje).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

// ---------------------------------------------------------------------------
// Sdílený stav
// ---------------------------------------------------------------------------
const state = {
  strokes: [],
  tool: { color: '#1e88e5', size: 10, eraser: false, pressure: true },
};
const strokeById = new Map();

const windows = new Map(); // display.id -> BrowserWindow
const infoByWc = new Map(); // webContents.id -> { win, displayId }
const retired = new WeakSet(); // okna zavřená schválně při přestavbě
let quitting = false;
let builtSignature = '';
let rebuildTimer = null;

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------
const isPt = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const isColor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
const isId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 64;

function virtualBounds() {
  const ds = screen.getAllDisplays();
  const x1 = Math.min(...ds.map((d) => d.bounds.x));
  const y1 = Math.min(...ds.map((d) => d.bounds.y));
  const x2 = Math.max(...ds.map((d) => d.bounds.x + d.bounds.width));
  const y2 = Math.max(...ds.map((d) => d.bounds.y + d.bounds.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function displaysSignature() {
  return screen
    .getAllDisplays()
    .map((d) => [d.id, d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height, d.scaleFactor].join(':'))
    .sort()
    .join('|');
}

function broadcast(channel, data, exceptWcId) {
  for (const { win } of infoByWc.values()) {
    if (win.isDestroyed()) continue;
    if (exceptWcId !== undefined && win.webContents.id === exceptWcId) continue;
    win.webContents.send(channel, data);
  }
}

function quitApp() {
  quitting = true;
  app.quit();
}

function undoLast() {
  const s = state.strokes.pop();
  if (!s) return;
  strokeById.delete(s.id);
  broadcast('undo', { id: s.id });
}

function clearAll() {
  state.strokes.length = 0;
  strokeById.clear();
  broadcast('clear', {});
}

// ---------------------------------------------------------------------------
// Okna
// ---------------------------------------------------------------------------
function placeWindow(win, b) {
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.setAlwaysOnTop(true, 'screen-saver');
}

function createWindow(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    hasShadow: false,
    acceptFirstMouse: true,
    backgroundColor: '#ffffff',
    title: 'Kreslení',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  infoByWc.set(win.webContents.id, { win, displayId: display.id });

  // setVisualZoomLevelLimits vrací promise a potřebuje už existující render frame –
  // volaná hned po vytvoření okna jen odmítla („Render frame was disposed…“).
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key).toLowerCase();
    const ctrl = input.control || input.meta;
    if (ctrl && input.shift && key === 'q') {
      event.preventDefault();
      quitApp();
    } else if (ctrl && !input.shift && key === 'z') {
      event.preventDefault();
      undoLast();
    } else if (key === 'f11' || (ctrl && (key === '+' || key === '-' || key === '=' || key === '0'))) {
      event.preventDefault(); // žádné zoomování ani přepínání celé obrazovky
    }
  });

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    placeWindow(win, b);
    if (process.platform === 'darwin') {
      // macOS: okno na všech Spaces daného monitoru (dítě ho neodswipuje).
      // skipTransformProcessType – jinak by Electron při každém volání
      // na chvíli schoval ikonu v Docku.
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    win.show();
    // macOS: „jednoduchý“ fullscreen (bez animace a vlastního Space) je per okno –
    // roztáhne okno na [window.screen frame] (= display.bounds, ne workArea) a
    // automaticky skryje menu bar a Dock. Úroveň 'screen-saver' je stejně nad nimi.
    if (process.platform === 'darwin') win.setSimpleFullScreen(true);
    // Na Windows s různým DPI občas první nastavení velikosti nesedí – zopakujeme.
    // Na macOS ne – rám okna už spravuje simpleFullScreen.
    setTimeout(() => {
      if (!win.isDestroyed() && process.platform !== 'darwin') placeWindow(win, b);
    }, 250);
  });

  const wcId = win.webContents.id; // po zavření okna už k webContents nejde sáhnout
  win.on('closed', () => {
    infoByWc.delete(wcId);
    if (!retired.has(win) && !quitting) quitApp();
  });

  // Okno může být zničeno (přestavba oken, ukončení) dřív, než se stránka načte –
  // pak loadFile odmítne („Render frame was disposed…“), což je v pořádku.
  win.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch((err) => {
    if (quitting || win.isDestroyed() || retired.has(win)) return;
    console.error('Načtení okna selhalo:', err);
  });
  return win;
}

function rebuildWindows() {
  const signature = displaysSignature();
  if (signature === builtSignature && windows.size > 0) return;
  builtSignature = signature;

  for (const w of windows.values()) {
    if (!w.isDestroyed()) {
      retired.add(w);
      w.destroy();
    }
  }
  windows.clear();
  infoByWc.clear();

  for (const d of screen.getAllDisplays()) {
    windows.set(d.id, createWindow(d));
  }
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuildWindows, 700);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
const trusted = (e) => infoByWc.has(e.sender.id);

ipcMain.handle('ready', (e) => {
  const info = infoByWc.get(e.sender.id);
  if (!info) return null;
  const display = screen.getAllDisplays().find((d) => d.id === info.displayId);
  if (!display) return null;
  return {
    origin: { x: display.bounds.x, y: display.bounds.y },
    size: { width: display.bounds.width, height: display.bounds.height },
    virtual: virtualBounds(),
    strokes: state.strokes,
    tool: state.tool,
  };
});

ipcMain.on('stroke:start', (e, s) => {
  if (!trusted(e) || !s || !isId(s.id) || !isColor(s.color) || !Number.isFinite(s.size)) return;
  if (!Array.isArray(s.points) || !s.points.every(isPt) || strokeById.has(s.id)) return;
  const stroke = {
    id: s.id,
    color: s.color,
    size: s.size,
    eraser: !!s.eraser,
    points: s.points.slice(),
    done: false,
  };
  state.strokes.push(stroke);
  strokeById.set(stroke.id, stroke);
  broadcast('stroke:start', stroke, e.sender.id);
});

ipcMain.on('stroke:points', (e, d) => {
  if (!trusted(e) || !d || !isId(d.id) || !Array.isArray(d.pts) || !d.pts.every(isPt)) return;
  const stroke = strokeById.get(d.id);
  if (!stroke) return;
  for (const p of d.pts) stroke.points.push(p);
  broadcast('stroke:points', { id: d.id, pts: d.pts }, e.sender.id);
});

ipcMain.on('stroke:end', (e, d) => {
  if (!trusted(e) || !d || !isId(d.id)) return;
  const stroke = strokeById.get(d.id);
  if (!stroke) return;
  stroke.done = true;
  broadcast('stroke:end', { id: d.id }, e.sender.id);
});

ipcMain.on('tool:set', (e, patch) => {
  if (!trusted(e) || !patch || typeof patch !== 'object') return;
  const t = state.tool;
  if (isColor(patch.color)) t.color = patch.color.toLowerCase();
  if (Number.isFinite(patch.size) && patch.size >= 1 && patch.size <= 200) t.size = patch.size;
  if (typeof patch.eraser === 'boolean') t.eraser = patch.eraser;
  if (typeof patch.pressure === 'boolean') t.pressure = patch.pressure;
  broadcast('tool:state', t, e.sender.id);
});

ipcMain.on('undo', (e) => {
  if (trusted(e)) undoLast();
});

ipcMain.on('clear', (e) => {
  if (trusted(e)) clearAll();
});

ipcMain.on('quit', (e) => {
  if (trusted(e)) quitApp();
});

ipcMain.handle('save', async (e, buf) => {
  if (!trusted(e)) return { ok: false, error: 'neznámý odesílatel' };
  try {
    const data = Buffer.from(buf);
    if (data.length < 8 || data.length > 400 * 1024 * 1024) throw new Error('neplatná velikost obrázku');
    const dir = path.join(process.env.KRESLENI_SAVE_DIR || app.getPath('pictures'), 'Kresleni');
    await fs.promises.mkdir(dir, { recursive: true });
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
    const file = path.join(dir, `kresba-${stamp}.png`);
    await fs.promises.writeFile(file, data);
    return { ok: true, file, dir };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    for (const w of windows.values()) if (!w.isDestroyed()) w.show();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    rebuildWindows();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, scheduleRebuild);
    }
  });

  // Ukončení „zvenku“ (macOS: Dock → Ukončit, odhlášení, vypnutí) – zavírání
  // oken pak už nesmí znovu volat quitApp.
  app.on('before-quit', () => {
    quitting = true;
  });

  // Přestavba oken (připojení/odpojení monitoru) nesmí aplikaci ukončit.
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });

  // macOS: klik na ikonu v Docku / znovuotevření aplikace. Kdyby žádné okno
  // nežilo (a aplikace se neukončuje), postavíme je znovu.
  app.on('activate', () => {
    if (quitting || !app.isReady()) return;
    const alive = [...windows.values()].filter((w) => !w.isDestroyed());
    if (!alive.length) {
      windows.clear();
      builtSignature = '';
      rebuildWindows();
    } else {
      for (const w of alive) w.show();
    }
  });
}

module.exports = { state };
