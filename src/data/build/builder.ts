// The character builder: a set of creator choices + a level → a CreatureDef the engine can play.
// Everything here follows the 2024 Player's Handbook; the few computer rulings are noted where they're made.
import { ABILITIES, abilityMod, SKILL_ABILITY, type Ability, type AbilityScores, type AttackProfile, type CreatureDef, type FeatureId, type Size, type Skill, type SpellDef } from '../../engine/types';
import { ARMOR, WEAPONS, weaponAttacks, type Weapon } from '../weapons';
import { SPELLS, fullCasterSlots, halfCasterSlots } from '../spells';
import { speciesById } from './species';
import { backgroundById, MAGIC_INITIATE, ORIGIN_FEATS, type OriginFeatId } from './backgrounds';
import { ALWAYS_PREPARED, CLASS_ACTIONS, CLASSES, classResources, FIGHTING_STYLES, SCHOLAR_SKILLS, type ClassId, type FightingStyle } from './classes';
import { parseDice } from '../../engine/dice';
import { lookFor, type LookChoice } from './look';

export const MAX_LEVEL = 4;

/** Options for one origin feat (Skilled: three skills; Magic Initiate: list, spells and ability). */
export interface FeatChoice {
  skills?: Skill[];
  list?: 'cleric' | 'druid' | 'wizard';
  cantrips?: string[];
  spell?: string;
  ability?: Ability;
}

export interface Choices {
  id?: string;
  name: string;
  species: string;
  lineage?: string;
  size?: Size;
  /** Keen Senses (elf) / Skillful (human). */
  speciesSkill?: Skill;
  /** Spellcasting ability for the species' cantrips (INT, WIS or CHA). */
  speciesAbility?: Ability;
  /** Human Versatile: the second origin feat. */
  versatileFeat?: OriginFeatId;
  cls: ClassId;
  background: string;
  /** Background increases: +2 / +1 to two of its abilities, or +1 to all three. */
  boosts: Partial<AbilityScores>;
  scoreMethod: 'standard' | 'pointBuy' | 'rolled';
  /** Scores before the background's increases. */
  base: AbilityScores;
  /** Class skill picks. */
  skills: Skill[];
  /** Rogue Expertise (two skills at level 1). */
  expertise?: Skill[];
  /** Wizard Scholar (level 2). */
  scholar?: Skill;
  fightingStyle?: FightingStyle;
  /** Weapon ids whose mastery you use, in order (later picks unlock at higher levels). */
  masteries?: string[];
  divineOrder?: 'protector' | 'thaumaturge';
  /** Class cantrips, in order (the extra one arrives at level 4). */
  cantrips?: string[];
  /** Spells in order of preference: the builder prepares the first ones you can cast (a wizard's spellbook, in order). */
  spells?: string[];
  kit: string;
  /** One per origin feat: [the background's, Human Versatile's]. */
  feats?: FeatChoice[];
  /** Level 4: Ability Score Improvement, or an origin feat. */
  level4?: { asi?: Partial<AbilityScores>; feat?: OriginFeatId; featChoice?: FeatChoice };
  /** Appearance picks (everything else about the figure follows from species and kit). */
  look?: LookChoice;
}

// ------------------------------------------------------------------ ability scores

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

export function pointBuyCost(base: AbilityScores): number {
  return ABILITIES.reduce((n, a) => n + (POINT_BUY_COST[base[a]] ?? Infinity), 0);
}

/** Final ability scores at a level: base + background (max 20), + the level 4 increase (max 20). */
export function abilityScores(c: Choices, level: number): AbilityScores {
  const out = { ...c.base };
  for (const a of ABILITIES) out[a] = Math.min(20, out[a] + (c.boosts[a] ?? 0));
  if (level >= 4 && c.level4?.asi) for (const a of ABILITIES) out[a] = Math.min(20, out[a] + (c.level4.asi[a] ?? 0));
  return out;
}

// ------------------------------------------------------------------ helpers

/** The origin feats a character has at a level, with their option sets. */
export function originFeats(c: Choices, level: number): { id: OriginFeatId; choice: FeatChoice }[] {
  const bg = backgroundById(c.background);
  const out = [{ id: bg.feat, choice: { ...(c.feats?.[0] ?? {}), ...(bg.magicList ? { list: bg.magicList } : {}) } }];
  if (speciesById(c.species).originFeat && c.versatileFeat) out.push({ id: c.versatileFeat, choice: c.feats?.[1] ?? {} });
  if (level >= 4 && c.level4?.feat) out.push({ id: c.level4.feat, choice: c.level4.featChoice ?? {} });
  return out;
}

export function proficientWith(cls: ClassId, w: Weapon, protector: boolean): boolean {
  const d = CLASSES[cls];
  if (w.category === 'simple') return true;
  if (d.martial === true || protector) return true;
  return d.martial === 'finesseOrLight' && (!!w.finesse || !!w.light);
}

function armorTrained(cls: ClassId, type: 'light' | 'medium' | 'heavy', protector: boolean): boolean {
  return CLASSES[cls].armor.includes(type) || (protector && type === 'heavy');
}

export function proficientSkills(c: Choices, level: number): Skill[] {
  const set = new Set<Skill>([...backgroundById(c.background).skills, ...c.skills]);
  if (c.speciesSkill) set.add(c.speciesSkill);
  for (const f of originFeats(c, level)) if (f.id === 'skilled') for (const s of f.choice.skills ?? []) set.add(s);
  return [...set];
}

const titled = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The spellcasting ability for spells a species or Magic Initiate grants: the given one, else the best of INT/WIS/CHA. */
function mentalAbility(scores: AbilityScores, pick?: Ability): Ability {
  if (pick) return pick;
  return (['int', 'wis', 'cha'] as Ability[]).reduce((b, a) => (scores[a] > scores[b] ? a : b));
}

function slotsFor(cls: ClassId, level: number): number[] {
  const k = CLASSES[cls].casting?.kind;
  return k === 'full' ? fullCasterSlots(level) : k === 'half' ? halfCasterSlots(level) : [0];
}

const spell = (id: string): SpellDef => (SPELLS as Record<string, SpellDef>)[id];

// ------------------------------------------------------------------ the builder

export function buildCharacter(c: Choices, level: number): CreatureDef {
  const cls = CLASSES[c.cls];
  const sp = speciesById(c.species);
  const lineage = sp.lineages?.find((l) => l.id === c.lineage);
  const abilities = abilityScores(c, level);
  const mod = (a: Ability) => abilityMod(abilities[a]);
  const pb = level >= 5 ? 3 : 2;
  const feats = originFeats(c, level);
  const has = (f: OriginFeatId) => feats.some((x) => x.id === f);
  const protector = c.cls === 'cleric' && c.divineOrder === 'protector';
  const style = level >= (cls.fightingStyleLevel ?? Infinity) ? c.fightingStyle : undefined;
  const kit = cls.kits.find((k) => k.id === c.kit) ?? cls.kits[0];

  // ---- features
  const features = new Set<FeatureId>();
  for (let l = 1; l <= level; l++) for (const f of cls.features[l]) features.add(f);
  if (style) features.add(FIGHTING_STYLES[style].feature);
  if (c.cls === 'cleric' && c.divineOrder) features.add(protector ? 'divineOrderProtector' : 'divineOrderThaumaturge');
  for (const f of sp.features) features.add(f);
  if (lineage?.feature) features.add(lineage.feature);
  for (const f of feats) { const id = ORIGIN_FEATS[f.id].feature; if (id) features.add(id); }

  // ---- hit points: max die at level 1, then the fixed value; CON, Dwarven Toughness and Tough each level
  const perLevel = mod('con') + (features.has('dwarvenToughness') ? 1 : 0) + (features.has('tough') ? 2 : 0);
  const maxHp = cls.hitDie + (level - 1) * (cls.hitDie / 2 + 1) + level * perLevel;

  // ---- armor class
  const armor = kit.armor ? ARMOR[kit.armor] : undefined;
  const dex = mod('dex');
  const book = c.spells ?? [];
  // Mage Armor: cast each morning (8 hours), so it's always up while unarmored. With Magic Initiate it's the free
  // casting; a wizard who only has it in the spellbook spends a 1st-level slot on it every day (ruling).
  const miArmor = feats.some((f) => f.id === 'magicInitiate' && f.choice.spell === 'mageArmor');
  const wizArmor = !miArmor && c.cls === 'wizard' && book.includes('mageArmor');
  const mageArmor = !armor && (miArmor || wizArmor);
  let ac = armor ? armor.base + Math.min(dex, armor.dexMax ?? Infinity) : (mageArmor ? 13 : 10) + dex;
  if (kit.shield) ac += 2;
  if (armor && style === 'defense') ac += 1;

  // ---- speed: heavy armor without the Strength it needs costs 10 ft
  let speed = lineage?.speed ?? sp.speed;
  if (armor?.strength && abilities.str < armor.strength) speed -= 10;

  // ---- skills
  const profs = proficientSkills(c, level);
  const expert = new Set<Skill>([...(c.cls === 'rogue' ? c.expertise ?? [] : []), ...(c.cls === 'wizard' && level >= 2 && c.scholar ? [c.scholar] : [])]);
  const skills: Partial<Record<Skill, number>> = {};
  for (const s of Object.keys(SKILL_ABILITY) as Skill[]) {
    let v = mod(SKILL_ABILITY[s]);
    if (profs.includes(s)) v += expert.has(s) ? pb * 2 : pb;
    // Thaumaturge: + WIS (at least +1) to Arcana and Religion
    if (c.cls === 'cleric' && c.divineOrder === 'thaumaturge' && (s === 'arcana' || s === 'religion')) v += Math.max(1, mod('wis'));
    skills[s] = v;
  }

  // ---- attacks
  const mastered = new Set((c.masteries ?? []).slice(0, cls.masteries[level] ?? 0));
  const attacks: AttackProfile[] = [];
  for (const kw of kit.weapons) {
    const w = WEAPONS[kw.id];
    const ranged = w.kind === 'ranged';
    // Dueling: a one-handed melee weapon (you hold no other weapon while using it). Without a shield, a Versatile
    // weapon is used in two hands, unless you fight Dueling style.
    const twoHands = !!w.versatile && !kit.shield && style !== 'dueling';
    const profiles = weaponAttacks(w, {
      abilities, pb, proficient: proficientWith(c.cls, w, protector), mastery: features.has('weaponMastery') && mastered.has(w.id),
      twoHands,
      damageBonus: style === 'dueling' && !ranged && !w.twoHanded ? 2 : 0,
      toHitBonus: style === 'archery' && ranged ? 2 : 0,
      greatWeaponFighting: style === 'greatWeapon',
      twoWeaponFighting: style === 'twoWeapon',
    });
    attacks.push(...(kw.thrownOnly ? profiles.filter((p) => p.kind === 'ranged') : profiles));
  }
  if (has('tavernBrawler')) {
    // Unarmed Strike with Tavern Brawler: 1d4 + STR bludgeoning (the 1s reroll lives in the engine)
    attacks.push({
      id: 'unarmed', name: 'Unarmed Strike', kind: 'melee', reach: 5, toHit: mod('str') + pb, damage: parseDice(`1d4${mod('str') >= 0 ? '+' : ''}${mod('str')}`),
      damageType: 'bludgeoning', ability: 'str', abilityMod: mod('str'), weapon: false, unarmed: true,
    });
  }

  // ---- resources
  const resources: Record<string, number> = { ...classResources(c.cls, level) };
  if (features.has('breathWeapon')) resources.breathWeapon = pb;
  if (features.has('healingHands')) resources.healingHands = 1;
  if (features.has('adrenalineRush')) resources.adrenalineRush = pb;
  if (features.has('relentlessEndurance')) resources.relentlessEndurance = 1;
  if (lineage?.feature) resources.giantAncestry = pb;
  if (has('lucky')) resources.luck = pb;

  // ---- spells
  const spells: SpellDef[] = [];
  const seen = new Set<string>();
  const add = (s: SpellDef) => { if (!seen.has(s.id)) { seen.add(s.id); spells.push(s); } };
  const castWith = (a: Ability) => ({ ability: a, dc: 8 + mod(a) + pb, attack: mod(a) + pb });
  const slots = slotsFor(c.cls, level);
  const maxSlot = slots.length - 1;
  const casting = cls.casting;

  if (casting) {
    const extra = c.divineOrder === 'thaumaturge' ? 1 : 0;
    for (const id of (c.cantrips ?? []).slice(0, casting.cantrips[level] + extra)) add(spell(id));
  }
  // species cantrips (Light for aasimar, Thaumaturgy for tieflings, the lineage's)
  const speciesCantrips = [...(sp.id === 'aasimar' ? ['light'] : []), ...(sp.id === 'tiefling' ? ['thaumaturgy'] : []), ...(lineage?.cantrip ? [lineage.cantrip] : [])];
  const spAbility: Ability = sp.id === 'aasimar' ? 'cha' : mentalAbility(abilities, c.speciesAbility);
  for (const id of speciesCantrips) add({ ...spell(id), castWith: castWith(spAbility) });
  // Magic Initiate cantrips
  for (const f of feats) if (f.id === 'magicInitiate') {
    const a = mentalAbility(abilities, f.choice.ability);
    for (const id of f.choice.cantrips ?? []) add({ ...spell(id), castWith: castWith(a) });
  }
  // prepared spells
  const always = (ALWAYS_PREPARED[c.cls] ?? []).filter((g) => g.level <= level).flatMap((g) => g.spells);
  const leveled: SpellDef[] = [];
  if (casting && maxSlot >= 1) {
    let pool = book.filter((id) => casting.list.includes(id) && spell(id).level <= maxSlot);
    if (casting.spellbook) pool = pool.slice(0, 6 + 2 * (level - 1));
    // Magic Initiate's spell is always prepared too, so it doesn't take a place
    const granted = feats.filter((f) => f.id === 'magicInitiate').map((f) => f.choice.spell);
    const prepared = pool.filter((id) => !always.includes(id) && !granted.includes(id)).slice(0, casting.prepared[level]);
    for (const id of prepared) leveled.push(spell(id));
  }
  for (const id of always) leveled.push({ ...spell(id), always: true, ...(id === 'divineSmite' ? { free: 'paladinsSmite' } : {}) });
  // Magic Initiate's 1st-level spell: free once per Long Rest, or with your slots
  feats.forEach((f, i) => {
    if (f.id !== 'magicInitiate' || !f.choice.spell) return;
    const key = `magicInitiate${i}`;
    resources[key] = 1;
    leveled.push({ ...spell(f.choice.spell), free: key, castWith: castWith(mentalAbility(abilities, f.choice.ability)) });
  });
  // hotbar order: by spell level, then as chosen
  leveled.sort((a, b) => a.level - b.level);
  for (const s of leveled) add(s);
  // class actions (Channel Divinity, Lay on Hands) and species actions
  for (const a of CLASS_ACTIONS[c.cls] ?? []) if (a.level <= level) add(spell(a.spell));
  if (features.has('healingHands')) add({ ...spell('healingHands'), heal: { dice: `${pb}d4` } });
  if (features.has('cloudsJaunt')) add(spell('cloudsJaunt'));
  if (features.has('adrenalineRush')) add(spell('adrenalineRush'));
  if (features.has('breathWeapon') && lineage?.damageType) {
    const dice = level >= 17 ? '4d10' : level >= 11 ? '3d10' : level >= 5 ? '2d10' : '1d10';
    for (const id of ['breathCone', 'breathLine']) {
      const s = spell(id);
      add({ ...s, damage: { dice, type: lineage.damageType }, castWith: castWith('con') });
    }
  }
  if (wizArmor && slots[1] > 0) slots[1] -= 1;

  const casterAbility = casting?.ability ?? spAbility;
  const hasSpellcasting = spells.length > 0;

  // ---- inventory: the kit, plus a Potion of Healing everyone starts the campaign with
  const inventory: Record<string, number> = { ...kit.inventory, potionOfHealing: 1 };

  const subclass = level >= 3 ? ` (${cls.subclass.replace(/^Oath of /, '').replace(/ Domain$/, '')})` : '';
  const size = c.size && sp.sizes.includes(c.size) ? c.size : sp.sizes[0];
  return {
    id: c.id ?? c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: c.name, side: 'party', controller: 'player', size, pc: true, type: 'humanoid',
    description: `${sp.name} ${cls.name} ${level}${subclass}`, model: cls.model, look: lookFor(c.species, c.lineage, c.cls, kit, c.look),
    abilities, pb, level, maxHp, ac, speed,
    saveProfs: [...cls.saves],
    skills, attacks, attacksPerAction: 1,
    features: [...features],
    resources,
    inventory,
    ...(c.cls === 'rogue' ? { sneakAttackDice: Math.ceil(level / 2) } : {}),
    ...(resistances(sp.resist, lineage)),
    ...(hasSpellcasting ? { spellcasting: { ability: casterAbility, dc: 8 + mod(casterAbility) + pb, attack: mod(casterAbility) + pb, slots, spells } } : {}),
  };
}

function resistances(base: CreatureDef['resist'], lineage?: { resist?: CreatureDef['resist']; damageType?: NonNullable<CreatureDef['resist']>[number] }) {
  const r = new Set([...(base ?? []), ...(lineage?.resist ?? []), ...(lineage?.damageType ? [lineage.damageType] : [])]);
  return r.size ? { resist: [...r] } : {};
}

// ------------------------------------------------------------------ validation

/** Everything wrong with a set of choices for a character of this level (empty = legal). */
export function validateChoices(c: Choices, level: number): string[] {
  const errs: string[] = [];
  const cls = CLASSES[c.cls];
  if (!cls) return [`Unknown class ${c.cls}`];
  const sp = speciesById(c.species);
  if (!sp) return [`Unknown species ${c.species}`];
  const bg = backgroundById(c.background);
  if (!bg) return [`Unknown background ${c.background}`];
  if (!c.name.trim()) errs.push('Give your character a name.');
  if (level < 1 || level > MAX_LEVEL) errs.push(`Level must be 1–${MAX_LEVEL}.`);

  // species
  if (sp.lineages && !sp.lineages.some((l) => l.id === c.lineage)) errs.push(`Choose a ${sp.lineageLabel ?? 'lineage'}.`);
  if (c.size && !sp.sizes.includes(c.size)) errs.push(`A ${sp.name} can't be ${c.size}.`);
  if (sp.skillChoice) {
    if (!c.speciesSkill) errs.push(`Choose a skill from your species.`);
    else if (Array.isArray(sp.skillChoice) && !sp.skillChoice.includes(c.speciesSkill)) errs.push(`${titled(c.speciesSkill)} isn't a ${sp.name} skill choice.`);
  }
  if (sp.originFeat && !c.versatileFeat) errs.push('Choose an origin feat (Versatile).');
  if (c.speciesAbility && !['int', 'wis', 'cha'].includes(c.speciesAbility)) errs.push('Species spells use Intelligence, Wisdom or Charisma.');

  // ability scores
  const vals = ABILITIES.map((a) => c.base[a]);
  if (c.scoreMethod === 'standard' && [...vals].sort((a, b) => b - a).join() !== STANDARD_ARRAY.join()) errs.push('Assign the standard array: 15, 14, 13, 12, 10, 8.');
  if (c.scoreMethod === 'pointBuy') {
    if (vals.some((v) => v < 8 || v > 15)) errs.push('Point buy scores run from 8 to 15.');
    else if (pointBuyCost(c.base) > POINT_BUY_BUDGET) errs.push(`Point buy costs ${pointBuyCost(c.base)} of ${POINT_BUY_BUDGET} points.`);
  }
  if (c.scoreMethod === 'rolled' && vals.some((v) => v < 3 || v > 18)) errs.push('Rolled scores run from 3 to 18.');
  const boosts = ABILITIES.filter((a) => c.boosts[a]).map((a) => [a, c.boosts[a]!] as const);
  const pattern = boosts.map(([, v]) => v).sort().join();
  if (boosts.some(([a]) => !bg.abilities.includes(a))) errs.push(`${bg.name} raises only ${bg.abilities.map((a) => a.toUpperCase()).join(', ')}.`);
  if (pattern !== '1,2' && pattern !== '1,1,1') errs.push('Background: +2 and +1, or +1 to all three.');
  if (level >= 4) {
    const l4 = c.level4;
    if (!l4 || (!l4.asi && !l4.feat)) errs.push('Level 4: choose an Ability Score Improvement or a feat.');
    else if (l4.asi) {
      const p = ABILITIES.filter((a) => l4.asi![a]).map((a) => l4.asi![a]).sort().join();
      if (p !== '2' && p !== '1,1') errs.push('Ability Score Improvement: +2 to one ability or +1 to two.');
    }
  }

  // skills
  const bgSkills: Skill[] = bg.skills;
  if (c.skills.length !== cls.skillCount) errs.push(`Choose ${cls.skillCount} ${cls.name} skills.`);
  if (c.skills.some((s) => !cls.skillList.includes(s))) errs.push(`Those aren't all ${cls.name} skills.`);
  const all = [...bgSkills, ...c.skills, ...(c.speciesSkill ? [c.speciesSkill] : [])];
  for (const f of originFeats(c, level)) if (f.id === 'skilled') {
    if ((f.choice.skills ?? []).length !== 3) errs.push('Skilled: choose three skills.');
    all.push(...(f.choice.skills ?? []));
  }
  if (new Set(all).size !== all.length) errs.push('A skill was picked twice.');
  const profs = proficientSkills(c, level);
  if (c.cls === 'rogue') {
    if ((c.expertise ?? []).length !== 2 || new Set(c.expertise).size !== 2) errs.push('Expertise: choose two skills.');
    else if (c.expertise!.some((s) => !profs.includes(s))) errs.push('Expertise needs skills you\'re proficient in.');
  }
  if (c.cls === 'wizard' && level >= 2 && (!c.scholar || !SCHOLAR_SKILLS.includes(c.scholar) || !profs.includes(c.scholar))) errs.push('Scholar: choose a proficient skill from Arcana, History, Investigation, Medicine, Nature or Religion.');

  // class options
  const protector = c.cls === 'cleric' && c.divineOrder === 'protector';
  if (level >= (cls.fightingStyleLevel ?? Infinity) && !c.fightingStyle) errs.push('Choose a Fighting Style.');
  if (c.cls === 'cleric' && !c.divineOrder) errs.push('Choose a Divine Order.');
  const nMastery = cls.masteries[level] ?? 0;
  if (nMastery) {
    const m = c.masteries ?? [];
    if (m.length < nMastery) errs.push(`Choose ${nMastery} weapons for Weapon Mastery.`);
    if (new Set(m).size !== m.length) errs.push('A Weapon Mastery weapon was picked twice.');
    if (m.some((id) => !WEAPONS[id] || !proficientWith(c.cls, WEAPONS[id], protector))) errs.push('Weapon Mastery needs weapons you\'re proficient with.');
  }
  const kit = cls.kits.find((k) => k.id === c.kit);
  if (!kit) errs.push('Choose your starting equipment.');
  else {
    if (kit.needs === 'protector' && !protector) errs.push(`${kit.name} needs the Protector order.`);
    if (kit.armor && !armorTrained(c.cls, ARMOR[kit.armor].type, protector)) errs.push(`You aren't trained in ${ARMOR[kit.armor].name}.`);
    if (kit.shield && !cls.shields) errs.push('You aren\'t trained with shields.');
  }

  // spells
  const casting = cls.casting;
  if (casting) {
    const want = casting.cantrips[level] + (c.divineOrder === 'thaumaturge' ? 1 : 0);
    const can = c.cantrips ?? [];
    if (can.length < want) errs.push(`Choose ${want} cantrips.`);
    if (can.some((id) => !casting.cantripList.includes(id))) errs.push(`Those aren't all ${cls.name} cantrips.`);
    if (new Set(can).size !== can.length) errs.push('A cantrip was picked twice.');
    const maxSlot = slotsFor(c.cls, level).length - 1;
    const book = (c.spells ?? []).filter((id) => spell(id)?.level <= maxSlot);
    if ((c.spells ?? []).some((id) => !casting.list.includes(id))) errs.push(`Those aren't all ${cls.name} spells.`);
    if (new Set(c.spells ?? []).size !== (c.spells ?? []).length) errs.push('A spell was picked twice.');
    const always = (ALWAYS_PREPARED[c.cls] ?? []).filter((g) => g.level <= level).flatMap((g) => g.spells);
    const need = casting.spellbook ? Math.min(6 + 2 * (level - 1), casting.list.filter((id) => spell(id).level <= maxSlot).length) : 1;
    if (maxSlot >= 1 && book.filter((id) => !always.includes(id)).length < need) errs.push(casting.spellbook ? `Your spellbook needs ${need} spells.` : 'Prepare at least one spell.');
  }

  // origin feats
  const feats = originFeats(c, level);
  for (const [i, f] of feats.entries()) {
    const ch = f.choice;
    if (f.id === 'magicInitiate') {
      const list = ch.list && MAGIC_INITIATE[ch.list];
      if (!list) { errs.push('Magic Initiate: choose a spell list.'); continue; }
      if ((ch.cantrips ?? []).length !== 2 || ch.cantrips!.some((id) => !list.cantrips.includes(id))) errs.push(`Magic Initiate: choose two ${ch.list} cantrips.`);
      if (!ch.spell || !list.spells.includes(ch.spell)) errs.push(`Magic Initiate: choose a 1st-level ${ch.list} spell.`);
      if (ch.ability && !['int', 'wis', 'cha'].includes(ch.ability)) errs.push('Magic Initiate uses Intelligence, Wisdom or Charisma.');
      if (feats.slice(0, i).some((g) => g.id === 'magicInitiate' && g.choice.list === ch.list)) errs.push('Magic Initiate twice needs two different lists.');
    } else if (f.id !== 'skilled' && feats.slice(0, i).some((g) => g.id === f.id)) errs.push(`${ORIGIN_FEATS[f.id].name} can be taken only once.`);
  }
  return errs;
}
