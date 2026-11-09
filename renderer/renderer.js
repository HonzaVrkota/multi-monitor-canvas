(async () => {
  'use strict';

  const api = window.kresleni;
  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const ring = $('ring');
  const toast = $('toast');
  const toolbar = $('toolbar');
  const fab = $('fab');
  const ctx = board.getContext('2d');

  const COLORS = [
    ['#111111', 'černá'],
    ['#8d5524', 'hnědá'],
    ['#e53935', 'červená'],
    ['#fb8c00', 'oranžová'],
    ['#fdd835', 'žlutá'],
    ['#9ccc65', 'světle zelená'],
    ['#2e7d32', 'tmavě zelená'],
    ['#00acc1', 'tyrkysová'],
    ['#1e88e5', 'modrá'],
    ['#8e24aa', 'fialová'],
    ['#ec407a', 'růžová'],
    ['#9e9e9e', 'šedá'],
  ];
  const SIZES = [4, 10, 22, 44];

  // --- stav ---------------------------------------------------------------
  let origin = { x: 0, y: 0 }; // levý horní roh tohoto monitoru v globálních souřadnicích
  let virtual = { x: 0, y: 0, width: 1, height: 1 }; // celé plátno (všechny monitory)
  let strokes = [];
  const byId = new Map();
  let tool = { color: '#1e88e5', size: 10, eraser: false, pressure: true };
  let dpr = window.devicePixelRatio || 1;
  const active = new Map(); // pointerId -> { stroke, eraser, p, last }
  const pending = new Map(); // strokeId -> [body]
  let idCounter = 0;

  // --- kreslení -----------------------------------------------------------
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  function setStyle(c, s) {
    c.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
    c.strokeStyle = s.eraser ? '#000' : s.color;
    c.fillStyle = c.strokeStyle;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }

  function drawDot(c, x, y, w) {
    c.beginPath();
    c.arc(x, y, Math.max(w, 1) / 2, 0, Math.PI * 2);
    c.fill();
  }

  // Úsek k mezi středy sousedních bodů, řídicí bod je bod k-1 (vyhlazená křivka).
  function drawPiece(c, s, k) {
    const pts = s.points;
    if (k < 1 || k >= pts.length) return;
    const from = k === 1 ? pts[0] : mid(pts[k - 2], pts[k - 1]);
    const to = mid(pts[k - 1], pts[k]);
    const ctrl = pts[k - 1];
    c.lineWidth = Math.max((pts[k - 1][2] + pts[k][2]) / 2, 1);
    c.beginPath();
    c.moveTo(from[0], from[1]);
    c.quadraticCurveTo(ctrl[0], ctrl[1], to[0], to[1]);
    c.stroke();
  }

  // Dokončení tahu: od středu posledního úseku k poslednímu bodu.
  function drawEnd(c, s) {
    const pts = s.points;
    const n = pts.length;
    if (n < 2) return;
    const from = mid(pts[n - 2], pts[n - 1]);
    c.lineWidth = Math.max(pts[n - 1][2], 1);
    c.beginPath();
    c.moveTo(from[0], from[1]);
    c.lineTo(pts[n - 1][0], pts[n - 1][1]);
    c.stroke();
  }

  function drawStrokeFull(c, s) {
    if (!s.points.length) return;
    setStyle(c, s);
    drawDot(c, s.points[0][0], s.points[0][1], s.points[0][2]);
    for (let k = 1; k < s.points.length; k++) drawPiece(c, s, k);
    if (s.done) drawEnd(c, s);
  }

  function applyTransform() {
    ctx.setTransform(dpr, 0, 0, dpr, -origin.x * dpr, -origin.y * dpr);
  }

  function redrawAll() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, board.width, board.height);
    applyTransform();
    for (const s of strokes) drawStrokeFull(ctx, s);
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    board.width = Math.max(1, Math.round(window.innerWidth * dpr));
    board.height = Math.max(1, Math.round(window.innerHeight * dpr));
    redrawAll();
  }

  // --- ukládání -----------------------------------------------------------
  function showToast(text, ms = 2600) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove('show'), ms);
  }

  async function save() {
    if (!strokes.length) {
      showToast('Zatím tu nic nenakreslilo – není co uložit 🙂');
      return;
    }
    try {
      const vw = virtual.width;
      const vh = virtual.height;
      const scale = Math.max(0.25, Math.min(Math.max(dpr, 1), 16000 / vw, 16000 / vh));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));

      const layer = document.createElement('canvas');
      layer.width = w;
      layer.height = h;
      const lc = layer.getContext('2d');
      lc.setTransform(scale, 0, 0, scale, -virtual.x * scale, -virtual.y * scale);
      for (const s of strokes) drawStrokeFull(lc, s);

      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const oc = out.getContext('2d');
      oc.fillStyle = '#ffffff';
      oc.fillRect(0, 0, w, h);
      oc.drawImage(layer, 0, 0);

      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('nepodařilo se vytvořit obrázek');
      const res = await api.save(await blob.arrayBuffer());
      if (res && res.ok) showToast('Uloženo ✔  ' + res.dir, 4000);
      else throw new Error(res && res.error ? res.error : 'neznámá chyba');
    } catch (err) {
      showToast('Uložení se nepovedlo: ' + (err && err.message ? err.message : err), 5000);
    }
  }

  // --- nástroje a panel ---------------------------------------------------
  for (const [color, name] of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = color;
    b.dataset.color = color;
    b.title = name;
    b.setAttribute('aria-label', name);
    $('colors').appendChild(b);
  }
  for (const size of SIZES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sizebtn';
    b.dataset.size = String(size);
    const dot = document.createElement('i');
    const d = Math.min(size, 40) + 2;
    dot.style.width = d + 'px';
    dot.style.height = d + 'px';
    b.appendChild(dot);
    $('sizes').appendChild(b);
  }

  function ringWidth() {
    return Math.max(6, tool.eraser ? Math.max(16, tool.size * 2.2) : tool.size);
  }

  function updateToolbar() {
    $('btn-pen').classList.toggle('active', !tool.eraser);
    $('btn-eraser').classList.toggle('active', tool.eraser);
    for (const el of $('colors').children) {
      el.classList.toggle('active', !tool.eraser && el.dataset.color === String(tool.color).toLowerCase());
    }
    for (const el of $('sizes').children) {
      el.classList.toggle('active', Number(el.dataset.size) === tool.size);
    }
    $('btn-pressure').classList.toggle('on', tool.pressure);
    $('btn-pressure').textContent = tool.pressure ? 'Tlak pera: zap' : 'Tlak pera: vyp';
  }

  function setTool(patch) {
    tool = Object.assign({}, tool, patch);
    updateToolbar();
    api.send('tool:set', patch);
  }

  $('btn-pen').addEventListener('click', () => {
    resetClear();
    setTool({ eraser: false });
  });
  $('btn-eraser').addEventListener('click', () => {
    resetClear();
    setTool({ eraser: true });
  });
  $('colors').addEventListener('click', (ev) => {
    const b = ev.target.closest('.swatch');
    if (b) {
      resetClear();
      setTool({ color: b.dataset.color, eraser: false });
    }
  });
  $('sizes').addEventListener('click', (ev) => {
    const b = ev.target.closest('.sizebtn');
    if (b) {
      resetClear();
      setTool({ size: Number(b.dataset.size) });
    }
  });
  $('btn-pressure').addEventListener('click', () => setTool({ pressure: !tool.pressure }));
  $('btn-undo').addEventListener('click', () => {
    resetClear();
    api.send('undo');
  });
  $('btn-save').addEventListener('click', () => {
    resetClear();
    save();
  });

  // Smazání celé kresby chce druhé klepnutí (ať se nesmaže omylem).
  let clearTimer = null;
  function resetClear() {
    clearTimeout(clearTimer);
    const b = $('btn-clear');
    b.classList.remove('confirm');
    b.querySelector('span').textContent = 'Smazat';
  }
  $('btn-clear').addEventListener('click', () => {
    const b = $('btn-clear');
    if (!b.classList.contains('confirm')) {
      b.classList.add('confirm');
      b.querySelector('span').textContent = 'Opravdu?';
      clearTimer = setTimeout(resetClear, 3000);
      return;
    }
    resetClear();
    api.send('clear');
  });

  // Schování panelu (jen na tomto monitoru).
  $('btn-hide').addEventListener('click', () => {
    toolbar.classList.add('hidden');
    fab.classList.add('show');
    ring.style.display = 'none';
  });
  fab.addEventListener('click', () => {
    toolbar.classList.remove('hidden');
    fab.classList.remove('show');
  });

  // Ukončení chce podržet tlačítko, ať ho děti nevypnou omylem.
  const quitBtn = $('btn-quit');
  let quitTimer = null;
  quitBtn.addEventListener('pointerdown', () => {
    quitBtn.classList.add('holding');
    clearTimeout(quitTimer);
    quitTimer = setTimeout(() => api.send('quit'), 1100);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    quitBtn.addEventListener(ev, () => {
      clearTimeout(quitTimer);
      quitBtn.classList.remove('holding');
    });
  }

  toolbar.addEventListener('pointerenter', () => {
    ring.style.display = 'none';
  });

  // --- ukazatel velikosti štětce -------------------------------------------
  function moveRing(e) {
    if (e.pointerType === 'touch') {
      ring.style.display = 'none';
      return;
    }
    const w = ringWidth();
    ring.style.display = 'block';
    ring.style.width = w + 'px';
    ring.style.height = w + 'px';
    ring.style.transform = `translate(${e.clientX - w / 2}px, ${e.clientY - w / 2}px)`;
  }
  board.addEventListener('pointerleave', () => {
    if (!active.size) ring.style.display = 'none';
  });

  // --- kreslení perem / myší / dotykem -----------------------------------
  function widthFor(e, entry) {
    if (entry.eraser) return Math.max(16, tool.size * 2.2);
    if (tool.pressure && e.pointerType === 'pen') {
      const p = e.pressure || 0;
      entry.p = entry.p == null ? p : entry.p * 0.5 + p * 0.5;
      return tool.size * (0.3 + 1.4 * entry.p);
    }
    return tool.size;
  }

  // Globální souřadnice = levý horní roh monitoru + pozice v okně.
  // Při „zachyceném“ ukazateli mohou být clientX/Y i mimo okno – a právě to
  // umožňuje pokračovat v tahu na sousedním monitoru.
  const pointFrom = (e, entry) => [origin.x + e.clientX, origin.y + e.clientY, widthFor(e, entry)];

  function queue(id, p) {
    let list = pending.get(id);
    if (!list) pending.set(id, (list = []));
    list.push(p);
    if (!queue.raf) {
      queue.raf = requestAnimationFrame(() => {
        queue.raf = 0;
        flush();
      });
    }
  }

  function flush() {
    for (const [id, pts] of pending) {
      if (pts.length) api.send('stroke:points', { id, pts });
    }
    pending.clear();
  }

  board.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (active.has(e.pointerId)) return;

    const eraser = tool.eraser || (e.buttons & 32) !== 0 || e.button === 5; // konec pera = guma
    const entry = { eraser, p: null, last: null, stroke: null };
    const first = pointFrom(e, entry);
    const stroke = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${idCounter++}`,
      color: tool.color,
      size: tool.size,
      eraser,
      points: [first],
      done: false,
    };
    entry.stroke = stroke;
    entry.last = first;
    strokes.push(stroke);
    byId.set(stroke.id, stroke);
    active.set(e.pointerId, entry);

    try {
      board.setPointerCapture(e.pointerId);
    } catch {
      /* nic */
    }

    setStyle(ctx, stroke);
    drawDot(ctx, first[0], first[1], first[2]);
    api.send('stroke:start', {
      id: stroke.id,
      color: stroke.color,
      size: stroke.size,
      eraser,
      points: [first],
    });
  });

  board.addEventListener('pointermove', (e) => {
    moveRing(e);
    const entry = active.get(e.pointerId);
    if (!entry) return;
    const s = entry.stroke;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const events = list.length ? list : [e];
    for (const ce of events) {
      const p = pointFrom(ce, entry);
      const l = entry.last;
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.7) continue;
      s.points.push(p);
      entry.last = p;
      setStyle(ctx, s);
      drawPiece(ctx, s, s.points.length - 1);
      queue(s.id, p);
    }
  });

  function endStroke(pointerId) {
    const entry = active.get(pointerId);
    if (!entry) return;
    active.delete(pointerId);
    flush();
    const s = entry.stroke;
    s.done = true;
    setStyle(ctx, s);
    drawEnd(ctx, s);
    api.send('stroke:end', { id: s.id });
  }
  board.addEventListener('pointerup', (e) => endStroke(e.pointerId));
  board.addEventListener('pointercancel', (e) => endStroke(e.pointerId));
  board.addEventListener('lostpointercapture', (e) => endStroke(e.pointerId));

  for (const ev of ['contextmenu', 'dragstart', 'selectstart']) {
    document.addEventListener(ev, (e) => e.preventDefault());
  }

  // --- zprávy z hlavního procesu (kresba z ostatních monitorů) ----------------
  api.on('stroke:start', (s) => {
    if (byId.has(s.id)) return;
    const st = {
      id: s.id,
      color: s.color,
      size: s.size,
      eraser: !!s.eraser,
      points: s.points.slice(),
      done: false,
    };
    strokes.push(st);
    byId.set(st.id, st);
    setStyle(ctx, st);
    drawDot(ctx, st.points[0][0], st.points[0][1], st.points[0][2]);
  });
  api.on('stroke:points', (d) => {
    const s = byId.get(d.id);
    if (!s) return;
    for (const p of d.pts) {
      s.points.push(p);
      setStyle(ctx, s);
      drawPiece(ctx, s, s.points.length - 1);
    }
  });
  api.on('stroke:end', (d) => {
    const s = byId.get(d.id);
    if (!s) return;
    s.done = true;
    setStyle(ctx, s);
    drawEnd(ctx, s);
  });
  api.on('undo', (d) => {
    const i = strokes.findIndex((s) => s.id === d.id);
    if (i === -1) return;
    strokes.splice(i, 1);
    byId.delete(d.id);
    for (const [pid, entry] of active) if (entry.stroke.id === d.id) active.delete(pid);
    redrawAll();
  });
  api.on('clear', () => {
    strokes = [];
    byId.clear();
    active.clear();
    redrawAll();
  });
  api.on('tool:state', (t) => {
    tool = Object.assign({}, tool, t);
    updateToolbar();
  });

  // --- start --------------------------------------------------------------
  const init = await api.ready();
  if (init) {
    origin = init.origin;
    virtual = init.virtual;
    tool = Object.assign({}, tool, init.tool);
    strokes = init.strokes.map((s) => Object.assign({}, s));
    for (const s of strokes) byId.set(s.id, s);
  }
  updateToolbar();
  resize();
  window.addEventListener('resize', resize);
})();
