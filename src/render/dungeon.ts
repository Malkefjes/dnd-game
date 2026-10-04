// Builds a floor from KayKit "Dungeon Remastered" pieces (CC0).
// KayKit uses 2-unit small tiles; at scale 0.5 one small tile is one 5-ft square.
//
// Static pieces are drawn with instancing: every copy of a piece shares one draw call
// (per sub-mesh), which is what lets a big floor render in a handful of calls. Floor
// instances keep a map back to their square for picking. Things that move (door leaves)
// or are procedural (graves, coffins, the brazier bowl) are ordinary meshes.
import * as THREE from 'three';
import type { AssetLibrary, Piece } from './assets';
import { DungeonMap, LEVEL, rng } from './models';

const S = 0.5;

export interface BuiltDungeon {
  group: THREE.Group;
  /** Floor meshes for picking: plain meshes carry userData.tile, instanced ones userData.tiles[instanceId]. */
  pickables: THREE.Object3D[];
  /** Wall torch flame positions and the direction they face. */
  torches: { pos: THREE.Vector3; dir: THREE.Vector3 }[];
  braziers: THREE.Vector3[];
  /** Door leaves that swing open, by square key "x,y". */
  doors: Map<string, THREE.Object3D>;
}

type Tag = { x: number; y: number } | undefined;

/** Collects placements, then turns them into one InstancedMesh per piece sub-mesh. */
class Batcher {
  private items = new Map<Piece, { m: THREE.Matrix4; tile: Tag }[]>();
  constructor(private lib: AssetLibrary) {}
  add(name: Piece, m: THREE.Matrix4, tile?: Tag) {
    let list = this.items.get(name);
    if (!list) this.items.set(name, (list = []));
    list.push({ m, tile });
  }
  build(group: THREE.Group, pickables: THREE.Object3D[]) {
    const local = new THREE.Matrix4();
    for (const [name, list] of this.items) {
      const src = this.lib.pieceSource(name);
      src.updateMatrixWorld(true);
      const rootInv = src.matrixWorld.clone().invert();
      src.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        local.multiplyMatrices(rootInv, mesh.matrixWorld);
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        list.forEach((it, i) => inst.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(it.m, local)));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.castShadow = true; inst.receiveShadow = true;
        if (list.some((it) => it.tile)) { inst.userData.tiles = list.map((it) => it.tile); pickables.push(inst); }
        group.add(inst);
      });
    }
  }
}

const mat = (x: number, y: number, z: number, rotY = 0, scale: number | [number, number, number] = S) => {
  const s = Array.isArray(scale) ? new THREE.Vector3(...scale) : new THREE.Vector3(scale, scale, scale);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), s);
};

export function buildKayKitDungeon(map: DungeonMap, lib: AssetLibrary): BuiltDungeon {
  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const torches: BuiltDungeon['torches'] = [];
  const braziers: THREE.Vector3[] = [];
  const doors = new Map<string, THREE.Object3D>();
  const batch = new Batcher(lib);
  const r = rng(21);
  const place = (name: Piece, x: number, y: number, z: number, rotY = 0, scale: number | [number, number, number] = S, tile?: Tag) =>
    batch.add(name, mat(x, y, z, rotY, scale), tile);
  const stone = new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.92 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.95 });
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rotY = 0) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = rotY; o.castShadow = true; o.receiveShadow = true; group.add(o); return o;
  };
  const floorPiece = (): Piece => {
    const v = r();
    return v < 0.08 ? 'floor_tile_small_broken_A' : v < 0.14 ? 'floor_tile_small_broken_B' : v < 0.18 ? 'floor_tile_small_weeds_A' : v < 0.21 ? 'floor_tile_small_weeds_B' : 'floor_tile_small';
  };
  const dirtPiece = (): Piece => { const v = r(); return v < 0.34 ? 'floor_dirt_small_A' : v < 0.67 ? 'floor_dirt_small_B' : 'floor_dirt_small_C'; };
  const quarter = () => Math.floor(r() * 4) * (Math.PI / 2);
  const floorAt = (t: { x: number; y: number }, piece: Piece = floorPiece()) => place(piece, t.x, 0, t.y, quarter(), S, t);
  const isOpen = (x: number, y: number) => { const n = map.tileAt(x, y); return !!n && n.kind !== 'wall' && n.kind !== 'void'; };
  /**
   * Cutaway: the camera looks from the south-east, so a wall that has open floor on its far side
   * (north of an east-west wall, west of a north-south one) stands in front of that room. It's drawn
   * as a low rim. So are the map's near edges. Walls at the back of rooms stay full height.
   */
  const isCut = (t: { x: number; y: number }) => {
    const { x, y } = t;
    const alongX = !map.isWall(x, y - 1) || !map.isWall(x, y + 1) ? (map.isWall(x - 1, y) || map.isWall(x + 1, y)) : false;
    if (alongX) return isOpen(x, y - 1) || !map.tileAt(x, y + 1) || map.tileAt(x, y + 1)!.kind === 'void';
    return isOpen(x - 1, y) || !map.tileAt(x + 1, y) || map.tileAt(x + 1, y)!.kind === 'void';
  };

  for (const t of map.tiles) {
    const { x, y } = t;
    if (t.kind === 'void') continue;
    // solid rock: a wall square with no open square around it isn't built at all (it reads as darkness)
    if (t.kind === 'wall' && ![-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => { const n = map.tileAt(x + dx, y + dy); return n && n.kind !== 'wall' && n.kind !== 'void'; }))) continue;
    if (t.kind === 'wall' || t.kind === 'door' || t.kind === 'gate') {
      // walls run along x when the squares above/below are open, else along z
      const alongX = !map.isWall(x, y - 1) || !map.isWall(x, y + 1) ? (map.isWall(x - 1, y) || map.isWall(x + 1, y)) : false;
      const rot = alongX ? 0 : Math.PI / 2;
      if (t.kind === 'door') {
        floorAt(t);
        place('wall_arched', x, 0, y, rot, [S * 0.5, S, S]);
        const dark = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.4), new THREE.MeshBasicMaterial({ color: 0x030202 }));
        dark.position.set(x, 0.7, y - 0.3); group.add(dark);
        continue;
      }
      if (t.kind === 'gate') {
        // a doorway with a real door leaf on a hinge, so it can swing open
        floorAt(t);
        const frame = lib.piece('wall_doorway');
        frame.scale.set(S * 0.5, S, S); frame.position.set(x, 0, y); frame.rotation.y = rot;
        const leaf = frame.getObjectByName('wall_doorway_door');
        group.add(frame);
        if (leaf) {
          // re-parent the leaf onto a hinge at its edge so rotating the hinge swings it
          const hinge = new THREE.Group();
          frame.add(hinge);
          hinge.position.copy(leaf.position);
          frame.remove(leaf); hinge.add(leaf); leaf.position.set(0, 0, 0);
          doors.set(`${x},${y}`, hinge);
        }
        frame.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        continue;
      }
      const wallScale: [number, number, number] = isCut(t) ? [S, S * 0.18, S] : [S, S, S];
      // wall_half spans 0..2 along its local x
      if (alongX) place('wall_half', x - 0.5, 0, y, 0, wallScale);
      else place('wall_half', x, 0, y - 0.5, -Math.PI / 2, wallScale);
      // a matching return segment at corners so they close up
      if (alongX && map.isWall(x, y + 1) && !map.isWall(x - 1, y)) place('wall_half', x, 0, y - 0.5, -Math.PI / 2, wallScale);
      continue;
    }

    const top = t.h * LEVEL;
    if (t.kind === 'platform') {
      place('floor_foundation_allsides', x, 0, y, 0, [S * 0.92, LEVEL / 2, S * 0.92]);
      place(floorPiece(), x, top, y, quarter(), S, t);
      continue;
    }
    if (t.kind === 'stairs') {
      // a half-height step up to the platform
      place('floor_foundation_allsides', x, 0, y, 0, [S * 0.92, top / 2, S * 0.92]);
      place(floorPiece(), x, top, y, quarter(), S, t);
      continue;
    }
    if (t.kind === 'rubble') { place('floor_tile_large_rocks', x, 0, y, quarter(), S * 0.5, t); continue; }
    if (t.kind === 'dirt' || t.kind === 'grave') floorAt(t, dirtPiece());
    else if (t.kind === 'water') {
      floorAt(t);
      const w = mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.8 }), x, 0.07, y);
      w.rotation.x = -Math.PI / 2;
    } else floorAt(t);

    if (t.kind === 'pillar') place('pillar', x, 0, y, 0, [S * 0.9, S, S * 0.9]);
    if (t.kind === 'barrel') {
      const v = r();
      place(v < 0.45 ? 'barrel_large' : v < 0.75 ? 'barrel_small_stack' : 'keg', x + (r() - 0.5) * 0.1, 0, y + (r() - 0.5) * 0.1, r() * Math.PI * 2, S * 0.9);
    }
    if (t.kind === 'grave') {
      // a headstone, a little crooked, with a low mound in front
      const stoneMesh = mesh(new THREE.BoxGeometry(0.5, 0.55, 0.12), r() < 0.5 ? stone : darkStone, x + (r() - 0.5) * 0.1, 0.27, y - 0.25, (r() - 0.5) * 0.25);
      stoneMesh.rotation.z = (r() - 0.5) * 0.15;
      const cap = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 10, 1, false, 0, Math.PI), stoneMesh.material as THREE.Material, 0, 0.27, 0);
      cap.rotation.x = Math.PI / 2; cap.rotation.z = Math.PI / 2; stoneMesh.add(cap); cap.position.set(0, 0.27, 0);
      mesh(new THREE.BoxGeometry(0.5, 0.06, 0.55), new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 1 }), x, 0.04, y + 0.12);
    }
    if (t.kind === 'coffin') {
      // a stone sarcophagus with a carved lid
      const along = r() < 0.5 ? 0 : Math.PI / 2;
      mesh(new THREE.BoxGeometry(0.62, 0.45, 0.95), stone, x, 0.225, y, along);
      mesh(new THREE.BoxGeometry(0.7, 0.1, 1.02), darkStone, x, 0.5, y, along);
    }
    if (t.kind === 'altar') {
      mesh(new THREE.BoxGeometry(0.95, 0.55, 0.6), stone, x, 0.275, y);
      mesh(new THREE.BoxGeometry(1.05, 0.08, 0.7), darkStone, x, 0.59, y);
      place('candle_triple', x - 0.3, 0.63, y, 0, S * 0.6);
      place('candle_triple', x + 0.3, 0.63, y, 0, S * 0.6);
    }
    if (t.kind === 'down' || t.kind === 'up') {
      // stairs to another floor: a dark stairwell going down, or steps going up
      if (t.kind === 'down') {
        const well = mesh(new THREE.BoxGeometry(0.86, 0.02, 0.86), new THREE.MeshBasicMaterial({ color: 0x050304 }), x, 0.06, y);
        well.receiveShadow = false;
        for (let i = 0; i < 3; i++) mesh(new THREE.BoxGeometry(0.8, 0.04, 0.2), darkStone, x, 0.05 - i * 0.001, y - 0.3 + i * 0.25);
      } else place('stairs_narrow', x, 0, y, 0, [S * 0.45, S * 0.35, S * 0.45]);
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
    if (t.kind !== 'wall' || isCut(t)) continue;
    const open = ([[0, 1], [1, 0]] as const).find(([dx, dy]) => { const n = map.tileAt(t.x + dx, t.y + dy); return n && n.kind !== 'wall' && n.kind !== 'door' && n.kind !== 'gate' && n.kind !== 'void'; });
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
  batch.build(group, pickables);
  return { group, pickables, torches, braziers, doors };
}
