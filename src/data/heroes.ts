// The ready-made heroes, as sets of creator choices built by the 2024 rules (levels 1–4, subclass at 3).
// They are the companions you meet in the abbey, and the party of the dev fights.
import type { CreatureDef } from '../engine/types';
import { buildCharacter, type Choices } from './build/builder';

export type Level = 1 | 2 | 3 | 4;

/**
 * Torvald — Dwarf Fighter, Soldier background. Champion at level 3.
 * Standard array: STR 15+2, DEX 13, CON 14+1, INT 8, WIS 12, CHA 10.
 * HP: d10 + CON (+2) + Dwarven Toughness (+1) per level → 13 / 22 / 31.
 * AC: Chain Mail 16 + Shield 2 + Defense fighting style 1 = 19.
 * Weapon Mastery (3): Longsword (Sap), Javelin (Slow), Greatsword (Graze).
 */
export const TORVALD: Choices = {
  id: 'torvald', name: 'Torvald', species: 'dwarf', cls: 'fighter', background: 'soldier',
  scoreMethod: 'standard', base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, boosts: { str: 2, con: 1 },
  skills: ['perception', 'survival'], fightingStyle: 'defense', masteries: ['longsword', 'javelin', 'greatsword', 'flail'],
  kit: 'swordAndShield', level4: { asi: { str: 2 } },
};

/**
 * Nyx — Halfling Rogue, Criminal background. Assassin at level 3.
 * Standard array: STR 8, DEX 15+2, CON 13+1, INT 14, WIS 12, CHA 10.
 * HP: d8 + CON (+2) per level → 10 / 17 / 24.  AC: Leather 11 + DEX 3 = 14.
 * Expertise: Stealth, Perception. Weapon Mastery (2): Shortsword (Vex), Shortbow (Vex).
 * Origin feat (Criminal): Alert (+PB to Initiative).
 */
export const NYX: Choices = {
  id: 'nyx', name: 'Nyx', species: 'halfling', size: 'small', cls: 'rogue', background: 'criminal',
  scoreMethod: 'standard', base: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 }, boosts: { dex: 2, con: 1 },
  skills: ['perception', 'acrobatics', 'investigation', 'insight'], expertise: ['stealth', 'perception'],
  masteries: ['shortsword', 'shortbow'], kit: 'rogue', level4: { asi: { dex: 2 } },
};

/**
 * Maren — Human Cleric, Farmer background. Divine Order: Protector. Life Domain at level 3.
 * Standard array: STR 14, DEX 10, CON 13+1, INT 8, WIS 15+2, CHA 12.
 * HP: d8 + CON (+2) + Tough (+2) per level → 12 / 21 / 30.
 * AC: Chain Mail 16 + Shield 2 = 18 (Protector grants Heavy armor training).
 * Origin feats: Tough (Farmer), Alert (Human Versatile).
 */
export const MAREN: Choices = {
  id: 'maren', name: 'Maren', species: 'human', speciesSkill: 'religion', versatileFeat: 'alert', cls: 'cleric', background: 'farmer',
  scoreMethod: 'standard', base: { str: 14, dex: 10, con: 13, int: 8, wis: 15, cha: 12 }, boosts: { wis: 2, con: 1 },
  skills: ['medicine', 'insight'], divineOrder: 'protector', kit: 'protector',
  cantrips: ['sacredFlame', 'tollTheDead', 'guidance', 'spareTheDying'],
  spells: ['bless', 'cureWounds', 'guidingBolt', 'healingWord', 'shieldOfFaith', 'inflictWounds', 'spiritualWeapon', 'protectionFromEvilAndGood'],
  level4: { asi: { wis: 2 } },
};

/**
 * Elowen — High Elf Wizard, Sage background. Evoker at level 3.
 * Standard array: STR 8, DEX 14, CON 13+1, INT 15+2, WIS 12, CHA 10.
 * HP: d6 + CON (+2) per level → 8 / 14 / 20.
 * AC: Mage Armor 13 + DEX 2 = 15. Her origin feat, Magic Initiate (Wizard), lets her cast Mage Armor
 * once per Long Rest without a slot; she casts it each morning, so it's always up.
 */
export const ELOWEN: Choices = {
  id: 'elowen', name: 'Elowen', species: 'elf', lineage: 'high', speciesSkill: 'perception', speciesAbility: 'int', cls: 'wizard', background: 'sage',
  scoreMethod: 'standard', base: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, boosts: { int: 2, con: 1 },
  skills: ['investigation', 'insight'], scholar: 'arcana', kit: 'wizard',
  feats: [{ cantrips: ['light', 'mageHand'], spell: 'mageArmor', ability: 'int' }],
  cantrips: ['fireBolt', 'rayOfFrost', 'shockingGrasp', 'chillTouch'],
  spells: ['magicMissile', 'shield', 'burningHands', 'sleep', 'scorchingRay', 'mistyStep', 'mageArmor', 'protectionFromEvilAndGood'],
  level4: { asi: { int: 2 } },
};

/** The ready-made heroes' choices by id. */
export const PRESET_CHOICES: Record<string, Choices> = { torvald: TORVALD, nyx: NYX, maren: MAREN, elowen: ELOWEN };

export const torvald = (level: Level = 3): CreatureDef => buildCharacter(TORVALD, level);
export const nyx = (level: Level = 3): CreatureDef => buildCharacter(NYX, level);
export const maren = (level: Level = 3): CreatureDef => buildCharacter(MAREN, level);
export const elowen = (level: Level = 3): CreatureDef => buildCharacter(ELOWEN, level);

export function party(level: Level = 3): CreatureDef[] { return [torvald(level), nyx(level), maren(level), elowen(level)]; }

/** The ready-made heroes by id. */
export const PRESETS: Record<string, (level?: Level) => CreatureDef> = { torvald, nyx, maren, elowen };
