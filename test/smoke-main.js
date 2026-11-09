'use strict';

/**
 * Smoke test: spustí aplikaci se dvěma „falešnými“ monitory vedle sebe,
 * nasimuluje tah, který začne v prvním okně a skončí ve druhém, a ověří,
 * že se kresba objeví na obou plátnech, že funguje zpět/smazat i uložení.
 *
 * Spuštění (na Linuxu bez displeje):  xvfb-run -a npx electron --no-sandbox test/smoke-main.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

// Falešné monitory mají scaleFactor 1 – vynutíme ho i pro skutečný displej
// (jinak testy selžou na počítači se škálováním 125/150 %).
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// macOS: falešné monitory fyzicky neexistují. Simple fullscreen by obě okna „přicvakl“
// na jedinou skutečnou obrazovku (0,0), okno A by zakrylo okno B a macOS by zakryté okno
// přestal vykreslovat. V testu proto simple fullscreen vypneme a vykreslování necháme běžet.
if (process.platform === 'darwin') {
  BrowserWindow.prototype.setSimpleFullScreen = function () {};
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

const W = 800;
const H = 600;
const fake = [
  { id: 101, bounds: { x: 0, y: 0, width: W, height: H }, scaleFactor: 1 },
  { id: 102, bounds: { x: W, y: 0, width: W, height: H }, scaleFactor: 1 },
];

const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kresleni-test-'));
process.env.KRESLENI_SAVE_DIR = saveDir;

// Vlastní userData = vlastní zámek jedné instance. Jinak by test při souběžně běžící
// aplikaci tiše skončil (main.js zavolá app.quit()) s kódem 0, aniž by cokoli ověřil.
app.setPath('userData', path.join(saveDir, 'userData'));
let finished = false;
app.on('will-quit', (e) => {
  if (finished) return;
  e.preventDefault();
  console.log('FAIL  aplikace skončila dřív, než test doběhl');
  app.exit(1);
});

let state; // sdílený stav z main.js (načte se až po „ready“, kdy jde použít modul screen)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failed++;
}

// Spočítá neprůhledné pixely na plátně okna a vrátí i barvu jednoho bodu.
const inspect = (win, px, py) =>
  win.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('board');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    const p = g.getImageData(${px}, ${py}, 1, 1).data;
    return { n, w: c.width, h: c.height, p: [p[0], p[1], p[2], p[3]] };
  })()`);

const mouse = (win, type, x, y, down) =>
  win.webContents.sendInputEvent({
    type,
    x,
    y,
    button: 'left',
    clickCount: 1,
    modifiers: down ? ['leftButtonDown'] : [],
  });

app.whenReady().then(async () => {
  try {
    screen.getAllDisplays = () => fake; // dva „monitory“ vedle sebe
    ({ state } = require('../main.js'));
    await sleep(3500);
    const wins = BrowserWindow.getAllWindows().sort((a, b) => a.getBounds().x - b.getBounds().x);
    check('vzniklo 2 oken', wins.length === 2, 'oken: ' + wins.length);
    if (wins.length !== 2) throw new Error('chybí okna');
    const [a, b] = wins;
    console.log('bounds A', JSON.stringify(a.getBounds()), 'bounds B', JSON.stringify(b.getBounds()));

    // Barva: červená (klik na swatch přes JS), štětec střední.
    await a.webContents.executeJavaScript(`document.querySelector('.swatch[data-color="#e53935"]').click()`);
    await sleep(200);
    check('barva se přenesla do hlavního procesu', state.tool.color === '#e53935', state.tool.color);

    // Tah v okně A od x=700 přes hranici (800) až do x=900 (už „na“ okně B).
    mouse(a, 'mouseMove', 700, 300, false);
    mouse(a, 'mouseDown', 700, 300, true);
    for (let x = 710; x <= 900; x += 10) {
      mouse(a, 'mouseMove', x, 300, true);
      await sleep(12);
    }
    mouse(a, 'mouseUp', 900, 300, false);
    await sleep(600);

    check('hlavní proces má 1 tah', state.strokes.length === 1, 'tahů: ' + state.strokes.length);
    const s = state.strokes[0];
    const maxX = s ? Math.max(...s.points.map((p) => p[0])) : 0;
    check('tah pokračuje za hranici okna A (globální x > 800)', maxX > 850, 'max x = ' + maxX);
    check('tah je ukončený', s && s.done === true);

    const ia = await inspect(a, 750, 300);
    const ib = await inspect(b, 50, 300); // globální x = 850
    check('okno A obsahuje kresbu', ia.n > 500, 'pixelů: ' + ia.n);
    check('okno B obsahuje pokračování tahu', ib.n > 500, 'pixelů: ' + ib.n);
    check('barva v okně B je červená', ib.p[3] > 0 && ib.p[0] > 200 && ib.p[1] < 100, JSON.stringify(ib.p));

    // Zpět
    await a.webContents.executeJavaScript(`document.getElementById('btn-undo').click()`);
    await sleep(400);
    const ia2 = await inspect(a, 750, 300);
    const ib2 = await inspect(b, 50, 300);
    check(
      'zpět smaže tah ve všech oknech',
      state.strokes.length === 0 && ia2.n === 0 && ib2.n === 0,
      `A=${ia2.n} B=${ib2.n}`,
    );

    // Druhý tah z okna B (zleva doprava), pak guma přes část tahu.
    mouse(b, 'mouseMove', 100, 200, false);
    mouse(b, 'mouseDown', 100, 200, true);
    for (let x = 110; x <= 300; x += 10) {
      mouse(b, 'mouseMove', x, 200, true);
      await sleep(12);
    }
    mouse(b, 'mouseUp', 300, 200, false);
    await sleep(400);
    const before = await inspect(a, 10, 10);
    const ib3 = await inspect(b, 200, 200);
    check('tah z okna B se nakreslil', ib3.n > 500 && ib3.p[3] > 0, 'pixelů: ' + ib3.n);
    check('okno A tah z okna B nekreslí (je mimo něj)', before.n === 0, 'pixelů: ' + before.n);

    await b.webContents.executeJavaScript(`document.getElementById('btn-eraser').click()`);
    await sleep(200);
    mouse(b, 'mouseMove', 190, 200, false);
    mouse(b, 'mouseDown', 190, 200, true);
    mouse(b, 'mouseMove', 215, 200, true);
    mouse(b, 'mouseUp', 215, 200, false);
    await sleep(300);
    const ib4 = await inspect(b, 200, 200);
    check('guma vymazala kus kresby', ib4.p[3] === 0, JSON.stringify(ib4.p));

    // Uložení
    await a.webContents.executeJavaScript(`document.getElementById('btn-save').click()`);
    await sleep(1500);
    const dir = path.join(saveDir, 'Kresleni');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    check('PNG se uložil', files.length === 1 && /\.png$/.test(files[0]), files.join(','));
    if (files.length) {
      const buf = fs.readFileSync(path.join(dir, files[0]));
      check('soubor je platné PNG', buf.slice(1, 4).toString() === 'PNG', buf.length + ' B');
      const wPx = buf.readUInt32BE(16);
      const hPx = buf.readUInt32BE(20);
      check('PNG má rozměr celého plátna', wPx === 2 * W && hPx === H, `${wPx}x${hPx}`);
    }

    // Smazat vše (dvě klepnutí)
    await a.webContents.executeJavaScript(`document.getElementById('btn-clear').click()`);
    await sleep(150);
    check('první klepnutí na Smazat jen žádá potvrzení', state.strokes.length > 0);
    await a.webContents.executeJavaScript(`document.getElementById('btn-clear').click()`);
    await sleep(400);
    check('druhé klepnutí smaže vše', state.strokes.length === 0);
  } catch (err) {
    console.log('CHYBA TESTU', err);
    failed++;
  }
  console.log(failed ? `\nSELHALO: ${failed}` : '\nVšechno prošlo');
  finished = true;
  app.exit(failed ? 1 : 0);
});
