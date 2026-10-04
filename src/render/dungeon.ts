// Builds the dungeon from KayKit "Dungeon Remastered" pieces (CC0).
// KayKit uses 2-unit small tiles; at scale 0.5 one small tile is one 5-ft square.
import * as THREE from 'three';
import type { AssetLibrary, Piece } from './assets';
import { DungeonMap, LEVEL, rng } from './models';

const S = 0.5;

export interface BuiltDungeon {
  group: THREE.Group;
  /** Floor meshes tagged with userData.tile, for picking. */
  pickables: THREE.Object3D[];
  /** Wall torch flame positions and the direction they face. */
  torches: { pos: THREE.Vector3; dir: THREE.Vector3 }[];
  braziers: THREE.Vector3[];
}

export function buildKayKitDungeon(map: DungeonMap, lib: AssetLibrary): BuiltDungeon {
  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const torches: BuiltDungeon['torches'] = [];
  const braziers: THREE.Vector3[] = [];
  const r = rng(21);
  const place = (name: Piece, x: number, y: number, z: number, rotY = 0, scale: number | [number, number, number] = S) => {
    const o = lib.piece(name);
    o.position.set(x, y, z); o.rotation.y = rotY;
    if (Array.isArray(scale)) o.scale.set(...scale); else o.scale.setScalar(scale);
    group.add(o);
    return o;
  };
  const tagFloor = (o: THREE.Object3D, t: { x: number; y: number }) => { o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.userData.tile = t; pickables.push(c); } }); };
  const floorPiece = (): Piece => {
    const v = r();
    return v < 0.08 ? 'floor_tile_small_broken_A' : v < 0.14 ? 'floor_tile_small_broken_B' : v < 0.18 ? 'floor_tile_small_weeds_A' : v < 0.21 ? 'floor_tile_small_weeds_B' : 'floor_tile_small';
  };
  const quarter = () => Math.floor(r() * 4) * (Math.PI / 2);

  for (const t of map.tiles) {
    const { x, y } = t;
    if (t.kind === 'wall' || t.kind === 'door') {
      // walls run along x when the squares above/below are open, else along z
      const alongX = !map.isWall(x, y - 1) || !map.isWall(x, y + 1) ? (map.isWall(x - 1, y) || map.isWall(x + 1, y)) : false;
      if (t.kind === 'door') {
        const f = place('floor_tile_small', x, 0, y); tagFloor(f, t);
        place('wall_arched', x, 0, y, alongX ? 0 : Math.PI / 2, [S * 0.5, S, S]);
        const dark = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.4), new THREE.MeshBasicMaterial({ color: 0x030202 }));
        dark.position.set(x, 0.7, y - 0.3); group.add(dark);
        continue;
      }
      // wall_half spans 0..2 along its local x
      if (alongX) place('wall_half', x - 0.5, 0, y);
      else place('wall_half', x, 0, y - 0.5, -Math.PI / 2);
      // a matching return segment at corners so they close up
      if (alongX && map.isWall(x, y + 1) && !map.isWall(x - 1, y)) place('wall_half', x, 0, y - 0.5, -Math.PI / 2);
      continue;
    }

    const top = t.h * LEVEL;
    if (t.kind === 'platform') {
      place('floor_foundation_allsides', x, 0, y, 0, [S * 0.92, LEVEL / 2, S * 0.92]);
      const f = place(floorPiece(), x, top, y, quarter()); tagFloor(f, t);
      continue;
    }
    if (t.kind === 'stairs') {
      // a half-height step up to the platform
      place('floor_foundation_allsides', x, 0, y, 0, [S * 0.92, top / 2, S * 0.92]);
      const f = place(floorPiece(), x, top, y, quarter()); tagFloor(f, t);
      continue;
    }
    if (t.kind === 'rubble') {
      const o = place('floor_tile_large_rocks', x, 0, y, quarter(), S * 0.5); tagFloor(o, t);
      continue;
    }

    const f = place(floorPiece(), x, 0, y, quarter()); tagFloor(f, t);
    if (t.kind === 'pillar') place('pillar', x, 0, y, 0, [S * 0.9, S, S * 0.9]);
    if (t.kind === 'barrel') {
      const v = r();
      place(v < 0.45 ? 'barrel_large' : v < 0.75 ? 'barrel_small_stack' : 'keg', x + (r() - 0.5) * 0.1, 0, y + (r() - 0.5) * 0.1, r() * Math.PI * 2, S * 0.9);
    }
    if (t.kind === 'brazier') {
      // a fire bowl on a squat stone column
      place('column', x, 0, y, 0, [S * 1.1, S * 0.55, S * 1.1]);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.18, 0.14, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x55504a, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }));
      bowl.position.set(x, 0.45, y); bowl.castShadow = true; group.add(bowl);
      const coals = new THREE.Mesh(new THREE.CircleGeometry(0.29, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a10).multiplyScalar(2) }));
      coals.rotation.x = -Math.PI / 2; coals.position.set(x, 0.5, y); group.add(coals);
      braziers.push(new THREE.Vector3(x, 0.52, y));
    }
  }

  // wall dressing: torches spaced out along walls that face open floor, banners in between, clutter at their feet
  const placed: THREE.Vector3[] = [];
  let bannerToggle = 0;
  for (const t of map.tiles) {
    if (t.kind !== 'wall') continue;
    const open = ([[0, 1], [1, 0]] as const).find(([dx, dy]) => { const n = map.tileAt(t.x + dx, t.y + dy); return n && n.kind !== 'wall' && n.kind !== 'door'; });
    if (!open) continue;
    const dir = new THREE.Vector3(open[0], 0, open[1]);
    const face = new THREE.Vector3(t.x, 0, t.y).addScaledVector(dir, 0.25);
    const rot = Math.atan2(dir.x, dir.z);
    if (!placed.some((q) => q.distanceTo(face) < 4)) {
      placed.push(face.clone());
      place('torch_mounted', face.x, 1.05, face.z, rot, S);
      torches.push({ pos: face.clone().setY(1.42).addScaledVector(dir, 0.22), dir });
      continue;
    }
    const near = Math.min(...placed.map((q) => q.distanceTo(face)));
    if (near >= 2 && near < 2.6 && bannerToggle++ % 2 === 0) place(bannerToggle % 4 === 1 ? 'banner_red' : 'banner_patternA_red', face.x, 0.15, face.z, rot, S * 0.8);
    // floor clutter against the wall (purely visual)
    const fx = t.x + open[0], fy = t.y + open[1];
    if (map.tileAt(fx, fy)?.kind === 'floor' && r() < 0.22) {
      const items: Piece[] = ['candle_triple', 'coin_stack_small', 'bottle_A_green', 'sword_shield_broken', 'box_small', 'trunk_small_A'];
      const it = items[Math.floor(r() * items.length)];
      const along = new THREE.Vector3(open[1], 0, open[0]).multiplyScalar((r() - 0.5) * 0.6);
      place(it, fx - open[0] * 0.33 + along.x, 0.02, fy - open[1] * 0.33 + along.z, r() * Math.PI * 2, it === 'box_small' ? S * 0.5 : S * 0.6);
    }
  }
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, pickables, torches, braziers };
}
