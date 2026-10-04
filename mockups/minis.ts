// Style A: "Painted Miniatures" — real-time 3D, torchlit dungeon, figures on bases.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildDungeon, buildFigure, buildOverlays, gridCenter, floorY, rng, type MatFactory, type Palette } from './shared/three-dungeon';
import { units, activeId, targetId, previewPath, reachable } from './shared/scene';
import { mountHud } from './shared/hud';
import { setupIsoCamera, renderPortraits, flame } from './shared/three-common';

const P: Palette = {
  floor: [0x6b6352, 0x5d5647, 0x736a57, 0x564f42], wall: [0x5a5249, 0x4d463e, 0x645a4f], trim: 0x7a7064,
  wood: 0x6b4526, metal: 0x8d939a, gold: 0xc8a050, skin: 0xd9a27e, beard: 0xb2502a, tabard: 0x24427a,
  shield: 0x2b4f8c, cloak: 0x2b3230, leather: 0x5a3b24, goblin: 0x7d9a3e, goblinDark: 0x4a3a2a, bossCape: 0x8c1d1d, baseTop: 0x2a2622,
};

const grain = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256); const r = rng(11);
  for (let i = 0; i < 256 * 256; i++) { const v = 215 + r() * 40; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const matCache = new Map<string, THREE.Material>();
const M: MatFactory = (color, o = {}) => {
  const key = `${color}|${o.metal}|${o.emissive}|${o.rough}|${o.transparent}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? (o.metal ? 0.38 : 0.8), metalness: o.metal ? 0.75 : 0.02,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissive ? 2.2 : 0,
      transparent: !!o.transparent, opacity: o.transparent ? 0.42 : 1, map: o.metal || o.emissive ? null : grain, bumpMap: o.metal || o.emissive ? null : grain, bumpScale: 0.6,
    });
    matCache.set(key, m);
  }
  return m;
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.className = 'stage';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060a);
scene.fog = new THREE.Fog(0x07060a, 32, 52);

const camera = setupIsoCamera(gridCenter().add(new THREE.Vector3(0.9, 0, 0.6)), 6.2);

scene.add(buildDungeon(M, P));
const figures = units.map((u) => buildFigure(u, M, P));
figures.forEach((f) => scene.add(f));
const active = units.find((u) => u.id === activeId)!;
const target = units.find((u) => u.id === targetId)!;
if (!location.search.includes('nooverlay')) scene.add(buildOverlays(reachable(active.x, active.y, 6), previewPath, active, target, { move: 0xffe2a8, moveEdge: 0x8fd0ff, path: 0xffe08a, target: 0xff4a3a, active: 0xffd66b, additive: true, fillOpacity: 0.04, edgeWidth: 0.04 }));

// lighting: cold moonlight from the doorway side, warm torches and the brazier
scene.add(new THREE.HemisphereLight(0x8a8478, 0x2a1a10, 0.9));
const moon = new THREE.DirectionalLight(0xd8d0c0, 0.75);
moon.position.set(14, 18, 6); moon.target.position.copy(gridCenter());
moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.02;
scene.add(moon, moon.target);

function torch(x: number, y: number, z: number, intensity = 9, color = 0xff8a3a) {
  const l = new THREE.PointLight(color, intensity, 11, 1.2);
  l.position.set(x, y, z); l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.002;
  scene.add(l);
  scene.add(flame(x, y - 0.05, z, 0.5));
  return l;
}
// wall sconces
for (const [x, z] of [[2.5, 0.35], [8.5, 0.35]] as [number, number][]) {
  const sconce = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.25, 8), M(P.metal, { metal: true }));
  sconce.position.set(x, 1.55, z); scene.add(sconce);
  torch(x, 1.8, z + 0.05, 22);
}
{ const sconce = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.25, 8), M(P.metal, { metal: true })); sconce.position.set(0.35, 1.55, 6); scene.add(sconce); torch(0.4, 1.8, 6, 22); }
torch(5, 1.15, 1, 38, 0xff7a2a); // brazier
scene.add(flame(5, 0.78, 1, 1.1));

// floating dust motes
{
  const r = rng(3); const n = 90; const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = r() * 12 - 0.5; pos[i * 3 + 1] = r() * 2.5; pos[i * 3 + 2] = r() * 10 - 0.5; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffc890, size: 0.022, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.82));
composer.addPass(new OutputPass());

// vignette
const vig = document.createElement('div');
vig.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0,0,0,.65) 100%)';
document.body.appendChild(vig);

composer.render();

const project = (x: number, y: number) => {
  const v = new THREE.Vector3(x, floorY(x, y) + 0.8, y).project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
};
const portraits = renderPortraits(scene, figures, (r) => { r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.4; }, 0x2a2018);
mountHud({ theme: 'minis', project, portraits, styleName: 'A · Painted Miniatures', styleBlurb: 'Real-time 3D with dynamic torchlight and shadows. Figures look like painted tabletop minis on their bases.' });
document.title = 'ready';
