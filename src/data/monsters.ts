// Monsters from the 2025 Monster Manual / SRD 5.2 stat blocks.
import { parseDice } from '../engine/dice';
import type { AttackProfile, CreatureDef } from '../engine/types';

const scimitar = (toHit = 4): AttackProfile => ({
  id: 'scimitar', name: 'Scimitar', kind: 'melee', reach: 5, toHit, damage: parseDice('1d6+2'), damageType: 'slashing',
  ability: 'dex', abilityMod: 2, finesse: true, light: true, weapon: true, bonusOnAdvantage: parseDice('1d4'),
});
const shortbow = (toHit = 4): AttackProfile => ({
  id: 'shortbow', name: 'Shortbow', kind: 'ranged', reach: 0, range: [80, 320], toHit, damage: parseDice('1d6+2'), damageType: 'piercing',
  ability: 'dex', abilityMod: 2, weapon: true, bonusOnAdvantage: parseDice('1d4'),
});

const GOBLIN_ABILITIES = { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 };

/** Goblin Warrior — Small Fey (Goblinoid), CR 1/4. */
export function goblinWarrior(id: string, name = 'Goblin Warrior'): CreatureDef {
  return {
    id, name, side: 'enemy', controller: 'ai', size: 'small', pc: false, cr: '1/4', xp: 50, model: 'goblin',
    abilities: GOBLIN_ABILITIES, pb: 2, maxHp: 10, ac: 15, speed: 30,
    saveProfs: [], skills: { stealth: 6, perception: -1 },
    attacks: [scimitar(), shortbow()], attacksPerAction: 1,
    features: ['nimbleEscape', 'darkvision'],
    description: 'Scimitar or Shortbow, +1d4 damage when attacking with Advantage. Nimble Escape: Disengage or Hide as a Bonus Action.',
  };
}

/** Goblin Minion — Small Fey (Goblinoid), CR 1/8. */
export function goblinMinion(id: string, name = 'Goblin Minion'): CreatureDef {
  const dagger: AttackProfile = { id: 'dagger', name: 'Dagger', kind: 'melee', reach: 5, toHit: 4, damage: parseDice('1d4+2'), damageType: 'piercing', ability: 'dex', abilityMod: 2, finesse: true, light: true, weapon: true };
  const thrown: AttackProfile = { ...dagger, id: 'dagger-throw', name: 'Dagger (thrown)', kind: 'ranged', reach: 0, range: [20, 60], consumes: 'dagger' };
  return {
    id, name, side: 'enemy', controller: 'ai', size: 'small', pc: false, cr: '1/8', xp: 25, model: 'goblin',
    abilities: GOBLIN_ABILITIES, pb: 2, maxHp: 7, ac: 12, speed: 30,
    saveProfs: [], skills: { stealth: 6, perception: -1 },
    attacks: [dagger, thrown], attacksPerAction: 1, inventory: { dagger: 3 },
    features: ['nimbleEscape', 'darkvision'],
    description: 'Dagger. Nimble Escape: Disengage or Hide as a Bonus Action.',
  };
}

/** Hobgoblin Warrior — Medium Fey (Goblinoid), CR 1/2. Half plate and shield; Pack Tactics. */
export function hobgoblinWarrior(id: string, name = 'Hobgoblin Warrior'): CreatureDef {
  const longsword: AttackProfile = { id: 'longsword', name: 'Longsword', kind: 'melee', reach: 5, toHit: 3, damage: parseDice('2d10+1'), damageType: 'slashing', ability: 'str', abilityMod: 1, weapon: true };
  const longbow: AttackProfile = {
    id: 'longbow', name: 'Longbow', kind: 'ranged', reach: 0, range: [150, 600], toHit: 3, damage: parseDice('1d8+1'), damageType: 'piercing',
    ability: 'dex', abilityMod: 1, weapon: true, extraDamage: { dice: parseDice('3d4'), type: 'poison' },
  };
  return {
    id, name, side: 'enemy', controller: 'ai', size: 'medium', pc: false, cr: '1/2', xp: 100, model: 'hobgoblin', type: 'fey',
    abilities: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 9 }, pb: 2, maxHp: 11, ac: 18, speed: 30,
    saveProfs: [], skills: { perception: 0 },
    attacks: [longsword, longbow], attacksPerAction: 1,
    features: ['packTactics', 'darkvision'],
    description: 'Longsword 2d10+1, or Longbow 1d8+1 plus 3d4 Poison. Pack Tactics: Advantage when an ally is next to the target.',
  };
}

/** Goblin Boss — Small Fey (Goblinoid), CR 1. Multiattack: two Scimitar/Shortbow attacks. */
export function goblinBoss(id: string, name = 'Goblin Boss'): CreatureDef {
  return {
    id, name, side: 'enemy', controller: 'ai', size: 'small', pc: false, cr: '1', xp: 200, model: 'goblinBoss',
    abilities: { ...GOBLIN_ABILITIES, str: 10, cha: 10 }, pb: 2, maxHp: 21, ac: 17, speed: 30,
    saveProfs: [], skills: { stealth: 6, perception: -1 },
    attacks: [scimitar(), shortbow()], attacksPerAction: 2,
    features: ['nimbleEscape', 'redirectAttack', 'darkvision'],
    description: 'Multiattack (2). Redirect Attack: when attacked, swaps places with an adjacent Small or Medium ally, who becomes the target.',
  };
}

// ---------------------------------------------------------------- undead (Milestone 3)

/** Skeleton — Medium Undead, CR 1/4 (2025 MM / SRD 5.2). Vulnerable to Bludgeoning; immune to Poison. */
export function skeleton(id: string, name = 'Skeleton'): CreatureDef {
  const common = { ability: 'dex', abilityMod: 3, toHit: 5, damage: parseDice('1d6+3'), damageType: 'piercing', weapon: true } as const;
  return {
    id, name, side: 'enemy', controller: 'ai', size: 'medium', pc: false, cr: '1/4', xp: 50, model: 'skeleton', type: 'undead',
    abilities: { str: 10, dex: 16, con: 15, int: 6, wis: 8, cha: 5 }, pb: 2, maxHp: 13, ac: 14, speed: 30,
    saveProfs: [], skills: { perception: -1 },
    attacks: [
      { ...common, id: 'shortsword', name: 'Shortsword', kind: 'melee', reach: 5, finesse: true, light: true },
      { ...common, id: 'shortbow', name: 'Shortbow', kind: 'ranged', reach: 0, range: [80, 320] },
    ],
    attacksPerAction: 1,
    features: ['darkvision'],
    vulnerable: ['bludgeoning'], immune: ['poison'], conditionImmune: ['poisoned', 'exhaustion'],
    description: 'Shortsword or Shortbow. Vulnerable to Bludgeoning damage; immune to Poison.',
  };
}

/** Zombie — Medium Undead, CR 1/4 (2025 MM / SRD 5.2). Undead Fortitude. */
export function zombie(id: string, name = 'Zombie'): CreatureDef {
  return {
    id, name, side: 'enemy', controller: 'ai', size: 'medium', pc: false, cr: '1/4', xp: 50, model: 'zombie', type: 'undead',
    abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 }, pb: 2, maxHp: 15, ac: 8, speed: 20,
    saveProfs: ['wis'], skills: { perception: -2 }, // WIS save +0
    attacks: [{ id: 'slam', name: 'Slam', kind: 'melee', reach: 5, toHit: 3, damage: parseDice('1d8+1'), damageType: 'bludgeoning', ability: 'str', abilityMod: 1, weapon: false }],
    attacksPerAction: 1,
    features: ['undeadFortitude', 'darkvision'],
    immune: ['poison'], conditionImmune: ['poisoned', 'exhaustion'],
    description: 'Slam. Undead Fortitude: dropping to 0 HP, it may stay up at 1 HP (CON save) unless the damage was Radiant or a critical hit.',
  };
}

/** Every monster by name, for maps to place. */
export const MONSTERS: Record<string, (id: string, name?: string) => CreatureDef> = {
  skeleton, zombie, goblinWarrior, goblinMinion, goblinBoss, hobgoblinWarrior,
};
