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
