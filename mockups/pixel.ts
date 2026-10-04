// Style C: "Pixel Art" — the 3D scene rendered at 1/4 resolution with a tight palette,
// hard outlines and nearest-neighbour upscaling (the "3D-to-pixel" technique).
import * as THREE from 'three';
import { buildDungeon, buildFigure, buildOverlays, gridCenter, floorY, type MatFactory, type Palette } from './shared/three-dungeon';
import { units, activeId, targetId, previewPath, reachable } from './shared/scene';
import { mountHud } from './shared/hud';
import { setupIsoCamera, renderPortraits } from './shared/three-common';

const PIXEL = 4;

const P: Palette = {
  floor: [0x5b5f78, 0x52566e, 0x63677f], wall: [0x585078, 0x625a84, 0x52496e], trim: 0x6e6a8f,
  wood: 0x8a5532, metal: 0xb7c0d8, gold: 0xf2c14e, skin: 0xf0b48c, beard: 0xd8642a, tabard: 0x3366cc,
  shield: 0x3366cc, cloak: 0x3c4a5e, leather: 0x7a4a2a, goblin: 0x7cc242, goblinDark: 0x4a3a32, bossCape: 0xc8303c, baseTop: 0x1e1b2c,
};

const gradient = (() => {
  const data = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
})();
const cache = new Map<string, THREE.Material>();
const M: MatFactory = (color, o = {}) => {
  const key = `${color}|${o.emissive}|${o.transparent}`;
  let m = cache.get(key);
  if (!m) {
    m = o.emissive
      ? new THREE.MeshBasicMaterial({ color: new THREE.Color(o.emissive).lerp(new THREE.Color(0xffee88), 0.4) })
      : new THREE.MeshToonMaterial({ color, gradientMap: gradient, transparent: !!o.transparent, opacity: o.transparent ? 0.55 : 1 });
    cache.set(key, m);
  }
  return m;
};
const inkMat = new THREE.MeshBasicMaterial({ color: 0x0b0a12, side: THREE.BackSide });
const outline = (m: THREE.Mesh) => { const hull = new THREE.Mesh(m.geometry, inkMat); hull.scale.setScalar(1.09); m.add(hull); };

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(Math.ceil(innerWidth / PIXEL), Math.ceil(innerHeight / PIXEL), false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.className = 'stage';
renderer.domElement.style.imageRendering = 'pixelated';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14121e);
const camera = setupIsoCamera(gridCenter().add(new THREE.Vector3(0.9, 0, 0.6)), 6.2);

scene.add(buildDungeon(M, P, outline));
const figures = units.map((u) => buildFigure(u, M, P, outline));
figures.forEach((f) => scene.add(f));
const active = units.find((u) => u.id === activeId)!;
const target = units.find((u) => u.id === targetId)!;
scene.add(buildOverlays(reachable(active.x, active.y, 6), previewPath, active, target, { move: 0x5fc8ff, moveEdge: 0x9be6ff, path: 0xfff3a0, target: 0xff4a4a, active: 0xffd84a, fillOpacity: 0.16, edgeWidth: 0.07 }));

scene.add(new THREE.HemisphereLight(0x9aa0d8, 0x2a2040, 1.3));
const key = new THREE.DirectionalLight(0xffe0b0, 1.6);
key.position.set(-6, 14, 12); key.target.position.copy(gridCenter());
key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
scene.add(key, key.target);
for (const [x, y, z, i] of [[5, 1.2, 1, 16], [2.5, 1.8, 0.4, 10], [8.5, 1.8, 0.4, 10]]) { const l = new THREE.PointLight(0xff9a40, i, 6, 1.4); l.position.set(x, y, z); scene.add(l); }
// chunky pixel flame on the brazier
const fl = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 5), new THREE.MeshBasicMaterial({ color: 0xffb030 })); fl.position.set(5, 0.98, 1); scene.add(fl);
const fl2 = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), new THREE.MeshBasicMaterial({ color: 0xfff0a0 })); fl2.position.set(5, 0.92, 1); scene.add(fl2);

renderer.render(scene, camera);

const project = (x: number, y: number) => {
  const v = new THREE.Vector3(x, floorY(x, y) + 0.8, y).project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
};
const portraits = renderPortraits(scene, figures, (r) => { r.setPixelRatio(1); }, 0x2e2a45, 40);
mountHud({ theme: 'pixel', project, portraits, styleName: 'C · Pixel Art', styleBlurb: 'The same 3D scene rendered at quarter resolution with a tight palette and hard outlines. Crisp retro look, still fully animatable.' });
document.title = 'ready';
