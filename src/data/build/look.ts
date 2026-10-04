// Appearance: what the creator lets you pick (body, colours, hat, cape, height), and the full Look the renderer
// draws, which also follows from species (ears, horns, tail, proportions) and starting kit (weapons, shield).
import type { Body, GearKind, Look, Tint } from '../../engine/types';
import { WEAPONS } from '../weapons';
import { speciesById } from './species';
import type { ClassId, Kit } from './classes';

export interface LookChoice {
  body?: Body;
  /** Skin and hair tints; null keeps the model's own colours. */
  skin?: Tint | null;
  hair?: Tint | null;
  hat?: boolean;
  cape?: boolean;
  /** Height multiplier, 0.9–1.1. */
  height?: number;
}

export const BODIES: { id: Body; name: string }[] = [
  { id: 'Knight', name: 'Armoured' }, { id: 'Barbarian', name: 'Rugged' }, { id: 'Rogue', name: 'Light' },
  { id: 'Rogue_Hooded', name: 'Hooded' }, { id: 'Mage', name: 'Robed' },
];

export const SKIN_SWATCHES: { name: string; tint: Tint | null }[] = [
  { name: 'Natural', tint: null },
  { name: 'Fair', tint: { hue: 0.07, sat: 0.42, light: 1.06 } },
  { name: 'Rose', tint: { hue: 0.03, sat: 0.45, light: 1 } },
  { name: 'Olive', tint: { hue: 0.1, sat: 0.36, light: 0.88 } },
  { name: 'Tan', tint: { hue: 0.07, sat: 0.45, light: 0.8 } },
  { name: 'Brown', tint: { hue: 0.06, sat: 0.42, light: 0.62 } },
  { name: 'Deep', tint: { hue: 0.05, sat: 0.38, light: 0.46 } },
  { name: 'Ashen', tint: { hue: 0.6, sat: 0.08, light: 0.85 } },
  { name: 'Green', tint: { hue: 0.27, sat: 0.28, light: 0.78 } },
  { name: 'Crimson', tint: { hue: 0.98, sat: 0.5, light: 0.75 } },
  { name: 'Violet', tint: { hue: 0.78, sat: 0.25, light: 0.7 } },
  { name: 'Gold', tint: { hue: 0.12, sat: 0.6, light: 0.98 } },
];

export const HAIR_SWATCHES: { name: string; tint: Tint | null }[] = [
  { name: 'Auburn', tint: null },
  { name: 'Black', tint: { hue: 0.07, sat: 0.2, light: 0.35 } },
  { name: 'Brown', tint: { hue: 0.07, sat: 0.45, light: 0.7 } },
  { name: 'Blond', tint: { hue: 0.12, sat: 0.55, light: 1.7 } },
  { name: 'White', tint: { hue: 0.1, sat: 0.06, light: 2.1 } },
  { name: 'Copper', tint: { hue: 0.04, sat: 0.7, light: 1.15 } },
  { name: 'Blue-black', tint: { hue: 0.62, sat: 0.3, light: 0.45 } },
];

const sameTint = (a: Tint | null | undefined, b: Tint | null | undefined) => (a ?? null) === (b ?? null) || (!!a && !!b && a.hue === b.hue && a.sat === b.sat && a.light === b.light);
export const swatchIndex = (list: { tint: Tint | null }[], t: Tint | null | undefined) => list.findIndex((s) => sameTint(s.tint, t));

/** How each class dresses by default. */
const CLASS_LOOK: Record<ClassId, { body: Body; hat: boolean; cape: boolean }> = {
  fighter: { body: 'Knight', hat: true, cape: false },
  paladin: { body: 'Knight', hat: true, cape: true },
  cleric: { body: 'Knight', hat: false, cape: true },
  rogue: { body: 'Rogue_Hooded', hat: false, cape: true },
  wizard: { body: 'Mage', hat: true, cape: true },
};

/** What the kit puts in the figure's hands. */
export function gearOf(cls: ClassId, kit: Kit): Look['gear'] {
  const ws = kit.weapons.filter((w) => !w.thrownOnly).map((w) => WEAPONS[w.id]);
  const melee = ws.filter((w) => w.kind === 'melee');
  const first = melee[0];
  const kind = (id: string | undefined): GearKind => {
    if (!id) return 'none';
    if (id === 'quarterstaff') return 'staff';
    if (id === 'mace' || id === 'morningstar' || id === 'flail' || id === 'warhammer' || id === 'club' || id === 'maul' || id === 'greatclub') return WEAPONS[id].twoHanded ? 'greatblade' : 'mace';
    if (id === 'dagger') return 'dagger';
    if (id.includes('axe')) return WEAPONS[id].twoHanded ? 'greataxe' : 'axe';
    return WEAPONS[id].twoHanded ? 'greatblade' : 'blade';
  };
  const lights = melee.filter((w) => w.light);
  return {
    main: kind(first?.id),
    offhand: kit.shield ? 'shield' : lights.length >= 2 || (first?.light && melee.some((w) => w.id === 'dagger' && w !== first)) ? 'dagger' : 'none',
    bow: ws.some((w) => !!w.ammunition),
    holy: cls === 'cleric' || cls === 'paladin',
  };
}

/** The full look: the creator's picks over the species' and class's defaults. */
export function lookFor(species: string, lineage: string | undefined, cls: ClassId, kit: Kit, pick: LookChoice = {}): Look {
  const sp = speciesById(species);
  const base = CLASS_LOOK[cls];
  const h = Math.min(1.1, Math.max(0.9, pick.height ?? 1));
  const [x, y, z] = sp.look.scale;
  // humans, dwarves and halflings keep KayKit's own skin by default; the rest get their species' colouring
  const natural = species === 'human' || species === 'dwarf' || species === 'halfling';
  return {
    body: pick.body ?? base.body,
    skin: pick.skin !== undefined ? pick.skin : natural ? null : sp.look.skin,
    hair: pick.hair ?? null,
    ears: sp.look.ears ? 'pointed' : 'none',
    horns: !!sp.look.horns,
    tail: !!sp.look.tail,
    // horns don't fit under a helmet
    hat: pick.hat ?? (base.hat && !sp.look.horns),
    cape: pick.cape ?? base.cape,
    scale: [x, y * h, z],
    gear: gearOf(cls, kit),
    ...(lineage === 'drow' && pick.skin === undefined ? { skin: { hue: 0.7, sat: 0.18, light: 0.55 } } : {}),
  };
}
