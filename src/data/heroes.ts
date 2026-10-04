// Pre-built characters, built by the 2024 PHB rules at levels 1–3 (subclass at 3).
import { weaponAttacks, WEAPONS } from './weapons';
import { SPELLS, fullCasterSlots } from './spells';
import { abilityMod, type CreatureDef, type FeatureId, type SpellDef } from '../engine/types';

export type Level = 1 | 2 | 3;

/** Features gained at each level, accumulated up to `level`. */
function upTo(level: Level, byLevel: Record<Level, FeatureId[]>): FeatureId[] {
  return ([1, 2, 3] as Level[]).filter((l) => l <= level).flatMap((l) => byLevel[l]);
}

/** HP: max hit die at level 1, then the fixed value per level, plus CON (and per-level bonuses) each level. */
function hitPoints(level: Level, die: number, perLevel: number): number {
  return die + (level - 1) * (die / 2 + 1) + level * perLevel;
}

/**
 * Torvald — Dwarf Fighter, Soldier background. Champion at level 3.
 * Standard array: STR 15+2, DEX 13, CON 14+1, INT 8, WIS 12, CHA 10.
 * HP: d10 + CON (+2) + Dwarven Toughness (+1) per level → 13 / 22 / 31.
 * AC: Chain Mail 16 + Shield 2 + Defense fighting style 1 = 19.
 * Weapon Mastery (3): Longsword (Sap), Javelin (Slow), Greatsword (Graze).
 * Origin feat (Soldier): Savage Attacker.
 */
export function torvald(level: Level = 3): CreatureDef {
  const abilities = { str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 };
  const pb = 2;
  return {
    id: 'torvald', name: 'Torvald', side: 'party', controller: 'player', size: 'medium', pc: true,
    description: `Dwarf Fighter ${level}${level >= 3 ? ' (Champion)' : ''}`, model: 'fighter', type: 'humanoid',
    abilities, pb, level,
    maxHp: hitPoints(level, 10, abilityMod(abilities.con) + 1),
    ac: 16 + 2 + 1,
    speed: 30,
    saveProfs: ['str', 'con'],
    skills: { athletics: abilityMod(17) + pb, perception: abilityMod(12) + pb, intimidation: abilityMod(10) + pb, stealth: abilityMod(13) },
    attacks: [
      ...weaponAttacks(WEAPONS.longsword, { abilities, pb, mastery: true }),
      ...weaponAttacks(WEAPONS.javelin, { abilities, pb, mastery: true }).filter((a) => a.kind === 'ranged'),
    ],
    attacksPerAction: 1,
    features: [
      'savageAttacker', 'dwarvenResilience', 'darkvision',
      ...upTo(level, { 1: ['secondWind', 'fightingStyleDefense', 'weaponMastery'], 2: ['actionSurge', 'tacticalMind'], 3: ['improvedCritical', 'remarkableAthlete'] }),
    ],
    resources: { secondWind: 2, ...(level >= 2 ? { actionSurge: 1 } : {}) },
    inventory: { javelin: 6, potionOfHealing: 1 },
  };
}

/**
 * Nyx — Halfling Rogue, Criminal background. Assassin at level 3.
 * Standard array: STR 8, DEX 15+2, CON 13+1, INT 14, WIS 12, CHA 10.
 * HP: d8 + CON (+2) per level → 10 / 17 / 24.  AC: Leather 11 + DEX 3 = 14.
 * Expertise: Stealth, Perception. Weapon Mastery (2): Shortsword (Vex), Shortbow (Vex).
 * Origin feat (Criminal): Alert (+PB to Initiative).
 */
export function nyx(level: Level = 3): CreatureDef {
  const abilities = { str: 8, dex: 17, con: 14, int: 14, wis: 12, cha: 10 };
  const pb = 2;
  const dex = abilityMod(abilities.dex), wis = abilityMod(abilities.wis);
  const daggers = weaponAttacks(WEAPONS.dagger, { abilities, pb, mastery: false });
  return {
    id: 'nyx', name: 'Nyx', side: 'party', controller: 'player', size: 'small', pc: true,
    description: `Halfling Rogue ${level}${level >= 3 ? ' (Assassin)' : ''}`, model: 'rogue', type: 'humanoid',
    abilities, pb, level, sneakAttackDice: Math.ceil(level / 2),
    maxHp: hitPoints(level, 8, abilityMod(abilities.con)),
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
    features: [
      'alert', 'luck', 'brave', 'halflingNimbleness', 'naturallyStealthy',
      ...upTo(level, { 1: ['sneakAttack', 'expertise', 'weaponMastery'], 2: ['cunningAction'], 3: ['steadyAim', 'assassinate'] }),
    ],
    inventory: { arrow: 20, dagger: 2, potionOfHealing: 1 },
  };
}

/**
 * Maren — Human Cleric, Farmer background. Divine Order: Protector. Life Domain at level 3.
 * Standard array: STR 14, DEX 10, CON 13+1, INT 8, WIS 15+2, CHA 12.
 * HP: d8 + CON (+2) + Tough (+2) per level → 12 / 21 / 30.
 * AC: Chain Mail 16 + Shield 2 = 18 (Protector grants Heavy armor training).
 * Origin feats: Tough (Farmer), Alert (Human Versatile).
 * Cantrips: Sacred Flame, Toll the Dead (and Guidance, which has no use in a fight).
 * Not modelled: Human Resourceful (Heroic Inspiration), Turn Undead (no undead yet).
 */
export function maren(level: Level = 3): CreatureDef {
  const abilities = { str: 14, dex: 10, con: 14, int: 8, wis: 17, cha: 12 };
  const pb = 2;
  const wis = abilityMod(abilities.wis);
  const S = SPELLS;
  const spells: SpellDef[] = [
    S.sacredFlame, S.tollTheDead,
    // Life Domain spells are always prepared from level 3 (Aid, Bless, Cure Wounds, Lesser Restoration)
    S.bless, S.cureWounds, S.guidingBolt, S.healingWord,
    ...(level >= 2 ? [S.shieldOfFaith] : []),
    ...(level >= 3 ? [S.inflictWounds, S.aid, S.spiritualWeapon] : []),
    ...(level >= 2 ? [S.divineSpark] : []),
    ...(level >= 3 ? [S.preserveLife] : []),
  ];
  return {
    id: 'maren', name: 'Maren', side: 'party', controller: 'player', size: 'medium', pc: true,
    description: `Human Cleric ${level}${level >= 3 ? ' (Life)' : ''}`, model: 'cleric', type: 'humanoid',
    abilities, pb, level,
    maxHp: hitPoints(level, 8, abilityMod(abilities.con) + 2),
    ac: 16 + 2,
    speed: 30,
    saveProfs: ['wis', 'cha'],
    skills: { medicine: wis + pb, insight: wis + pb, perception: wis, athletics: abilityMod(abilities.str), stealth: 0 },
    attacks: weaponAttacks(WEAPONS.mace, { abilities, pb, mastery: false }),
    attacksPerAction: 1,
    features: ['alert', 'tough', ...upTo(level, { 1: ['spellcasting'], 2: ['channelDivinity'], 3: ['discipleOfLife'] })],
    resources: level >= 2 ? { channelDivinity: 2 } : {},
    inventory: { potionOfHealing: 1 },
    spellcasting: { ability: 'wis', dc: 8 + wis + pb, attack: wis + pb, slots: fullCasterSlots(level), spells },
  };
}

/**
 * Elowen — High Elf Wizard, Sage background. Evoker at level 3.
 * Standard array: STR 8, DEX 14, CON 13+1, INT 15+2, WIS 12, CHA 10.
 * HP: d6 + CON (+2) per level → 8 / 14 / 20.
 * AC: Mage Armor 13 + DEX 2 = 15. Her origin feat, Magic Initiate (Wizard), lets her cast Mage Armor
 * once per Long Rest without a slot; she casts it each morning, so it's always up.
 * Cantrips: Fire Bolt, Ray of Frost, Shocking Grasp (plus Light, Mage Hand, Prestidigitation for exploring).
 */
export function elowen(level: Level = 3): CreatureDef {
  const abilities = { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 };
  const pb = 2;
  const int = abilityMod(abilities.int), dex = abilityMod(abilities.dex);
  const S = SPELLS;
  const spells: SpellDef[] = [
    S.fireBolt, S.rayOfFrost, S.shockingGrasp,
    S.magicMissile, S.shield, S.burningHands, S.sleep,
    ...(level >= 3 ? [S.scorchingRay, S.mistyStep] : []),
  ];
  return {
    id: 'elowen', name: 'Elowen', side: 'party', controller: 'player', size: 'medium', pc: true,
    description: `Elf Wizard ${level}${level >= 3 ? ' (Evoker)' : ''}`, model: 'wizard', type: 'humanoid',
    abilities, pb, level,
    maxHp: hitPoints(level, 6, abilityMod(abilities.con)),
    ac: 13 + dex,
    speed: 30,
    saveProfs: ['int', 'wis'],
    skills: { perception: abilityMod(abilities.wis) + pb, stealth: dex, acrobatics: dex, athletics: abilityMod(abilities.str) },
    attacks: weaponAttacks(WEAPONS.dagger, { abilities, pb, mastery: false }),
    attacksPerAction: 1,
    features: ['darkvision', 'feyAncestry', 'keenSenses', 'trance', ...upTo(level, { 1: ['spellcasting'], 2: [], 3: ['potentCantrip'] })],
    inventory: { dagger: 2, potionOfHealing: 1 },
    spellcasting: { ability: 'int', dc: 8 + int + pb, attack: int + pb, slots: fullCasterSlots(level), spells },
  };
}

export function party(level: Level = 3): CreatureDef[] { return [torvald(level), nyx(level), maren(level), elowen(level)]; }
