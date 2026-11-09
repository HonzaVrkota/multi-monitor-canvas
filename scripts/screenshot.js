'use strict';

/**
 * Generates README screenshots: fakes two 1280x800 monitors side by side, starts the app,
 * draws a demo picture with synthetic mouse input (one wavy stroke and a rainbow cross the
 * boundary between the monitors), captures both windows and composes them into
 * docs/screenshot.png (two monitors on a desk) and docs/screenshot-single.png (one window).
 *
 * Usage: npx electron scripts/screenshot.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

const W = 1280;
const H = 800;
const fake = [
  { id: 201, bounds: { x: 0, y: 0, width: W, height: H }, scaleFactor: 1 },
  { id: 202, bounds: { x: W, y: 0, width: W, height: H }, scaleFactor: 1 },
];

const DOCS = path.join(__dirname, '..', 'docs');
process.env.KRESLENI_SAVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kresleni-shot-'));
// Own userData = own single-instance lock, so a running copy of the app doesn't block the script.
app.setPath('userData', path.join(process.env.KRESLENI_SAVE_DIR, 'userData'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wins = [];

const mouse = (win, type, x, y, down) =>
  win.webContents.sendInputEvent({
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: 1,
    modifiers: down ? ['leftButtonDown'] : [],
  });

// Tool selection by clicking the real toolbar buttons in every window.
async function pick(color, size) {
  for (const w of wins) {
    await w.webContents.executeJavaScript(`(() => {
      document.querySelector('.swatch[data-color="${color}"]').click();
      document.querySelector('#sizes [data-size="${size}"]').click();
    })()`);
  }
  await sleep(80);
}

// Draws one stroke through the given points (global coordinates). The stroke is sent to the
// window under the first point; pointer capture lets it continue onto the neighbouring monitor.
async function stroke(points, step = 9) {
  const win = points[0][0] < W ? wins[0] : wins[1];
  const ox = win === wins[0] ? 0 : W;
  const [x0, y0] = points[0];
  mouse(win, 'mouseMove', x0 - ox, y0, false);
  mouse(win, 'mouseDown', x0 - ox, y0, true);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) {
      mouse(win, 'mouseMove', ax + ((bx - ax) * k) / n - ox, ay + ((by - ay) * k) / n, true);
      await sleep(4);
    }
  }
  const [xe, ye] = points[points.length - 1];
  mouse(win, 'mouseUp', xe - ox, ye, false);
  await sleep(60);
}

const arc = (cx, cy, r, a0, a1, n = 60) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

const spiral = (cx, cy, r, turns = 4) =>
  Array.from({ length: turns * 40 + 1 }, (_, i) => {
    const t = i / 40;
    const rr = (r * i) / (turns * 40);
    return [cx + rr * Math.cos(t * Math.PI * 2), cy + rr * Math.sin(t * Math.PI * 2)];
  });

const dot = (x, y) =>
  stroke([
    [x, y],
    [x + 1, y],
  ]);

async function drawDemo() {
  // The toolbar covers roughly y > 560 on these 1280x800 screens, so the scene sits above it.
  const G = 500; // ground line

  // Sun (right monitor, top right corner)
  await pick('#fdd835', 44);
  for (const r of [56, 34, 12]) await stroke(arc(W + 1080, 150, r, 0, Math.PI * 2.1, 40));
  await pick('#fb8c00', 10);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    await stroke([
      [W + 1080 + 100 * Math.cos(a), 150 + 100 * Math.sin(a)],
      [W + 1080 + 140 * Math.cos(a), 150 + 140 * Math.sin(a)],
    ]);
  }

  // Rainbow spanning both monitors (centered on the boundary)
  const rainbow = ['#e53935', '#fb8c00', '#fdd835', '#2e7d32', '#1e88e5', '#8e24aa'];
  for (let i = 0; i < rainbow.length; i++) {
    await pick(rainbow[i], 22);
    await stroke(arc(W, G, 330 - i * 21, Math.PI, Math.PI * 2, 90));
  }

  // House (left monitor)
  await pick('#8d5524', 10);
  await stroke([
    [170, G - 180],
    [170, G],
    [430, G],
    [430, G - 180],
    [170, G - 180],
  ]);
  await pick('#e53935', 22);
  await stroke([
    [140, G - 170],
    [300, G - 310],
    [460, G - 170],
    [140, G - 170],
  ]);
  await pick('#1e88e5', 10);
  const wy = G - 140;
  await stroke([
    [210, wy],
    [280, wy],
    [280, wy + 60],
    [210, wy + 60],
    [210, wy],
  ]);
  await stroke([
    [245, wy],
    [245, wy + 60],
  ]);
  await stroke([
    [210, wy + 30],
    [280, wy + 30],
  ]);
  await pick('#8d5524', 22);
  await stroke([
    [340, G],
    [340, G - 100],
    [390, G - 100],
    [390, G],
  ]);
  await pick('#fdd835', 10);
  await dot(376, G - 50);
  await pick('#9e9e9e', 10);
  await stroke(spiral(390, G - 350, 20, 2));
  await stroke(spiral(420, G - 400, 28, 2));

  // Tree (right monitor)
  await pick('#8d5524', 22);
  await stroke([
    [W + 820, G],
    [W + 822, G - 140],
  ]);
  await pick('#2e7d32', 44);
  for (const r of [60, 38, 16]) await stroke(arc(W + 820, G - 200, r, 0, Math.PI * 2.1, 40));
  await pick('#e53935', 22);
  for (const [ax, ay] of [
    [-30, -20],
    [25, -40],
    [10, 15],
    [-12, -60],
  ]) {
    await dot(W + 820 + ax, G - 200 + ay);
  }

  // Flowers (right monitor)
  const flowers = [
    [W + 470, G - 50, '#ec407a'],
    [W + 560, G - 30, '#8e24aa'],
    [W + 1010, G - 45, '#e53935'],
    [W + 1120, G - 25, '#ec407a'],
  ];
  for (const [fx, fy, c] of flowers) {
    await pick('#2e7d32', 4);
    await stroke([
      [fx, fy],
      [fx, G + 10],
    ]);
    await pick(c, 22);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      await stroke([
        [fx, fy],
        [fx + 14 * Math.cos(a), fy + 14 * Math.sin(a)],
      ]);
    }
    await pick('#fdd835', 10);
    await dot(fx, fy);
  }

  // Long wavy grass stroke from the far left to the far right: one stroke across both monitors.
  await pick('#9ccc65', 22);
  const grass = [];
  for (let x = 40; x <= 2 * W - 40; x += 12) grass.push([x, G + 14 + 12 * Math.sin(x / 55)]);
  await stroke(grass, 12);

  // A breezy wavy line high in the sky, also drawn in one go across the boundary.
  await pick('#00acc1', 10);
  const wind = [];
  for (let x = 620; x <= 1900; x += 10) wind.push([x, 95 + 30 * Math.sin((x - 620) / 70)]);
  await stroke(wind, 8);
}

async function capture(win) {
  await win.webContents.executeJavaScript(`document.getElementById('ring').style.display = 'none'`);
  await sleep(150);
  return (await win.webContents.capturePage()).toDataURL();
}

// Composes the two window captures into "two monitors on a desk".
async function compose(left, right) {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><html><body></body></html>');
    const out = await win.webContents.executeJavaScript(`(async () => {
      const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
      const [a, b] = await Promise.all([load(${JSON.stringify(left)}), load(${JSON.stringify(right)})]);
      const S = 0.6;                    // scale of one screen
      const sw = ${W} * S, sh = ${H} * S;
      const bez = 14, gap = 18, pad = 60, standH = 70;
      const cw = Math.round(pad * 2 + (sw + bez * 2) * 2 + gap);
      const ch = Math.round(pad * 1.2 + sh + bez * 2 + standH + pad * 0.8);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const g = c.getContext('2d');

      const bg = g.createLinearGradient(0, 0, 0, ch);
      bg.addColorStop(0, '#e3f2fd');
      bg.addColorStop(1, '#bbdefb');
      g.fillStyle = bg;
      g.fillRect(0, 0, cw, ch);

      const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
      const top = pad * 1.2;
      [a, b].forEach((img, i) => {
        const x = pad + i * (sw + bez * 2 + gap);
        const cx = x + bez + sw / 2;
        // stand
        g.fillStyle = '#37474f';
        g.fillRect(cx - 22, top + sh + bez * 2 - 4, 44, standH - 16);
        rr(cx - 90, top + sh + bez * 2 + standH - 24, 180, 16, 8);
        g.fill();
        // bezel with shadow
        g.save();
        g.shadowColor = 'rgba(13, 43, 82, 0.35)';
        g.shadowBlur = 28;
        g.shadowOffsetY = 10;
        g.fillStyle = '#263238';
        rr(x, top, sw + bez * 2, sh + bez * 2, 16);
        g.fill();
        g.restore();
        // screen
        g.save();
        rr(x + bez, top + bez, sw, sh, 4);
        g.clip();
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, x + bez, top + bez, sw, sh);
        g.restore();
      });
      return c.toDataURL('image/png');
    })()`);
    return Buffer.from(out.split(',')[1], 'base64');
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    screen.getAllDisplays = () => fake;
    require('../main.js');

    for (let i = 0; i < 40 && BrowserWindow.getAllWindows().length < 2; i++) await sleep(250);
    await sleep(2500);
    wins = BrowserWindow.getAllWindows().sort((p, q) => p.getBounds().x - q.getBounds().x);
    if (wins.length !== 2) throw new Error('expected 2 windows, got ' + wins.length);

    await drawDemo();
    // Leave the brush on a nice colour/size so the toolbar shows an active selection.
    await pick('#1e88e5', 22);
    await sleep(500);

    const [left, right] = [await capture(wins[0]), await capture(wins[1])];
    fs.mkdirSync(DOCS, { recursive: true });
    fs.writeFileSync(path.join(DOCS, 'screenshot.png'), await compose(left, right));
    fs.writeFileSync(path.join(DOCS, 'screenshot-single.png'), Buffer.from(left.split(',')[1], 'base64'));
    console.log('wrote docs/screenshot.png and docs/screenshot-single.png');
    app.exit(0);
  } catch (err) {
    console.error('screenshot failed:', err);
    app.exit(1);
  }
});
