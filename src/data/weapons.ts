// Weapons from the 2024 Player's Handbook (subset used so far).
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
  /** Thrown range [normal, long] in feet. */
  thrown?: [number, number];
  /** Ammunition range [normal, long] in feet and the ammo item. */
  ammunition?: { range: [number, number]; item: string };
  mastery: Mastery;
}

export const WEAPONS: Record<string, Weapon> = {
  dagger: { id: 'dagger', name: 'Dagger', category: 'simple', kind: 'melee', damage: '1d4', damageType: 'piercing', finesse: true, light: true, thrown: [20, 60], mastery: 'nick' },
  javelin: { id: 'javelin', name: 'Javelin', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'piercing', thrown: [30, 120], mastery: 'slow' },
  handaxe: { id: 'handaxe', name: 'Handaxe', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'slashing', light: true, thrown: [20, 60], mastery: 'vex' },
  mace: { id: 'mace', name: 'Mace', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'bludgeoning', mastery: 'sap' },
  quarterstaff: { id: 'quarterstaff', name: 'Quarterstaff', category: 'simple', kind: 'melee', damage: '1d6', damageType: 'bludgeoning', versatile: '1d8', mastery: 'topple' },
  shortbow: { id: 'shortbow', name: 'Shortbow', category: 'simple', kind: 'ranged', damage: '1d6', damageType: 'piercing', twoHanded: true, ammunition: { range: [80, 320], item: 'arrow' }, mastery: 'vex' },
  longsword: { id: 'longsword', name: 'Longsword', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'slashing', versatile: '1d10', mastery: 'sap' },
  shortsword: { id: 'shortsword', name: 'Shortsword', category: 'martial', kind: 'melee', damage: '1d6', damageType: 'piercing', finesse: true, light: true, mastery: 'vex' },
  scimitar: { id: 'scimitar', name: 'Scimitar', category: 'martial', kind: 'melee', damage: '1d6', damageType: 'slashing', finesse: true, light: true, mastery: 'nick' },
  rapier: { id: 'rapier', name: 'Rapier', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'piercing', finesse: true, mastery: 'vex' },
  greatsword: { id: 'greatsword', name: 'Greatsword', category: 'martial', kind: 'melee', damage: '2d6', damageType: 'slashing', heavy: true, twoHanded: true, mastery: 'graze' },
  warhammer: { id: 'warhammer', name: 'Warhammer', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'bludgeoning', versatile: '1d10', mastery: 'push' },
  battleaxe: { id: 'battleaxe', name: 'Battleaxe', category: 'martial', kind: 'melee', damage: '1d8', damageType: 'slashing', versatile: '1d10', mastery: 'topple' },
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
}

/** Turn a weapon into attack profiles: the melee/ranged use, plus a thrown use if it has one. */
export function weaponAttacks(w: Weapon, o: WeaponAttackOpts): AttackProfile[] {
  const str = abilityMod(o.abilities.str), dex = abilityMod(o.abilities.dex);
  const melee = w.kind === 'melee';
  const ability = w.finesse ? (dex > str ? 'dex' : 'str') : melee ? 'str' : 'dex';
  const mod = ability === 'dex' ? dex : str;
  const toHit = mod + (o.proficient === false ? 0 : o.pb);
  const base = parseDice(w.damage);
  const common = {
    damageType: w.damageType, ability, abilityMod: mod, toHit, weapon: true,
    mastery: o.mastery ? w.mastery : undefined, finesse: w.finesse, light: w.light,
  } as const;
  const out: AttackProfile[] = [];
  const dmg = withBonus(base, mod + (o.damageBonus ?? 0));
  const offhand = withBonus(base, Math.min(0, mod));
  if (melee) {
    out.push({ ...common, id: w.id, name: w.name, kind: 'melee', reach: w.reach ? 10 : 5, damage: dmg, offhandDamage: w.light ? offhand : undefined });
    if (w.thrown) {
      out.push({ ...common, id: `${w.id}-throw`, name: `${w.name} (thrown)`, kind: 'ranged', reach: 0, range: w.thrown, damage: dmg, offhandDamage: w.light ? offhand : undefined, consumes: w.id });
    }
  } else {
    out.push({ ...common, id: w.id, name: w.name, kind: 'ranged', reach: 0, range: w.ammunition!.range, damage: dmg, consumes: w.ammunition!.item });
  }
  return out;
}
