// Spells from the 2024 Player's Handbook (levels 0–2 so far), plus the Cleric's
// Channel Divinity options, which share the casting pipeline (they are Magic actions).
// Rider effects that don't fit the data fields are implemented in engine/spells.ts by id.
import type { SpellDef } from '../engine/types';

export const SPELLS = {
  // ------------------------------------------------------------ cantrips
  fireBolt: {
    id: 'fireBolt', name: 'Fire Bolt', level: 0, school: 'Evocation', time: 'action', range: 120,
    shape: { kind: 'single' }, affects: 'enemy', attack: 'ranged', damage: { dice: '1d10', type: 'fire' }, icon: 'fireBolt',
    description: 'Hurl a mote of fire: ranged spell attack, 1d10 Fire damage.',
  },
  rayOfFrost: {
    id: 'rayOfFrost', name: 'Ray of Frost', level: 0, school: 'Evocation', time: 'action', range: 60,
    shape: { kind: 'single' }, affects: 'enemy', attack: 'ranged', damage: { dice: '1d8', type: 'cold' }, icon: 'frost',
    description: 'Ranged spell attack, 1d8 Cold damage, and the target\'s Speed drops by 10 ft until the start of your next turn.',
  },
  shockingGrasp: {
    id: 'shockingGrasp', name: 'Shocking Grasp', level: 0, school: 'Evocation', time: 'action', range: 5,
    shape: { kind: 'single' }, affects: 'enemy', attack: 'melee', damage: { dice: '1d8', type: 'lightning' }, icon: 'shock',
    description: 'Melee spell attack, 1d8 Lightning damage, and the target can\'t take Reactions until the start of its next turn.',
  },
  sacredFlame: {
    id: 'sacredFlame', name: 'Sacred Flame', level: 0, school: 'Evocation', time: 'action', range: 60,
    shape: { kind: 'single' }, affects: 'enemy', save: 'dex', ignoresCover: true, damage: { dice: '1d8', type: 'radiant' }, icon: 'flame',
    description: 'Radiance descends on a creature: Dexterity save or 1d8 Radiant damage. Cover doesn\'t help it.',
  },
  tollTheDead: {
    id: 'tollTheDead', name: 'Toll the Dead', level: 0, school: 'Necromancy', time: 'action', range: 60,
    shape: { kind: 'single' }, affects: 'enemy', save: 'wis', damage: { dice: '1d8', type: 'necrotic' }, icon: 'bell',
    description: 'Wisdom save or 1d8 Necrotic damage — 1d12 if the target is missing any Hit Points.',
  },

  // ------------------------------------------------------------ 1st level
  magicMissile: {
    id: 'magicMissile', name: 'Magic Missile', level: 1, school: 'Evocation', time: 'action', range: 120,
    shape: { kind: 'multi', count: 3, perSlot: 1, repeat: true }, affects: 'enemy', damage: { dice: '1d4+1', type: 'force' }, icon: 'missile',
    description: 'Three glowing darts that always hit, 1d4+1 Force damage each. One more dart per slot level above 1st.',
  },
  shield: {
    id: 'shield', name: 'Shield', level: 1, school: 'Abjuration', time: 'reaction', range: 0,
    shape: { kind: 'self' }, affects: 'ally', icon: 'shieldSpell',
    description: 'Reaction when you are hit by an attack roll: +5 AC until the start of your next turn, including against the triggering attack.',
  },
  burningHands: {
    id: 'burningHands', name: 'Burning Hands', level: 1, school: 'Evocation', time: 'action', range: 0,
    shape: { kind: 'cone', length: 15 }, affects: 'any', save: 'dex', half: true, damage: { dice: '3d6', type: 'fire', upcast: '1d6' }, icon: 'cone',
    description: '15-ft Cone. Dexterity save: 3d6 Fire damage, half on a success. Hits allies too. +1d6 per slot level above 1st.',
  },
  sleep: {
    id: 'sleep', name: 'Sleep', level: 1, school: 'Enchantment', time: 'action', range: 60, concentration: true,
    shape: { kind: 'sphere', radius: 5 }, affects: 'enemy', save: 'wis', icon: 'sleep',
    description: 'Enemies in a 5-ft-radius Sphere make a Wisdom save or are Incapacitated until the end of their next turn, then save again or fall Unconscious. Damage or a shake from an ally wakes them. Concentration.',
  },
  guidingBolt: {
    id: 'guidingBolt', name: 'Guiding Bolt', level: 1, school: 'Evocation', time: 'action', range: 120,
    shape: { kind: 'single' }, affects: 'enemy', attack: 'ranged', damage: { dice: '4d6', type: 'radiant', upcast: '1d6' }, icon: 'bolt',
    description: 'Ranged spell attack, 4d6 Radiant damage, and the next attack roll against the target before the end of your next turn has Advantage. +1d6 per slot level above 1st.',
  },
  healingWord: {
    id: 'healingWord', name: 'Healing Word', level: 1, school: 'Abjuration', time: 'bonus', range: 60,
    shape: { kind: 'single' }, affects: 'ally', heal: { dice: '2d4', upcast: '2d4', addMod: true }, icon: 'word',
    description: 'Bonus Action: a creature you can see within 60 ft regains 2d4 + your spellcasting modifier HP. +2d4 per slot level above 1st.',
  },
  cureWounds: {
    id: 'cureWounds', name: 'Cure Wounds', level: 1, school: 'Abjuration', time: 'action', range: 5,
    shape: { kind: 'single' }, affects: 'ally', heal: { dice: '2d8', upcast: '2d8', addMod: true }, icon: 'cure',
    description: 'A creature you touch regains 2d8 + your spellcasting modifier HP. +2d8 per slot level above 1st.',
  },
  bless: {
    id: 'bless', name: 'Bless', level: 1, school: 'Enchantment', time: 'action', range: 30, concentration: true,
    shape: { kind: 'multi', count: 3, perSlot: 1, repeat: false }, affects: 'ally', icon: 'bless',
    description: 'Up to three creatures add 1d4 to their attack rolls and saving throws. One more target per slot level above 1st. Concentration.',
  },
  shieldOfFaith: {
    id: 'shieldOfFaith', name: 'Shield of Faith', level: 1, school: 'Abjuration', time: 'bonus', range: 60, concentration: true,
    shape: { kind: 'single' }, affects: 'ally', icon: 'faith',
    description: 'Bonus Action: a shimmering field gives a creature +2 AC. Concentration.',
  },
  inflictWounds: {
    id: 'inflictWounds', name: 'Inflict Wounds', level: 1, school: 'Necromancy', time: 'action', range: 5,
    shape: { kind: 'single' }, affects: 'enemy', save: 'con', half: true, damage: { dice: '2d10', type: 'necrotic', upcast: '1d10' }, icon: 'inflict',
    description: 'A creature you touch makes a Constitution save: 2d10 Necrotic damage, half on a success. +1d10 per slot level above 1st.',
  },

  // ------------------------------------------------------------ 2nd level
  scorchingRay: {
    id: 'scorchingRay', name: 'Scorching Ray', level: 2, school: 'Evocation', time: 'action', range: 120,
    shape: { kind: 'multi', count: 3, perSlot: 1, repeat: true }, affects: 'enemy', attack: 'ranged', damage: { dice: '2d6', type: 'fire' }, icon: 'rays',
    description: 'Three rays, each a ranged spell attack for 2d6 Fire damage. One more ray per slot level above 2nd.',
  },
  mistyStep: {
    id: 'mistyStep', name: 'Misty Step', level: 2, school: 'Conjuration', time: 'bonus', range: 30,
    shape: { kind: 'point' }, affects: 'ally', icon: 'misty',
    description: 'Bonus Action: teleport up to 30 ft to an unoccupied space you can see. Doesn\'t provoke Opportunity Attacks.',
  },
  spiritualWeapon: {
    id: 'spiritualWeapon', name: 'Spiritual Weapon', level: 2, school: 'Evocation', time: 'bonus', range: 60, concentration: true,
    shape: { kind: 'single' }, affects: 'enemy', attack: 'melee', damage: { dice: '1d8', type: 'force', upcast: '1d8', addMod: true }, icon: 'spiritual',
    description: 'Bonus Action: a floating spectral weapon appears next to a foe and strikes (melee spell attack, 1d8 + modifier Force). On later turns, a Bonus Action moves it 20 ft and strikes again. Concentration.',
  },
  aid: {
    id: 'aid', name: 'Aid', level: 2, school: 'Abjuration', time: 'action', range: 30,
    shape: { kind: 'multi', count: 3, perSlot: 0, repeat: false }, affects: 'ally', icon: 'aid',
    description: 'Up to three creatures gain 5 Hit Point maximum and current HP for 8 hours. +5 per slot level above 2nd.',
  },

  // ------------------------------------------------------------ Channel Divinity (Cleric)
  divineSpark: {
    id: 'divineSpark', name: 'Divine Spark', level: 0, school: 'Channel Divinity', time: 'action', range: 30, uses: 'channelDivinity',
    shape: { kind: 'single' }, affects: 'any', save: 'con', half: true, damage: { dice: '1d8', type: 'radiant', addMod: true }, heal: { dice: '1d8', addMod: true }, icon: 'spark',
    description: 'Channel Divinity: heal an ally 1d8 + WIS, or an enemy makes a Constitution save against 1d8 + WIS Radiant damage (half on a success).',
  },
  preserveLife: {
    id: 'preserveLife', name: 'Preserve Life', level: 0, school: 'Channel Divinity', time: 'action', range: 30, uses: 'channelDivinity',
    shape: { kind: 'emanation', radius: 30 }, affects: 'ally', icon: 'preserve',
    description: 'Channel Divinity: restore 5 × Cleric level HP, divided among Bloodied allies within 30 ft. Nobody goes above half their HP maximum.',
  },
} satisfies Record<string, SpellDef>;

export type SpellId = keyof typeof SPELLS;

/** Full-caster spell slots by class level (2024 Cleric / Wizard table). */
export function fullCasterSlots(level: number): number[] {
  const table: number[][] = [[], [0, 2], [0, 3], [0, 4, 2], [0, 4, 3], [0, 4, 3, 2]];
  return [...(table[Math.min(level, 5)] ?? [0])];
}
