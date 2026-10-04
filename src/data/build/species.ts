// Species from the 2024 Player's Handbook. `traits` is what the creator shows; `implemented`
// marks the ones the game already plays (the rest are listed honestly as not yet).
import type { DamageType, FeatureId, Size, Skill } from '../../engine/types';

export interface Trait { name: string; text: string; implemented: boolean }

export interface Lineage {
  id: string;
  name: string;
  blurb: string;
  /** A cantrip known from level 1 (cast with the species spellcasting ability). */
  cantrip?: string;
  resist?: DamageType[];
  speed?: number;
  darkvision?: number;
  /** Dragonborn: the breath and resistance damage type. */
  damageType?: DamageType;
  /** Goliath: the ancestry's feature. */
  feature?: FeatureId;
}

export interface SpeciesDef {
  id: string;
  name: string;
  blurb: string;
  sizes: Size[];
  speed: number;
  darkvision: number;
  features: FeatureId[];
  resist?: DamageType[];
  lineageLabel?: string;
  lineages?: Lineage[];
  /** A skill proficiency to choose (Keen Senses: from a list; Skillful: any). */
  skillChoice?: Skill[] | 'any';
  /** Human Versatile: an extra origin feat. */
  originFeat?: boolean;
  traits: Trait[];
  /** Figure proportions and default colouring for the creator. */
  look: { scale: [number, number, number]; skin: { hue: number; sat: number; light: number }; ears?: boolean; horns?: boolean; tail?: boolean };
}

const T = (name: string, text: string, implemented = true): Trait => ({ name, text, implemented });
const HUMAN_SKIN = { hue: 0.07, sat: 0.45, light: 1 };

export const SPECIES: SpeciesDef[] = [
  {
    id: 'aasimar', name: 'Aasimar', blurb: 'Mortals with a spark of the Upper Planes, touched by celestial light.',
    sizes: ['medium', 'small'], speed: 30, darkvision: 60, features: ['celestialResistance', 'healingHands', 'darkvision'], resist: ['necrotic', 'radiant'],
    traits: [
      T('Celestial Resistance', 'Resistance to Necrotic and Radiant damage.'),
      T('Darkvision', '60 ft.'),
      T('Healing Hands', 'Magic action, once per Long Rest: touch a creature and roll a number of d4s equal to your Proficiency Bonus; it regains that many HP.'),
      T('Light Bearer', 'You know the Light cantrip (Charisma).'),
      T('Celestial Revelation (level 3)', 'Transform for a minute: wings, inner radiance or a necrotic shroud.', false),
    ],
    look: { scale: [0.5, 0.52, 0.5], skin: { hue: 0.1, sat: 0.3, light: 1.1 } },
  },
  {
    id: 'dragonborn', name: 'Dragonborn', blurb: 'Draconic folk with a breath weapon and a dragon ancestor\'s resistance.',
    sizes: ['medium'], speed: 30, darkvision: 60, features: ['breathWeapon', 'darkvision'],
    lineageLabel: 'Draconic Ancestry',
    lineages: [
      { id: 'black', name: 'Black', blurb: 'Acid', damageType: 'acid' }, { id: 'blue', name: 'Blue', blurb: 'Lightning', damageType: 'lightning' },
      { id: 'brass', name: 'Brass', blurb: 'Fire', damageType: 'fire' }, { id: 'bronze', name: 'Bronze', blurb: 'Lightning', damageType: 'lightning' },
      { id: 'copper', name: 'Copper', blurb: 'Acid', damageType: 'acid' }, { id: 'gold', name: 'Gold', blurb: 'Fire', damageType: 'fire' },
      { id: 'green', name: 'Green', blurb: 'Poison', damageType: 'poison' }, { id: 'red', name: 'Red', blurb: 'Fire', damageType: 'fire' },
      { id: 'silver', name: 'Silver', blurb: 'Cold', damageType: 'cold' }, { id: 'white', name: 'White', blurb: 'Cold', damageType: 'cold' },
    ],
    traits: [
      T('Breath Weapon', 'Replace one attack with a 15-ft Cone or a 30-ft Line: Dexterity save (DC 8 + CON + PB), 1d10 damage of your ancestry\'s type, half on a success. Proficiency Bonus uses per Long Rest.'),
      T('Damage Resistance', 'Resistance to your ancestry\'s damage type.'),
      T('Darkvision', '60 ft.'),
      T('Draconic Flight (level 5)', 'Spectral wings for 10 minutes.', false),
    ],
    look: { scale: [0.52, 0.53, 0.52], skin: { hue: 0.0, sat: 0.55, light: 0.85 } },
  },
  {
    id: 'dwarf', name: 'Dwarf', blurb: 'Stout folk of stone and forge, hard to kill and harder to poison.',
    sizes: ['medium'], speed: 30, darkvision: 120, features: ['dwarvenResilience', 'dwarvenToughness', 'stonecunning', 'darkvision'], resist: ['poison'],
    traits: [
      T('Darkvision', '120 ft.'),
      T('Dwarven Resilience', 'Resistance to Poison damage, and Advantage on saves to avoid or end the Poisoned condition.'),
      T('Dwarven Toughness', 'Your Hit Point maximum increases by 1 per level.'),
      T('Stonecunning', 'Tremorsense for 10 minutes on stone (a Bonus Action, Proficiency Bonus times per Long Rest).', false),
    ],
    look: { scale: [0.56, 0.45, 0.56], skin: HUMAN_SKIN },
  },
  {
    id: 'elf', name: 'Elf', blurb: 'Long-lived folk of the Feywild who trance instead of sleeping.',
    sizes: ['medium'], speed: 30, darkvision: 60, features: ['feyAncestry', 'keenSenses', 'trance', 'darkvision'],
    skillChoice: ['insight', 'perception', 'survival'],
    lineageLabel: 'Elven Lineage',
    lineages: [
      { id: 'drow', name: 'Drow', blurb: 'Darkvision 120 ft; Dancing Lights (Faerie Fire at 3, Darkness at 5)', cantrip: 'dancingLights', darkvision: 120 },
      { id: 'high', name: 'High Elf', blurb: 'Prestidigitation (Detect Magic at 3, Misty Step at 5)', cantrip: 'prestidigitation' },
      { id: 'wood', name: 'Wood Elf', blurb: 'Speed 35 ft; Druidcraft (Longstrider at 3, Pass without Trace at 5)', cantrip: 'druidcraft', speed: 35 },
    ],
    traits: [
      T('Darkvision', '60 ft (120 ft for drow).'),
      T('Fey Ancestry', 'Advantage on saves against being Charmed.'),
      T('Keen Senses', 'Proficiency in Insight, Perception or Survival.'),
      T('Trance', 'You don\'t sleep, and magic can\'t put you to sleep.'),
      T('Lineage spells (level 3+)', 'Faerie Fire, Detect Magic or Longstrider at level 3.', false),
    ],
    look: { scale: [0.47, 0.52, 0.47], skin: { hue: 0.08, sat: 0.35, light: 1.05 }, ears: true },
  },
  {
    id: 'gnome', name: 'Gnome', blurb: 'Small, clever and curious, with a mind magic struggles to grip.',
    sizes: ['small'], speed: 30, darkvision: 60, features: ['gnomishCunning', 'darkvision'],
    lineageLabel: 'Gnomish Lineage',
    lineages: [
      { id: 'forest', name: 'Forest Gnome', blurb: 'Minor Illusion; Speak with Animals', cantrip: 'minorIllusion' },
      { id: 'rock', name: 'Rock Gnome', blurb: 'Mending and Prestidigitation; tinker clockwork devices', cantrip: 'mending' },
    ],
    traits: [
      T('Darkvision', '60 ft.'),
      T('Gnomish Cunning', 'Advantage on Intelligence, Wisdom and Charisma saving throws.'),
      T('Gnomish Lineage', 'A cantrip and a little more, out of combat.'),
    ],
    look: { scale: [0.4, 0.38, 0.4], skin: HUMAN_SKIN, ears: true },
  },
  {
    id: 'goliath', name: 'Goliath', blurb: 'Towering folk descended from giants, each carrying a gift of their giant ancestor.',
    sizes: ['medium'], speed: 35, darkvision: 0, features: [],
    lineageLabel: 'Giant Ancestry',
    lineages: [
      { id: 'cloud', name: 'Cloud\'s Jaunt', blurb: 'Bonus Action: teleport 30 ft', feature: 'cloudsJaunt' },
      { id: 'fire', name: 'Fire\'s Burn', blurb: 'On a hit: +1d10 Fire', feature: 'firesBurn' },
      { id: 'frost', name: 'Frost\'s Chill', blurb: 'On a hit: +1d6 Cold, Speed −10 ft', feature: 'frostsChill' },
      { id: 'hill', name: 'Hill\'s Tumble', blurb: 'On a hit: knock a Large or smaller target Prone', feature: 'hillsTumble' },
      { id: 'stone', name: 'Stone\'s Endurance', blurb: 'Reaction when damaged: reduce it by 1d12 + CON', feature: 'stonesEndurance' },
      { id: 'storm', name: 'Storm\'s Thunder', blurb: 'Reaction when damaged: 1d8 Thunder back at the attacker', feature: 'stormsThunder' },
    ],
    traits: [
      T('Giant Ancestry', 'One giant\'s gift, Proficiency Bonus uses per Long Rest. On-hit gifts are used on your hits automatically while uses last.'),
      T('Speed', '35 ft.'),
      T('Powerful Build', 'Advantage on checks to end being Grappled; you carry as if one size larger.', false),
      T('Large Form (level 5)', 'Become Large for 10 minutes.', false),
    ],
    look: { scale: [0.6, 0.6, 0.6], skin: { hue: 0.08, sat: 0.12, light: 0.9 } },
  },
  {
    id: 'halfling', name: 'Halfling', blurb: 'Small, quick and lucky, slipping past bigger folk.',
    sizes: ['small'], speed: 30, darkvision: 0, features: ['brave', 'halflingNimbleness', 'luck', 'naturallyStealthy'],
    traits: [
      T('Brave', 'Advantage on saves to avoid or end the Frightened condition.', false),
      T('Halfling Nimbleness', 'You can move through the space of any creature larger than you.'),
      T('Luck', 'Reroll a 1 on a d20 Test, once.'),
      T('Naturally Stealthy', 'You can Hide even when only a creature larger than you blocks the view.', false),
    ],
    look: { scale: [0.4, 0.4, 0.4], skin: HUMAN_SKIN },
  },
  {
    id: 'human', name: 'Human', blurb: 'Adaptable and ambitious; the most common folk of the multiverse.',
    sizes: ['medium', 'small'], speed: 30, darkvision: 0, features: ['heroicInspiration'], skillChoice: 'any', originFeat: true,
    traits: [
      T('Resourceful', 'Heroic Inspiration after every Long Rest: reroll any die once.', false),
      T('Skillful', 'Proficiency in one skill of your choice.'),
      T('Versatile', 'An extra origin feat of your choice.'),
    ],
    look: { scale: [0.5, 0.5, 0.5], skin: HUMAN_SKIN },
  },
  {
    id: 'orc', name: 'Orc', blurb: 'Tireless, fierce and hard to put down.',
    sizes: ['medium'], speed: 30, darkvision: 120, features: ['adrenalineRush', 'relentlessEndurance', 'darkvision'],
    traits: [
      T('Adrenaline Rush', 'Bonus Action: Dash and gain Temporary HP equal to your Proficiency Bonus. Proficiency Bonus uses per Short or Long Rest.'),
      T('Darkvision', '120 ft.'),
      T('Relentless Endurance', 'Once per Long Rest, when you drop to 0 HP but aren\'t killed outright, drop to 1 HP instead.'),
    ],
    look: { scale: [0.53, 0.52, 0.53], skin: { hue: 0.27, sat: 0.28, light: 0.8 } },
  },
  {
    id: 'tiefling', name: 'Tiefling', blurb: 'Bearing the mark of the Lower Planes: horns, a tail and a fiendish legacy.',
    sizes: ['medium', 'small'], speed: 30, darkvision: 60, features: ['darkvision'],
    lineageLabel: 'Fiendish Legacy',
    lineages: [
      { id: 'abyssal', name: 'Abyssal', blurb: 'Resist Poison; Poison Spray (Ray of Sickness at 3)', cantrip: 'poisonSpray', resist: ['poison'] },
      { id: 'chthonic', name: 'Chthonic', blurb: 'Resist Necrotic; Chill Touch (False Life at 3)', cantrip: 'chillTouch', resist: ['necrotic'] },
      { id: 'infernal', name: 'Infernal', blurb: 'Resist Fire; Fire Bolt (Hellish Rebuke at 3)', cantrip: 'fireBolt', resist: ['fire'] },
    ],
    traits: [
      T('Darkvision', '60 ft.'),
      T('Fiendish Legacy', 'A resistance and a cantrip (more spells at levels 3 and 5).'),
      T('Otherworldly Presence', 'You know Thaumaturgy.'),
      T('Legacy spells (level 3+)', 'Ray of Sickness, False Life or Hellish Rebuke at level 3.', false),
    ],
    look: { scale: [0.5, 0.5, 0.5], skin: { hue: 0.98, sat: 0.45, light: 0.85 }, horns: true, tail: true },
  },
];

export const speciesById = (id: string) => SPECIES.find((s) => s.id === id)!;
