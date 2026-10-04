// Style D: "Ink & Parchment" — the DM's hand-drawn map come alive. Pure 2D canvas:
// wobbly ink lines, cross-hatching, watercolour washes, paper standee tokens.
import { tiles, units, activeId, targetId, previewPath, reachable, tileAt, W, H, type Tile, type Unit } from './shared/scene';
import { mountHud } from './shared/hud';
import { icon, archetypeIcon } from './shared/icons';
import { rng } from './shared/three-dungeon';

const TW = 100, TH = 50, LIFT = 26; // tile width/height, px per height unit
const canvas = document.createElement('canvas');
canvas.className = 'stage';
const dpr = Math.min(devicePixelRatio, 2);
canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
document.body.appendChild(canvas);
const g = canvas.getContext('2d')!;
g.scale(dpr, dpr);
const r = rng(5);

const origin = { x: innerWidth / 2 - ((W - H) * TW) / 4 + 40, y: innerHeight / 2 - ((W + H) * TH) / 4 + 10 };
const iso = (x: number, y: number, h = 0) => ({ x: origin.x + (x - y) * (TW / 2), y: origin.y + (x + y) * (TH / 2) - h * LIFT });

const INK = '#2b1d10', INK_SOFT = 'rgba(43,29,16,.55)';

// ---------------------------------------------------------------- paper
function paper() {
  g.fillStyle = '#ead9b2'; g.fillRect(0, 0, innerWidth, innerHeight);
  for (let i = 0; i < 60; i++) {
    const x = r() * innerWidth, y = r() * innerHeight, rad = 40 + r() * 220;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    grad.addColorStop(0, dark ? 'rgba(150,110,60,.10)' : 'rgba(255,248,225,.18)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // fibres / speckle
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(90,60,30,${r() * 0.08})`; g.fillRect(r() * innerWidth, r() * innerHeight, 1 + r() * 1.5, 1); }
  // burnt edges
  const v = g.createRadialGradient(innerWidth / 2, innerHeight / 2, innerHeight * 0.45, innerWidth / 2, innerHeight / 2, innerWidth * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(90,50,15,.55)');
  g.fillStyle = v; g.fillRect(0, 0, innerWidth, innerHeight);
}

// ---------------------------------------------------------------- ink helpers
function line(x1: number, y1: number, x2: number, y2: number, w = 1.4, color = INK, passes = 2) {
  g.strokeStyle = color; g.lineCap = 'round';
  for (let p = 0; p < passes; p++) {
    g.lineWidth = w * (p ? 0.6 : 1);
    const mx = (x1 + x2) / 2 + (r() - 0.5) * 2.2, my = (y1 + y2) / 2 + (r() - 0.5) * 2.2;
    g.beginPath(); g.moveTo(x1 + (r() - 0.5) * 1.2, y1 + (r() - 0.5) * 1.2); g.quadraticCurveTo(mx, my, x2 + (r() - 0.5) * 1.2, y2 + (r() - 0.5) * 1.2); g.stroke();
  }
}
function poly(pts: { x: number; y: number }[], fill?: string, stroke = true, w = 1.4) {
  if (fill) { g.fillStyle = fill; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); }
  if (stroke) for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; line(a.x, a.y, b.x, b.y, w); }
}
/** Diagonal hatching clipped to a polygon. */
function hatch(pts: { x: number; y: number }[], spacing: number, angle: number, alpha = 0.5) {
  g.save(); g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.clip();
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - 80, maxX = Math.max(...xs) + 80, minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (let s = minX - (maxY - minY); s < maxX + (maxY - minY); s += spacing) {
    line(s, minY - 10, s + dx * 400, minY - 10 + dy * 400, 0.9, `rgba(43,29,16,${alpha})`, 1);
  }
  g.restore();
}
function wash(pts: { x: number; y: number }[], color: string, passes = 3) {
  g.save(); g.globalCompositeOperation = 'multiply';
  for (let p = 0; p < passes; p++) {
    g.fillStyle = color; g.beginPath();
    pts.forEach((q, i) => { const x = q.x + (r() - 0.5) * 4, y = q.y + (r() - 0.5) * 3; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.fill();
  }
  g.restore();
}

function diamond(x: number, y: number, h: number, inset = 0) {
  const c = iso(x, y, h); const hw = TW / 2 - inset, hh = TH / 2 - inset / 2;
  return [{ x: c.x, y: c.y - hh }, { x: c.x + hw, y: c.y }, { x: c.x, y: c.y + hh }, { x: c.x - hw, y: c.y }];
}

/** An isometric block from height h0 to h1 on tile (x, y). */
function block(x: number, y: number, h0: number, h1: number, topFill = '#efe2c0', hatchSides = true) {
  const top = diamond(x, y, h1), bot = diamond(x, y, h0);
  const left = [top[3], top[2], bot[2], bot[3]], right = [top[2], top[1], bot[1], bot[2]];
  poly(left, '#d9c294', false); poly(right, '#e4d0a6', false);
  if (hatchSides) { hatch(left, 5, Math.PI * 0.32, 0.55); hatch(right, 9, Math.PI * 0.32, 0.3); }
  poly(left); poly(right); poly(top, topFill);
}

// ---------------------------------------------------------------- scene pieces
function drawTile(t: Tile) {
  if (t.kind === 'wall' || t.kind === 'door') {
    if (t.kind === 'door') {
      block(t.x, t.y, 0, 0.05, '#e6d4ab', false);
      const a = iso(t.x, t.y, 0);
      g.fillStyle = 'rgba(43,29,16,.85)'; g.beginPath(); g.ellipse(a.x, a.y - 4, 20, 9, 0, 0, Math.PI * 2); g.fill();
      block(t.x, t.y, 3.4, 4.2);
      return;
    }
    block(t.x, t.y, 0, 4.2);
    // brick courses on the visible faces
    const top = diamond(t.x, t.y, 4.2);
    for (let i = 1; i < 8; i++) {
      const h = i * 0.52; const L = diamond(t.x, t.y, h);
      line(L[3].x, L[3].y, L[2].x, L[2].y, 0.8, INK_SOFT, 1); line(L[2].x, L[2].y, L[1].x, L[1].y, 0.8, INK_SOFT, 1);
    }
    void top;
    return;
  }
  const h = t.kind === 'platform' ? 1 : t.kind === 'stairs' ? 0.5 : 0;
  if (h > 0) {
    block(t.x, t.y, 0, h);
    if (t.kind === 'stairs') { const d = diamond(t.x, t.y, h); for (let i = 1; i < 4; i++) { const f = i / 4; line(d[0].x + (d[3].x - d[0].x) * f, d[0].y + (d[3].y - d[0].y) * f, d[1].x + (d[2].x - d[1].x) * f, d[1].y + (d[2].y - d[1].y) * f, 1, INK_SOFT); } }
  } else {
    const d = diamond(t.x, t.y, 0);
    poly(d, r() < 0.15 ? 'rgba(160,120,70,.10)' : undefined, true, 0.9);
    if (r() < 0.25) { const c = iso(t.x, t.y); line(c.x - 10, c.y - 2, c.x + 4, c.y + 3, 0.7, INK_SOFT, 1); line(c.x + 4, c.y + 3, c.x + 12, c.y + 1, 0.7, INK_SOFT, 1); }
  }
  const c = iso(t.x, t.y, h);
  if (t.kind === 'pillar') {
    const rad = 22, hgt = 115;
    g.fillStyle = '#e4d0a6'; g.fillRect(c.x - rad, c.y - hgt, rad * 2, hgt);
    hatch([{ x: c.x - rad, y: c.y - hgt }, { x: c.x - rad * 0.2, y: c.y - hgt }, { x: c.x - rad * 0.2, y: c.y + 8 }, { x: c.x - rad, y: c.y }], 4, Math.PI / 2, 0.5);
    line(c.x - rad, c.y - hgt, c.x - rad, c.y, 1.5); line(c.x + rad, c.y - hgt, c.x + rad, c.y, 1.5);
    g.beginPath(); g.ellipse(c.x, c.y, rad, rad / 2, 0, 0, Math.PI); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#f1e5c6'; g.beginPath(); g.ellipse(c.x, c.y - hgt, rad + 4, (rad + 4) / 2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    for (const yy of [0.3, 0.75]) { g.beginPath(); g.ellipse(c.x, c.y - hgt * yy, rad, rad / 2, 0, 0, Math.PI); g.lineWidth = 0.9; g.stroke(); }
  }
  if (t.kind === 'rubble') {
    for (let i = 0; i < 6; i++) {
      const x = c.x + (r() - 0.5) * 60, y = c.y + (r() - 0.5) * 24, s = 5 + r() * 8;
      poly([{ x: x - s, y }, { x: x - s * 0.3, y: y - s * 0.8 }, { x: x + s, y: y - s * 0.3 }, { x: x + s * 0.6, y: y + s * 0.4 }], '#dcc597', true, 1);
    }
  }
  if (t.kind === 'barrel') {
    const rad = 18, hgt = 40;
    g.fillStyle = '#d8b98a'; g.fillRect(c.x - rad, c.y - hgt, rad * 2, hgt);
    hatch([{ x: c.x - rad, y: c.y - hgt }, { x: c.x - 4, y: c.y - hgt }, { x: c.x - 4, y: c.y + 6 }, { x: c.x - rad, y: c.y }], 4, Math.PI / 2, 0.45);
    line(c.x - rad, c.y - hgt, c.x - rad, c.y, 1.4); line(c.x + rad, c.y - hgt, c.x + rad, c.y, 1.4);
    g.strokeStyle = INK; g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(c.x, c.y, rad, rad / 2, 0, 0, Math.PI); g.stroke();
    g.fillStyle = '#e8d2a6'; g.beginPath(); g.ellipse(c.x, c.y - hgt, rad, rad / 2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    for (const yy of [0.25, 0.75]) { g.beginPath(); g.ellipse(c.x, c.y - hgt * yy, rad, rad / 2, 0, 0, Math.PI); g.lineWidth = 1; g.stroke(); }
  }
  if (t.kind === 'brazier') {
    line(c.x - 14, c.y + 6, c.x - 6, c.y - 26); line(c.x + 14, c.y + 6, c.x + 6, c.y - 26); line(c.x, c.y + 10, c.x, c.y - 24);
    g.fillStyle = '#c9b08a'; g.beginPath(); g.ellipse(c.x, c.y - 30, 22, 9, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    // watercolour flame
    g.save(); g.globalCompositeOperation = 'multiply';
    for (const [col, s] of [['rgba(220,90,30,.45)', 1], ['rgba(240,170,40,.55)', 0.65]] as [string, number][]) {
      g.fillStyle = col; g.beginPath(); g.moveTo(c.x - 16 * s, c.y - 32); g.quadraticCurveTo(c.x - 18 * s, c.y - 60 * s - 20, c.x, c.y - 80 * s - 10); g.quadraticCurveTo(c.x + 18 * s, c.y - 58 * s - 20, c.x + 16 * s, c.y - 32); g.closePath(); g.fill();
    }
    g.restore();
    line(c.x - 6, c.y - 40, c.x - 2, c.y - 66, 0.8, 'rgba(140,40,10,.7)', 1); line(c.x + 5, c.y - 38, c.x + 2, c.y - 58, 0.8, 'rgba(140,40,10,.7)', 1);
  }
}

const iconCache = new Map<string, HTMLImageElement>();
function iconImg(name: string, color: string): HTMLImageElement {
  const key = name + color; let img = iconCache.get(key);
  if (!img) { img = new Image(); img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(icon(name, 48).replace('currentColor', color)); iconCache.set(key, img); }
  return img;
}

function drawStandee(u: Unit) {
  const t = tileAt(u.x, u.y)!;
  const c = iso(u.x, u.y, t.h);
  const ally = u.side === 'party';
  const ink = ally ? '#2c4f7c' : '#8c2316';
  const big = u.archetype === 'goblinBoss' || u.archetype === 'fighter';
  const w = big ? 50 : 42, h = big ? 74 : 62;
  g.save();
  if (u.hidden) g.globalAlpha = 0.45;
  // base circle on the floor
  g.fillStyle = 'rgba(60,35,10,.25)'; g.beginPath(); g.ellipse(c.x, c.y + 2, 30, 14, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.ellipse(c.x, c.y, 27, 12, 0, 0, Math.PI * 2); g.stroke();
  // standee card with an arched top
  const x0 = c.x - w / 2, y0 = c.y - h - 4;
  g.beginPath(); g.moveTo(x0, c.y - 4); g.lineTo(x0, y0 + w / 2); g.arc(c.x, y0 + w / 2, w / 2, Math.PI, 0); g.lineTo(x0 + w, c.y - 4); g.closePath();
  g.fillStyle = '#f6ecd3'; g.fill(); g.lineWidth = 2; g.strokeStyle = INK; g.stroke();
  g.save(); g.clip(); g.fillStyle = ally ? 'rgba(44,79,124,.18)' : 'rgba(140,35,22,.16)'; g.fillRect(x0, c.y - 20, w, 20); g.restore();
  const img = iconImg(archetypeIcon[u.archetype], ink);
  const s = big ? 34 : 28;
  g.drawImage(img, c.x - s / 2, y0 + 8, s, s);
  g.font = `${big ? 13 : 12}px "IM Fell English"`; g.fillStyle = INK; g.textAlign = 'center';
  g.fillText(u.name.split(' ').pop()!, c.x, c.y - 9);
  g.restore();
}

// ---------------------------------------------------------------- compose
function render() {
  paper();
  const active = units.find((u) => u.id === activeId)!;
  const target = units.find((u) => u.id === targetId)!;
  const reach = reachable(active.x, active.y, 6);

  // floor-level tiles first (painter's order), then movement wash, then tall things
  const order = [...tiles].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const t of order) if (t.kind === 'floor' || t.kind === 'rubble') drawTile(t);
  for (const k of [...reach.keys(), `${active.x},${active.y}`]) { const [x, y] = k.split(',').map(Number); wash(diamond(x, y, tileAt(x, y)!.h, 3), 'rgba(110,150,200,.22)', 2); }
  // path: dashed ink with an arrow
  g.save(); g.setLineDash([7, 6]); g.strokeStyle = '#7a1f12'; g.lineWidth = 2.4; g.beginPath();
  previewPath.forEach(([x, y], i) => { const p = iso(x, y); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }); g.stroke(); g.restore();
  const e = iso(...previewPath[previewPath.length - 1]);
  g.strokeStyle = '#7a1f12'; g.lineWidth = 2.2; g.beginPath(); g.ellipse(e.x, e.y, 22, 10, 0, 0, Math.PI * 2); g.stroke();

  const objects: { depth: number; draw: () => void }[] = [];
  for (const t of order) if (t.kind !== 'floor' && t.kind !== 'rubble') objects.push({ depth: t.x + t.y + (t.kind === 'wall' || t.kind === 'door' ? -0.5 : 0), draw: () => drawTile(t) });
  for (const u of units) objects.push({ depth: u.x + u.y + 0.1, draw: () => drawStandee(u) });
  objects.sort((a, b) => a.depth - b.depth).forEach((o) => o.draw());

  // target: a sketchy red ink circle
  const tc = iso(target.x, target.y, tileAt(target.x, target.y)!.h);
  for (let i = 0; i < 2; i++) { g.strokeStyle = 'rgba(140,35,22,.85)'; g.lineWidth = 2; g.beginPath(); g.ellipse(tc.x + (r() - 0.5) * 3, tc.y + (r() - 0.5) * 2, 36 + i * 3, 17 + i, -0.05 + i * 0.08, 0, Math.PI * 2); g.stroke(); }
  // active marker: a little gold-leaf flag
  const ac = iso(active.x, active.y);
  g.fillStyle = '#b8862b'; g.beginPath(); g.moveTo(ac.x, ac.y - 104); g.lineTo(ac.x + 10, ac.y - 92); g.lineTo(ac.x - 10, ac.y - 92); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 1.2; g.stroke();

  // compass rose + cartouche
  const cx = innerWidth - 150, cy = innerHeight - 220;
  g.strokeStyle = INK; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, 36, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, L = i % 2 ? 26 : 46; poly([{ x: cx, y: cy }, { x: cx + Math.cos(a - 0.15) * 12, y: cy + Math.sin(a - 0.15) * 12 }, { x: cx + Math.cos(a) * L, y: cy + Math.sin(a) * L }], i % 2 ? '#e8d5ab' : '#3b2a18', true, 1); }
  g.font = '18px "IM Fell English"'; g.fillStyle = INK; g.textAlign = 'center'; g.fillText('N', cx - 34, cy - 30);
}

const project = (x: number, y: number, h: number) => { const p = iso(x, y, h); return { x: p.x, y: p.y - 70 }; };
document.fonts.load('16px "IM Fell English"').then(() => {
  // icons are SVG images; wait for them before drawing standees
  const imgs = units.map((u) => iconImg(archetypeIcon[u.archetype], u.side === 'party' ? '#2c4f7c' : '#8c2316'));
  Promise.all(imgs.map((i) => i.decode().catch(() => {}))).then(() => { render(); document.title = 'ready'; });
});
mountHud({ theme: 'parchment', project, styleName: 'D · Ink & Parchment', styleBlurb: "The DM's hand-drawn map come alive: inked lines, cross-hatching, watercolour washes and paper standees." });
