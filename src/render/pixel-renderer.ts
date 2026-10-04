// Pixel-art renderer with real lighting.
//
// The 3D scene is lit by flickering, shadow-casting torches and rendered into a
// low-resolution HDR target. A single post pass then does filmic tone mapping,
// a limited palette with ordered dithering, and depth-based outlines, and the
// result is shown upscaled with hard pixels. Lighting stays fully dynamic.
import * as THREE from 'three';
import { DungeonMap, buildDungeon, buildFigure, LEVEL, rng, type Archetype, type MatFactory, type Palette } from './models';

export const PALETTE: Palette = {
  floor: [0x6b6352, 0x5d5647, 0x736a57, 0x564f42], wall: [0x5a5249, 0x4d463e, 0x645a4f], trim: 0x7a7064,
  wood: 0x7a4a26, metal: 0x9aa2ac, gold: 0xd8aa50, skin: 0xe0a882, beard: 0xc0582a, tabard: 0x2a4c8c,
  shield: 0x2e5aa0, cloak: 0x34403c, leather: 0x6a4428, goblin: 0x86a83e, goblinDark: 0x4e3e2c, bossCape: 0xa02020, baseTop: 0x2a2622,
};

const POST_VERT = /* glsl */ `precision highp float; in vec3 position; in vec2 uv; out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 res;
  uniform float exposure; uniform float levels; uniform float depthRange; uniform float outlineDepth;
  in vec2 vUv; out vec4 fragColor;
  vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
  float bayer(vec2 p) {
    int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4;
    float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
    return m[i] / 16.0 - 0.5;
  }
  float depthAt(vec2 uv) { return texture(tDepth, uv).r * depthRange; }
  void main() {
    vec2 px = 1.0 / res;
    vec3 col = texture(tColor, vUv).rgb;
    float d = depthAt(vUv);
    // inner outline: this pixel is notably closer than a neighbour → silhouette edge
    float edge = 0.0;
    edge = max(edge, step(outlineDepth, depthAt(vUv + vec2(px.x, 0.0)) - d));
    edge = max(edge, step(outlineDepth, depthAt(vUv - vec2(px.x, 0.0)) - d));
    edge = max(edge, step(outlineDepth, depthAt(vUv + vec2(0.0, px.y)) - d));
    edge = max(edge, step(outlineDepth, depthAt(vUv - vec2(0.0, px.y)) - d));
    col = aces(col * exposure);
    col = pow(col, vec3(1.0 / 2.2));
    // outlines darken toward a deep warm violet rather than flat black
    col = mix(col, col * vec3(0.32, 0.26, 0.34), edge * 0.85);
    // posterise with a 4x4 ordered dither
    col += bayer(gl_FragCoord.xy) / levels;
    col = floor(col * levels + 0.5) / levels;
    fragColor = vec4(col, 1.0);
  }
`;

export interface FigureView {
  id: string;
  group: THREE.Group;
  fig: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  headHeight: number;
  ring: THREE.Mesh;
  opacity: number;
  down: boolean;
}

interface Torch { light: THREE.PointLight; base: number; phase: number; flames: THREE.Group }

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly map: DungeonMap;
  readonly figures = new Map<string, FigureView>();
  readonly overlay = new THREE.Group();
  readonly pixel: number;
  zoom = 5.4;
  /** Point the camera looks at (world space, y = 0). */
  readonly focus = new THREE.Vector3();
  private focusGoal = new THREE.Vector3();
  private rt!: THREE.WebGLRenderTarget;
  private post: THREE.RawShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private torches: Torch[] = [];
  private pickables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private lowW = 0; private lowH = 0;
  private time = 0;
  /** Animation speed multiplier (?speed=4 in the URL, for testing). */
  timeScale = Number(new URLSearchParams(location.search).get('speed')) || 1;
  private updaters = new Set<(dt: number) => boolean | void>();
  private grain: THREE.Texture;

  constructor(container: HTMLElement, rows: string[], pixel = 3) {
    this.pixel = pixel;
    this.map = new DungeonMap(rows);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    const cv = this.renderer.domElement;
    cv.className = 'stage';
    cv.style.imageRendering = 'pixelated';
    container.appendChild(cv);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    this.scene.background = new THREE.Color(0x050407);

    this.post = new THREE.RawShaderMaterial({
      vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, res: { value: new THREE.Vector2() },
        exposure: { value: 1.25 }, levels: { value: 22 }, depthRange: { value: 79.9 }, outlineDepth: { value: 0.35 },
      },
    });
    this.post.glslVersion = THREE.GLSL3;
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));

    this.grain = makeGrain();
    this.buildWorld();
    this.scene.add(this.overlay);
    this.focus.copy(this.map.center()); this.focusGoal.copy(this.focus);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------ world

  /** Shared, cached materials for static scenery. */
  private staticMat: MatFactory = (() => {
    const cache = new Map<string, THREE.Material>();
    return (color, o = {}) => {
      const key = `${color}|${o.metal}|${o.emissive}|${o.rough}`;
      let m = cache.get(key);
      if (!m) { m = this.makeMaterial(color, o); cache.set(key, m); }
      return m;
    };
  })();

  private makeMaterial(color: number, o: Parameters<MatFactory>[1] = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? (o.metal ? 0.35 : 0.85), metalness: o.metal ? 0.7 : 0.02,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissive ? 2.4 : 0,
      map: o.metal || o.emissive ? null : this.grain,
    });
  }

  private buildWorld() {
    const dungeon = buildDungeon(this.map, this.staticMat, PALETTE);
    this.scene.add(dungeon);
    dungeon.traverse((o) => { if (o.userData.tile) this.pickables.push(o); });

    // cold ambient + faint moonlight through the doorway for readable shadows
    this.scene.add(new THREE.HemisphereLight(0x8a8478, 0x2a1a10, 0.75));
    const moon = new THREE.DirectionalLight(0xc8d0ff, 0.55);
    const c = this.map.center();
    moon.position.set(c.x + 10, 18, c.z + 4); moon.target.position.copy(c);
    moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
    Object.assign(moon.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.02;
    this.scene.add(moon, moon.target);

    // wall sconces wherever a wall faces open floor, spaced out
    let shadowBudget = 3;
    const placed: THREE.Vector3[] = [];
    for (const t of this.map.tiles) {
      if (t.kind !== 'wall') continue;
      const open = [[0, 1], [1, 0]].find(([dx, dy]) => { const n = this.map.tileAt(t.x + dx, t.y + dy); return n && n.kind === 'floor'; });
      if (!open) continue;
      const p = new THREE.Vector3(t.x + open[0] * 0.42, 1.75, t.y + open[1] * 0.42);
      if (placed.some((q) => q.distanceTo(p) < 4.5)) continue;
      placed.push(p);
      const sconce = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.03, 0.28, 6), this.staticMat(PALETTE.metal, { metal: true }));
      sconce.position.copy(p).setY(1.52); this.scene.add(sconce);
      this.addTorch(p, 15, 0xff8a3a, shadowBudget-- > 0, 0.45);
    }
    for (const t of this.map.tiles) if (t.kind === 'brazier') this.addTorch(new THREE.Vector3(t.x, 1.0, t.y), 26, 0xff7a2a, shadowBudget-- > 0, 0.9, 0.78);

    // drifting embers / dust
    const r = rng(3), n = 120, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = r() * this.map.width - 0.5; pos[i * 3 + 1] = r() * 2.4; pos[i * 3 + 2] = r() * this.map.height - 0.5; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb070, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(dust);
    this.onUpdate((dt) => {
      const a = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) { let y = a.getY(i) + dt * 0.08; if (y > 2.6) y = 0; a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(this.time + i) * dt * 0.03); }
      a.needsUpdate = true;
    });
  }

  private addTorch(p: THREE.Vector3, intensity: number, color: number, shadow: boolean, flameScale: number, flameY = p.y - 0.08) {
    const light = new THREE.PointLight(color, intensity, 10, 1.25);
    light.position.copy(p);
    if (shadow) { light.castShadow = true; light.shadow.mapSize.set(512, 512); light.shadow.bias = -0.003; light.shadow.radius = 1; }
    this.scene.add(light);
    const flames = new THREE.Group();
    const cols = [0xff5a10, 0xffa030, 0xffe8a0];
    cols.forEach((c, i) => {
      const s = (0.34 - i * 0.09) * flameScale;
      const m = new THREE.Mesh(new THREE.ConeGeometry(s * 0.55, s * 1.9, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3 - i * 0.6) }));
      m.position.y = s * 0.7 + i * 0.02; flames.add(m);
    });
    flames.position.set(p.x, flameY, p.z);
    this.scene.add(flames);
    this.torches.push({ light, base: intensity, phase: Math.random() * 10, flames });
  }

  // ------------------------------------------------------------ figures

  addFigure(id: string, archetype: Archetype, side: 'party' | 'enemy', x: number, y: number, facing: number): FigureView {
    const materials: THREE.MeshStandardMaterial[] = [];
    const M: MatFactory = (color, o = {}) => { const m = this.makeMaterial(color, o); materials.push(m); return m; };
    const group = buildFigure({ id, archetype, side, facing, x, y }, this.map, M, PALETTE);
    const fig = group.userData.figure as THREE.Group;
    // the coloured rim is the 2nd child (after the base)
    const ring = group.children[1] as THREE.Mesh;
    group.traverse((o) => { o.userData.creatureId = id; });
    // heroes carry a faint lantern so they read clearly in the dark corners
    if (side === 'party') {
      const lantern = new THREE.PointLight(0xffd9a0, 2.2, 3.2, 1.6);
      lantern.position.set(0.15, 0.9, 0.1); group.add(lantern);
    }
    this.scene.add(group);
    this.pickables.push(group);
    const view: FigureView = { id, group, fig, materials, headHeight: group.userData.headHeight, ring, opacity: 1, down: false };
    this.figures.set(id, view);
    return view;
  }

  setOpacity(id: string, opacity: number) {
    const v = this.figures.get(id); if (!v) return;
    v.opacity = opacity;
    for (const m of v.materials) { m.transparent = opacity < 1; m.opacity = opacity; m.depthWrite = opacity > 0.5; m.needsUpdate = true; }
    v.group.visible = opacity > 0.01;
  }

  flash(id: string, color = 0xff2a1a, dur = 0.18) {
    const v = this.figures.get(id); if (!v) return;
    const saved = v.materials.map((m) => [m.emissive.getHex(), m.emissiveIntensity] as const);
    v.materials.forEach((m) => { m.emissive.setHex(color); m.emissiveIntensity = 1.6; });
    this.after(dur, () => v.materials.forEach((m, i) => { m.emissive.setHex(saved[i][0]); m.emissiveIntensity = saved[i][1]; }));
  }

  /** Tiny pixel-art portraits rendered from the real figures (hide everything else, add a key light). */
  renderPortraits(size = 40): Record<string, string> {
    const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    r.setSize(size, size); r.setPixelRatio(1); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.3;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    const key = new THREE.PointLight(0xffd8a8, 6, 4, 1.5); this.scene.add(key);
    const hidden: THREE.Object3D[] = [];
    this.scene.children.forEach((c) => { if (!(c instanceof THREE.Light) && c.visible) { hidden.push(c); c.visible = false; } });
    const bg = this.scene.background; this.scene.background = new THREE.Color(0x2a2018);
    const out: Record<string, string> = {};
    for (const [id, v] of this.figures) {
      v.group.visible = true;
      const head = v.group.position.clone().add(new THREE.Vector3(0, v.headHeight - 0.02, 0));
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(v.group.quaternion);
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
      cam.position.copy(head).addScaledVector(fwd, 0.95).addScaledVector(side, 0.35).add(new THREE.Vector3(0, 0.06, 0));
      cam.lookAt(head);
      key.position.copy(cam.position).add(new THREE.Vector3(0, 0.5, 0));
      r.render(this.scene, cam);
      out[id] = r.domElement.toDataURL();
      v.group.visible = false;
    }
    hidden.forEach((c) => (c.visible = true));
    this.scene.background = bg; this.scene.remove(key); key.dispose();
    r.dispose();
    return out;
  }

  /** Turn a figure to face a grid position. */
  face(id: string, x: number, y: number) {
    const v = this.figures.get(id); if (!v) return;
    const dx = x - v.group.position.x, dz = y - v.group.position.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-3) return;
    v.group.rotation.y = -Math.atan2(dz, dx);
  }

  worldOf(x: number, y: number): THREE.Vector3 { return new THREE.Vector3(x, this.map.floorY(x, y), y); }

  /** Screen position (CSS px) of a world point. */
  project(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    const cssW = this.lowW * this.pixel, cssH = this.lowH * this.pixel;
    return { x: (p.x * 0.5 + 0.5) * cssW, y: (-p.y * 0.5 + 0.5) * cssH };
  }

  /** Screen position above a creature's head. */
  projectHead(id: string, extra = 0.25) {
    const v = this.figures.get(id);
    if (!v) return { x: -999, y: -999 };
    return this.project(v.group.position.clone().add(new THREE.Vector3(0, v.down ? 0.35 : v.headHeight + extra, 0)));
  }

  // ------------------------------------------------------------ picking

  pick(clientX: number, clientY: number): { tile?: { x: number; y: number }; creatureId?: string } {
    const cssW = this.lowW * this.pixel, cssH = this.lowH * this.pixel;
    const ndc = new THREE.Vector2((clientX / cssW) * 2 - 1, -(clientY / cssH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables.filter((o) => o.visible), true);
    const out: { tile?: { x: number; y: number }; creatureId?: string } = {};
    for (const h of hits) {
      if (!out.creatureId && h.object.userData.creatureId && h.object.visible) { out.creatureId = h.object.userData.creatureId; }
      if (!out.tile && h.object.userData.tile) { const t = h.object.userData.tile; out.tile = { x: t.x, y: t.y }; }
      if (out.tile) break;
    }
    if (out.creatureId && !out.tile) {
      const g = this.figures.get(out.creatureId)!.group.position; out.tile = { x: Math.round(g.x), y: Math.round(g.z) };
    }
    return out;
  }

  // ------------------------------------------------------------ camera

  lookAt(x: number, z: number, instant = false) { this.focusGoal.set(x, 0, z); if (instant) this.focus.copy(this.focusGoal); }
  pan(dx: number, dz: number) { this.focusGoal.x += dx; this.focusGoal.z += dz; this.clampFocus(); }
  setZoom(z: number) { this.zoom = Math.min(8, Math.max(3.2, z)); this.updateCamera(); }
  private clampFocus() {
    this.focusGoal.x = Math.min(this.map.width, Math.max(-1, this.focusGoal.x));
    this.focusGoal.z = Math.min(this.map.height, Math.max(-1, this.focusGoal.z));
  }

  private updateCamera() {
    const aspect = this.lowW / this.lowH;
    const half = this.zoom;
    Object.assign(this.camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    this.camera.updateProjectionMatrix();
    // snap the focus to the pixel grid along the camera's screen axes to avoid shimmering
    const dir = new THREE.Vector3(1, 1.05, 1).normalize();
    const right = new THREE.Vector3(1, 0, -1).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).negate().normalize();
    const texel = (2 * half) / this.lowH;
    const f = this.focus.clone();
    const sr = Math.round(f.dot(right) / texel) * texel, su = Math.round(f.dot(up) / texel) * texel, sd = f.dot(dir);
    const snapped = right.clone().multiplyScalar(sr).add(up.clone().multiplyScalar(su)).add(dir.clone().multiplyScalar(sd));
    this.camera.position.copy(snapped).addScaledVector(dir, 30);
    this.camera.lookAt(snapped);
    this.camera.updateMatrixWorld();
  }

  resize() {
    this.lowW = Math.ceil(innerWidth / this.pixel);
    this.lowH = Math.ceil(innerHeight / this.pixel);
    this.renderer.setSize(this.lowW, this.lowH, false);
    const cv = this.renderer.domElement;
    cv.style.width = `${this.lowW * this.pixel}px`; cv.style.height = `${this.lowH * this.pixel}px`;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(this.lowW, this.lowH, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(this.lowW, this.lowH), minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.post.uniforms.tColor.value = this.rt.texture;
    this.post.uniforms.tDepth.value = this.rt.depthTexture;
    (this.post.uniforms.res.value as THREE.Vector2).set(this.lowW, this.lowH);
    this.updateCamera();
  }

  // ------------------------------------------------------------ loop & tweening

  onUpdate(fn: (dt: number) => boolean | void) { this.updaters.add(fn); }

  /** Animate over `dur` seconds; resolves when finished. */
  tween(dur: number, fn: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      if (dur <= 0) { fn(1); resolve(); return; }
      this.updaters.add((dt) => { t += dt; const k = Math.min(1, t / dur); fn(k); if (k >= 1) { resolve(); return true; } });
    });
  }
  wait(s: number) { return this.tween(s, () => {}); }
  after(s: number, fn: () => void) { this.wait(s).then(fn); }

  start() {
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000) * this.timeScale; last = now;
      this.frame(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Advance animation by dt and draw one frame. */
  frame(dt: number) {
    this.time += dt;
    for (const fn of [...this.updaters]) if (fn(dt) === true) this.updaters.delete(fn);
    for (const t of this.torches) {
      const f = 0.82 + Math.sin(this.time * 9 + t.phase) * 0.06 + Math.sin(this.time * 23.7 + t.phase * 2) * 0.05 + Math.sin(this.time * 3.1 + t.phase) * 0.07;
      t.light.intensity = t.base * f;
      t.flames.scale.set(1, 0.85 + f * 0.25, 1);
      t.flames.rotation.y += dt * 2;
    }
    this.focus.lerp(this.focusGoal, 1 - Math.pow(0.0015, dt));
    this.updateCamera();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  /** Height of a tile's floor in world units. */
  floorY(x: number, y: number) { return this.map.floorY(x, y); }
  static readonly LEVEL = LEVEL;
}

function makeGrain(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  const img = g.createImageData(128, 128); const r = rng(11);
  for (let i = 0; i < 128 * 128; i++) { const v = 205 + r() * 50; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}
