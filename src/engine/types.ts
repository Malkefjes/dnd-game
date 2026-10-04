import type { DiceExpr } from './dice';
import type { Pos } from './grid';

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export type AbilityScores = Record<Ability, number>;
export const abilityMod = (score: number) => Math.floor((score - 10) / 2);

export type Size = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export const SIZE_RANK: Record<Size, number> = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4, gargantuan: 5 };

export type DamageType = 'slashing' | 'piercing' | 'bludgeoning' | 'fire' | 'cold' | 'poison' | 'acid' | 'lightning' | 'thunder' | 'necrotic' | 'radiant' | 'force' | 'psychic';

export type Mastery = 'cleave' | 'graze' | 'nick' | 'push' | 'sap' | 'slow' | 'topple' | 'vex';

export type Skill = 'acrobatics' | 'athletics' | 'stealth' | 'perception' | 'medicine' | 'insight' | 'sleightOfHand' | 'survival' | 'intimidation';
export const SKILL_ABILITY: Record<Skill, Ability> = {
  acrobatics: 'dex', athletics: 'str', stealth: 'dex', perception: 'wis', medicine: 'wis', insight: 'wis', sleightOfHand: 'dex', survival: 'wis', intimidation: 'cha',
};

export type Side = 'party' | 'enemy';

/** A ready-to-use attack option: weapon attacks are resolved into these when a creature is built. */
export interface AttackProfile {
  id: string;
  name: string;
  kind: 'melee' | 'ranged';
  /** Melee reach in feet. */
  reach: number;
  /** Ranged: [normal, long] in feet. */
  range?: [number, number];
  toHit: number;
  /** Damage including the ability modifier. */
  damage: DiceExpr;
  /** Off-hand damage (Light weapon extra attack): no ability modifier unless negative. */
  offhandDamage?: DiceExpr;
  damageType: DamageType;
  ability: Ability;
  /** Ability modifier, used by Graze and mastery DCs. */
  abilityMod: number;
  mastery?: Mastery;
  finesse?: boolean;
  light?: boolean;
  /** Consumes one of this inventory item per attack (thrown weapon or ammunition). */
  consumes?: string;
  /** Goblin-style "plus 1d4 if the attack roll had Advantage". */
  bonusOnAdvantage?: DiceExpr;
  /** Extra damage of another type on a hit (Hobgoblin Longbow: + 3d4 Poison). */
  extraDamage?: { dice: DiceExpr; type: DamageType };
  /** Weapon attack (vs. a natural / special monster attack). */
  weapon: boolean;
  /** Spell attack: the spell's id. */
  spell?: string;
  /** Cantrip (Potent Cantrip applies). */
  cantrip?: boolean;
}

export type FeatureId =
  | 'secondWind' | 'actionSurge' | 'tacticalMind' | 'fightingStyleDefense' | 'weaponMastery'
  | 'sneakAttack' | 'cunningAction' | 'expertise'
  | 'savageAttacker' | 'alert' | 'luck' | 'brave' | 'halflingNimbleness' | 'naturallyStealthy' | 'dwarvenResilience' | 'darkvision'
  | 'nimbleEscape' | 'redirectAttack' | 'packTactics'
  // Milestone 2: casters and level 3 subclasses
  | 'spellcasting' | 'channelDivinity' | 'discipleOfLife' | 'potentCantrip' | 'tough' | 'feyAncestry' | 'keenSenses' | 'trance'
  | 'improvedCritical' | 'remarkableAthlete' | 'steadyAim' | 'assassinate';

export type ConditionId =
  | 'prone' | 'unconscious' | 'invisible' | 'hidden' | 'dodging' | 'disengaged'
  | 'sapped' | 'vexing' | 'slowed' | 'stable' | 'dead'
  | 'incapacitated' | 'blessed' | 'shieldOfFaith' | 'shielded' | 'guided' | 'chilled' | 'steadyAim' | 'aided';

export interface Expiry {
  /** Whose turn boundary ends this effect. */
  creature: string;
  when: 'start' | 'end';
  /** The effect ends at that creature's turn boundary once its turn count reaches this value. */
  turn: number;
}

export interface Condition {
  id: ConditionId;
  source?: string;
  /** Vex: the creature this advantage applies against. */
  against?: string;
  /** Hidden: the Stealth total enemies must beat to find you. */
  value?: number;
  expires?: Expiry;
  /** Sustained by this caster's concentration: ends when it does. */
  conc?: string;
  /** The spell that imposed it (Sleep tracks its two stages this way). */
  spell?: string;
}

export interface TurnState {
  actions: number;
  bonusActions: number;
  reaction: boolean;
  movement: number;
  /** Attacks left in the current Attack action (Extra Attack / Multiattack). */
  attacksLeft: number;
  /** Light weapon used in this turn's Attack action ('' if none); enables the off-hand attack. */
  lightWeapon: string;
  offhandUsed: boolean;
  nickUsed: boolean;
  dashed: number;
  /** Moved at least one square this turn (Steady Aim). */
  moved: boolean;
}

// ---------------------------------------------------------------- spells

export type SpellShape =
  /** One creature. */
  | { kind: 'single' }
  /** Several targets: darts/rays may repeat a target, Bless-style picks are distinct. */
  | { kind: 'multi'; count: number; perSlot: number; repeat: boolean }
  /** Centred on a square within range; squares within `radius` ft by grid distance. */
  | { kind: 'sphere'; radius: number }
  /** From the caster towards a square. */
  | { kind: 'cone'; length: number }
  /** An unoccupied square you can see (Misty Step). */
  | { kind: 'point' }
  | { kind: 'self' }
  /** Everyone of yours within `radius` ft of you (Preserve Life). */
  | { kind: 'emanation'; radius: number };

export interface SpellDef {
  id: string;
  name: string;
  /** 0 = cantrip (or a Channel Divinity option when `uses` is set). */
  level: number;
  school: string;
  time: 'action' | 'bonus' | 'reaction';
  /** Feet. 0 = self, 5 = touch. */
  range: number;
  shape: SpellShape;
  /** Who it can target / who an area harms. */
  affects: 'enemy' | 'ally' | 'any';
  concentration?: boolean;
  attack?: 'melee' | 'ranged';
  save?: Ability;
  /** Half damage on a successful save. */
  half?: boolean;
  /** Ignores Half and Three-Quarters Cover (Sacred Flame). */
  ignoresCover?: boolean;
  damage?: { dice: string; type: DamageType; upcast?: string; addMod?: boolean };
  heal?: { dice: string; upcast?: string; addMod?: boolean };
  /** Spends this resource instead of a spell slot (Channel Divinity). */
  uses?: string;
  description: string;
  icon: string;
}

export interface Spellcasting {
  ability: Ability;
  /** Spell save DC and spell attack bonus. */
  dc: number;
  attack: number;
  /** Spell slots by level: slots[1] = 1st-level slots. */
  slots: number[];
  /** Prepared spells and cantrips (plus Channel Divinity options), in hotbar order. */
  spells: SpellDef[];
}

export interface CreatureDef {
  id: string;
  name: string;
  side: Side;
  controller: 'player' | 'ai';
  size: Size;
  abilities: AbilityScores;
  pb: number;
  maxHp: number;
  ac: number;
  speed: number;
  saveProfs: Ability[];
  skills: Partial<Record<Skill, number>>;
  attacks: AttackProfile[];
  /** How many attacks one Attack action grants (Extra Attack / Multiattack). */
  attacksPerAction: number;
  features: FeatureId[];
  resources?: Record<string, number>;
  inventory?: Record<string, number>;
  /** Class level for scaling features (Second Wind, Sneak Attack). */
  level?: number;
  sneakAttackDice?: number;
  cr?: string;
  xp?: number;
  /** Player characters roll death saves; monsters die at 0 HP. */
  pc: boolean;
  description?: string;
  /** Which 3D model the renderer uses. */
  model?: string;
  spellcasting?: Spellcasting;
  /** Creature type, for spells like Sleep (elves) or Hold Person (humanoids). */
  type?: string;
}

export interface Creature extends CreatureDef {
  hp: number;
  pos: Pos;
  initiative: number;
  conditions: Condition[];
  turn: TurnState;
  /** Number of turns this creature has started (for effect expiry). */
  turnsStarted: number;
  resourcesLeft: Record<string, number>;
  inv: Record<string, number>;
  deathSaves: { success: number; fail: number };
  /** Spell slots left, by level. */
  slotsLeft: number[];
  /** The concentration spell this creature is maintaining. */
  concentration: string | null;
}

/** A spell effect with a position on the map (Spiritual Weapon). Not a creature: it doesn't block movement. */
export interface Summon {
  id: string;
  kind: 'spiritualWeapon';
  owner: string;
  pos: Pos;
  /** Slot level it was cast with (damage scaling). */
  slot: number;
}
