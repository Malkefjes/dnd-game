import * as THREE from 'three';

/** Orthographic camera at the classic 2:1-ish isometric angle, looking at `center`. */
export function setupIsoCamera(center: THREE.Vector3, halfHeight: number): THREE.OrthographicCamera {
  const aspect = innerWidth / innerHeight;
  const cam = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.1, 100);
  cam.position.copy(center).add(new THREE.Vector3(1, 1.05, 1).multiplyScalar(20));
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  return cam;
}

let flameTex: THREE.Texture | undefined;
function getFlameTexture(): THREE.Texture {
  if (flameTex) return flameTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 40, 2, 32, 36, 30);
  grad.addColorStop(0, 'rgba(255,250,220,1)'); grad.addColorStop(0.25, 'rgba(255,190,80,.9)');
  grad.addColorStop(0.6, 'rgba(255,90,20,.35)'); grad.addColorStop(1, 'rgba(255,40,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  flameTex = new THREE.CanvasTexture(c); flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

/** A cheap layered-sprite flame. */
export function flame(x: number, y: number, z: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: getFlameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const layers: [number, number, number][] = [[0, 0.0, 0.55], [0.03, 0.12, 0.4], [-0.02, 0.22, 0.28], [0.01, 0.32, 0.18]];
  for (const [dx, dy, s] of layers) {
    const sp = new THREE.Sprite(mat); sp.position.set(dx * scale, dy * scale, 0); sp.scale.set(s * scale, s * scale * 1.4, 1); g.add(sp);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getFlameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.25, color: 0xff7a30 }));
  glow.scale.set(1.6 * scale, 1.6 * scale, 1); g.add(glow);
  g.position.set(x, y, z);
  return g;
}

/** Render a close-up of each figure into a data URL to use as HUD portraits. */
export function renderPortraits(
  scene: THREE.Scene, figures: THREE.Group[], configure: (r: THREE.WebGLRenderer) => void, bg: number, size = 160,
): Record<string, string> {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(size, size); r.setPixelRatio(1); r.shadowMap.enabled = true; configure(r);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
  const prevBg = scene.background; const prevFog = scene.fog;
  scene.background = new THREE.Color(bg); scene.fog = null;
  const out: Record<string, string> = {};
  const hidden: THREE.Object3D[] = [];
  scene.children.forEach((c) => { if (!(c instanceof THREE.Light) && c.visible) { hidden.push(c); c.visible = false; } });
  for (const f of figures) {
    f.visible = true;
    const u = f.userData.unit as { id: string; facing: number };
    const head = new THREE.Vector3(f.position.x, f.userData.headY as number, f.position.z);
    const dir = new THREE.Vector3(Math.cos(u.facing), 0, Math.sin(u.facing));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    cam.position.copy(head).addScaledVector(dir, 1.05).addScaledVector(side, 0.4).add(new THREE.Vector3(0, 0.08, 0));
    cam.lookAt(head.clone().add(new THREE.Vector3(0, -0.06, 0)));
    r.render(scene, cam);
    out[u.id] = r.domElement.toDataURL();
    f.visible = false;
  }
  hidden.forEach((c) => (c.visible = true));
  scene.background = prevBg; scene.fog = prevFog;
  r.dispose();
  return out;
}
