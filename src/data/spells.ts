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

  chillTouch: {
    id: 'chillTouch', name: 'Chill Touch', level: 0, school: 'Necromancy', time: 'action', range: 5,
    shape: { kind: 'single' }, affects: 'enemy', attack: 'melee', damage: { dice: '1d10', type: 'necrotic' }, icon: 'chill',
    description: 'Melee spell attack, 1d10 Necrotic damage, and the target can\'t regain Hit Points until the end of your next turn.',
  },
  poisonSpray: {
    id: 'poisonSpray', name: 'Poison Spray', level: 0, school: 'Necromancy', time: 'action', range: 30,
    shape: { kind: 'single' }, affects: 'enemy', attack: 'ranged', damage: { dice: '1d12', type: 'poison' }, icon: 'poison',
    description: 'Ranged spell attack, 1d12 Poison damage. (Most undead are immune to poison.)',
  },
  produceFlame: {
    id: 'produceFlame', name: 'Produce Flame', level: 0, school: 'Conjuration', time: 'action', range: 60,
    shape: { kind: 'single' }, affects: 'enemy', attack: 'ranged', damage: { dice: '1d8', type: 'fire' }, icon: 'fireBolt',
    description: 'Hurl the flame in your hand: ranged spell attack, 1d8 Fire damage. (You light the flame before a fight, as a Bonus Action; it lasts 10 minutes.)',
  },
  spareTheDying: {
    id: 'spareTheDying', name: 'Spare the Dying', level: 0, school: 'Necromancy', time: 'action', range: 15,
    shape: { kind: 'single' }, affects: 'ally', icon: 'help',
    description: 'A creature within 15 ft that has 0 Hit Points and isn\'t dead becomes Stable.',
  },
  // cantrips that do nothing in a fight yet: listed on the sheet, kept off the hotbar
  light: { id: 'light', name: 'Light', level: 0, school: 'Evocation', time: 'action', range: 5, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'spark', description: 'An object sheds Bright Light in a 20-foot radius for an hour.' },
  guidance: { id: 'guidance', name: 'Guidance', level: 0, school: 'Divination', time: 'action', range: 5, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'bless', description: 'An ally adds 1d4 to ability checks with one skill you choose. Concentration, 1 minute.' },
  thaumaturgy: { id: 'thaumaturgy', name: 'Thaumaturgy', level: 0, school: 'Transmutation', time: 'action', range: 30, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'spark', description: 'Minor wonders: a booming voice, flickering flames, trembling ground.' },
  prestidigitation: { id: 'prestidigitation', name: 'Prestidigitation', level: 0, school: 'Transmutation', time: 'action', range: 10, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'spark', description: 'Small magical tricks: clean, chill, warm, flavour, a harmless sensory effect.' },
  mageHand: { id: 'mageHand', name: 'Mage Hand', level: 0, school: 'Conjuration', time: 'action', range: 30, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'shove', description: 'A spectral hand that can manipulate objects up to 10 pounds within 30 ft.' },
  druidcraft: { id: 'druidcraft', name: 'Druidcraft', level: 0, school: 'Transmutation', time: 'action', range: 30, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'spark', description: 'Small nature effects: predict the weather, make a flower bloom, light or snuff a candle.' },
  dancingLights: { id: 'dancingLights', name: 'Dancing Lights', level: 0, school: 'Illusion', time: 'action', range: 120, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'spark', description: 'Up to four hovering lights. Concentration, 1 minute.' },
  minorIllusion: { id: 'minorIllusion', name: 'Minor Illusion', level: 0, school: 'Illusion', time: 'action', range: 30, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'misty', description: 'A sound or a still image of an object.' },
  mending: { id: 'mending', name: 'Mending', level: 0, school: 'Transmutation', time: 'action', range: 5, shape: { kind: 'self' }, affects: 'ally', utility: true, icon: 'cure', description: 'Repairs a single break or tear in an object.' },

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

  mageArmor: {
    id: 'mageArmor', name: 'Mage Armor', level: 1, school: 'Abjuration', time: 'action', range: 5, utility: true,
    shape: { kind: 'self' }, affects: 'ally', icon: 'faith',
    description: 'Base AC becomes 13 + DEX for 8 hours while you wear no armor. Cast each morning, so it\'s always up.',
  },
  divineSmite: {
    id: 'divineSmite', name: 'Divine Smite', level: 1, school: 'Evocation', time: 'onHit', range: 0,
    shape: { kind: 'self' }, affects: 'enemy', damage: { dice: '2d8', type: 'radiant', upcast: '1d8' }, icon: 'smite',
    description: 'Bonus Action right after you hit with a melee weapon or an Unarmed Strike: 2d8 extra Radiant damage, +1d8 against a Fiend or Undead. +1d8 per slot level above 1st. You\'ll be asked after each hit.',
  },
  divineFavor: {
    id: 'divineFavor', name: 'Divine Favor', level: 1, school: 'Transmutation', time: 'bonus', range: 0,
    shape: { kind: 'self' }, affects: 'ally', icon: 'favor',
    description: 'Bonus Action: for 1 minute your weapon attacks deal an extra 1d4 Radiant damage on a hit.',
  },
  heroism: {
    id: 'heroism', name: 'Heroism', level: 1, school: 'Enchantment', time: 'action', range: 5, concentration: true,
    shape: { kind: 'single' }, affects: 'ally', icon: 'heroism',
    description: 'A creature you touch is immune to the Frightened condition and gains Temporary Hit Points equal to your spellcasting modifier at the start of each of its turns. Concentration.',
  },
  protectionFromEvilAndGood: {
    id: 'protectionFromEvilAndGood', name: 'Protection from Evil and Good', level: 1, school: 'Abjuration', time: 'action', range: 5, concentration: true,
    shape: { kind: 'single' }, affects: 'ally', consumes: 'holyWater', icon: 'ward',
    description: 'A creature you touch is warded against Aberrations, Celestials, Elementals, Fey, Fiends and Undead: they have Disadvantage on attack rolls against it, and can\'t Charm, Frighten or possess it. Consumes a flask of Holy Water. Concentration.',
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

  // ------------------------------------------------------------ Paladin
  layOnHands: {
    id: 'layOnHands', name: 'Lay on Hands', level: 0, school: 'Paladin', time: 'bonus', range: 5, uses: 'layOnHands',
    shape: { kind: 'single' }, affects: 'ally', icon: 'hands',
    description: 'Bonus Action: touch a creature and restore Hit Points from your pool (5 × Paladin level, refilled by a Long Rest). As much as it needs, or what\'s left.',
  },
  sacredWeapon: {
    id: 'sacredWeapon', name: 'Sacred Weapon', level: 0, school: 'Channel Divinity', time: 'attack', range: 0, uses: 'channelDivinity',
    shape: { kind: 'self' }, affects: 'ally', icon: 'sacred',
    description: 'Channel Divinity, as you take the Attack action: for 10 minutes add your Charisma modifier (at least +1) to attack rolls with melee weapons, which can deal Radiant damage. Doesn\'t use up an attack.',
  },

  // ------------------------------------------------------------ species
  healingHands: {
    id: 'healingHands', name: 'Healing Hands', level: 0, school: 'Aasimar', time: 'action', range: 5, uses: 'healingHands',
    shape: { kind: 'single' }, affects: 'ally', heal: { dice: '2d4' }, icon: 'hands',
    description: 'Touch a creature: it regains a number of d4s equal to your Proficiency Bonus in Hit Points. Once per Long Rest.',
  },
  cloudsJaunt: {
    id: 'cloudsJaunt', name: 'Cloud\'s Jaunt', level: 0, school: 'Goliath', time: 'bonus', range: 30, uses: 'giantAncestry',
    shape: { kind: 'point' }, affects: 'ally', icon: 'misty',
    description: 'Bonus Action: teleport up to 30 ft to an unoccupied space you can see. Proficiency Bonus uses per Long Rest.',
  },
  adrenalineRush: {
    id: 'adrenalineRush', name: 'Adrenaline Rush', level: 0, school: 'Orc', time: 'bonus', range: 0, uses: 'adrenalineRush',
    shape: { kind: 'self' }, affects: 'ally', icon: 'dash',
    description: 'Bonus Action: Dash, and gain Temporary Hit Points equal to your Proficiency Bonus. Proficiency Bonus uses per Short or Long Rest.',
  },
  breathCone: {
    id: 'breathCone', name: 'Breath Weapon (cone)', level: 0, school: 'Dragonborn', time: 'attack', range: 0, uses: 'breathWeapon',
    shape: { kind: 'cone', length: 15 }, affects: 'any', save: 'dex', half: true, damage: { dice: '1d10', type: 'fire' }, icon: 'cone',
    description: 'Replaces one attack: a 15-ft Cone. Dexterity save (DC 8 + CON + PB), 1d10 damage of your ancestry\'s type, half on a success. Proficiency Bonus uses per Long Rest.',
  },
  breathLine: {
    id: 'breathLine', name: 'Breath Weapon (line)', level: 0, school: 'Dragonborn', time: 'attack', range: 0, uses: 'breathWeapon',
    shape: { kind: 'line', length: 30 }, affects: 'any', save: 'dex', half: true, damage: { dice: '1d10', type: 'fire' }, icon: 'line',
    description: 'Replaces one attack: a 30-ft by 5-ft Line. Dexterity save (DC 8 + CON + PB), 1d10 damage of your ancestry\'s type, half on a success. Proficiency Bonus uses per Long Rest.',
  },
} satisfies Record<string, SpellDef>;

export type SpellId = keyof typeof SPELLS;

/** Half-caster spell slots by class level (2024 Paladin table). */
export function halfCasterSlots(level: number): number[] {
  const table: number[][] = [[], [0, 2], [0, 2], [0, 3], [0, 3], [0, 4, 2]];
  return [...(table[Math.min(level, 5)] ?? [0])];
}

/** Full-caster spell slots by class level (2024 Cleric / Wizard table). */
export function fullCasterSlots(level: number): number[] {
  const table: number[][] = [[], [0, 2], [0, 3], [0, 4, 2], [0, 4, 3], [0, 4, 3, 2]];
  return [...(table[Math.min(level, 5)] ?? [0])];
}
