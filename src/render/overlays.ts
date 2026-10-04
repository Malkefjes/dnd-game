// Ground overlays drawn inside the 3D scene (so they get pixelated with it):
// movement range, path preview, target/active rings and the hover cursor.
import * as THREE from 'three';
import type { PixelRenderer } from './pixel-renderer';

type P = { x: number; y: number };
const additive = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });

export class Overlays {
  private reach = new THREE.Group();
  private path = new THREE.Group();
  private marks = new THREE.Group();
  private areaG = new THREE.Group();
  private markerG = new THREE.Group();
  private activeRing: THREE.Mesh;
  private hover: THREE.Mesh;
  private time = 0;

  constructor(private r: PixelRenderer) {
    r.overlay.add(this.reach, this.path, this.marks, this.areaG, this.markerG);
    this.activeRing = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.5, 40), additive(0xffd66b));
    this.activeRing.rotation.x = -Math.PI / 2; this.activeRing.visible = false;
    this.hover = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.47, 4, 1), additive(0xffffff, 0.55));
    this.hover.rotation.x = -Math.PI / 2; this.hover.rotation.z = Math.PI / 4; this.hover.scale.setScalar(1.35); this.hover.visible = false;
    r.overlay.add(this.activeRing, this.hover);
    r.onUpdate((dt) => {
      this.time += dt;
      const k = 0.75 + Math.sin(this.time * 4) * 0.25;
      (this.activeRing.material as THREE.MeshBasicMaterial).opacity = k;
      this.markerG.children.forEach((m, i) => { m.position.y = m.userData.y + Math.sin(this.time * 2 + i) * 0.06; m.rotation.y += dt * 1.5; });
    });
  }

  // just above the top of the KayKit floor tiles (lower and the floor hides it)
  private y(x: number, y: number) { return this.r.floorY(x, y) + 0.05; }

  /** Show the region a creature can still walk to, as an outlined area. */
  setReach(tiles: P[], origin?: P) {
    this.reach.clear();
    if (!tiles.length) return;
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    if (origin) set.add(`${origin.x},${origin.y}`);
    const fill = additive(0x5aa8ff, 0.07), edge = additive(0x9fd8ff, 0.8), grid = additive(0x8fd0ff, 0.14);
    const quad = new THREE.PlaneGeometry(0.96, 0.96);
    const w = 0.07;
    const hStrip = new THREE.PlaneGeometry(1 + w, w), vStrip = new THREE.PlaneGeometry(w, 1 + w);
    const hThin = new THREE.PlaneGeometry(1, 0.03), vThin = new THREE.PlaneGeometry(0.03, 1);
    for (const k of set) {
      const [x, y] = k.split(',').map(Number);
      const yy = this.y(x, y);
      const q = new THREE.Mesh(quad, fill); q.rotation.x = -Math.PI / 2; q.position.set(x, yy, y); this.reach.add(q);
      const add = (geo: THREE.PlaneGeometry, cx: number, cz: number) => { const m = new THREE.Mesh(geo, edge); m.rotation.x = -Math.PI / 2; m.position.set(cx, yy + 0.002, cz); this.reach.add(m); };
      if (!set.has(`${x},${y - 1}`)) add(hStrip, x, y - 0.5);
      if (!set.has(`${x},${y + 1}`)) add(hStrip, x, y + 0.5);
      if (!set.has(`${x - 1},${y}`)) add(vStrip, x - 0.5, y);
      if (!set.has(`${x + 1},${y}`)) add(vStrip, x + 0.5, y);
      // faint lines between squares inside the area: the floor tiles are octagons, the rules grid is square
      const inner = (geo: THREE.PlaneGeometry, cx: number, cz: number) => { const m = new THREE.Mesh(geo, grid); m.rotation.x = -Math.PI / 2; m.position.set(cx, yy + 0.001, cz); this.reach.add(m); };
      if (set.has(`${x + 1},${y}`)) inner(vThin, x + 0.5, y);
      if (set.has(`${x},${y + 1}`)) inner(hThin, x, y + 0.5);
    }
  }

  /** A dotted path with a ring at the end. Colour warns about opportunity attacks. */
  setPath(points: P[] | null, warn = false) {
    this.path.clear();
    if (!points || points.length < 2) return;
    const mat = additive(warn ? 0xff7a5a : 0xffe08a, 0.95);
    const pts = points.map((p) => new THREE.Vector3(p.x, this.y(p.x, p.y) + 0.02, p.y));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
    const len = curve.getLength();
    const dots = Math.max(2, Math.round(len * 4));
    const dot = new THREE.CircleGeometry(0.055, 8);
    for (let i = 1; i < dots; i++) { const m = new THREE.Mesh(dot, mat); m.rotation.x = -Math.PI / 2; m.position.copy(curve.getPoint(i / dots)); this.path.add(m); }
    const end = pts[pts.length - 1];
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 32), mat); ring.rotation.x = -Math.PI / 2; ring.position.copy(end); this.path.add(ring);
  }

  /** Squares a spell would cover: tinted fill with a brighter outline. */
  setArea(squares: P[] | null, color = 0xff8a3a) {
    this.areaG.clear();
    if (!squares || !squares.length) return;
    const set = new Set(squares.map((t) => `${t.x},${t.y}`));
    const fill = additive(color, 0.22), edge = additive(color, 0.95);
    const quad = new THREE.PlaneGeometry(0.98, 0.98);
    const w = 0.06;
    const hStrip = new THREE.PlaneGeometry(1 + w, w), vStrip = new THREE.PlaneGeometry(w, 1 + w);
    for (const t of squares) {
      const yy = this.y(t.x, t.y) + 0.004;
      const q = new THREE.Mesh(quad, fill); q.rotation.x = -Math.PI / 2; q.position.set(t.x, yy, t.y); this.areaG.add(q);
      const add = (geo: THREE.PlaneGeometry, cx: number, cz: number) => { const m = new THREE.Mesh(geo, edge); m.rotation.x = -Math.PI / 2; m.position.set(cx, yy + 0.002, cz); this.areaG.add(m); };
      if (!set.has(`${t.x},${t.y - 1}`)) add(hStrip, t.x, t.y - 0.5);
      if (!set.has(`${t.x},${t.y + 1}`)) add(hStrip, t.x, t.y + 0.5);
      if (!set.has(`${t.x - 1},${t.y}`)) add(vStrip, t.x - 0.5, t.y);
      if (!set.has(`${t.x + 1},${t.y}`)) add(vStrip, t.x + 0.5, t.y);
    }
  }

  /** Red target brackets (or green for helping an ally). Several targets can be marked at once. */
  setTarget(p: P | P[] | null, friendly = false) {
    this.marks.clear();
    if (!p) return;
    if (Array.isArray(p)) { for (const q of p) this.addTarget(q, friendly); return; }
    this.addTarget(p, friendly);
  }

  private addTarget(p: P, friendly: boolean) {
    const mat = additive(friendly ? 0x7ee07a : 0xff4a3a);
    const yy = this.y(p.x, p.y);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.52, 40), mat); ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, yy + 0.003, p.y); this.marks.add(ring);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const tri = new THREE.Mesh(new THREE.CircleGeometry(0.1, 3), mat); tri.rotation.x = -Math.PI / 2; tri.rotation.z = a + Math.PI;
      tri.position.set(p.x + Math.cos(a) * 0.64, yy + 0.003, p.y - Math.sin(a) * 0.64); this.marks.add(tri);
    }
  }

  setActive(p: P | null) {
    this.activeRing.visible = !!p;
    if (p) this.activeRing.position.set(p.x, this.y(p.x, p.y) + 0.004, p.y);
  }

  setHover(p: P | null) {
    this.hover.visible = !!p;
    if (p) this.hover.position.set(p.x, this.y(p.x, p.y) + 0.006, p.y);
  }

  /** Floating markers over things to interact with (unread notes: gold, stairs: blue). */
  setMarkers(list: { at: P; kind: 'note' | 'stairs' | 'rest' }[]) {
    this.markerG.clear();
    const colors = { note: 0xffd66b, stairs: 0x8fd0ff, rest: 0x9fffb0 };
    for (const m of list) {
      const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), additive(colors[m.kind], 0.95));
      d.scale.y = 1.6;
      d.userData.y = this.y(m.at.x, m.at.y) + 1.05;
      d.position.set(m.at.x, d.userData.y, m.at.y);
      this.markerG.add(d);
    }
  }

  clearPlanning() { this.setPath(null); this.setTarget(null); this.setHover(null); this.setArea(null); }
}
