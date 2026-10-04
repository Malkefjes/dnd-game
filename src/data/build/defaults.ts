// Sensible defaults for the character creator. `complete(c)` keeps every pick that's still legal and fills the
// rest, so whatever order the player clicks in, the choices stay a legal character (and a quick player can just
// press Next). Pure data, unit-tested.
import { ABILITIES, abilityMod, type Ability, type AbilityScores, type Skill } from '../../engine/types';
import { WEAPONS } from '../weapons';
import { SPELLS } from '../spells';
import { SPECIES, speciesById } from './species';
import { BACKGROUNDS, backgroundById, MAGIC_INITIATE, ORIGIN_FEATS, type OriginFeatId } from './backgrounds';
import { CLASSES, SCHOLAR_SKILLS, type ClassId } from './classes';
import { POINT_BUY_BUDGET, pointBuyCost, proficientWith, STANDARD_ARRAY, type Choices, type FeatChoice } from './builder';

/** Which abilities each class wants most, in order (the standard array goes on in this order). */
export const PRIORITY: Record<ClassId, Ability[]> = {
  fighter: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  rogue: ['dex', 'con', 'wis', 'int', 'cha', 'str'],
  cleric: ['wis', 'con', 'str', 'cha', 'dex', 'int'],
  wizard: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
  paladin: ['str', 'cha', 'con', 'wis', 'dex', 'int'],
};

const SKILL_PREF: Record<ClassId, Skill[]> = {
  fighter: ['perception', 'athletics', 'intimidation', 'survival', 'insight', 'acrobatics', 'history', 'animalHandling', 'persuasion'],
  rogue: ['perception', 'stealth', 'acrobatics', 'insight', 'investigation', 'deception', 'sleightOfHand', 'athletics', 'persuasion', 'intimidation'],
  cleric: ['insight', 'medicine', 'religion', 'persuasion', 'history'],
  wizard: ['arcana', 'investigation', 'history', 'insight', 'religion', 'nature', 'medicine'],
  paladin: ['athletics', 'insight', 'religion', 'persuasion', 'medicine', 'intimidation'],
};
const ANY_SKILL_PREF: Skill[] = ['perception', 'stealth', 'athletics', 'insight', 'survival', 'medicine', 'acrobatics', 'investigation', 'arcana', 'religion', 'history', 'persuasion', 'nature', 'deception', 'intimidation', 'animalHandling', 'performance', 'sleightOfHand'];
const CANTRIP_PREF: Partial<Record<ClassId, string[]>> = {
  cleric: ['sacredFlame', 'tollTheDead', 'guidance', 'spareTheDying', 'light', 'thaumaturgy', 'mending'],
  wizard: ['fireBolt', 'rayOfFrost', 'shockingGrasp', 'chillTouch', 'poisonSpray', 'mageHand', 'light', 'prestidigitation', 'minorIllusion', 'dancingLights', 'mending'],
};
const SPELL_PREF: Partial<Record<ClassId, string[]>> = {
  cleric: ['bless', 'cureWounds', 'guidingBolt', 'healingWord', 'shieldOfFaith', 'inflictWounds', 'protectionFromEvilAndGood', 'spiritualWeapon', 'aid'],
  wizard: ['magicMissile', 'shield', 'burningHands', 'sleep', 'mageArmor', 'protectionFromEvilAndGood', 'scorchingRay', 'mistyStep'],
  paladin: ['divineFavor', 'cureWounds', 'heroism', 'bless', 'shieldOfFaith', 'protectionFromEvilAndGood'],
};
const MI_PREF: Record<'cleric' | 'druid' | 'wizard', { cantrips: string[]; spells: string[] }> = {
  cleric: { cantrips: ['sacredFlame', 'tollTheDead', 'guidance', 'spareTheDying', 'light'], spells: ['bless', 'healingWord', 'cureWounds', 'guidingBolt', 'shieldOfFaith'] },
  druid: { cantrips: ['produceFlame', 'guidance', 'poisonSpray', 'druidcraft'], spells: ['healingWord', 'cureWounds', 'protectionFromEvilAndGood'] },
  wizard: { cantrips: ['fireBolt', 'rayOfFrost', 'shockingGrasp', 'mageHand', 'light'], spells: ['shield', 'magicMissile', 'mageArmor', 'sleep', 'burningHands'] },
};

const uniq = <T>(xs: T[]) => [...new Set(xs)];
/** Keep the valid picks in order, then top up from the preferences until there are `n`. */
function fill<T>(picked: T[] | undefined, valid: (x: T) => boolean, prefs: T[], n: number): T[] {
  const out = uniq((picked ?? []).filter(valid)).slice(0, n);
  for (const p of prefs) { if (out.length >= n) break; if (valid(p) && !out.includes(p)) out.push(p); }
  return out;
}

/** The standard array placed in the class's priority order. */
export function standardFor(cls: ClassId): AbilityScores {
  const out = {} as AbilityScores;
  PRIORITY[cls].forEach((a, i) => { out[a] = STANDARD_ARRAY[i]; });
  return out;
}

/** 4d6, drop the lowest, six times. */
export function rollScores(roll: () => number): number[] {
  return Array.from({ length: 6 }, () => {
    const d = [roll(), roll(), roll(), roll()].sort((a, b) => a - b);
    return d[1] + d[2] + d[3];
  });
}

/** Place a set of scores in the class's priority order. */
export function placeScores(values: number[], cls: ClassId): AbilityScores {
  const sorted = [...values].sort((a, b) => b - a);
  const out = {} as AbilityScores;
  PRIORITY[cls].forEach((a, i) => { out[a] = sorted[i]; });
  return out;
}

function defaultBoosts(bgId: string, cls: ClassId): Partial<AbilityScores> {
  const bg = backgroundById(bgId);
  const ranked = [...bg.abilities].sort((a, b) => PRIORITY[cls].indexOf(a) - PRIORITY[cls].indexOf(b));
  return { [ranked[0]]: 2, [ranked[1]]: 1 };
}

function boostsValid(b: Partial<AbilityScores>, bgId: string): boolean {
  const bg = backgroundById(bgId);
  const keys = ABILITIES.filter((a) => b[a]);
  if (keys.some((a) => !bg.abilities.includes(a))) return false;
  const p = keys.map((a) => b[a]).sort().join();
  return p === '1,2' || p === '1,1,1';
}

/** The best of INT, WIS and CHA. */
function mental(scores: AbilityScores): Ability {
  return (['int', 'wis', 'cha'] as Ability[]).reduce((b, a) => (scores[a] > scores[b] ? a : b));
}

/** A fresh character: a human fighter soldier with everything filled in. */
export function newChoices(name = ''): Choices {
  return complete({ name, species: 'human', cls: 'fighter', background: 'soldier', scoreMethod: 'standard', base: standardFor('fighter'), boosts: {}, skills: [], kit: '' });
}

/** Keep every legal pick and fill in the rest. */
export function complete(input: Choices): Choices {
  const c: Choices = structuredClone(input);
  const sp = speciesById(c.species) ?? SPECIES[0];
  c.species = sp.id;
  const cls = CLASSES[c.cls] ?? CLASSES.fighter;
  c.cls = cls.id;
  const bg = backgroundById(c.background) ?? BACKGROUNDS[0];
  c.background = bg.id;

  // species
  c.lineage = sp.lineages ? (sp.lineages.some((l) => l.id === c.lineage) ? c.lineage : sp.lineages[0].id) : undefined;
  c.size = c.size && sp.sizes.includes(c.size) ? c.size : sp.sizes[0];

  // ability scores
  if (c.scoreMethod === 'standard') {
    const ok = [...ABILITIES.map((a) => c.base?.[a])].sort((a, b) => (b ?? 0) - (a ?? 0)).join() === STANDARD_ARRAY.join();
    if (!ok) c.base = standardFor(c.cls);
  } else if (c.scoreMethod === 'pointBuy') {
    const vals = ABILITIES.map((a) => c.base?.[a] ?? 8);
    if (vals.some((v) => v < 8 || v > 15) || pointBuyCost(c.base) > POINT_BUY_BUDGET) c.base = standardFor(c.cls);
  } else if (ABILITIES.some((a) => !(c.base?.[a] >= 3 && c.base[a] <= 18))) c.base = standardFor(c.cls);
  if (!c.boosts || !boostsValid(c.boosts, bg.id)) c.boosts = defaultBoosts(bg.id, c.cls);
  const scores = { ...c.base };
  for (const a of ABILITIES) scores[a] += c.boosts[a] ?? 0;
  c.speciesAbility = c.speciesAbility && ['int', 'wis', 'cha'].includes(c.speciesAbility) ? c.speciesAbility : mental(scores);

  // origin feats: the background's, plus Human Versatile's
  if (sp.originFeat) {
    const ok = c.versatileFeat && ORIGIN_FEATS[c.versatileFeat] && (c.versatileFeat !== bg.feat || c.versatileFeat === 'skilled' || c.versatileFeat === 'magicInitiate');
    c.versatileFeat = ok ? c.versatileFeat : (bg.feat === 'alert' ? 'tough' : 'alert');
  } else c.versatileFeat = undefined;
  const featIds: OriginFeatId[] = [bg.feat, ...(c.versatileFeat ? [c.versatileFeat] : [])];

  // skills: background ones are fixed; species, class and Skilled picks may not repeat them or each other
  const taken = new Set<Skill>(bg.skills);
  if (sp.skillChoice) {
    const list = Array.isArray(sp.skillChoice) ? sp.skillChoice : ANY_SKILL_PREF;
    c.speciesSkill = c.speciesSkill && list.includes(c.speciesSkill) && !taken.has(c.speciesSkill) ? c.speciesSkill : list.find((s) => !taken.has(s));
    if (c.speciesSkill) taken.add(c.speciesSkill);
  } else c.speciesSkill = undefined;
  c.skills = fill(c.skills, (s) => cls.skillList.includes(s) && !taken.has(s), [...SKILL_PREF[c.cls], ...cls.skillList], cls.skillCount);
  c.skills.forEach((s) => taken.add(s));

  const feats: FeatChoice[] = [];
  featIds.forEach((id, i) => {
    const prev = c.feats?.[i] ?? {};
    if (id === 'skilled') {
      const skills = fill(prev.skills, (s) => !taken.has(s), ANY_SKILL_PREF, 3);
      skills.forEach((s) => taken.add(s));
      feats.push({ skills });
    } else if (id === 'magicInitiate') {
      // the background fixes the list; Human Versatile picks one (not the same as another Magic Initiate's)
      const other = i === 0 ? undefined : (bg.feat === 'magicInitiate' ? bg.magicList ?? feats[0]?.list : undefined);
      const prevList = i === 0 && bg.magicList ? bg.magicList : prev.list;
      let list = prevList ?? 'wizard';
      if (list === other) list = (['wizard', 'cleric', 'druid'] as const).find((l) => l !== other)!;
      const pool = MAGIC_INITIATE[list];
      feats.push({
        list,
        cantrips: fill(prevList === list ? prev.cantrips : undefined, (x) => pool.cantrips.includes(x), [...MI_PREF[list].cantrips, ...pool.cantrips], 2),
        spell: prevList === list && prev.spell && pool.spells.includes(prev.spell) ? prev.spell : MI_PREF[list].spells.find((x) => pool.spells.includes(x)),
        ability: prev.ability && ['int', 'wis', 'cha'].includes(prev.ability) ? prev.ability : mental(scores),
      });
    } else feats.push({});
  });
  c.feats = feats;

  // class options
  const proficient = [...taken];
  c.expertise = c.cls === 'rogue' ? fill(c.expertise, (s) => proficient.includes(s), ['stealth', 'perception', ...proficient], 2) : undefined;
  c.scholar = c.cls === 'wizard'
    ? (c.scholar && SCHOLAR_SKILLS.includes(c.scholar) && proficient.includes(c.scholar) ? c.scholar : SCHOLAR_SKILLS.find((s) => proficient.includes(s)))
    : undefined;
  c.divineOrder = c.cls === 'cleric' ? c.divineOrder ?? 'protector' : undefined;
  const kit = cls.kits.find((k) => k.id === c.kit && (k.needs !== 'protector' || c.divineOrder === 'protector'));
  c.kit = kit ? kit.id : (c.divineOrder === 'protector' ? cls.kits.find((k) => k.needs === 'protector')?.id : undefined) ?? cls.kits[0].id;
  const chosenKit = cls.kits.find((k) => k.id === c.kit)!;
  if (cls.fightingStyleLevel) {
    c.fightingStyle = c.fightingStyle ?? (chosenKit.shield ? 'defense' : chosenKit.weapons.some((w) => WEAPONS[w.id].twoHanded && WEAPONS[w.id].kind === 'melee') ? 'greatWeapon' : 'archery');
  } else c.fightingStyle = undefined;
  const nMastery = cls.masteries[4] ?? 0;
  const protector = c.divineOrder === 'protector';
  const kitWeapons = chosenKit.weapons.map((w) => w.id);
  c.masteries = nMastery
    ? fill(c.masteries, (id) => !!WEAPONS[id] && proficientWith(c.cls, WEAPONS[id], protector), [...kitWeapons, 'longsword', 'greatsword', 'javelin', 'shortsword', 'shortbow', 'rapier', 'dagger', 'longbow'], nMastery)
    : undefined;

  // spells
  const casting = cls.casting;
  if (casting) {
    const nCantrips = casting.cantrips[4] + (c.divineOrder === 'thaumaturge' ? 1 : 0);
    c.cantrips = nCantrips ? fill(c.cantrips, (id) => casting.cantripList.includes(id), [...(CANTRIP_PREF[c.cls] ?? []), ...casting.cantripList], nCantrips) : [];
    const valid = uniq((c.spells ?? []).filter((id) => casting.list.includes(id)));
    // enough level 1 spells to prepare (or fill a spellbook) at level 1; the rest of the list follows as backups
    const level1 = (SPELLS as Record<string, { level: number }>);
    const want = casting.spellbook ? 6 : casting.prepared[1];
    const firsts = valid.filter((id) => level1[id].level === 1);
    const extra = (SPELL_PREF[c.cls] ?? casting.list).filter((id) => casting.list.includes(id) && !valid.includes(id));
    for (const id of extra) if (level1[id].level === 1 && firsts.length < want) { firsts.push(id); valid.push(id); }
    c.spells = valid.length ? valid : extra;
  } else { c.cantrips = undefined; c.spells = undefined; }

  // level 4: +2 to the main ability (or +1 / +1 when it's at 19)
  if (!c.level4 || (!c.level4.asi && !c.level4.feat)) {
    const main = PRIORITY[c.cls][0], second = PRIORITY[c.cls][1];
    c.level4 = { asi: scores[main] >= 19 ? { [main]: 1, [second]: 1 } : { [main]: 2 } };
  }
  c.look = c.look ?? {};
  return c;
}

/** A short summary of an ability score: "16 (+3)". */
export const scoreText = (n: number) => `${n} (${abilityMod(n) >= 0 ? '+' : ''}${abilityMod(n)})`;
