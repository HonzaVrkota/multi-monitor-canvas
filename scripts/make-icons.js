'use strict';

/**
 * Renders build/icon.svg into build/icon.png (1024x1024) and build/icon.ico
 * (16-256 px, PNG-encoded entries). Uses a hidden Electron window as the SVG
 * rasterizer, so no extra npm dependencies are needed.
 *
 * Usage: npx electron scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const BUILD = path.join(__dirname, '..', 'build');
const SVG = path.join(BUILD, 'icon.svg');
const PNG_SIZE = 1024;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function rasterize(svgText, sizes) {
  const win = new BrowserWindow({
    show: false,
    width: 300,
    height: 300,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><html><body></body></html>');
    const svgUrl = 'data:image/svg+xml;base64,' + Buffer.from(svgText).toString('base64');
    const urls = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(svgUrl)};
      await img.decode();
      const out = {};
      for (const size of ${JSON.stringify(sizes)}) {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, size, size);
        out[size] = c.toDataURL('image/png');
      }
      return out;
    })()`);
    const result = {};
    for (const size of sizes) {
      result[size] = Buffer.from(urls[size].split(',')[1], 'base64');
    }
    return result;
  } finally {
    win.destroy();
  }
}

// ICO container: ICONDIR (6 B) + ICONDIRENTRY (16 B each) + PNG payloads.
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // width (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    dir.writeUInt8(0, o + 2); // palette colors
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const svgText = fs.readFileSync(SVG, 'utf8');
    const pngs = await rasterize(svgText, [PNG_SIZE, ...ICO_SIZES]);

    fs.writeFileSync(path.join(BUILD, 'icon.png'), pngs[PNG_SIZE]);
    const ico = buildIco(ICO_SIZES.map((size) => ({ size, data: pngs[size] })));
    fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);

    console.log(`build/icon.png  ${PNG_SIZE}x${PNG_SIZE}  ${pngs[PNG_SIZE].length} B`);
    console.log(`build/icon.ico  ${ICO_SIZES.join(', ')} px  ${ico.length} B`);
    app.exit(0);
  } catch (err) {
    console.error('make-icons failed:', err);
    app.exit(1);
  }
});
