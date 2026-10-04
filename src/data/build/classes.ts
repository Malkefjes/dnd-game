// Classes from the 2024 Player's Handbook, levels 1–4 (the Hollow Abbey's cap), each with the one
// subclass the game has: Champion, Assassin, Life Domain, Evoker and Oath of Devotion.
import type { Ability, FeatureId, Skill } from '../../engine/types';

export type ClassId = 'fighter' | 'rogue' | 'cleric' | 'wizard' | 'paladin';
export type FightingStyle = 'archery' | 'defense' | 'dueling' | 'greatWeapon' | 'twoWeapon';

export const FIGHTING_STYLES: Record<FightingStyle, { name: string; feature: FeatureId; text: string }> = {
  archery: { name: 'Archery', feature: 'fightingStyleArchery', text: '+2 to attack rolls with Ranged weapons.' },
  defense: { name: 'Defense', feature: 'fightingStyleDefense', text: '+1 AC while you wear Light, Medium or Heavy armor.' },
  dueling: { name: 'Dueling', feature: 'fightingStyleDueling', text: '+2 damage with a Melee weapon held in one hand and no other weapon.' },
  greatWeapon: { name: 'Great Weapon Fighting', feature: 'fightingStyleGreatWeapon', text: 'With a Two-Handed or Versatile melee weapon held in two hands, treat any 1 or 2 on a damage die as a 3.' },
  twoWeapon: { name: 'Two-Weapon Fighting', feature: 'fightingStyleTwoWeapon', text: 'Add your ability modifier to the damage of the extra Light weapon attack.' },
};

/** A starting kit: one of the class's PHB equipment options, or what its gold option buys (noted as such). */
export interface Kit {
  id: string;
  name: string;
  text: string;
  armor?: string;
  shield?: boolean;
  /** Weapons carried; `thrownOnly` keeps just the thrown use (javelins next to a sword). */
  weapons: { id: string; thrownOnly?: boolean }[];
  inventory: Record<string, number>;
  /** Only for characters with this Divine Order (heavy armor needs Protector). */
  needs?: 'protector';
}

export interface Casting {
  ability: Ability;
  kind: 'full' | 'half';
  /** By level, index 1–4. */
  cantrips: number[];
  prepared: number[];
  cantripList: string[];
  /** The class's spell list (the spells the game has). */
  list: string[];
  /** Wizards prepare from a spellbook: 6 spells at level 1, 2 more each level. */
  spellbook?: boolean;
}

export interface ClassFeatureText { level: number; name: string; text: string; implemented: boolean }

export interface ClassDef {
  id: ClassId;
  name: string;
  blurb: string;
  hitDie: number;
  primary: Ability[];
  saves: [Ability, Ability];
  skillCount: number;
  skillList: Skill[];
  armor: ('light' | 'medium' | 'heavy')[];
  shields: boolean;
  /** Martial weapons: all, or (Rogue) only those with Finesse or Light. */
  martial: boolean | 'finesseOrLight';
  /** Weapon Mastery picks by level (index 1–4); 0 = none. */
  masteries: number[];
  /** Features gained at each level (index 1–4). */
  features: FeatureId[][];
  subclass: string;
  fightingStyleLevel?: number;
  casting?: Casting;
  kits: Kit[];
  model: string;
  /** What the creator shows for each level. */
  text: ClassFeatureText[];
}

const F = (level: number, name: string, text: string, implemented = true): ClassFeatureText => ({ level, name, text, implemented });

export const CLASSES: Record<ClassId, ClassDef> = {
  fighter: {
    id: 'fighter', name: 'Fighter', blurb: 'A master of arms and armor, hard to hurt and relentless in battle.', model: 'fighter',
    hitDie: 10, primary: ['str', 'dex'], saves: ['str', 'con'],
    skillCount: 2, skillList: ['acrobatics', 'animalHandling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'persuasion', 'survival'],
    armor: ['light', 'medium', 'heavy'], shields: true, martial: true,
    masteries: [0, 3, 3, 3, 4], fightingStyleLevel: 1, subclass: 'Champion',
    features: [[], ['secondWind', 'weaponMastery'], ['actionSurge', 'tacticalMind'], ['improvedCritical', 'remarkableAthlete'], []],
    kits: [
      { id: 'swordAndShield', name: 'Sword and shield', text: 'Chain Mail, Shield, Longsword, 6 Javelins (bought with the 155 GP option).', armor: 'chainMail', shield: true, weapons: [{ id: 'longsword' }, { id: 'javelin', thrownOnly: true }], inventory: { javelin: 6 } },
      { id: 'greatsword', name: 'Great weapon', text: 'Chain Mail, Greatsword, Flail, 8 Javelins (option A).', armor: 'chainMail', weapons: [{ id: 'greatsword' }, { id: 'flail' }, { id: 'javelin', thrownOnly: true }], inventory: { javelin: 8 } },
      { id: 'archer', name: 'Archer', text: 'Studded Leather, Scimitar, Shortsword, Longbow, 20 Arrows (option B).', armor: 'studdedLeather', weapons: [{ id: 'scimitar' }, { id: 'shortsword' }, { id: 'longbow' }], inventory: { arrow: 20 } },
    ],
    text: [
      F(1, 'Fighting Style', 'A fighting style feat of your choice.'),
      F(1, 'Second Wind', 'Bonus Action: regain 1d10 + Fighter level HP. Two uses (three at level 4), one back on a Short Rest.'),
      F(1, 'Weapon Mastery', 'Use the mastery property of three kinds of weapons (four at level 4).'),
      F(2, 'Action Surge', 'Once per Short Rest, take one additional action on your turn.'),
      F(2, 'Tactical Mind', 'Spend a Second Wind use to add 1d10 to a failed ability check.', false),
      F(3, 'Champion: Improved Critical', 'Your weapon attacks score a Critical Hit on a 19 or 20.'),
      F(3, 'Champion: Remarkable Athlete', 'Advantage on Initiative and Athletics checks.'),
      F(4, 'Ability Score Improvement', '+2 to one ability or +1 to two, or an origin feat.'),
    ],
  },
  rogue: {
    id: 'rogue', name: 'Rogue', blurb: 'A scoundrel who strikes where it hurts and slips away before the reply.', model: 'rogue',
    hitDie: 8, primary: ['dex'], saves: ['dex', 'int'],
    skillCount: 4, skillList: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'persuasion', 'sleightOfHand', 'stealth'],
    armor: ['light'], shields: false, martial: 'finesseOrLight',
    masteries: [0, 2, 2, 2, 2], subclass: 'Assassin',
    features: [[], ['sneakAttack', 'expertise', 'weaponMastery'], ['cunningAction'], ['steadyAim', 'assassinate'], []],
    kits: [
      { id: 'rogue', name: 'Rogue\'s kit', text: 'Leather Armor, 2 Daggers, Shortsword, Shortbow, 20 Arrows (option A).', armor: 'leather', weapons: [{ id: 'shortsword' }, { id: 'dagger' }, { id: 'shortbow' }], inventory: { arrow: 20, dagger: 2 } },
      { id: 'duelist', name: 'Duelist', text: 'Leather Armor, Rapier, Dagger, Shortbow, 20 Arrows (bought with the 100 GP option).', armor: 'leather', weapons: [{ id: 'rapier' }, { id: 'dagger' }, { id: 'shortbow' }], inventory: { arrow: 20, dagger: 1 } },
    ],
    text: [
      F(1, 'Expertise', 'Double your Proficiency Bonus for two skills you\'re proficient in.'),
      F(1, 'Sneak Attack', 'Once per turn, +1d6 damage (2d6 at level 3) with a Finesse or Ranged weapon if you have Advantage, or an ally is next to the target.'),
      F(1, 'Weapon Mastery', 'Use the mastery property of two kinds of weapons.'),
      F(2, 'Cunning Action', 'Bonus Action: Dash, Disengage or Hide.'),
      F(3, 'Steady Aim', 'Bonus Action, if you haven\'t moved: Advantage on your next attack this turn, and your Speed is 0.'),
      F(3, 'Assassin: Assassinate', 'Advantage on Initiative, and Advantage against anyone who hasn\'t had a turn yet in the first round (Sneak Attack adds your Rogue level).'),
      F(4, 'Ability Score Improvement', '+2 to one ability or +1 to two, or an origin feat.'),
    ],
  },
  cleric: {
    id: 'cleric', name: 'Cleric', blurb: 'A priestly champion who heals, protects and smites with divine power.', model: 'cleric',
    hitDie: 8, primary: ['wis'], saves: ['wis', 'cha'],
    skillCount: 2, skillList: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
    armor: ['light', 'medium'], shields: true, martial: false,
    masteries: [0, 0, 0, 0, 0], subclass: 'Life Domain',
    features: [[], ['spellcasting'], ['channelDivinity'], ['discipleOfLife'], []],
    casting: {
      ability: 'wis', kind: 'full', cantrips: [0, 3, 3, 3, 4], prepared: [0, 4, 5, 6, 7],
      cantripList: ['sacredFlame', 'tollTheDead', 'spareTheDying', 'guidance', 'light', 'thaumaturgy', 'mending'],
      list: ['bless', 'cureWounds', 'guidingBolt', 'healingWord', 'inflictWounds', 'shieldOfFaith', 'protectionFromEvilAndGood', 'aid', 'spiritualWeapon'],
    },
    kits: [
      { id: 'cleric', name: 'Priest\'s kit', text: 'Chain Shirt, Shield, Mace (option A).', armor: 'chainShirt', shield: true, weapons: [{ id: 'mace' }], inventory: {} },
      { id: 'holyWater', name: 'Priest with holy water', text: 'Chain Shirt, Shield, Mace and a flask of Holy Water (bought with the 110 GP option).', armor: 'chainShirt', shield: true, weapons: [{ id: 'mace' }], inventory: { holyWater: 1 } },
      { id: 'protector', name: 'Protector\'s mail', text: 'Chain Mail, Shield, Mace (bought with the 110 GP option; needs the Protector order).', armor: 'chainMail', shield: true, weapons: [{ id: 'mace' }], inventory: {}, needs: 'protector' },
    ],
    text: [
      F(1, 'Spellcasting', 'Wisdom-based divine spells, prepared each day from the Cleric list.'),
      F(1, 'Divine Order', 'Protector (martial weapons, Heavy armor) or Thaumaturge (an extra cantrip, + WIS to Arcana and Religion).'),
      F(2, 'Channel Divinity: Divine Spark', 'Heal 1d8 + WIS, or deal 1d8 + WIS Radiant damage (CON save for half). Two uses per Long Rest, one back on a Short Rest.'),
      F(2, 'Channel Divinity: Turn Undead', 'Undead within 30 ft make a WIS save or are Frightened and Incapacitated.', false),
      F(3, 'Life Domain: Disciple of Life', 'Healing spells restore 2 + the spell\'s level extra HP.'),
      F(3, 'Life Domain: Preserve Life', 'Channel Divinity: share 5 × Cleric level HP among Bloodied allies.'),
      F(3, 'Life Domain spells', 'Always prepared: Aid, Bless, Cure Wounds (Lesser Restoration isn\'t in the game yet).'),
      F(4, 'Ability Score Improvement', '+2 to one ability or +1 to two, or an origin feat.'),
    ],
  },
  wizard: {
    id: 'wizard', name: 'Wizard', blurb: 'A scholarly magic-user who bends reality with spells from a spellbook.', model: 'wizard',
    hitDie: 6, primary: ['int'], saves: ['int', 'wis'],
    skillCount: 2, skillList: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'nature', 'religion'],
    armor: [], shields: false, martial: false,
    masteries: [0, 0, 0, 0, 0], subclass: 'Evoker',
    features: [[], ['spellcasting'], [], ['potentCantrip'], []],
    casting: {
      ability: 'int', kind: 'full', cantrips: [0, 3, 3, 3, 4], prepared: [0, 4, 5, 6, 7], spellbook: true,
      cantripList: ['fireBolt', 'rayOfFrost', 'shockingGrasp', 'chillTouch', 'poisonSpray', 'light', 'mageHand', 'prestidigitation', 'minorIllusion', 'dancingLights', 'mending'],
      list: ['magicMissile', 'shield', 'burningHands', 'sleep', 'mageArmor', 'protectionFromEvilAndGood', 'scorchingRay', 'mistyStep'],
    },
    kits: [
      { id: 'wizard', name: 'Scholar\'s kit', text: '2 Daggers, a Quarterstaff (arcane focus), Robe, Spellbook (option A).', weapons: [{ id: 'quarterstaff' }, { id: 'dagger' }], inventory: { dagger: 2 } },
    ],
    text: [
      F(1, 'Spellcasting', 'Intelligence-based arcane spells, prepared from your spellbook (6 spells, 2 more each level).'),
      F(1, 'Arcane Recovery', 'Recover spell slots on a Short Rest.', false),
      F(1, 'Ritual Adept', 'Cast Ritual spells from your spellbook without preparing them.', false),
      F(2, 'Scholar', 'Expertise in Arcana, History, Investigation, Medicine, Nature or Religion.'),
      F(3, 'Evoker: Potent Cantrip', 'Your damaging cantrips deal half damage on a miss or a successful save.'),
      F(3, 'Evoker: Evocation Savant', 'Two extra Evocation spells in your spellbook.', false),
      F(4, 'Ability Score Improvement', '+2 to one ability or +1 to two, or an origin feat.'),
    ],
  },
  paladin: {
    id: 'paladin', name: 'Paladin', blurb: 'A holy warrior bound by an oath, healing with a touch and smiting the unholy.', model: 'fighter',
    hitDie: 10, primary: ['str', 'cha'], saves: ['wis', 'cha'],
    skillCount: 2, skillList: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
    armor: ['light', 'medium', 'heavy'], shields: true, martial: true,
    masteries: [0, 2, 2, 2, 2], fightingStyleLevel: 2, subclass: 'Oath of Devotion',
    features: [[], ['layOnHands', 'spellcasting', 'weaponMastery'], ['paladinsSmite'], ['channelDivinity', 'sacredWeapon'], []],
    casting: {
      ability: 'cha', kind: 'half', cantrips: [0, 0, 0, 0, 0], prepared: [0, 2, 3, 4, 5],
      cantripList: [],
      list: ['bless', 'cureWounds', 'divineFavor', 'heroism', 'protectionFromEvilAndGood', 'shieldOfFaith'],
    },
    kits: [
      { id: 'paladin', name: 'Paladin\'s kit', text: 'Chain Mail, Shield, Longsword, 6 Javelins (option A).', armor: 'chainMail', shield: true, weapons: [{ id: 'longsword' }, { id: 'javelin', thrownOnly: true }], inventory: { javelin: 6 } },
      { id: 'greatsword', name: 'Great weapon', text: 'Chain Mail, Greatsword and a flask of Holy Water (bought with the 150 GP option).', armor: 'chainMail', weapons: [{ id: 'greatsword' }], inventory: { holyWater: 1 } },
    ],
    text: [
      F(1, 'Lay on Hands', 'Bonus Action: restore HP from a pool of 5 × Paladin level.'),
      F(1, 'Spellcasting', 'Charisma-based divine spells (half caster).'),
      F(1, 'Weapon Mastery', 'Use the mastery property of two kinds of weapons.'),
      F(2, 'Fighting Style', 'A fighting style feat of your choice.'),
      F(2, 'Paladin\'s Smite', 'Divine Smite is always prepared, and once per Long Rest you can cast it without a slot.'),
      F(3, 'Channel Divinity', 'Two uses per Long Rest, one back on a Short Rest. (Divine Sense isn\'t in the game yet.)'),
      F(3, 'Oath of Devotion: Sacred Weapon', 'Channel Divinity as you attack: + CHA to melee weapon attack rolls for 10 minutes.'),
      F(3, 'Oath of Devotion spells', 'Always prepared: Protection from Evil and Good, Shield of Faith.'),
      F(4, 'Ability Score Improvement', '+2 to one ability or +1 to two, or an origin feat.'),
    ],
  },
};

/** Spells a subclass always has prepared, by the level they arrive. */
export const ALWAYS_PREPARED: Partial<Record<ClassId, { level: number; spells: string[] }[]>> = {
  cleric: [{ level: 3, spells: ['aid', 'bless', 'cureWounds'] }],
  paladin: [{ level: 2, spells: ['divineSmite'] }, { level: 3, spells: ['protectionFromEvilAndGood', 'shieldOfFaith'] }],
};

/** Class actions that share the casting pipeline (Channel Divinity options, Lay on Hands), by level. */
export const CLASS_ACTIONS: Partial<Record<ClassId, { level: number; spell: string }[]>> = {
  cleric: [{ level: 2, spell: 'divineSpark' }, { level: 3, spell: 'preserveLife' }],
  paladin: [{ level: 1, spell: 'layOnHands' }, { level: 3, spell: 'sacredWeapon' }],
};

/** Limited-use class resources at a level. */
export function classResources(cls: ClassId, level: number): Record<string, number> {
  switch (cls) {
    case 'fighter': return { secondWind: level >= 4 ? 3 : 2, ...(level >= 2 ? { actionSurge: 1 } : {}) };
    case 'cleric': return level >= 2 ? { channelDivinity: 2 } : {};
    case 'paladin': return { layOnHands: 5 * level, ...(level >= 2 ? { paladinsSmite: 1 } : {}), ...(level >= 3 ? { channelDivinity: 2 } : {}) };
    default: return {};
  }
}

/** Wizard Scholar's skills (level 2 expertise). */
export const SCHOLAR_SKILLS: Skill[] = ['arcana', 'history', 'investigation', 'medicine', 'nature', 'religion'];
