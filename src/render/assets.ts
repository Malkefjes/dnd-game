// Loads the KayKit (CC0) models and builds animated characters from them.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Archetype } from './models';
import type { Look, Tint } from '../engine/types';

const BASE = `${import.meta.env.BASE_URL}assets/`;

export const DUNGEON_PIECES = [
  'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small_decorated', 'floor_tile_small_weeds_A', 'floor_tile_small_weeds_B',
  'floor_tile_large_rocks', 'floor_foundation_allsides', 'wall_half', 'wall_arched', 'pillar', 'stairs_narrow',
  'barrel_large', 'barrel_small_stack', 'keg', 'crates_stacked', 'box_small', 'torch_mounted', 'banner_red', 'banner_patternA_red', 'banner_shield_brown',
  'candle_triple', 'sword_shield_broken', 'coin_stack_small', 'bottle_A_green', 'trunk_small_A', 'column',
  'wall_doorway', 'chest', 'floor_dirt_large', 'floor_dirt_small_A', 'floor_dirt_small_B', 'floor_dirt_small_C', 'rubble_large', 'candle_lit',
  'banner_thin_white', 'banner_patternB_white', 'wall',
] as const;
export type Piece = typeof DUNGEON_PIECES[number];

const CHARACTER_FILES = ['Knight', 'Rogue', 'Rogue_Hooded', 'Barbarian', 'Mage', 'Skeleton_Warrior', 'Skeleton_Minion', 'Skeleton_Rogue', 'Skeleton_Mage'] as const;
type CharFile = typeof CHARACTER_FILES[number];
/** Weapons and shields that come as separate models (the skeleton pack), attached to hand bones. */
const PROP_FILES = ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Staff', 'Skeleton_Crossbow', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Large_A'] as const;
type PropFile = typeof PROP_FILES[number];

/** How each archetype is dressed and animated. */
interface ModelSpec {
  file: CharFile;
  /** World scale (x, y, z). 0.5 maps KayKit units onto our 5-ft squares. */
  scale: [number, number, number];
  /** Accessory nodes to show (weapons, shields, hats); all other accessories are hidden. */
  show: string[];
  /** Accessory shown only while shooting (swapped in for the melee weapons). */
  rangedProp?: string;
  melee: string;
  offhand?: string;
  ranged: string;
  /** Spellcasting animation for bolts and for buffs/heals. */
  cast?: string;
  /** Re-tint the skin (goblin green 0.25, hobgoblin red-orange 0.03, zombie grey-green); `ears` adds goblin ears. */
  skin?: { hue: number; sat: number; light?: number; ears?: boolean };
  /** A hero's look: skin and hair tones (lightness relative to the original), and extra features. */
  tone?: { skin: Tint | null; hair: Tint | null; ears: Look['ears']; horns: boolean; tail: boolean };
  /** Separate prop models held in the hands. */
  props?: { file: PropFile; hand: 'r' | 'l' }[];
  /** Walk cycle (default Running_A) and idle (default Idle). */
  walk?: string;
  idle?: string;
  /** A hand-made prop (the cleric's mace). */
  prop?: 'mace';
}

const HATS: Record<Look['body'], string | undefined> = { Knight: 'Knight_Helmet', Barbarian: 'Barbarian_Hat', Mage: 'Mage_Hat', Rogue: undefined, Rogue_Hooded: undefined };
const CAPES: Record<Look['body'], string> = { Knight: 'Knight_Cape', Barbarian: 'Barbarian_Cape', Mage: 'Mage_Cape', Rogue: 'Rogue_Cape', Rogue_Hooded: 'Rogue_Cape' };

/**
 * A hero's model spec from their look. Each KayKit body has its own weapons; where a body lacks one, the
 * skeleton pack's props stand in (a blade, an axe, a staff, a shield), and the mace is built by hand.
 */
export function specForLook(look: Look): ModelSpec {
  const b = look.body, g = look.gear;
  const show: string[] = [];
  const props: NonNullable<ModelSpec['props']> = [];
  let prop: ModelSpec['prop'];
  if (look.hat && HATS[b]) show.push(HATS[b]!);
  if (look.cape) show.push(CAPES[b]);
  const rogue = b === 'Rogue' || b === 'Rogue_Hooded';
  const two = g.main === 'greatblade' || g.main === 'greataxe' || g.main === 'staff';
  switch (g.main) {
    case 'mace': prop = 'mace'; break;
    case 'staff': if (b === 'Mage') show.push('2H_Staff'); else props.push({ file: 'Skeleton_Staff', hand: 'r' }); break;
    case 'blade': case 'dagger':
      if (b === 'Knight') show.push('1H_Sword'); else if (b === 'Barbarian') show.push('1H_Axe'); else if (rogue) show.push('Knife'); else props.push({ file: 'Skeleton_Blade', hand: 'r' });
      break;
    case 'axe':
      if (b === 'Barbarian') show.push('1H_Axe'); else props.push({ file: 'Skeleton_Axe', hand: 'r' });
      break;
    case 'greatblade': case 'greataxe':
      if (b === 'Knight') show.push('2H_Sword'); else if (b === 'Barbarian') show.push('2H_Axe'); else props.push({ file: g.main === 'greataxe' ? 'Skeleton_Axe' : 'Skeleton_Blade', hand: 'r' });
      break;
    default: if (b === 'Mage') show.push('1H_Wand'); break;
  }
  if (g.offhand === 'shield') {
    if (b === 'Knight') show.push(g.holy ? 'Badge_Shield' : 'Round_Shield');
    else if (b === 'Barbarian') show.push('Barbarian_Round_Shield');
    else props.push({ file: 'Skeleton_Shield_Small_A', hand: 'l' });
  } else if (g.offhand === 'dagger') {
    if (rogue) show.push('Knife_Offhand'); else if (b === 'Knight') show.push('1H_Sword_Offhand'); else if (b === 'Barbarian') show.push('1H_Axe_Offhand');
  } else if (b === 'Mage' && !two) show.push('Spellbook');
  const melee = g.main === 'dagger' ? '1H_Melee_Attack_Stab' : two ? '1H_Melee_Attack_Slice_Horizontal' : g.main === 'mace' ? '1H_Melee_Attack_Chop' : '1H_Melee_Attack_Slice_Diagonal';
  return {
    file: b, scale: look.scale, show, props, prop,
    rangedProp: g.bow && rogue ? '2H_Crossbow' : undefined,
    melee, offhand: g.offhand === 'dagger' ? 'Dualwield_Melee_Attack_Stab' : undefined,
    ranged: g.bow ? (rogue ? '2H_Ranged_Shoot' : '1H_Ranged_Shoot') : 'Throw',
    cast: g.main === 'staff' || b === 'Mage' ? 'Spellcast_Shoot' : 'Spellcast_Raise',
    tone: { skin: look.skin, hair: look.hair, ears: look.ears, horns: look.horns, tail: look.tail },
  };
}

export const MODEL_SPECS: Record<Archetype, ModelSpec> = {
  // a dwarf: shorter and broader than the human knight
  fighter: { file: 'Knight', scale: [0.56, 0.45, 0.56], show: ['1H_Sword', 'Round_Shield', 'Knight_Helmet'], melee: '1H_Melee_Attack_Chop', ranged: 'Throw' },
  // a halfling
  rogue: { file: 'Rogue_Hooded', scale: [0.4, 0.4, 0.4], show: ['Knife', 'Knife_Offhand', 'Rogue_Cape'], rangedProp: '2H_Crossbow', melee: '1H_Melee_Attack_Stab', offhand: 'Dualwield_Melee_Attack_Stab', ranged: '2H_Ranged_Shoot' },
  // a human cleric: no helmet, holy-symbol shield, a mace (KayKit has none, so it's built by hand)
  cleric: { file: 'Knight', scale: [0.5, 0.5, 0.5], show: ['Badge_Shield', 'Knight_Cape'], melee: '1H_Melee_Attack_Chop', ranged: 'Throw', cast: 'Spellcast_Raise', prop: 'mace' },
  // an elf wizard: a touch taller and slimmer
  wizard: { file: 'Mage', scale: [0.47, 0.52, 0.47], show: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'], melee: '1H_Melee_Attack_Stab', ranged: 'Throw', cast: 'Spellcast_Shoot' },
  goblin: { file: 'Rogue', scale: [0.36, 0.34, 0.36], show: ['Knife'], rangedProp: '1H_Crossbow', melee: '1H_Melee_Attack_Slice_Diagonal', ranged: 'Throw', skin: { hue: 0.25, sat: 0.55, ears: true } },
  goblinArcher: { file: 'Rogue', scale: [0.36, 0.34, 0.36], show: ['2H_Crossbow', 'Rogue_Cape'], rangedProp: '2H_Crossbow', melee: '1H_Melee_Attack_Slice_Diagonal', ranged: '2H_Ranged_Shoot', skin: { hue: 0.25, sat: 0.55, ears: true } },
  goblinBoss: { file: 'Barbarian', scale: [0.44, 0.4, 0.44], show: ['1H_Axe', 'Barbarian_Round_Shield', 'Barbarian_Cape'], melee: '1H_Melee_Attack_Chop', ranged: 'Throw', skin: { hue: 0.25, sat: 0.55, ears: true } },
  // hobgoblins: knight-sized, red-orange skin, half plate and a longsword (KayKit has no bow: it shoots a crossbow-less "Throw")
  hobgoblin: { file: 'Knight', scale: [0.5, 0.5, 0.5], show: ['1H_Sword', 'Rectangle_Shield', 'Knight_Helmet'], melee: '1H_Melee_Attack_Slice_Horizontal', ranged: '1H_Ranged_Shoot', skin: { hue: 0.03, sat: 0.55, ears: true } },
  // undead (KayKit Skeletons pack). The plain skeleton is bare bone with a blade (the 2025 stat block
  // has no shield); the armoured warrior body is kept for tougher dead later.
  skeleton: { file: 'Skeleton_Minion', scale: [0.5, 0.5, 0.5], show: [], props: [{ file: 'Skeleton_Blade', hand: 'r' }], melee: '1H_Melee_Attack_Slice_Diagonal', ranged: '1H_Ranged_Shoot', walk: 'Walking_C' },
  skeletonWarrior: { file: 'Skeleton_Warrior', scale: [0.5, 0.5, 0.5], show: ['Skeleton_Warrior_Helmet', 'Skeleton_Warrior_Cloak'], props: [{ file: 'Skeleton_Blade', hand: 'r' }, { file: 'Skeleton_Shield_Small_A', hand: 'l' }],
    melee: '1H_Melee_Attack_Slice_Diagonal', ranged: '1H_Ranged_Shoot', walk: 'Walking_C' },
  skeletonRogue: { file: 'Skeleton_Rogue', scale: [0.5, 0.5, 0.5], show: ['Skeleton_Rogue_Hood', 'Skeleton_Rogue_Cape'], props: [{ file: 'Skeleton_Blade', hand: 'r' }], melee: '1H_Melee_Attack_Slice_Diagonal', ranged: '1H_Ranged_Shoot', walk: 'Walking_C' },
  skeletonMage: { file: 'Skeleton_Mage', scale: [0.5, 0.5, 0.5], show: ['Skeleton_Mage_Hat'], props: [{ file: 'Skeleton_Staff', hand: 'r' }], melee: '1H_Melee_Attack_Stab', ranged: 'Spellcast_Shoot', walk: 'Walking_C' },
  // a zombie: a human body with grey-green skin, shambling
  zombie: { file: 'Rogue', scale: [0.5, 0.48, 0.5], show: [], melee: 'Unarmed_Melee_Attack_Punch_A', ranged: 'Throw', walk: 'Walking_D_Skeletons', skin: { hue: 0.2, sat: 0.18, light: 0.85 } },
};

const ACCESSORY_PARENTS = new Set(['handslot.l', 'handslot.r', 'head', 'chest']);

export class AssetLibrary {
  private pieces = new Map<string, THREE.Object3D>();
  private chars = new Map<string, GLTF>();
  private props = new Map<string, THREE.Object3D>();
  clips: THREE.AnimationClip[] = [];
  private goblinTextures = new Map<string, THREE.Texture>();
  private texIds = new Map<THREE.Texture, number>();
  /** Decoded pixels of each atlas, for recolouring. */
  private pixels = new Map<THREE.Texture, ImageData>();
  /** One texture per atlas: every KayKit model file carries its own copy (the dungeon's, 53 times). */
  private atlases = new Map<string, THREE.Texture>();

  async load(onProgress?: (done: number, total: number) => void) {
    const loader = new GLTFLoader();
    const jobs: [string, (g: GLTF) => void][] = [
      ['characters/animations.glb', (g) => { this.clips.push(...g.animations); }],
      ['characters/undead-animations.glb', (g) => { this.clips.push(...g.animations); }],
      ...PROP_FILES.map((f) => [`props/${f}.glb`, (g: GLTF) => this.props.set(f, g.scene)] as [string, (g: GLTF) => void]),
      ...CHARACTER_FILES.map((f) => [`characters/${f}.glb`, (g: GLTF) => this.chars.set(f, g)] as [string, (g: GLTF) => void]),
      ...DUNGEON_PIECES.map((p) => [`dungeon/${p}.glb`, (g: GLTF) => this.pieces.set(p, g.scene)] as [string, (g: GLTF) => void]),
    ];
    let done = 0;
    await Promise.all(jobs.map(async ([url, use]) => {
      const g = await loader.loadAsync(BASE + url);
      g.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true; mesh.receiveShadow = true;
        for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
          if (!m.map?.name) continue;
          const img = m.map.image as { width: number; height: number; close?: () => void };
          const k = `${m.map.name}:${img.width}x${img.height}`;
          const shared = this.atlases.get(k);
          if (!shared) { this.atlases.set(k, m.map); continue; }
          if (shared !== m.map) { img.close?.(); m.map.dispose(); m.map = shared; }
        }
      });
      use(g);
      onProgress?.(++done, jobs.length);
    }));
  }

  /** A fresh copy of a dungeon piece (geometry and materials are shared). */
  piece(name: Piece): THREE.Object3D { return this.pieces.get(name)!.clone(true); }
  /** The loaded original, for instancing (don't add it to the scene). */
  pieceSource(name: Piece): THREE.Object3D { return this.pieces.get(name)!; }

  /** Build an animated character for an archetype, or from a hero's look. */
  character(archetype: Archetype, look?: Look): Character {
    const spec = look ? specForLook(look) : MODEL_SPECS[archetype];
    const src = this.chars.get(spec.file)!;
    const model = cloneSkinned(src.scene) as THREE.Group;
    const materials: THREE.MeshStandardMaterial[] = [];
    const accessories = new Map<string, THREE.Object3D>();
    model.traverse((o) => {
      if (o.parent && ACCESSORY_PARENTS.has(o.parent.name) && (o as THREE.Mesh).isMesh) accessories.set(o.name, o);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        // own materials per character so it can flash / fade independently
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        if (spec.skin && m.map) m.map = this.skinTexture(m.map, spec.skin);
        if (spec.tone && (spec.tone.skin || spec.tone.hair) && m.map) m.map = this.toneTexture(m.map, spec.tone.skin, spec.tone.hair);
        m.roughness = 0.85; m.metalness = Math.min(m.metalness, 0.2);
        mesh.material = m;
        materials.push(m);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      }
    });
    // only accessories (hand / head / chest attachments) are toggled; body parts always show
    for (const [name, o] of accessories) o.visible = spec.show.includes(name);
    if (spec.skin?.ears) addGoblinEars(model, materials, spec.skin.hue);
    if (spec.tone) addFeatures(model, materials, spec.tone);
    for (const p of spec.props ?? []) {
      const hand = model.getObjectByName(`handslot.${p.hand}`);
      const src = this.props.get(p.file);
      if (!hand || !src) continue;
      const prop = src.clone(true);
      prop.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.roughness = 0.85; mesh.material = m; materials.push(m);
        mesh.castShadow = true; mesh.frustumCulled = false;
      });
      hand.add(prop);
    }
    if (spec.prop === 'mace') addMace(model, materials);
    model.scale.set(...spec.scale);
    return new Character(model, this.clips, spec, accessories, materials);
  }

  /**
   * A hero's skin and hair: skin pixels move to the tint's hue and saturation with their lightness scaled, so
   * the shading survives; the red hair of the atlas takes the hair tint the same way.
   */
  private toneTexture(tex: THREE.Texture, skin: Tint | null, hair: Tint | null): THREE.Texture {
    return this.recolor(tex, `tone:${JSON.stringify(skin)}:${JSON.stringify(hair)}`, (h, s, l) => {
      let t: Tint | null = null;
      if (skin && h > 0.03 && h < 0.12 && s > 0.2 && l > 0.55 && l < 0.95) t = skin;
      else if (hair && h < 0.045 && s > 0.3 && l > 0.22 && l < 0.6) t = hair;
      return t ? [t.hue + (h - 0.07) * 0.5, t.sat, Math.min(0.94, l * t.light)] : null;
    });
  }

  /** Re-tint the skin tones of a KayKit gradient atlas (goblin green, hobgoblin red, zombie grey). */
  private skinTexture(tex: THREE.Texture, skin: NonNullable<ModelSpec['skin']>): THREE.Texture {
    const { hue, sat, light = 1 } = skin;
    return this.recolor(tex, `skin:${hue}:${sat}:${light}`, (h, s, l) => {
      // KayKit skin: warm, fairly light, moderately saturated. Keep the shading gradient (lighter peach → lighter green).
      if (h > 0.03 && h < 0.12 && s > 0.2 && l > 0.55 && l < 0.95) return [hue + (h - 0.07) * 0.5, sat, (0.22 + (l - 0.55) * 0.9) * light + (1 - light) * 0.3];
      // red hair → a dark, scruffy goblin mop
      if (h < 0.045 && s > 0.3 && l > 0.22 && l < 0.6) return [0.08, 0.3, l * 0.4];
      return null;
    });
  }

  /**
   * A recoloured copy of an atlas. `fn` maps a pixel's HSL (in sRGB, 0–1) to a new HSL, or null to leave it.
   * The atlases are gradient swatches with few distinct colours, so each colour is worked out once.
   */
  private recolor(tex: THREE.Texture, what: string, fn: (h: number, s: number, l: number) => [number, number, number] | null): THREE.Texture {
    if (!this.texIds.has(tex)) this.texIds.set(tex, this.texIds.size);
    const key = `${this.texIds.get(tex)}:${what}`;
    const cached = this.goblinTextures.get(key);
    if (cached) return cached;
    let src = this.pixels.get(tex);
    if (!src) {
      const img = tex.image as HTMLImageElement | ImageBitmap;
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
      src = g.getImageData(0, 0, c.width, c.height);
      this.pixels.set(tex, src);
    }
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d')!;
    const data = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    const d = data.data;
    const memo = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) {
      const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let out = memo.get(rgb);
      if (out === undefined) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const t = fn(h, s, l);
        out = t ? hslToRgb(t[0], t[1], t[2]) : -1;
        memo.set(rgb, out);
      }
      if (out >= 0) { d[i] = out >> 16; d[i + 1] = (out >> 8) & 255; d[i + 2] = out & 255; }
    }
    g.putImageData(data, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = tex.flipY; t.colorSpace = tex.colorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
    t.magFilter = tex.magFilter; t.minFilter = tex.minFilter; t.channel = tex.channel;
    this.goblinTextures.set(key, t);
    return t;
  }
}

/** sRGB bytes → HSL (0–1), the same formula three.js uses. */
function rgbToHsl(r8: number, g8: number, b8: number): [number, number, number] {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (min + max) / 2;
  if (min === max) return [0, 0, l];
  const delta = max - min;
  const s = l <= 0.5 ? delta / (max + min) : delta / (2 - max - min);
  let h = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  h /= 6;
  return [h, s, l];
}

/** HSL (hue wraps, the rest clamped) → packed sRGB 0xRRGGBB. */
function hslToRgb(h: number, s: number, l: number): number {
  h = ((h % 1) + 1) % 1; s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
    return p;
  };
  let r = l, g = l, b = l;
  if (s !== 0) {
    const p = l <= 0.5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
    r = hue(q, p, h + 1 / 3); g = hue(q, p, h); b = hue(q, p, h - 1 / 3);
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/**
 * Long pointed goblin ears, parented to the head bone so they follow the
 * animation. Placed in model space and converted into the bone's frame (the
 * bone's own axes don't line up with the model's).
 */
function addGoblinEars(model: THREE.Object3D, materials: THREE.MeshStandardMaterial[], hue: number) {
  const head = model.getObjectByName('head');
  if (!head) return;
  model.updateMatrixWorld(true);
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue + 0.005, 0.47, 0.41, THREE.SRGBColorSpace), roughness: 0.85 });
  materials.push(skin);
  const headPos = head.getWorldPosition(new THREE.Vector3());
  const headQuat = head.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const side of [-1, 1]) {
    const geo = new THREE.ConeGeometry(0.13, 0.75, 6);
    geo.translate(0, 0.375, 0); // pivot at the base
    const ear = new THREE.Mesh(geo, skin);
    ear.castShadow = true;
    const at = headPos.clone().add(new THREE.Vector3(side * 0.42, 0.55, -0.05));
    const dir = new THREE.Vector3(side, 0.32, -0.25).normalize();
    ear.position.copy(head.worldToLocal(at));
    ear.quaternion.copy(headQuat).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    ear.scale.set(1, 1, 0.45);
    head.add(ear);
  }
}

/** The skin colour a tint gives a typical KayKit skin pixel (for ears and tails). */
function skinColor(t: Tint | null): THREE.Color {
  const base = new THREE.Color().setHSL(0.07, 0.5, 0.72, THREE.SRGBColorSpace);
  if (!t) return base;
  return new THREE.Color().setHSL(t.hue, t.sat, Math.min(0.94, 0.72 * t.light), THREE.SRGBColorSpace);
}

/** Pointed ears, horns and a tail, built from primitives on the head and hip bones. */
function addFeatures(model: THREE.Object3D, materials: THREE.MeshStandardMaterial[], tone: NonNullable<ModelSpec['tone']>) {
  model.updateMatrixWorld(true);
  const skin = new THREE.MeshStandardMaterial({ color: skinColor(tone.skin), roughness: 0.85 });
  materials.push(skin);
  const attach = (bone: THREE.Object3D, mesh: THREE.Mesh, at: THREE.Vector3, dir: THREE.Vector3) => {
    const bonePos = bone.getWorldPosition(new THREE.Vector3());
    const inv = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    mesh.position.copy(bone.worldToLocal(bonePos.clone().add(at)));
    mesh.quaternion.copy(inv).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    mesh.castShadow = true;
    bone.add(mesh);
  };
  const head = model.getObjectByName('head');
  if (head && tone.ears === 'pointed') {
    for (const side of [-1, 1]) {
      const geo = new THREE.ConeGeometry(0.11, 0.42, 5); geo.translate(0, 0.21, 0);
      const ear = new THREE.Mesh(geo, skin);
      attach(head, ear, new THREE.Vector3(side * 0.43, 0.5, -0.02), new THREE.Vector3(side, 0.55, -0.35));
      ear.scale.set(1, 1, 0.45);
    }
  }
  if (head && tone.horns) {
    const horn = new THREE.MeshStandardMaterial({ color: 0x2a2024, roughness: 0.6 });
    materials.push(horn);
    for (const side of [-1, 1]) {
      // two segments curving up and back
      const a = new THREE.ConeGeometry(0.1, 0.34, 6); a.translate(0, 0.17, 0);
      const m = new THREE.Mesh(a, horn);
      attach(head, m, new THREE.Vector3(side * 0.26, 0.95, 0.12), new THREE.Vector3(side * 0.35, 1, -0.55));
    }
  }
  const hips = model.getObjectByName('hips');
  if (hips && tone.tail) {
    const geo = new THREE.CylinderGeometry(0.035, 0.07, 0.9, 6); geo.translate(0, 0.45, 0);
    const tail = new THREE.Mesh(geo, skin);
    attach(hips, tail, new THREE.Vector3(0, 0.1, -0.25), new THREE.Vector3(0, -0.55, -1));
    const tipGeo = new THREE.ConeGeometry(0.09, 0.2, 4); tipGeo.translate(0, 0.1, 0);
    const tip = new THREE.Mesh(tipGeo, skin);
    tip.position.y = 0.9; tip.rotation.x = 0.6;
    tail.add(tip);
  }
}

/** A flanged mace in the right hand, built from primitives in the hand slot's frame. */
function addMace(model: THREE.Object3D, materials: THREE.MeshStandardMaterial[]) {
  const hand = model.getObjectByName('handslot.r');
  if (!hand) return;
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.45, metalness: 0.6 });
  materials.push(wood, iron);
  const mace = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 6), wood);
  shaft.position.y = 0.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), iron);
  head.position.y = 0.95;
  mace.add(shaft, head);
  for (let i = 0; i < 4; i++) {
    const flange = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.3), iron);
    flange.position.y = 0.95; flange.rotation.y = (i * Math.PI) / 4;
    mace.add(flange);
  }
  mace.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  hand.add(mace);
}

/** An animated KayKit character: mixer, clip lookup, and weapon swaps. */
export class Character {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private base: string;

  constructor(
    readonly model: THREE.Group,
    clips: THREE.AnimationClip[],
    readonly spec: ModelSpec,
    private accessories: Map<string, THREE.Object3D>,
    readonly materials: THREE.MeshStandardMaterial[],
  ) {
    this.mixer = new THREE.AnimationMixer(model);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.base = spec.idle ?? 'Idle';
    this.loop(this.base, 0);
    // desynchronise idles so a group doesn't breathe in unison
    this.mixer.update(Math.random() * 2);
  }

  has(name: string) { return this.actions.has(name); }

  /** Switch to a looping animation (Idle, Running_A …). */
  loop(name: string, fade = 0.2) {
    const a = this.actions.get(name);
    if (!a || a === this.current) return;
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(1);
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false); else this.current?.stop();
    a.play();
    this.current = a;
  }

  /** Set the animation to return to after one-shots. */
  setBase(name: string, fade = 0.25) { this.base = name; this.loop(name, fade); }

  /**
   * Play a one-shot. Resolves `impact` at `impactAt` (fraction of the clip) and
   * `done` at the end. With `hold`, the last frame is kept (death, lying down).
   */
  once(name: string, opts: { impactAt?: number; hold?: boolean; speed?: number; fade?: number } = {}) {
    const a = this.actions.get(name);
    if (!a) return { impact: Promise.resolve(), done: Promise.resolve(), duration: 0 };
    const speed = opts.speed ?? 1;
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.enabled = true; a.setEffectiveTimeScale(speed); a.setEffectiveWeight(1);
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, opts.fade ?? 0.12, false); else this.current?.stop();
    a.play();
    this.current = a;
    const duration = a.getClip().duration / speed;
    const elapsed = { t: 0 };
    const tick = (resolveAt: number) => new Promise<void>((res) => {
      const check = () => { if (elapsed.t >= resolveAt) res(); else requestAnimationFrame(check); };
      check();
    });
    this.pending.push({ elapsed, a });
    const impact = tick(duration * (opts.impactAt ?? 0.45));
    const done = tick(duration * 0.98).then(() => { if (!opts.hold && this.current === a) this.loop(this.base, 0.2); });
    return { impact, done, duration };
  }

  private pending: { elapsed: { t: number }; a: THREE.AnimationAction }[] = [];

  private skipped = 0;
  /** Advance the animation. With `animate` false (far off screen) only the clocks move; the pose catches up later. */
  update(dt: number, animate = true) {
    if (animate) { this.mixer.update(dt + this.skipped); this.skipped = 0; } else this.skipped += dt;
    for (const p of this.pending) p.elapsed.t += dt;
    this.pending = this.pending.filter((p) => p.elapsed.t < 30);
  }

  /** Show the ranged weapon instead of melee weapons while shooting. */
  showRanged(on: boolean) {
    const prop = this.spec.rangedProp;
    if (!prop) return;
    for (const [name, o] of this.accessories) {
      if (name === prop) o.visible = on || this.spec.show.includes(name);
      else if (this.spec.show.includes(name) && (name.includes('Knife') || name.includes('Sword') || name.includes('Axe'))) o.visible = !on;
    }
  }
}
