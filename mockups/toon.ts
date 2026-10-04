// Style B: "Toon Diorama" — cel-shaded 3D with ink outlines, bright storybook palette.
import * as THREE from 'three';
import { buildDungeon, buildFigure, buildOverlays, gridCenter, floorY, type MatFactory, type Palette } from './shared/three-dungeon';
import { units, activeId, targetId, previewPath, reachable } from './shared/scene';
import { mountHud } from './shared/hud';
import { setupIsoCamera, renderPortraits, flame } from './shared/three-common';

const P: Palette = {
  floor: [0xe8c995, 0xdcb984, 0xf0d3a2, 0xd6b07a], wall: [0x7d86c2, 0x6d76b4, 0x8a93cc], trim: 0xa9b1e6,
  wood: 0xb5713a, metal: 0xc4cbe0, gold: 0xffc93c, skin: 0xffc49b, beard: 0xe0682c, tabard: 0x3b6fe0,
  shield: 0x3b6fe0, cloak: 0x4a5a78, leather: 0x9a5d34, goblin: 0x8ccf4a, goblinDark: 0x5e4a3a, bossCape: 0xe0384a, baseTop: 0x3c4266,
};

const gradient = (() => {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
})();
const cache = new Map<string, THREE.Material>();
const M: MatFactory = (color, o = {}) => {
  const key = `${color}|${o.emissive}|${o.transparent}`;
  let m = cache.get(key);
  if (!m) {
    m = o.emissive
      ? new THREE.MeshBasicMaterial({ color: new THREE.Color(o.emissive).lerp(new THREE.Color(0xffffff), 0.3) })
      : new THREE.MeshToonMaterial({ color, gradientMap: gradient, transparent: !!o.transparent, opacity: o.transparent ? 0.5 : 1 });
    cache.set(key, m);
  }
  return m;
};
const inkMat = new THREE.MeshBasicMaterial({ color: 0x1a1730, side: THREE.BackSide });
const outline = (m: THREE.Mesh) => {
  const hull = new THREE.Mesh(m.geometry, inkMat);
  hull.scale.setScalar(1.07); hull.castShadow = false; hull.receiveShadow = false;
  m.add(hull);
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.domElement.className = 'stage';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// soft sky gradient behind the diorama
{
  const c = document.createElement('canvas'); c.width = 2; c.height = 256; const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256); grad.addColorStop(0, '#2b3266'); grad.addColorStop(1, '#6b5a9e');
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
const camera = setupIsoCamera(gridCenter().add(new THREE.Vector3(0.9, 0, 0.6)), 6.2);

const dungeon = buildDungeon(M, P, outline);
scene.add(dungeon);
// a chunky base under the diorama, like a display plinth
const plinth = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.9, 10.6), M(0x2c2f55)); plinth.position.set(5.5, -0.75, 4.5); outline(plinth); scene.add(plinth);

const figures = units.map((u) => buildFigure(u, M, P, outline));
figures.forEach((f) => scene.add(f));
const active = units.find((u) => u.id === activeId)!;
const target = units.find((u) => u.id === targetId)!;
scene.add(buildOverlays(reachable(active.x, active.y, 6), previewPath, active, target, { move: 0x7fe0ff, moveEdge: 0xffffff, path: 0xffffff, target: 0xff4060, active: 0xffd84a, fillOpacity: 0.22, edgeWidth: 0.05 }));

scene.add(new THREE.HemisphereLight(0xd8e0ff, 0x8a6a9a, 1.6));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.position.set(10, 16, 14); sun.target.position.copy(gridCenter());
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
scene.add(flame(5, 0.8, 1, 1.0));
const bl = new THREE.PointLight(0xffa040, 8, 4, 1.5); bl.position.set(5, 1.1, 1); scene.add(bl);

renderer.render(scene, camera);

const project = (x: number, y: number) => {
  const v = new THREE.Vector3(x, floorY(x, y) + 0.8, y).project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
};
const portraits = renderPortraits(scene, figures, () => {}, 0x6b78c8);
mountHud({ theme: 'toon', project, portraits, styleName: 'B · Toon Diorama', styleBlurb: 'Cel-shaded 3D with ink outlines and a bright storybook palette. Very readable, and it ages well.' });
document.title = 'ready';
