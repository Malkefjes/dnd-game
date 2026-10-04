// Pre-built level 2 characters for Milestone 1, built by the 2024 PHB rules.
import { weaponAttacks, WEAPONS } from './weapons';
import { abilityMod, type CreatureDef } from '../engine/types';

/**
 * Torvald — Dwarf Fighter 2, Soldier background.
 * Standard array: STR 15+2, DEX 13, CON 14+1, INT 8, WIS 12, CHA 10.
 * HP: 10 + 6 (fixed L2) + 2×CON(+2) + Dwarven Toughness (+1/level) = 22.
 * AC: Chain Mail 16 + Shield 2 + Defense fighting style 1 = 19.
 * Weapon Mastery (3): Longsword (Sap), Javelin (Slow), Greatsword (Graze).
 * Origin feat (Soldier): Savage Attacker.
 */
export function torvald(): CreatureDef {
  const abilities = { str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 };
  const pb = 2;
  const con = abilityMod(abilities.con);
  return {
    id: 'torvald', name: 'Torvald', side: 'party', controller: 'player', size: 'medium', pc: true,
    description: 'Dwarf Fighter 2 (Soldier)',
    abilities, pb, level: 2,
    maxHp: 10 + 6 + 2 * con + 2,
    ac: 16 + 2 + 1,
    speed: 30,
    saveProfs: ['str', 'con'],
    skills: { athletics: abilityMod(17) + pb, perception: abilityMod(12) + pb, intimidation: abilityMod(10) + pb, stealth: abilityMod(13) },
    attacks: [
      ...weaponAttacks(WEAPONS.longsword, { abilities, pb, mastery: true }),
      ...weaponAttacks(WEAPONS.javelin, { abilities, pb, mastery: true }).filter((a) => a.kind === 'ranged'),
    ],
    attacksPerAction: 1,
    features: ['secondWind', 'actionSurge', 'tacticalMind', 'fightingStyleDefense', 'weaponMastery', 'savageAttacker', 'dwarvenResilience', 'darkvision'],
    resources: { secondWind: 2, actionSurge: 1 },
    inventory: { javelin: 6, potionOfHealing: 1 },
  };
}

/**
 * Nyx — Halfling Rogue 2, Criminal background.
 * Standard array: STR 8, DEX 15+2, CON 13+1, INT 14, WIS 12, CHA 10.
 * HP: 8 + 5 (fixed L2) + 2×CON(+2) = 17.  AC: Leather 11 + DEX 3 = 14.
 * Expertise: Stealth, Perception. Weapon Mastery (2): Shortsword (Vex), Shortbow (Vex).
 * Origin feat (Criminal): Alert (+PB to Initiative).
 */
export function nyx(): CreatureDef {
  const abilities = { str: 8, dex: 17, con: 14, int: 14, wis: 12, cha: 10 };
  const pb = 2;
  const dex = abilityMod(abilities.dex), wis = abilityMod(abilities.wis);
  const daggers = weaponAttacks(WEAPONS.dagger, { abilities, pb, mastery: false });
  return {
    id: 'nyx', name: 'Nyx', side: 'party', controller: 'player', size: 'small', pc: true,
    description: 'Halfling Rogue 2 (Criminal)',
    abilities, pb, level: 2, sneakAttackDice: 1,
    maxHp: 8 + 5 + 2 * abilityMod(abilities.con),
    ac: 11 + dex,
    speed: 30,
    saveProfs: ['dex', 'int'],
    skills: { stealth: dex + pb * 2, perception: wis + pb * 2, acrobatics: dex + pb, sleightOfHand: dex + pb, athletics: abilityMod(8) },
    attacks: [
      ...weaponAttacks(WEAPONS.shortsword, { abilities, pb, mastery: true }),
      ...daggers,
      ...weaponAttacks(WEAPONS.shortbow, { abilities, pb, mastery: true }),
    ],
    attacksPerAction: 1,
    features: ['sneakAttack', 'cunningAction', 'expertise', 'weaponMastery', 'alert', 'luck', 'brave', 'halflingNimbleness', 'naturallyStealthy'],
    inventory: { arrow: 20, dagger: 2, potionOfHealing: 1 },
  };
}
