// Procedural 3D dungeon + miniature figures for the 3D style mockups.
// Everything is built from primitives in code: no external art assets.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tiles, units, tileAt, W, H, type Unit, type Archetype } from './scene';

export const LEVEL = 0.6; // world units per grid height unit

export interface Palette {
  floor: number[]; wall: number[]; trim: number; wood: number; metal: number; gold: number;
  skin: number; beard: number; tabard: number; shield: number; cloak: number; leather: number;
  goblin: number; goblinDark: number; bossCape: number; baseTop: number;
}

export type MatFactory = (color: number, opts?: { metal?: boolean; emissive?: number; rough?: number; transparent?: boolean }) => THREE.Material;

/** Deterministic PRNG so every screenshot is identical. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function floorY(x: number, y: number): number {
  return (tileAt(x, y)?.h ?? 0) * LEVEL;
}

interface Ctx { M: MatFactory; P: Palette; r: () => number; outline?: (m: THREE.Mesh) => void; }

function mesh(ctx: Ctx, geo: THREE.BufferGeometry, mat: THREE.Material, outline = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  if (outline && ctx.outline) ctx.outline(m);
  return m;
}

function pick(r: () => number, arr: number[]): number { return arr[Math.floor(r() * arr.length)]; }

function jitterColor(c: number, r: () => number, amt = 0.08): number {
  const col = new THREE.Color(c); const hsl = { h: 0, s: 0, l: 0 }; col.getHSL(hsl);
  col.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + (r() - 0.5) * amt))); return col.getHex();
}

export function buildDungeon(M: MatFactory, P: Palette, outline?: (m: THREE.Mesh) => void): THREE.Group {
  const ctx: Ctx = { M, P, r: rng(7), outline };
  const g = new THREE.Group();
  const slab = new RoundedBoxGeometry(0.96, 0.3, 0.96, 2, 0.05);
  const brick = new RoundedBoxGeometry(0.47, 0.27, 0.32, 2, 0.04);

  for (const t of tiles) {
    const top = t.h * LEVEL;
    if (t.kind === 'wall' || t.kind === 'door') {
      // a stack of staggered bricks; doors leave a gap with a lintel
      const rows = 8;
      for (let row = 0; row < rows; row++) {
        if (t.kind === 'door' && row < 6) continue;
        const along = t.y === 0 ? 'x' : 'z';
        // even rows: one long brick; odd rows: two half bricks (staggered look)
        const pieces = row % 2 ? [-0.25, 0.25] : [0];
        for (const pos of pieces) {
          const b = mesh(ctx, brick, M(jitterColor(pick(ctx.r, P.wall), ctx.r, 0.1)));
          if (pieces.length === 1) b.scale.x = 2.04;
          const px = along === 'x' ? t.x + pos : t.x;
          const pz = along === 'z' ? t.y + pos : t.y;
          b.position.set(px, 0.14 + row * 0.28, pz);
          if (along === 'z') b.rotation.y = Math.PI / 2;
          b.rotation.z = (ctx.r() - 0.5) * 0.03;
          g.add(b);
        }
      }
      if (t.kind === 'door') {
        const door = mesh(ctx, new THREE.BoxGeometry(0.8, 1.66, 0.08), M(P.wood, { rough: 0.9 }));
        door.position.set(t.x + 0.32, 0.83, t.y - 0.05); door.rotation.y = -0.9; g.add(door);
        for (const yy of [0.35, 1.3]) {
          const band = mesh(ctx, new THREE.BoxGeometry(0.82, 0.06, 0.1), M(P.metal, { metal: true }), false);
          band.position.copy(door.position).setY(yy); band.rotation.y = door.rotation.y; g.add(band);
        }
        const dark = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 1.66), new THREE.MeshBasicMaterial({ color: 0x050302 }));
        dark.position.set(t.x, 0.83, t.y - 0.2); g.add(dark);
      }
      continue;
    }

    // floor slab for everything walkable or standing on the floor
    const s = mesh(ctx, slab, M(jitterColor(pick(ctx.r, P.floor), ctx.r, 0.12), { rough: 0.95 }), false);
    s.position.set(t.x + (ctx.r() - 0.5) * 0.02, -0.15 + (ctx.r() - 0.5) * 0.025, t.y + (ctx.r() - 0.5) * 0.02);
    s.rotation.y = (ctx.r() - 0.5) * 0.04;
    g.add(s);

    if (t.kind === 'platform' || t.kind === 'stairs') {
      const steps = t.kind === 'stairs' ? 2 : 0;
      if (steps) {
        for (let i = 0; i < steps; i++) {
          const st = mesh(ctx, new RoundedBoxGeometry(0.96, LEVEL / 2, 0.96 - i * 0.48, 2, 0.04), M(jitterColor(P.floor[0], ctx.r, 0.1)));
          st.position.set(t.x, LEVEL / 4 + i * (LEVEL / 2), t.y + i * 0.24);
          g.add(st);
        }
      } else {
        const block = mesh(ctx, new RoundedBoxGeometry(0.98, LEVEL, 0.98, 2, 0.05), M(jitterColor(pick(ctx.r, P.wall), ctx.r, 0.1)));
        block.position.set(t.x, LEVEL / 2 - 0.001, t.y); g.add(block);
        const cap = mesh(ctx, slab, M(jitterColor(pick(ctx.r, P.floor), ctx.r, 0.12)), false);
        cap.scale.y = 0.4; cap.position.set(t.x, top - 0.05, t.y); g.add(cap);
      }
    }
    if (t.kind === 'pillar') {
      const col = new THREE.Group();
      const base = mesh(ctx, new RoundedBoxGeometry(0.8, 0.25, 0.8, 2, 0.05), M(P.trim)); base.position.y = 0.12; col.add(base);
      const shaft = mesh(ctx, new THREE.CylinderGeometry(0.28, 0.32, 1.9, 16), M(jitterColor(P.wall[1], ctx.r))); shaft.position.y = 1.2; col.add(shaft);
      for (const yy of [0.6, 1.8]) { const ring = mesh(ctx, new THREE.TorusGeometry(0.31, 0.04, 8, 20), M(P.trim)); ring.rotation.x = Math.PI / 2; ring.position.y = yy; col.add(ring); }
      const capital = mesh(ctx, new RoundedBoxGeometry(0.75, 0.22, 0.75, 2, 0.05), M(P.trim)); capital.position.y = 2.25; col.add(capital);
      col.position.set(t.x, 0, t.y); g.add(col);
    }
    if (t.kind === 'rubble') {
      for (let i = 0; i < 7; i++) {
        const rock = mesh(ctx, new THREE.DodecahedronGeometry(0.07 + ctx.r() * 0.12, 0), M(jitterColor(pick(ctx.r, P.wall), ctx.r, 0.15)));
        rock.position.set(t.x + (ctx.r() - 0.5) * 0.8, 0.04, t.y + (ctx.r() - 0.5) * 0.8);
        rock.rotation.set(ctx.r() * 3, ctx.r() * 3, ctx.r() * 3); rock.scale.y = 0.6; g.add(rock);
      }
    }
    if (t.kind === 'barrel') {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 10; i++) { const v = i / 10; pts.push(new THREE.Vector2(0.26 + Math.sin(v * Math.PI) * 0.05, v * 0.72)); }
      const barrel = new THREE.Group();
      const body = mesh(ctx, new THREE.LatheGeometry(pts, 18), M(jitterColor(P.wood, ctx.r, 0.1), { rough: 0.85 })); barrel.add(body);
      const lid = mesh(ctx, new THREE.CircleGeometry(0.26, 18), M(jitterColor(P.wood, ctx.r, 0.15)), false); lid.rotation.x = -Math.PI / 2; lid.position.y = 0.72; barrel.add(lid);
      for (const yy of [0.12, 0.6]) { const hoop = mesh(ctx, new THREE.TorusGeometry(0.29, 0.018, 6, 24), M(P.metal, { metal: true }), false); hoop.rotation.x = Math.PI / 2; hoop.position.y = yy; barrel.add(hoop); }
      barrel.position.set(t.x + (ctx.r() - 0.5) * 0.15, 0, t.y + (ctx.r() - 0.5) * 0.15);
      if (t.x === 1 && t.y === 8) { barrel.rotation.z = Math.PI / 2; barrel.position.y = 0.3; barrel.position.x += 0.35; }
      g.add(barrel);
    }
    if (t.kind === 'brazier') {
      const br = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const leg = mesh(ctx, new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), M(P.metal, { metal: true }));
        const a = (i / 3) * Math.PI * 2; leg.position.set(Math.cos(a) * 0.17, 0.3, Math.sin(a) * 0.17); leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); br.add(leg);
      }
      const bowl = mesh(ctx, new THREE.CylinderGeometry(0.3, 0.16, 0.18, 16, 1, true), M(P.metal, { metal: true })); bowl.position.y = 0.66; br.add(bowl);
      const coals = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), M(0x331000, { emissive: 0xff5a10 })); coals.rotation.x = -Math.PI / 2; coals.position.y = 0.72; br.add(coals);
      br.position.set(t.x, 0, t.y); br.name = 'brazier'; g.add(br);
    }
  }
  return g;
}

// ---------------------------------------------------------------- figures

function limb(ctx: Ctx, r: number, len: number, mat: THREE.Material): THREE.Mesh {
  return mesh(ctx, new THREE.CapsuleGeometry(r, len, 4, 8), mat);
}

function curvedBlade(ctx: Ctx, mat: THREE.Material, len = 0.3): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.quadraticCurveTo(0.07, len * 0.6, 0.0, len); s.quadraticCurveTo(0.03, len * 0.55, -0.025, 0); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
  return mesh(ctx, geo, mat);
}

export function buildFigure(u: Unit, M: MatFactory, P: Palette, outline?: (m: THREE.Mesh) => void): THREE.Group {
  const ctx: Ctx = { M, P, r: rng(u.id.length * 31 + u.x * 7), outline };
  const g = new THREE.Group();
  const fig = new THREE.Group();
  const transparent = !!u.hidden;
  const m = (c: number, o: Parameters<MatFactory>[1] = {}) => M(c, { ...o, transparent });

  // base: bevelled disc + coloured rim marking the side
  const base = mesh(ctx, new THREE.CylinderGeometry(0.36, 0.39, 0.06, 32), m(P.baseTop, { rough: 0.6 }), false);
  base.position.y = 0.03; g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.385, 0.018, 8, 40), M(u.side === 'party' ? 0x3d8bff : 0xd8392e, { emissive: u.side === 'party' ? 0x1d4fb0 : 0x8a1810 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.045; g.add(rim);
  fig.position.y = 0.06;

  const build: Record<Archetype, () => void> = {
    fighter: () => {
      const steel = m(P.metal, { metal: true }); const tabard = m(P.tabard); const skin = m(P.skin); const leather = m(P.leather);
      for (const z of [-0.08, 0.08]) { const leg = limb(ctx, 0.06, 0.12, leather); leg.position.set(0, 0.12, z); fig.add(leg); const boot = mesh(ctx, new RoundedBoxGeometry(0.15, 0.08, 0.1, 1, 0.03), m(P.wood)); boot.position.set(0.03, 0.04, z); fig.add(boot); }
      const torso = mesh(ctx, new THREE.CylinderGeometry(0.15, 0.19, 0.28, 14), steel); torso.position.y = 0.34; fig.add(torso);
      const tab = mesh(ctx, new THREE.BoxGeometry(0.03, 0.3, 0.16), tabard); tab.position.set(0.17, 0.3, 0); tab.rotation.z = 0.08; fig.add(tab);
      const belt = mesh(ctx, new THREE.TorusGeometry(0.175, 0.025, 6, 20), leather, false); belt.rotation.x = Math.PI / 2; belt.position.y = 0.26; fig.add(belt);
      for (const z of [-0.17, 0.17]) { const pauldron = mesh(ctx, new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel); pauldron.position.set(0, 0.46, z); fig.add(pauldron); }
      const head = mesh(ctx, new THREE.SphereGeometry(0.1, 16, 12), skin); head.position.set(0.01, 0.57, 0); fig.add(head);
      const beard = mesh(ctx, new THREE.ConeGeometry(0.1, 0.24, 10), m(P.beard)); beard.rotation.z = Math.PI; beard.position.set(0.07, 0.45, 0); fig.add(beard);
      const helm = mesh(ctx, new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel); helm.position.set(0.0, 0.615, 0); helm.scale.set(1, 0.85, 1); fig.add(helm);
      for (const z of [-0.035, 0.035]) { const eye = mesh(ctx, new THREE.SphereGeometry(0.014, 6, 6), m(0x1a1210), false); eye.position.set(0.098, 0.585, z); fig.add(eye); }
      const nasal = mesh(ctx, new THREE.BoxGeometry(0.02, 0.08, 0.025), steel, false); nasal.position.set(0.105, 0.59, 0); fig.add(nasal);
      // shield arm (left = -z)
      const shield = mesh(ctx, new THREE.CylinderGeometry(0.17, 0.17, 0.03, 24), m(P.shield)); shield.rotation.x = Math.PI / 2; shield.rotation.z = 0.3; shield.position.set(0.1, 0.36, -0.23); fig.add(shield);
      const srim = mesh(ctx, new THREE.TorusGeometry(0.17, 0.014, 6, 28), m(P.gold, { metal: true }), false); srim.rotation.copy(shield.rotation); srim.rotation.x = 0; srim.position.copy(shield.position); srim.lookAt(shield.position.clone().add(new THREE.Vector3(0.3, 0, -1))); fig.add(srim);
      const boss = mesh(ctx, new THREE.SphereGeometry(0.04, 10, 8), m(P.gold, { metal: true }), false); boss.position.set(0.12, 0.36, -0.255); fig.add(boss);
      // sword arm (right = +z), blade raised
      const arm = limb(ctx, 0.045, 0.14, steel); arm.position.set(0.06, 0.36, 0.2); arm.rotation.x = -0.4; arm.rotation.z = -0.9; fig.add(arm);
      const sword = new THREE.Group();
      const blade = mesh(ctx, new THREE.BoxGeometry(0.035, 0.42, 0.012), m(0xd8dde3, { metal: true })); blade.position.y = 0.25; sword.add(blade);
      const guard = mesh(ctx, new THREE.BoxGeometry(0.14, 0.025, 0.03), m(P.gold, { metal: true }), false); guard.position.y = 0.04; sword.add(guard);
      const grip = mesh(ctx, new THREE.CylinderGeometry(0.015, 0.015, 0.08, 6), leather, false); sword.add(grip);
      sword.position.set(0.16, 0.32, 0.24); sword.rotation.z = -0.5; sword.rotation.x = 0.15; fig.add(sword);
      fig.scale.setScalar(1.05);
    },
    rogue: () => {
      const cloak = m(P.cloak); const skin = m(P.skin); const leather = m(P.leather);
      for (const z of [-0.06, 0.06]) { const leg = limb(ctx, 0.045, 0.1, leather); leg.position.set(0, 0.09, z); fig.add(leg); }
      const body = mesh(ctx, new THREE.ConeGeometry(0.2, 0.4, 14, 1, true), cloak); body.position.y = 0.3; fig.add(body);
      const bodyIn = mesh(ctx, new THREE.CylinderGeometry(0.1, 0.13, 0.25, 12), leather, false); bodyIn.position.y = 0.3; fig.add(bodyIn);
      const head = mesh(ctx, new THREE.SphereGeometry(0.085, 14, 10), skin); head.position.set(0.02, 0.5, 0); fig.add(head);
      const hood = mesh(ctx, new THREE.SphereGeometry(0.11, 14, 10, Math.PI * 0.75, Math.PI * 1.5), cloak); hood.position.set(0.0, 0.52, 0); hood.rotation.y = 0; fig.add(hood);
      const tip = mesh(ctx, new THREE.ConeGeometry(0.06, 0.14, 8), cloak, false); tip.position.set(-0.08, 0.6, 0); tip.rotation.z = 1.1; fig.add(tip);
      const scarf = mesh(ctx, new THREE.TorusGeometry(0.08, 0.03, 6, 14), m(0x7a2a2a), false); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.43; fig.add(scarf);
      for (const z of [-0.17, 0.17]) {
        const d = new THREE.Group();
        const blade = mesh(ctx, new THREE.ConeGeometry(0.02, 0.2, 4), m(0xd8dde3, { metal: true })); blade.position.y = 0.12; d.add(blade);
        const guard = mesh(ctx, new THREE.BoxGeometry(0.07, 0.02, 0.02), m(P.gold, { metal: true }), false); d.add(guard);
        d.position.set(0.1, 0.25, z); d.rotation.z = -1.1; d.rotation.x = z > 0 ? 0.3 : -0.3; fig.add(d);
      }
      fig.scale.setScalar(0.92);
    },
    goblin: () => goblin(ctx, fig, m, 'melee'),
    goblinArcher: () => goblin(ctx, fig, m, 'bow'),
    goblinBoss: () => { goblin(ctx, fig, m, 'boss'); fig.scale.setScalar(1.18); },
  };
  build[u.archetype]();
  fig.scale.multiplyScalar(1.55);
  g.add(fig);
  g.rotation.y = -u.facing;
  g.position.set(u.x, floorY(u.x, u.y), u.y);
  const headLocal: Record<Archetype, number> = { fighter: 0.57 * 1.05, rogue: 0.5 * 0.92, goblin: 0.43, goblinArcher: 0.43, goblinBoss: 0.43 * 1.18 };
  g.userData.unit = u;
  g.userData.headY = g.position.y + 0.06 + headLocal[u.archetype] * 1.55;
  return g;
}

function goblin(ctx: Ctx, fig: THREE.Group, m: (c: number, o?: Parameters<MatFactory>[1]) => THREE.Material, kind: 'melee' | 'bow' | 'boss') {
  const P = ctx.P; const skin = m(P.goblin); const dark = m(P.goblinDark); const leather = m(kind === 'boss' ? 0x3b2a1e : P.leather);
  for (const z of [-0.05, 0.05]) { const leg = limb(ctx, 0.035, 0.1, dark); leg.position.set(0, 0.09, z); fig.add(leg); const foot = mesh(ctx, new THREE.SphereGeometry(0.04, 8, 6), skin, false); foot.scale.set(1.6, 0.6, 1); foot.position.set(0.03, 0.02, z); fig.add(foot); }
  const torso = mesh(ctx, new THREE.CylinderGeometry(0.1, 0.12, 0.2, 10), leather); torso.position.y = 0.25; torso.rotation.z = -0.15; fig.add(torso);
  const head = mesh(ctx, new THREE.SphereGeometry(0.115, 14, 10), skin); head.scale.set(1.05, 0.9, 1); head.position.set(0.05, 0.43, 0); fig.add(head);
  for (const z of [-1, 1]) {
    const ear = mesh(ctx, new THREE.ConeGeometry(0.035, 0.18, 6), skin); ear.position.set(0.0, 0.46, z * 0.13); ear.rotation.x = z * 1.25; ear.rotation.z = 0.35; fig.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), ctx.M(0xffe066, { emissive: 0xffb000 })); eye.position.set(0.15, 0.45, z * 0.045); fig.add(eye);
  }
  const nose = mesh(ctx, new THREE.ConeGeometry(0.025, 0.09, 6), skin, false); nose.rotation.z = -Math.PI / 2; nose.position.set(0.18, 0.42, 0); fig.add(nose);
  if (kind === 'boss') {
    const helm = mesh(ctx, new THREE.ConeGeometry(0.1, 0.16, 8), m(P.metal, { metal: true })); helm.position.set(0.04, 0.55, 0); fig.add(helm);
    const cape = mesh(ctx, new THREE.CylinderGeometry(0.11, 0.2, 0.32, 14, 1, true, Math.PI * 0.6, Math.PI * 0.8), m(P.bossCape, { rough: 0.8 })); cape.position.set(-0.02, 0.22, 0); fig.add(cape);
    const pauld = mesh(ctx, new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m(P.metal, { metal: true })); pauld.position.set(0, 0.34, 0.12); fig.add(pauld);
  }
  if (kind === 'bow') {
    const bow = mesh(ctx, new THREE.TorusGeometry(0.2, 0.012, 6, 20, Math.PI * 0.9), m(P.wood)); bow.position.set(0.14, 0.3, -0.06); bow.rotation.set(0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.45); fig.add(bow);
    const quiver = mesh(ctx, new THREE.CylinderGeometry(0.035, 0.03, 0.2, 8), leather); quiver.position.set(-0.11, 0.3, 0.04); quiver.rotation.x = 0.4; fig.add(quiver);
  } else {
    const blade = curvedBlade(ctx, m(0xc9ced4, { metal: true }), kind === 'boss' ? 0.32 : 0.26);
    blade.position.set(0.12, 0.24, 0.13); blade.rotation.z = -0.6; fig.add(blade);
    const arm = limb(ctx, 0.03, 0.1, skin); arm.position.set(0.07, 0.27, 0.12); arm.rotation.z = -0.9; fig.add(arm);
    if (kind === 'boss') { const sh = mesh(ctx, new THREE.CylinderGeometry(0.11, 0.11, 0.025, 12), m(P.wood)); sh.rotation.x = Math.PI / 2; sh.position.set(0.1, 0.27, -0.15); fig.add(sh); }
  }
}

export interface OverlayColors { move: number; moveEdge: number; path: number; target: number; active: number; additive?: boolean; fillOpacity?: number; edgeWidth?: number; }

/** Movement range, path preview, target and active-unit rings. */
export function buildOverlays(reach: Map<string, number>, path: [number, number][], active: Unit, target: Unit, C: OverlayColors): THREE.Group {
  const g = new THREE.Group();
  const blend = C.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  const fill = new THREE.MeshBasicMaterial({ color: C.move, transparent: true, opacity: C.fillOpacity ?? 0.2, depthWrite: false, blending: blend });
  const quad = new THREE.PlaneGeometry(0.94, 0.94);
  const edgeMat = new THREE.MeshBasicMaterial({ color: C.moveEdge, transparent: true, opacity: 0.85, depthWrite: false, blending: blend });
  const has = (x: number, y: number) => reach.has(`${x},${y}`) || (x === active.x && y === active.y);
  for (const key of [...reach.keys(), `${active.x},${active.y}`]) {
    const [x, y] = key.split(',').map(Number);
    const yy = floorY(x, y) + 0.012;
    const q = new THREE.Mesh(quad, fill); q.rotation.x = -Math.PI / 2; q.position.set(x, yy, y); q.renderOrder = 2; g.add(q);
    // outline only on the border of the region, as thin flat strips
    const e = 0.5; const w = C.edgeWidth ?? 0.035;
    const strip = (cx: number, cz: number, horizontal: boolean) => {
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? 1 + w : w, horizontal ? w : 1 + w), edgeMat);
      sm.rotation.x = -Math.PI / 2; sm.position.set(cx, yy + 0.002, cz); sm.renderOrder = 3; g.add(sm);
    };
    if (!has(x, y - 1)) strip(x, y - e, true);
    if (!has(x, y + 1)) strip(x, y + e, true);
    if (!has(x - 1, y)) strip(x - e, y, false);
    if (!has(x + 1, y)) strip(x + e, y, false);
  }
  // path: a smooth tube with a ring at the destination
  const curvePts = path.map(([x, y]) => new THREE.Vector3(x, floorY(x, y) + 0.05, y));
  const curve = new THREE.CatmullRomCurve3(curvePts, false, 'catmullrom', 0.2);
  const pathMat = new THREE.MeshBasicMaterial({ color: C.path, transparent: true, opacity: 0.95, blending: blend, depthWrite: false });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.035, 8, false), pathMat));
  const end = curvePts[curvePts.length - 1];
  const endRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 40), pathMat); endRing.rotation.x = -Math.PI / 2; endRing.position.copy(end).setY(end.y - 0.03); g.add(endRing);
  for (let i = 1; i < 6; i++) { const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), pathMat); dot.rotation.x = -Math.PI / 2; dot.position.copy(curve.getPoint(i / 6)); dot.position.y -= 0.03; g.add(dot); }
  // rings
  const ring = (u: Unit, color: number, r0: number, r1: number) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: blend, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(u.x, floorY(u.x, u.y) + 0.015, u.y); g.add(m);
  };
  ring(active, C.active, 0.42, 0.48);
  ring(target, C.target, 0.42, 0.5);
  // target brackets
  const tMat = new THREE.MeshBasicMaterial({ color: C.target, transparent: true, blending: blend, depthWrite: false });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const tri = new THREE.Mesh(new THREE.CircleGeometry(0.09, 3), tMat); tri.rotation.x = -Math.PI / 2; tri.rotation.z = a + Math.PI;
    tri.position.set(target.x + Math.cos(a) * 0.6, floorY(target.x, target.y) + 0.02, target.y - Math.sin(a) * 0.6); g.add(tri);
  }
  return g;
}

export function gridCenter(): THREE.Vector3 { return new THREE.Vector3((W - 1) / 2, 0, (H - 1) / 2); }

export { units };
