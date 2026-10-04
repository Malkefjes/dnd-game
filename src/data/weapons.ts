// Weapons and armor from the 2024 Player's Handbook.
import { parseDice, type DiceExpr } from '../engine/dice';
import { abilityMod, type AbilityScores, type AttackProfile, type DamageType, type Mastery } from '../engine/types';

export interface Weapon {
  id: string;
  name: string;
  category: 'simple' | 'martial';
  kind: 'melee' | 'ranged';
  damage: string;
  damageType: DamageType;
  finesse?: boolean;
  light?: boolean;
  heavy?: boolean;
  twoHanded?: boolean;
  versatile?: string;
  reach?: boolean;
  loading?: boolean;
  /** Thrown range [normal, long] in feet. */
  thrown?: [number, number];
  /** Ammunition range [normal, long] in feet and the ammo item. */
  ammunition?: { range: [number, number]; item: string };
  mastery: Mastery;
}

const W = (w: Weapon) => w;
export const WEAPONS: Record<string, Weapon> = {
  // simple melee
  club: W({ id: 'club', name: 'Club', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'bludgeoning', light: true, mastery: 'slow' }),
  dagger: W({ id: 'dagger', name: 'Dagger', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'piercing', finesse: true, light: true, thrown: [20, 60], mastery: 'nick' }),
  greatclub: W({ id: 'greatclub', name: 'Greatclub', category: 'simple', kind: 'melee', damage: '1d8', damageType: 'bludgeoning', twoHanded: true, mastery: 'push' }),
  handaxe: W({ id: 'handaxe', name: 'Handaxe', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'slashing', light: true, thrown: [20, 60], mastery: 'vex' }),
  javelin: W({ id: 'javelin', name: 'Javelin', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'piercing', thrown: [30, 120], mastery: 'slow' }),
  lightHammer: W({ id: 'lightHammer', name: 'Light Hammer', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'bludgeoning', light: true, thrown: [20, 60], mastery: 'nick' }),
  mace: W({ id: 'mace', name: 'Mace', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'bludgeoning', mastery: 'sap' }),
  quarterstaff: W({ id: 'quarterstaff', name: 'Quarterstaff', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'bludgeoning', versatile: '1d8', mastery: 'topple' }),
  sickle: W({ id: 'sickle', name: 'Sickle', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'slashing', light: true, mastery: 'nick' }),
  spear: W({ id: 'spear', name: 'Spear', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'piercing', thrown: [20, 60], versatile: '1d8', mastery: 'sap' }),
  // simple ranged
  dart: W({ id: 'dart', name: 'Dart', category: 'simple', kind: 'ranged', damage: '1d4', damageType: 'piercing', finesse: true, thrown: [20, 60], mastery: 'vex' }),
  lightCrossbow: W({ id: 'lightCrossbow', name: 'Light Crossbow', category: 'simple', kind: 'ranged', damage: '1d8', damageType: 'piercing', twoHanded: true, loading: true, ammunition: { range: [80, 320], item: 'bolt' }, mastery: 'slow' }),
  shortbow: W({ id: 'shortbow', name: 'Shortbow', category: 'simple', kind: 'ranged', damage: '1d6', damageType: 'piercing', twoHanded: true, ammunition: { range: [80, 320], item: 'arrow' }, mastery: 'vex' }),
  sling: W({ id: 'sling', name: 'Sling', category: 'simple', kind: 'ranged', damage: '1d4', damageType: 'bludgeoning', ammunition: { range: [30, 120], item: 'bullet' }, mastery: 'slow' }),
  // martial melee
  battleaxe: W({ id: 'battleaxe', name: 'Battleaxe', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'slashing', versatile: '1d10', mastery: 'topple' }),
  flail: W({ id: 'flail', name: 'Flail', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'bludgeoning', mastery: 'sap' }),
  glaive: W({ id: 'glaive', name: 'Glaive', category: 'martial', kind: 'melee', damage: '1d10', damageType: 'slashing', heavy: true, reach: true, twoHanded: true, mastery: 'graze' }),
  greataxe: W({ id: 'greataxe', name: 'Greataxe', category: 'martial', kind: 'melee', damage: '1d12', damageType: 'slashing', heavy: true, twoHanded: true, mastery: 'cleave' }),
  greatsword: W({ id: 'greatsword', name: 'Greatsword', category: 'martial', kind: 'melee', damage: '2d6', damageType: 'slashing', heavy: true, twoHanded: true, mastery: 'graze' }),
  halberd: W({ id: 'halberd', name: 'Halberd', category: 'martial', kind: 'melee', damage: '1d10', damageType: 'slashing', heavy: true, reach: true, twoHanded: true, mastery: 'cleave' }),
  longsword: W({ id: 'longsword', name: 'Longsword', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'slashing', versatile: '1d10', mastery: 'sap' }),
  maul: W({ id: 'maul', name: 'Maul', category: 'martial', kind: 'melee', damage: '2d6', damageType: 'bludgeoning', heavy: true, twoHanded: true, mastery: 'topple' }),
  morningstar: W({ id: 'morningstar', name: 'Morningstar', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'piercing', mastery: 'sap' }),
  pike: W({ id: 'pike', name: 'Pike', category: 'martial', kind: 'melee', damage: '1d10', damageType: 'piercing', heavy: true, reach: true, twoHanded: true, mastery: 'push' }),
  rapier: W({ id: 'rapier', name: 'Rapier', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'piercing', finesse: true, mastery: 'vex' }),
  scimitar: W({ id: 'scimitar', name: 'Scimitar', category: 'martial', kind: 'melee', damage: '1d6', damageType: 'slashing', finesse: true, light: true, mastery: 'nick' }),
  shortsword: W({ id: 'shortsword', name: 'Shortsword', category: 'martial', kind: 'melee', damage: '1d6', damageType: 'piercing', finesse: true, light: true, mastery: 'vex' }),
  trident: W({ id: 'trident', name: 'Trident', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'piercing', thrown: [20, 60], versatile: '1d10', mastery: 'topple' }),
  warhammer: W({ id: 'warhammer', name: 'Warhammer', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'bludgeoning', versatile: '1d10', mastery: 'push' }),
  warPick: W({ id: 'warPick', name: 'War Pick', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'piercing', versatile: '1d10', mastery: 'sap' }),
  whip: W({ id: 'whip', name: 'Whip', category: 'martial', kind: 'melee', damage: '1d4', damageType: 'slashing', finesse: true, reach: true, mastery: 'slow' }),
  // martial ranged
  handCrossbow: W({ id: 'handCrossbow', name: 'Hand Crossbow', category: 'martial', kind: 'ranged', damage: '1d6', damageType: 'piercing', light: true, loading: true, ammunition: { range: [30, 120], item: 'bolt' }, mastery: 'vex' }),
  heavyCrossbow: W({ id: 'heavyCrossbow', name: 'Heavy Crossbow', category: 'martial', kind: 'ranged', damage: '1d10', damageType: 'piercing', heavy: true, twoHanded: true, loading: true, ammunition: { range: [100, 400], item: 'bolt' }, mastery: 'push' }),
  longbow: W({ id: 'longbow', name: 'Longbow', category: 'martial', kind: 'ranged', damage: '1d8', damageType: 'piercing', heavy: true, twoHanded: true, ammunition: { range: [150, 600], item: 'arrow' }, mastery: 'slow' }),
};

export interface Armor { id: string; name: string; type: 'light' | 'medium' | 'heavy'; base: number; dexMax?: number; strength?: number; stealthDisadvantage?: boolean }

/**
 * Armor a new character can start in. The pricier suits (breastplate, half plate, splint, plate)
 * aren't on the list: no class's starting equipment includes them. They'll turn up as loot.
 */
export const ARMOR: Record<string, Armor> = {
  padded: { id: 'padded', name: 'Padded Armor', type: 'light', base: 11, stealthDisadvantage: true },
  leather: { id: 'leather', name: 'Leather Armor', type: 'light', base: 11 },
  studdedLeather: { id: 'studdedLeather', name: 'Studded Leather Armor', type: 'light', base: 12 },
  hide: { id: 'hide', name: 'Hide Armor', type: 'medium', base: 12, dexMax: 2 },
  chainShirt: { id: 'chainShirt', name: 'Chain Shirt', type: 'medium', base: 13, dexMax: 2 },
  scaleMail: { id: 'scaleMail', name: 'Scale Mail', type: 'medium', base: 14, dexMax: 2, stealthDisadvantage: true },
  ringMail: { id: 'ringMail', name: 'Ring Mail', type: 'heavy', base: 14, dexMax: 0, stealthDisadvantage: true },
  chainMail: { id: 'chainMail', name: 'Chain Mail', type: 'heavy', base: 16, dexMax: 0, strength: 13, stealthDisadvantage: true },
};

function withBonus(d: DiceExpr, bonus: number): DiceExpr { return { terms: d.terms, bonus: d.bonus + bonus }; }

export interface WeaponAttackOpts {
  abilities: AbilityScores;
  pb: number;
  proficient?: boolean;
  /** The character has unlocked this weapon's mastery property. */
  mastery?: boolean;
  /** Extra damage bonus (e.g. Dueling fighting style). */
  damageBonus?: number;
  /** Extra attack-roll bonus (e.g. Archery fighting style on ranged weapons). */
  toHitBonus?: number;
  /** Wielded in two hands: a Versatile weapon uses its larger die. */
  twoHands?: boolean;
  /** Great Weapon Fighting: 1s and 2s on the damage dice count as 3s (two-handed / versatile in two hands). */
  greatWeaponFighting?: boolean;
  /** Two-Weapon Fighting: the off-hand attack adds the ability modifier too. */
  twoWeaponFighting?: boolean;
}

/** Turn a weapon into attack profiles: the melee/ranged use, plus a thrown use if it has one. */
export function weaponAttacks(w: Weapon, o: WeaponAttackOpts): AttackProfile[] {
  const str = abilityMod(o.abilities.str), dex = abilityMod(o.abilities.dex);
  const melee = w.kind === 'melee';
  const ability = w.finesse ? (dex > str ? 'dex' : 'str') : melee ? 'str' : 'dex';
  const mod = ability === 'dex' ? dex : str;
  const toHit = mod + (o.proficient === false ? 0 : o.pb) + (o.toHitBonus ?? 0);
  const twoHands = !!o.twoHands && !!w.versatile;
  const base = parseDice(twoHands ? w.versatile! : w.damage);
  const gwf = !!o.greatWeaponFighting && melee && (w.twoHanded || twoHands);
  const common = {
    damageType: w.damageType, ability, abilityMod: mod, toHit, weapon: true,
    mastery: o.mastery ? w.mastery : undefined, finesse: w.finesse, light: w.light, gwf: gwf || undefined,
  } as const;
  const out: AttackProfile[] = [];
  const dmg = withBonus(base, mod + (o.damageBonus ?? 0));
  const offhand = withBonus(base, o.twoWeaponFighting ? mod : Math.min(0, mod));
  const label = twoHands ? `${w.name} (two hands)` : w.name;
  if (melee) {
    out.push({ ...common, id: w.id, name: label, kind: 'melee', reach: w.reach ? 10 : 5, damage: dmg, offhandDamage: w.light ? offhand : undefined });
    if (w.thrown) {
      // a thrown weapon isn't wielded in two hands, and Dueling doesn't apply to ranged attacks
      const thrown = withBonus(parseDice(w.damage), mod);
      out.push({ ...common, gwf: undefined, id: `${w.id}-throw`, name: `${w.name} (thrown)`, kind: 'ranged', reach: 0, range: w.thrown, damage: thrown, offhandDamage: w.light ? offhand : undefined, consumes: w.id });
    }
  } else if (w.thrown) {
    out.push({ ...common, id: w.id, name: w.name, kind: 'ranged', reach: 0, range: w.thrown, damage: dmg, consumes: w.id });
  } else {
    out.push({ ...common, id: w.id, name: w.name, kind: 'ranged', reach: 0, range: w.ammunition!.range, damage: dmg, consumes: w.ammunition!.item });
  }
  return out;
}
