// Pixel-art renderer with real lighting.
//
// The 3D scene (KayKit models, CC0) is lit by flickering, shadow-casting
// torches and rendered into a low-resolution HDR target, plus a matching
// normals pass. One post pass then does: filmic tone mapping, banded light
// falloff, cooler shadows, silhouette outlines from depth, highlighted creases
// from normals, and a limited palette with ordered dithering. The result is
// upscaled with hard pixels. Lighting stays fully dynamic.
import * as THREE from 'three';
import { DungeonMap, LEVEL, rng, type Archetype } from './models';
import { AssetLibrary, type Character } from './assets';
import type { Look } from '../engine/types';
import { buildKayKitDungeon } from './dungeon';

const POST_VERT = /* glsl */ `precision highp float; in vec3 position; in vec2 uv; out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tNormal; uniform vec2 res;
  uniform float exposure; uniform float levels; uniform float bands; uniform float depthRange; uniform float outlineDepth;
  uniform vec3 lightView;
  // the camera's position in whole screen pixels: keeps the dither pattern fixed to the world while panning
  uniform vec2 ditherOrigin;
  in vec2 vUv; out vec4 fragColor;
  vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
  float bayer(vec2 p) {
    int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4;
    float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
    return m[i] / 16.0 - 0.5;
  }
  float depthAt(vec2 uv) { return texture(tDepth, uv).r * depthRange; }
  vec3 normalAt(vec2 uv) { return normalize(texture(tNormal, uv).xyz * 2.0 - 1.0); }
  void main() {
    vec2 px = 1.0 / res;
    vec3 col = texture(tColor, vUv).rgb;
    float d = depthAt(vUv);
    vec3 n = normalAt(vUv);
    float edge = 0.0, crease = 0.0;
    vec2 offs[4] = vec2[4](vec2(px.x, 0.0), vec2(-px.x, 0.0), vec2(0.0, px.y), vec2(0.0, -px.y));
    for (int i = 0; i < 4; i++) {
      float dd = depthAt(vUv + offs[i]) - d;
      // silhouette: a neighbour is notably farther away → this pixel is the object's edge
      edge = max(edge, step(outlineDepth, dd));
      // crease: same surface depth, but the normal turns sharply → a convex edge catches the light
      if (abs(dd) < outlineDepth * 0.6) {
        vec3 nn = normalAt(vUv + offs[i]);
        float turn = 1.0 - dot(n, nn);
        float facing = dot(n - nn, lightView);
        crease = max(crease, step(0.22, turn) * step(0.0, facing));
      }
    }
    col = aces(col * exposure);
    // banded light falloff: quantise brightness, keep hue
    float L = dot(col, vec3(0.299, 0.587, 0.114));
    float Lq = floor(L * bands + bayer(gl_FragCoord.xy + ditherOrigin) * 0.45 + 0.5) / bands;
    col = mix(col, col * (Lq + 0.004) / (L + 0.004), 0.55);
    // shadows lean cool, highlights stay warm
    col = mix(col * vec3(0.8, 0.85, 1.15), col, smoothstep(0.04, 0.4, L));
    col = pow(col, vec3(1.0 / 2.2));
    col = mix(col, col * vec3(0.3, 0.24, 0.32), edge * 0.85);
    col = mix(col, col * 1.32 + vec3(0.025, 0.02, 0.0), crease * 0.65 * (1.0 - edge));
    col += bayer(gl_FragCoord.xy + ditherOrigin) * 0.55 / levels;
    col = floor(col * levels + 0.5) / levels;
    fragColor = vec4(col, 1.0);
  }
`;

const NORMAL_BG = new THREE.Color(0.5, 0.5, 1);

export interface FigureView {
  id: string;
  /** Root positioned on the grid; rotate it to face. */
  group: THREE.Group;
  character: Character;
  materials: THREE.MeshStandardMaterial[];
  headHeight: number;
  ring: THREE.Mesh;
  opacity: number;
  down: boolean;
}

/** A flame in the world. Lights come from a fixed pool handed to the torches nearest the camera. */
interface Torch { pos: THREE.Vector3; base: number; phase: number; flames: THREE.Group; range: number }
/** Torch lights, and how many of them cast shadows. Fixed counts: changing the number of lights recompiles every shader. */
const TORCH_LIGHTS = 8, SHADOW_LIGHTS = 3;

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  map: DungeonMap;
  readonly figures = new Map<string, FigureView>();
  readonly overlay = new THREE.Group();
  readonly pixel: number;
  readonly lib = new AssetLibrary();
  zoom = 4.0;
  readonly focus = new THREE.Vector3();
  private focusGoal = new THREE.Vector3();
  private rt!: THREE.WebGLRenderTarget;
  private normalRt!: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private post: THREE.RawShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private torches: Torch[] = [];
  private torchPool: THREE.PointLight[] = [];
  private world?: THREE.Group;
  private doorLeaves = new Map<string, THREE.Object3D>();
  /** Things that shouldn't write normals (overlays, flames, particles). */
  private noNormals: THREE.Object3D[] = [];
  private pickables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private lowW = 0; private lowH = 0;
  private time = 0;
  private camRight = new THREE.Vector3(1, 0, -1).normalize();
  private camDir = new THREE.Vector3(1, 1.05, 1).normalize();
  private camUp = new THREE.Vector3();
  /** Animation speed multiplier (?speed=4 in the URL, for testing). */
  timeScale = Number(new URLSearchParams(location.search).get('speed')) || 1;
  private updaters = new Set<(dt: number) => boolean | void>();

  private constructor(container: HTMLElement, rows: string[], pixel: number) {
    this.pixel = pixel;
    this.map = new DungeonMap(rows);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // refreshed once per frame, not again for the normals pass
    this.renderer.toneMapping = THREE.NoToneMapping;
    const cv = this.renderer.domElement;
    cv.className = 'stage';
    cv.style.imageRendering = 'pixelated';
    container.appendChild(cv);
    this.camUp.crossVectors(this.camRight, this.camDir).negate().normalize();

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    this.scene.background = new THREE.Color(0x040306);
    this.post = new THREE.RawShaderMaterial({
      vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false, glslVersion: THREE.GLSL3,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null }, res: { value: new THREE.Vector2() },
        exposure: { value: 1.05 }, levels: { value: 24 }, bands: { value: 7 }, depthRange: { value: 79.9 }, outlineDepth: { value: 0.3 },
        lightView: { value: new THREE.Vector3(-0.35, 0.85, 0.4).normalize() },
        ditherOrigin: { value: new THREE.Vector2() },
      },
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.scene.add(this.overlay);
    this.noNormals.push(this.overlay);
    this.focus.copy(this.map.center()); this.focusGoal.copy(this.focus);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  static async create(container: HTMLElement, rows: string[], onProgress?: (done: number, total: number) => void, pixel = 3) {
    const r = new PixelRenderer(container, rows, pixel);
    await r.lib.load(onProgress);
    r.buildLights();
    r.buildWorld();
    return r;
  }

  /** Swap to another floor: the dungeon and all figures are rebuilt; lights and effects stay. */
  loadMap(rows: string[]) {
    for (const id of [...this.figures.keys()]) this.removeFigure(id);
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) m.geometry?.dispose(); });
    }
    for (const t of this.torches) { this.scene.remove(t.flames); const i = this.noNormals.indexOf(t.flames); if (i >= 0) this.noNormals.splice(i, 1); }
    this.torches = [];
    this.pickables = this.pickables.filter((p) => this.figures.has(p.userData.creatureId));
    this.map = new DungeonMap(rows);
    this.buildWorld();
    this.focus.copy(this.map.center()); this.focusGoal.copy(this.focus);
  }

  // ------------------------------------------------------------ world

  /** Lights that exist for the whole game (their number must never change). */
  private moon!: THREE.DirectionalLight;
  private buildLights() {
    // cold ambient + faint moonlight for readable shadows; the torches do the rest
    this.scene.add(new THREE.HemisphereLight(0x8c8aa0, 0x2a1a10, 0.7));
    const moon = new THREE.DirectionalLight(0xc8d0ff, 0.5);
    moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 70 });
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.02;
    this.scene.add(moon, moon.target);
    this.moon = moon;
    for (let i = 0; i < TORCH_LIGHTS; i++) {
      const light = new THREE.PointLight(0xff8a3a, 0, 10, 1.25);
      if (i < SHADOW_LIGHTS) { light.castShadow = true; light.shadow.mapSize.set(512, 512); light.shadow.bias = -0.003; light.shadow.radius = 1; }
      this.scene.add(light);
      this.torchPool.push(light);
    }
  }

  private buildWorld() {
    const built = buildKayKitDungeon(this.map, this.lib);
    this.world = built.group;
    this.scene.add(built.group);
    this.pickables.push(...built.pickables);
    this.doorLeaves = built.doors;

    for (const t of built.torches) this.addTorch(t.pos.clone().addScaledVector(t.dir, 0.15), 8, 0.32, t.pos.y - 0.05, t.pos, 10);
    for (const b of built.braziers) this.addTorch(b.clone().setY(1.0), 16, 0.9, b.y, undefined, 12);

    // drifting embers / dust
    const r = rng(3), n = 110, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = r() * this.map.width - 0.5; pos[i * 3 + 1] = r() * 2.2; pos[i * 3 + 2] = r() * this.map.height - 0.5; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb070, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(dust); this.noNormals.push(dust);
    this.onUpdate((dt) => {
      const a = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) { let y = a.getY(i) + dt * 0.08; if (y > 2.4) y = 0; a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(this.time + i) * dt * 0.03); }
      a.needsUpdate = true;
    });
  }

  private addTorch(p: THREE.Vector3, intensity: number, flameScale: number, flameY: number, flameAt = p, range = 10) {
    const flames = new THREE.Group();
    [0xff5a10, 0xffa030, 0xffe8a0].forEach((c, i) => {
      const s = (0.34 - i * 0.09) * flameScale;
      const m = new THREE.Mesh(new THREE.ConeGeometry(s * 0.55, s * 1.9, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3 - i * 0.6) }));
      m.position.y = s * 0.7 + i * 0.02; flames.add(m);
    });
    flames.position.set(flameAt.x, flameY, flameAt.z);
    this.scene.add(flames); this.noNormals.push(flames);
    this.torches.push({ pos: p.clone(), base: intensity, phase: Math.random() * 10, flames, range });
  }

  /**
   * Hand the pooled torch lights to the torches nearest the camera, the closest ones
   * getting the shadow-casting lights. A torch far away keeps its flame but no light.
   */
  private assignTorchLights() {
    const f = this.focus;
    const near = [...this.torches].sort((a, b) => a.pos.distanceToSquared(f) - b.pos.distanceToSquared(f)).slice(0, TORCH_LIGHTS);
    // shadow-casting lights go to the nearest few; the rest of the pool fills in after
    this.torchPool.forEach((light, i) => {
      const t = near[i];
      light.userData.torch = t;
      if (!t) { light.intensity = 0; return; }
      light.position.copy(t.pos); light.distance = t.range;
    });
    this.lightsAt.copy(f);
  }
  private lightsAt = new THREE.Vector3(1e9, 0, 0);

  /** Swing a door open (or shut). */
  setDoorOpen(x: number, y: number, open: boolean, instant = false) {
    const hinge = this.doorLeaves.get(`${x},${y}`);
    if (!hinge) return Promise.resolve();
    const to = open ? -Math.PI * 0.55 : 0, from = hinge.rotation.y;
    if (instant) { hinge.rotation.y = to; return Promise.resolve(); }
    return this.tween(0.35, (k) => { hinge.rotation.y = from + (to - from) * (1 - (1 - k) ** 2); });
  }

  // ------------------------------------------------------------ figures

  /** Put a figure on the map. `lantern: false` skips the hero's lantern light (the creator's preview, which changes often). */
  addFigure(id: string, archetype: Archetype, side: 'party' | 'enemy', x: number, y: number, facing: number, look?: Look, opts: { lantern?: boolean } = {}): FigureView {
    const character = this.lib.character(archetype, look);
    const group = new THREE.Group();
    group.add(character.model);
    // team ring at the feet
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(side === 'party' ? 0x3d8bff : 0xe0392e).multiplyScalar(1.4), transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    group.add(ring); this.noNormals.push(ring);
    // heroes carry a faint lantern so they read clearly in the dark corners
    if (side === 'party' && opts.lantern !== false) { const lantern = new THREE.PointLight(0xffd9a0, 2.2, 3.2, 1.6); lantern.position.set(0.1, 1.0, 0.15); group.add(lantern); }
    group.position.set(x, this.map.floorY(x, y), y);
    group.rotation.y = Math.PI / 2 - facing; // KayKit models face +z
    group.traverse((o) => { o.userData.creatureId = id; });
    this.scene.add(group);
    this.pickables.push(group);
    const box = new THREE.Box3().setFromObject(character.model);
    const view: FigureView = { id, group, character, materials: character.materials, headHeight: Math.max(0.6, (box.max.y - group.position.y) * 0.9), ring, opacity: 1, down: false };
    this.figures.set(id, view);
    return view;
  }

  removeFigure(id: string) {
    const v = this.figures.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    this.pickables = this.pickables.filter((p) => p !== v.group);
    const i = this.noNormals.indexOf(v.ring); if (i >= 0) this.noNormals.splice(i, 1);
    this.figures.delete(id);
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
    v.materials.forEach((m) => { m.emissive.setHex(color); m.emissiveIntensity = 1.4; });
    this.after(dur, () => v.materials.forEach((m, i) => { m.emissive.setHex(saved[i][0]); m.emissiveIntensity = saved[i][1]; }));
  }

  /** Turn a figure to face a grid position. */
  face(id: string, x: number, y: number) {
    const v = this.figures.get(id); if (!v) return;
    const dx = x - v.group.position.x, dz = y - v.group.position.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-3) return;
    v.group.rotation.y = Math.atan2(dx, dz);
  }

  worldOf(x: number, y: number): THREE.Vector3 { return new THREE.Vector3(x, this.map.floorY(x, y), y); }

  project(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    const cssW = this.lowW * this.pixel, cssH = this.lowH * this.pixel;
    return { x: (p.x * 0.5 + 0.5) * cssW, y: (-p.y * 0.5 + 0.5) * cssH };
  }

  projectHead(id: string, extra = 0.25) {
    const v = this.figures.get(id);
    if (!v) return { x: -999, y: -999 };
    return this.project(v.group.position.clone().add(new THREE.Vector3(0, v.down ? 0.35 : v.headHeight + extra, 0)));
  }

  /**
   * Compile every shader the scene needs (all three passes) without blocking, while a loading screen is up.
   * The render loop pauses meanwhile, or its next frame would compile them all at once and freeze.
   */
  async precompile() {
    this.paused = true;
    try {
      this.renderer.setRenderTarget(this.rt);
      await this.renderer.compileAsync(this.scene, this.camera);
      this.scene.overrideMaterial = this.normalMat;
      this.renderer.setRenderTarget(this.normalRt);
      await this.renderer.compileAsync(this.scene, this.camera);
      this.scene.overrideMaterial = null;
      this.renderer.setRenderTarget(null);
      await this.renderer.compileAsync(this.postScene, this.postCam);
    } finally {
      this.scene.overrideMaterial = null;
      this.paused = false;
    }
  }

  // ------------------------------------------------------------ picking

  pick(clientX: number, clientY: number): { tile?: { x: number; y: number }; creatureId?: string } {
    const cssW = this.lowW * this.pixel, cssH = this.lowH * this.pixel;
    const ndc = new THREE.Vector2((clientX / cssW) * 2 - 1, -(clientY / cssH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables.filter((o) => o.visible), true);
    const out: { tile?: { x: number; y: number }; creatureId?: string } = {};
    for (const h of hits) {
      if (!out.creatureId && h.object.userData.creatureId) out.creatureId = h.object.userData.creatureId;
      const tile = h.object.userData.tile ?? (h.instanceId !== undefined ? h.object.userData.tiles?.[h.instanceId] : undefined);
      if (!out.tile && tile) out.tile = { x: tile.x, y: tile.y };
      if (out.tile) break;
    }
    if (out.creatureId && !out.tile) {
      const g = this.figures.get(out.creatureId)!.group.position; out.tile = { x: Math.round(g.x), y: Math.round(g.z) };
    }
    return out;
  }

  // ------------------------------------------------------------ camera

  lookAt(x: number, z: number, instant = false) { this.focusGoal.set(x, 0, z); if (instant) this.focus.copy(this.focusGoal); }

  /**
   * Bring a square into view only if it isn't comfortably on screen already (inside the
   * middle `margin` fraction of the view). Keeps the camera still unless it has to move.
   */
  ensureVisible(x: number, z: number, margin = 0.6) {
    const p = new THREE.Vector3(x, this.map.floorY(x, z), z);
    // judge against where the camera is heading, not where it is mid-ease
    const saved = this.focus.clone();
    this.focus.copy(this.focusGoal); this.updateCamera();
    const ndc = p.clone().project(this.camera);
    this.focus.copy(saved); this.updateCamera();
    if (Math.abs(ndc.x) > margin || Math.abs(ndc.y) > margin) this.lookAt(x, z);
  }
  pan(dx: number, dz: number) { this.focusGoal.x += dx; this.focusGoal.z += dz; this.clampFocus(); }
  /** Zoom (half the view height in squares). `close` allows the creator's close-up. */
  setZoom(z: number, close = false) { this.zoom = Math.min(8, Math.max(close ? 1.2 : 2.8, z)); this.updateCamera(); }
  private clampFocus() {
    this.focusGoal.x = Math.min(this.map.width, Math.max(-1, this.focusGoal.x));
    this.focusGoal.z = Math.min(this.map.height, Math.max(-1, this.focusGoal.z));
  }

  private get texel() { return (2 * this.zoom) / this.lowH; }

  /** Snap a world position to the screen's pixel grid (along the camera's right/up axes). */
  private snap(p: THREE.Vector3): THREE.Vector3 {
    const t = this.texel;
    const r = Math.round(p.dot(this.camRight) / t) * t, u = Math.round(p.dot(this.camUp) / t) * t, d = p.dot(this.camDir);
    return this.camRight.clone().multiplyScalar(r).addScaledVector(this.camUp, u).addScaledVector(this.camDir, d);
  }

  private updateCamera() {
    const aspect = this.lowW / this.lowH;
    Object.assign(this.camera, { left: -this.zoom * aspect, right: this.zoom * aspect, top: this.zoom, bottom: -this.zoom });
    this.camera.updateProjectionMatrix();
    const snapped = this.snap(this.focus);
    // Panning moves the picture in whole pixels; move the dither pattern with it. A pattern fixed to the
    // screen makes every dithered gradient flip as the floor slides under it, which reads as shaking.
    const t = this.texel;
    (this.post.uniforms.ditherOrigin.value as THREE.Vector2).set(
      ((Math.round(this.focus.dot(this.camRight) / t) % 4) + 4) % 4,
      ((Math.round(this.focus.dot(this.camUp) / t) % 4) + 4) % 4,
    );
    this.camera.position.copy(snapped).addScaledVector(this.camDir, 30);
    this.camera.lookAt(snapped);
    this.camera.updateMatrixWorld();
  }

  resize() {
    this.lowW = Math.ceil(innerWidth / this.pixel);
    this.lowH = Math.ceil(innerHeight / this.pixel);
    this.renderer.setSize(this.lowW, this.lowH, false);
    const cv = this.renderer.domElement;
    cv.style.width = `${this.lowW * this.pixel}px`; cv.style.height = `${this.lowH * this.pixel}px`;
    this.rt?.dispose(); this.normalRt?.dispose();
    const opts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.rt = new THREE.WebGLRenderTarget(this.lowW, this.lowH, { ...opts, type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(this.lowW, this.lowH) });
    this.normalRt = new THREE.WebGLRenderTarget(this.lowW, this.lowH, opts);
    this.post.uniforms.tColor.value = this.rt.texture;
    this.post.uniforms.tDepth.value = this.rt.depthTexture;
    this.post.uniforms.tNormal.value = this.normalRt.texture;
    (this.post.uniforms.res.value as THREE.Vector2).set(this.lowW, this.lowH);
    this.updateCamera();
  }

  // ------------------------------------------------------------ loop & tweening

  onUpdate(fn: (dt: number) => boolean | void) { this.updaters.add(fn); }

  tween(dur: number, fn: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      if (dur <= 0) { fn(1); resolve(); return; }
      this.updaters.add((dt) => { t += dt; const k = Math.min(1, t / dur); fn(k); if (k >= 1) { resolve(); return true; } });
    });
  }
  wait(s: number) { return this.tween(s, () => {}); }
  after(s: number, fn: () => void) { this.wait(s).then(fn); }

  private started = false;
  /** Skip rendering (while shaders compile in the background). */
  paused = false;
  start() {
    if (this.started) return;
    this.started = true;
    let last = performance.now();
    const frame = (now: number) => {
      // rAF timestamps can precede performance.now(): never let dt go negative
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) * this.timeScale; last = now;
      if (!this.paused) this.frame(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  frame(dt: number) {
    this.time += dt;
    // camera first, so anything projected to the screen this frame (nameplates, floating text) lines up
    this.focus.lerp(this.focusGoal, 1 - Math.pow(0.004, dt));
    this.updateCamera();
    for (const fn of [...this.updaters]) if (fn(dt) === true) this.updaters.delete(fn);
    // animate figures; ones far off screen only advance their clocks (cheap) until they're near again
    const reach = this.zoom * 2.2 + 3;
    for (const f of this.figures.values()) {
      const far = Math.abs(f.group.position.x - this.focus.x) + Math.abs(f.group.position.z - this.focus.z) > reach * 1.5;
      f.character.update(dt, !far);
    }
    if (this.lightsAt.distanceToSquared(this.focus) > 1) this.assignTorchLights();
    for (const t of this.torches) {
      // the flames themselves can dance: they're small and don't light anything
      t.flames.scale.set(1, 0.9 + Math.sin(this.time * 7 + t.phase) * 0.08, 1);
      t.flames.rotation.y += dt * 2;
    }
    for (const light of this.torchPool) {
      const t = light.userData.torch as Torch | undefined;
      if (!t) continue;
      // A slow, shallow breathing of the light. Fast flicker made the banded lighting crawl across
      // the whole floor (the quantised bands jump with every small change in brightness).
      light.intensity = t.base * (0.95 + Math.sin(this.time * 1.3 + t.phase) * 0.03 + Math.sin(this.time * 2.1 + t.phase * 2) * 0.02);
    }
    // the moon's shadow box follows the camera, so a big floor still gets crisp shadows near the action
    this.moon.position.set(this.focus.x + 10, 18, this.focus.z + 4); this.moon.target.position.copy(this.focus).setY(0);
    this.moon.target.updateMatrixWorld();

    // snap figures to whole pixels for the render (keeps sprites crisp while they move)
    const saved: [THREE.Group, THREE.Vector3][] = [];
    for (const f of this.figures.values()) { saved.push([f.group, f.group.position.clone()]); f.group.position.copy(this.snap(f.group.position)); }

    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    // normals pass (no overlays / flames / particles)
    const vis = this.noNormals.map((o) => o.visible);
    this.noNormals.forEach((o) => (o.visible = false));
    const bg = this.scene.background;
    this.scene.background = NORMAL_BG;
    this.scene.overrideMaterial = this.normalMat;
    this.renderer.setRenderTarget(this.normalRt);
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
    this.noNormals.forEach((o, i) => (o.visible = vis[i]));

    for (const [g, p] of saved) g.position.copy(p);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  /** Add a visual effect: it's lit and drawn but writes no normals (no outlines on glows). */
  addFx(o: THREE.Object3D) { this.scene.add(o); this.noNormals.push(o); }
  removeFx(o: THREE.Object3D) {
    this.scene.remove(o);
    const i = this.noNormals.indexOf(o); if (i >= 0) this.noNormals.splice(i, 1);
    o.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh || (x as THREE.Points).isPoints) { m.geometry?.dispose(); const mat = m.material as THREE.Material; mat?.dispose?.(); } });
  }

  floorY(x: number, y: number) { return this.map.floorY(x, y); }
  static readonly LEVEL = LEVEL;
}
