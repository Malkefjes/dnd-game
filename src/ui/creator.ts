// The character creator and the party screen. Both run on the game's own renderer, in a small torch-lit
// room, so the preview is the real figure with the real pixel filter; when the party is ready the same
// renderer loads the abbey.
import './creator.css';
import { esc } from './hud';
import { icon } from './icons';
import type { PixelRenderer } from '../render/pixel-renderer';
import type { Archetype } from '../render/models';
import { ABILITIES, abilityMod, SKILL_NAME, type Ability, type CreatureDef, type FeatureId, type Skill } from '../engine/types';
import { formatDice } from '../engine/dice';
import { SPELLS } from '../data/spells';
import { WEAPONS } from '../data/weapons';
import { SPECIES, speciesById } from '../data/build/species';
import { BACKGROUNDS, backgroundById, MAGIC_INITIATE, ORIGIN_FEATS, type OriginFeatId } from '../data/build/backgrounds';
import { ALWAYS_PREPARED, CLASSES, FIGHTING_STYLES, SCHOLAR_SKILLS, type ClassId, type FightingStyle } from '../data/build/classes';
import { buildCharacter, originFeats, POINT_BUY_BUDGET, POINT_BUY_COST, pointBuyCost, proficientSkills, proficientWith, STANDARD_ARRAY, validateChoices, type Choices, type FeatChoice } from '../data/build/builder';
import { BODIES, HAIR_SWATCHES, lookFor, SKIN_SWATCHES, swatchIndex } from '../data/build/look';
import { complete, newChoices, placeScores, PRIORITY, rollScores } from '../data/build/defaults';
import { PRESET_CHOICES, type Level } from '../data/heroes';
import type { HeroBuild } from '../world/world';

/** The room the creator and party screen stand in. */
export const DRESSING_ROOM = [
  '#############',
  '#...........#',
  '#.B.......B.#',
  '#...........#',
  '#...........#',
  '#...........#',
  '#...........#',
  '#...........#',
  '#############',
];
const SPOT = { x: 6, y: 5 };
/** The party stands in a row across the screen (screen right is world +x, −y). */
const LINEUP = [{ x: 4, y: 7 }, { x: 5, y: 6 }, { x: 6, y: 5 }, { x: 7, y: 4 }];
/** Facing the camera. */
const FACE_CAMERA = Math.PI / 4;

const ABILITY_NAME: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const spellName = (id: string) => (SPELLS as Record<string, { name: string }>)[id]?.name ?? id;
const spellLevel = (id: string) => (SPELLS as Record<string, { level: number }>)[id]?.level ?? 0;
const spellText = (id: string) => (SPELLS as Record<string, { description: string }>)[id]?.description ?? '';

const FEATURE_NAME: Partial<Record<FeatureId, string>> = {
  secondWind: 'Second Wind', actionSurge: 'Action Surge', weaponMastery: 'Weapon Mastery', sneakAttack: 'Sneak Attack', cunningAction: 'Cunning Action',
  expertise: 'Expertise', savageAttacker: 'Savage Attacker', alert: 'Alert', luck: 'Luck', brave: 'Brave', halflingNimbleness: 'Halfling Nimbleness',
  dwarvenResilience: 'Dwarven Resilience', darkvision: 'Darkvision', spellcasting: 'Spellcasting', channelDivinity: 'Channel Divinity',
  discipleOfLife: 'Disciple of Life', potentCantrip: 'Potent Cantrip', tough: 'Tough', feyAncestry: 'Fey Ancestry', keenSenses: 'Keen Senses', trance: 'Trance',
  improvedCritical: 'Improved Critical', remarkableAthlete: 'Remarkable Athlete', steadyAim: 'Steady Aim', assassinate: 'Assassinate',
  fightingStyleArchery: 'Archery', fightingStyleDefense: 'Defense', fightingStyleDueling: 'Dueling', fightingStyleGreatWeapon: 'Great Weapon Fighting',
  fightingStyleTwoWeapon: 'Two-Weapon Fighting', layOnHands: 'Lay on Hands', paladinsSmite: 'Paladin\'s Smite', sacredWeapon: 'Sacred Weapon',
  divineOrderProtector: 'Protector', divineOrderThaumaturge: 'Thaumaturge', healer: 'Healer', lucky: 'Lucky', tavernBrawler: 'Tavern Brawler',
  magicInitiate: 'Magic Initiate', skilled: 'Skilled', relentlessEndurance: 'Relentless Endurance', adrenalineRush: 'Adrenaline Rush',
  breathWeapon: 'Breath Weapon', gnomishCunning: 'Gnomish Cunning', dwarvenToughness: 'Dwarven Toughness', celestialResistance: 'Celestial Resistance',
  healingHands: 'Healing Hands', stonecunning: 'Stonecunning', heroicInspiration: 'Resourceful', cloudsJaunt: 'Cloud\'s Jaunt', firesBurn: 'Fire\'s Burn',
  frostsChill: 'Frost\'s Chill', hillsTumble: 'Hill\'s Tumble', stonesEndurance: 'Stone\'s Endurance', stormsThunder: 'Storm\'s Thunder',
  naturallyStealthy: 'Naturally Stealthy', tacticalMind: 'Tactical Mind',
};

type StepId = 'species' | 'class' | 'background' | 'abilities' | 'options' | 'spells' | 'look' | 'review';
const STEPS: { id: StepId; name: string }[] = [
  { id: 'species', name: 'Species' }, { id: 'class', name: 'Class' }, { id: 'background', name: 'Background' }, { id: 'abilities', name: 'Abilities' },
  { id: 'options', name: 'Skills & Options' }, { id: 'spells', name: 'Spells' }, { id: 'look', name: 'Appearance' }, { id: 'review', name: 'Review' },
];

/** Panels scale with the window like the HUD (designed for 900 px tall). */
function setUiScale() { document.documentElement.style.setProperty('--ui', String(Math.min(1.6, Math.max(0.85, innerHeight / 900)))); }

/** Put `id` into the picks that count now (the first `n`), keeping later picks behind it, at most `max` in all. */
function insertPick<T>(list: T[], id: T, n: number, max: number): T[] {
  const without = list.filter((x) => x !== id);
  const at = Math.min(without.length, Math.max(0, n - 1));
  return [...without.slice(0, at), id, ...without.slice(at)].slice(0, max);
}

/** The room, the camera and the figures standing in it. */
class Room {
  private turning: { id: string; angle: number } | null = null;
  private drag: { x: number; angle: number } | null = null;
  private live = true;
  private shown = new Map<string, string>();
  private readonly onDown = (e: PointerEvent) => { if (this.turning) this.drag = { x: e.clientX, angle: this.turning.angle }; };
  private readonly onMove = (e: PointerEvent) => { if (this.drag && this.turning) this.turning.angle = this.drag.angle + (e.clientX - this.drag.x) * 0.012; };
  private readonly onUp = () => { this.drag = null; };

  constructor(readonly r: PixelRenderer) {
    r.onUpdate(() => {
      if (!this.live) return true;
      if (this.turning) { const f = r.figures.get(this.turning.id); if (f) f.group.rotation.y = this.turning.angle; }
    });
    const cv = r.renderer.domElement;
    cv.addEventListener('pointerdown', this.onDown); addEventListener('pointermove', this.onMove); addEventListener('pointerup', this.onUp);
  }

  /** Show a hero; rebuilt only when the look changed. */
  show(id: string, def: CreatureDef, at: { x: number; y: number }) {
    const key = JSON.stringify(def.look) + def.model;
    if (this.shown.get(id) === key && this.r.figures.has(id)) return;
    const angle = this.r.figures.get(id)?.group.rotation.y ?? FACE_CAMERA;
    this.r.removeFigure(id);
    const f = this.r.addFigure(id, def.model as Archetype, 'party', at.x, at.y, 0, def.look, { lantern: false });
    f.group.rotation.y = angle;
    f.ring.visible = false;
    this.shown.set(id, key);
  }

  hide(id: string) { this.r.removeFigure(id); this.shown.delete(id); }
  clear() { for (const id of [...this.shown.keys()]) this.hide(id); }
  turnable(id: string | null) { this.turning = id ? { id, angle: this.r.figures.get(id)?.group.rotation.y ?? FACE_CAMERA } : null; }
  rotate(by: number) { if (this.turning) this.turning.angle += by; }
  play(id: string, anim: string) { this.r.figures.get(id)?.character.once(anim, { speed: 1.1 }); }

  /** Frame a spot so it sits at screen x `cx` (CSS px), at a close zoom. */
  frame(spot: { x: number; y: number }, cx: number, zoom: number) {
    this.r.setZoom(zoom, true);
    this.r.lookAt(spot.x, spot.y, true);
    this.r.frame(0);
    const p = this.r.project(this.r.worldOf(spot.x, spot.y));
    const s = (this.r.zoom * 2) / innerHeight; // world units per CSS pixel
    const dx = (p.x - cx) * s;
    // screen right is world (+1, 0, −1)/√2
    this.r.lookAt(spot.x + dx / Math.SQRT2, spot.y - dx / Math.SQRT2, true);
  }

  dispose() {
    this.live = false;
    const cv = this.r.renderer.domElement;
    cv.removeEventListener('pointerdown', this.onDown); removeEventListener('pointermove', this.onMove); removeEventListener('pointerup', this.onUp);
    this.clear();
  }
}

// ====================================================================== the creator

export class Creator {
  private c: Choices;
  private step: StepId = 'species';
  private root = document.createElement('div');
  private left!: HTMLElement;
  private sheet!: HTMLElement;
  private tabs!: HTMLElement;
  private rolled: number[] | null = null;
  private resolve!: (c: Choices | null) => void;

  constructor(private room: Room, initial: Choices, private title: string, private id: string) {
    this.c = complete(initial);
  }

  run(): Promise<Choices | null> {
    setUiScale();
    this.root.className = 'creator';
    this.root.innerHTML = `
      <div class="cr-top panel"><span class="cr-title">${esc(this.title)}</span><div class="cr-tabs"></div></div>
      <div class="cr-left panel"></div>
      <div class="cr-sheet panel"></div>
      <div class="cr-bottom">
        <button class="btn secondary" data-act="cancel">Cancel</button>
        <span class="cr-turn"><button class="mini" data-act="turn" data-v="-1" title="Turn left">⟲</button><button class="mini" data-act="turn" data-v="1" title="Turn right">⟳</button></span>
        <button class="btn secondary" data-act="back">Back</button>
        <button class="btn" data-act="next">Next</button>
      </div>`;
    document.body.appendChild(this.root);
    this.left = this.root.querySelector('.cr-left')!;
    this.sheet = this.root.querySelector('.cr-sheet')!;
    this.tabs = this.root.querySelector('.cr-tabs')!;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
    this.room.clear();
    this.room.turnable(this.id);
    this.render();
    const reframe = () => this.frameFigure();
    addEventListener('resize', reframe);
    return new Promise((res) => {
      this.resolve = (v) => { removeEventListener('resize', reframe); this.root.remove(); this.room.turnable(null); this.room.hide(this.id); res(v); };
    });
  }

  private frameFigure() {
    const l = this.left.getBoundingClientRect(), s = this.sheet.getBoundingClientRect();
    this.room.frame(SPOT, (l.right + s.left) / 2, 1.55);
  }

  private set(patch: Partial<Choices>) {
    this.c = complete({ ...this.c, ...patch });
    this.render();
  }

  // ------------------------------------------------------------ rendering

  private render() {
    const scroll = this.left.scrollTop;
    const def = buildCharacter(this.c, 1);
    const errs = validateChoices(this.c, 1);
    this.tabs.innerHTML = STEPS.map((s, i) => `<button class="cr-tab ${s.id === this.step ? 'on' : ''}" data-act="step" data-v="${s.id}"><span>${i + 1}</span>${s.name}</button>`).join('');
    this.left.innerHTML = this.stepHtml(def, errs);
    this.sheet.innerHTML = this.sheetHtml(def, errs);
    this.left.scrollTop = scroll;
    const last = this.step === 'review';
    const next = this.root.querySelector<HTMLButtonElement>('[data-act="next"]')!;
    next.textContent = last ? 'Done' : 'Next';
    next.classList.toggle('disabled', last && errs.length > 0);
    this.root.querySelector<HTMLElement>('[data-act="back"]')!.style.visibility = this.step === 'species' ? 'hidden' : '';
    this.room.show(this.id, def, SPOT);
    this.frameFigure();
  }

  private stepHtml(def: CreatureDef, errs: string[]): string {
    switch (this.step) {
      case 'species': return this.speciesStep();
      case 'class': return this.classStep();
      case 'background': return this.backgroundStep();
      case 'abilities': return this.abilitiesStep();
      case 'options': return this.optionsStep();
      case 'spells': return this.spellsStep(def);
      case 'look': return this.lookStep();
      case 'review': return this.reviewStep(def, errs);
    }
  }

  private card(act: string, v: string, on: boolean, title: string, sub: string, extra = '') {
    return `<button class="cr-card ${on ? 'on' : ''} ${extra}" data-act="${act}" data-v="${esc(v)}"><b>${esc(title)}</b><span>${esc(sub)}</span></button>`;
  }
  private chip(act: string, v: string, on: boolean, label: string, opts: { locked?: string; note?: string; disabled?: boolean; tip?: string } = {}) {
    return `<button class="cr-chip ${on ? 'on' : ''} ${opts.locked ? 'locked' : ''} ${opts.disabled ? 'disabled' : ''}" data-act="${act}" data-v="${esc(v)}" ${opts.tip ? `title="${esc(opts.tip)}"` : ''}>${esc(label)}${opts.note ? `<i>${esc(opts.note)}</i>` : ''}${opts.locked ? `<i>${esc(opts.locked)}</i>` : ''}</button>`;
  }
  private section(title: string, body: string, note = '') {
    return `<section><h4>${esc(title)}${note ? `<small>${note}</small>` : ''}</h4>${body}</section>`;
  }
  private traitList(items: { name: string; text: string; implemented: boolean }[]) {
    return `<ul class="cr-traits">${items.map((t) => `<li class="${t.implemented ? '' : 'later'}"><b>${esc(t.name)}</b> ${esc(t.text)}${t.implemented ? '' : ' <em>Not in the game yet.</em>'}</li>`).join('')}</ul>`;
  }

  private speciesStep(): string {
    const c = this.c, sp = speciesById(c.species);
    let html = `<h3>Species</h3><div class="cr-cards">${SPECIES.map((s) => this.card('species', s.id, s.id === c.species, s.name, `${s.speed} ft${s.darkvision ? ` · darkvision ${s.darkvision}` : ''}`)).join('')}</div>`;
    html += `<p class="cr-blurb">${esc(sp.blurb)}</p>`;
    if (sp.lineages) html += this.section(sp.lineageLabel ?? 'Lineage', `<div class="cr-chips wide">${sp.lineages.map((l) => this.chip('lineage', l.id, l.id === c.lineage, l.name, { note: l.blurb })).join('')}</div>`);
    if (sp.sizes.length > 1) html += this.section('Size', `<div class="cr-chips">${sp.sizes.map((z) => this.chip('size', z, z === c.size, z[0].toUpperCase() + z.slice(1))).join('')}</div>`);
    html += this.section('Traits', this.traitList(sp.traits));
    if (sp.skillChoice) {
      const bgSkills = backgroundById(c.background).skills as Skill[];
      const list = Array.isArray(sp.skillChoice) ? sp.skillChoice : (Object.keys(SKILL_NAME) as Skill[]);
      html += this.section(sp.id === 'elf' ? 'Keen Senses' : 'Skillful', `<div class="cr-chips">${list.map((s) => this.chip('speciesSkill', s, s === c.speciesSkill, SKILL_NAME[s], { disabled: bgSkills.includes(s), locked: bgSkills.includes(s) ? 'background' : undefined })).join('')}</div>`, 'one skill proficiency');
    }
    const hasSpells = !!(sp.lineages?.some((l) => l.cantrip) || sp.id === 'tiefling');
    if (hasSpells) html += this.section('Spellcasting ability', `<div class="cr-chips">${(['int', 'wis', 'cha'] as Ability[]).map((a) => this.chip('speciesAbility', a, a === c.speciesAbility, ABILITY_NAME[a])).join('')}</div>`, 'for your species\' spells');
    if (sp.originFeat) {
      html += this.section('Versatile: an extra origin feat', `<div class="cr-chips">${(Object.keys(ORIGIN_FEATS) as OriginFeatId[]).map((f) => this.chip('versatileFeat', f, f === c.versatileFeat, ORIGIN_FEATS[f].name, { tip: ORIGIN_FEATS[f].text, note: ORIGIN_FEATS[f].implemented ? undefined : 'not in yet', disabled: f === backgroundById(c.background).feat && f !== 'skilled' && f !== 'magicInitiate' })).join('')}</div>
        <p class="cr-note">${esc(ORIGIN_FEATS[c.versatileFeat!].text)}</p>${this.featOptions(1)}`);
    }
    return html;
  }

  private classStep(): string {
    const c = this.c, cls = CLASSES[c.cls];
    let html = `<h3>Class</h3><div class="cr-cards">${Object.values(CLASSES).map((k) => this.card('cls', k.id, k.id === c.cls, k.name, `d${k.hitDie} · ${k.primary.map((a) => a.toUpperCase()).join(' / ')}`)).join('')}</div>`;
    html += `<p class="cr-blurb">${esc(cls.blurb)}</p>`;
    const armor = [...cls.armor.map((a) => a[0].toUpperCase() + a.slice(1)), ...(cls.shields ? ['Shields'] : [])].join(', ') || 'None';
    html += `<div class="cr-facts"><span>Hit die <b>d${cls.hitDie}</b></span><span>Saves <b>${cls.saves.map((a) => ABILITY_NAME[a]).join(', ')}</b></span><span>Armor <b>${armor}</b></span><span>Weapons <b>${cls.martial === true ? 'Simple, Martial' : cls.martial ? 'Simple, Martial (Finesse or Light)' : 'Simple'}</b></span></div>`;
    html += this.section('Starting equipment', `<div class="cr-chips wide">${cls.kits.map((k) => this.chip('kit', k.id, k.id === c.kit, k.name, { note: k.text, disabled: k.needs === 'protector' && c.divineOrder !== 'protector' })).join('')}</div>`, 'plus a Potion of Healing');
    html += this.section(`Features, levels 1–4 (${cls.subclass} at 3)`, `<ul class="cr-traits">${cls.text.map((t) => `<li class="${t.implemented ? '' : 'later'}"><span class="lvl">${t.level}</span><b>${esc(t.name)}</b> ${esc(t.text)}${t.implemented ? '' : ' <em>Not in the game yet.</em>'}</li>`).join('')}</ul>`);
    return html;
  }

  private backgroundStep(): string {
    const c = this.c, bg = backgroundById(c.background);
    let html = `<h3>Background</h3><div class="cr-cards small">${BACKGROUNDS.map((b) => this.card('background', b.id, b.id === c.background, b.name, `${ORIGIN_FEATS[b.feat].name} · ${b.abilities.map((a) => a.toUpperCase()).join(' ')}`)).join('')}</div>`;
    html += `<p class="cr-blurb">${esc(bg.blurb)}</p>`;
    const plus2 = bg.abilities.find((a) => c.boosts[a] === 2);
    const plus1 = bg.abilities.find((a) => c.boosts[a] === 1 && !plus2 ? false : c.boosts[a] === 1);
    const even = bg.abilities.every((a) => c.boosts[a] === 1);
    html += this.section('Ability increases', `
      <div class="cr-boost"><span>+2</span>${bg.abilities.map((a) => this.chip('boost2', a, !even && plus2 === a, ABILITY_NAME[a])).join('')}</div>
      <div class="cr-boost"><span>+1</span>${bg.abilities.map((a) => this.chip('boost1', a, !even && plus1 === a, ABILITY_NAME[a], { disabled: plus2 === a && !even })).join('')}</div>
      <div class="cr-boost"><span></span>${this.chip('boostEven', '1', even, '+1 to all three')}</div>`);
    html += this.section('Skill proficiencies', `<p class="cr-note">${bg.skills.map((s) => SKILL_NAME[s]).join(', ')}</p>`);
    const f = ORIGIN_FEATS[bg.feat];
    html += this.section(`Origin feat: ${f.name}`, `<p class="cr-note">${esc(f.text)}${f.implemented ? '' : ' <em>Not in the game yet.</em>'}</p>${this.featOptions(0)}`);
    return html;
  }

  /** Options for the origin feat at `i` (Magic Initiate, Skilled). */
  private featOptions(i: number): string {
    const feats = originFeats(this.c, 1);
    const f = feats[i];
    if (!f) return '';
    const ch = this.c.feats?.[i] ?? {};
    if (f.id === 'skilled') {
      const others = new Set(proficientSkills({ ...this.c, feats: this.c.feats?.map((x, k) => (k === i ? {} : x)) }, 1));
      return `<p class="cr-sub">Three skills (${(ch.skills ?? []).length}/3)</p><div class="cr-chips">${(Object.keys(SKILL_NAME) as Skill[]).map((s) => this.chip(`skilled${i}`, s, !!ch.skills?.includes(s), SKILL_NAME[s], { disabled: others.has(s), locked: others.has(s) ? 'have it' : undefined })).join('')}</div>`;
    }
    if (f.id === 'magicInitiate') {
      const list = f.choice.list ?? ch.list ?? 'wizard';
      const pool = MAGIC_INITIATE[list];
      const fixed = i === 0 && !!backgroundById(this.c.background).magicList;
      return `${fixed ? `<p class="cr-sub">The ${list} spell list</p>` : `<p class="cr-sub">Spell list</p><div class="cr-chips">${(['cleric', 'druid', 'wizard'] as const).map((l) => this.chip(`miList${i}`, l, l === list, l[0].toUpperCase() + l.slice(1))).join('')}</div>`}
        <p class="cr-sub">Two cantrips (${(ch.cantrips ?? []).length}/2)</p><div class="cr-chips">${pool.cantrips.map((id) => this.chip(`miCantrip${i}`, id, !!ch.cantrips?.includes(id), spellName(id), { tip: spellText(id) })).join('')}</div>
        <p class="cr-sub">A 1st-level spell, free once per Long Rest</p><div class="cr-chips">${pool.spells.map((id) => this.chip(`miSpell${i}`, id, ch.spell === id, spellName(id), { tip: spellText(id) })).join('')}</div>
        <p class="cr-sub">Spellcasting ability</p><div class="cr-chips">${(['int', 'wis', 'cha'] as Ability[]).map((a) => this.chip(`miAbility${i}`, a, ch.ability === a, ABILITY_NAME[a])).join('')}</div>`;
    }
    return '';
  }

  private abilitiesStep(): string {
    const c = this.c, cls = CLASSES[c.cls];
    const method = c.scoreMethod;
    const cost = pointBuyCost(c.base);
    let html = `<h3>Ability Scores</h3>
      <div class="cr-chips">${this.chip('method', 'standard', method === 'standard', 'Standard array')}${this.chip('method', 'pointBuy', method === 'pointBuy', 'Point buy')}${this.chip('method', 'rolled', method === 'rolled', 'Roll 4d6')}</div>`;
    if (method === 'standard') html += `<p class="cr-note">Assign 15, 14, 13, 12, 10 and 8. Pick a value to swap it with the ability that has it.</p>`;
    if (method === 'pointBuy') html += `<p class="cr-note">Scores start at 8. <b class="${cost > POINT_BUY_BUDGET ? 'bad' : ''}">${POINT_BUY_BUDGET - cost} of ${POINT_BUY_BUDGET} points left.</b> 14 and 15 cost 2 each.</p>`;
    if (method === 'rolled') html += `<p class="cr-note">${this.rolled ? `Rolled: <b>${this.rolled.join(', ')}</b>. Pick a value to swap.` : 'Roll four d6 and drop the lowest, six times.'} <button class="mini" data-act="roll">Roll</button></p>`;
    const pool = method === 'rolled' ? this.rolled ?? ABILITIES.map((a) => c.base[a]) : STANDARD_ARRAY;
    html += `<table class="cr-abil"><tr><th></th><th>Base</th><th>Bonus</th><th>Score</th><th>Mod</th></tr>${ABILITIES.map((a) => {
      const bonus = c.boosts[a] ?? 0, total = Math.min(20, c.base[a] + bonus);
      const primary = cls.primary.includes(a);
      const ctrl = method === 'pointBuy'
        ? `<button class="mini" data-act="pb" data-v="${a}:-1" ${c.base[a] <= 8 ? 'disabled' : ''}>−</button><b>${c.base[a]}</b><button class="mini" data-act="pb" data-v="${a}:1" ${c.base[a] >= 15 || POINT_BUY_COST[c.base[a] + 1] - POINT_BUY_COST[c.base[a]] > POINT_BUY_BUDGET - cost ? 'disabled' : ''}>+</button>`
        : `<select data-act="assign" data-v="${a}">${[...new Set(pool)].sort((x, y) => y - x).map((v) => `<option ${v === c.base[a] ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
      return `<tr class="${primary ? 'primary' : ''}"><td>${ABILITY_NAME[a]}${primary ? ' <i>★</i>' : ''}</td><td class="ctrl">${ctrl}</td><td>${bonus ? `+${bonus}` : ''}</td><td><b>${total}</b></td><td>${sign(abilityMod(total))}</td></tr>`;
    }).join('')}</table>
      <p class="cr-note">★ ${cls.name}s rely on ${cls.primary.map((a) => ABILITY_NAME[a]).join(' and ')}. Bonuses come from your background (step 3).</p>
      <button class="mini" data-act="suggest">Arrange for a ${cls.name}</button>`;
    return html;
  }

  private optionsStep(): string {
    const c = this.c, cls = CLASSES[c.cls], bg = backgroundById(c.background);
    const granted = new Map<Skill, string>();
    for (const s of bg.skills) granted.set(s, 'background');
    if (c.speciesSkill) granted.set(c.speciesSkill, 'species');
    c.feats?.forEach((f) => f.skills?.forEach((s) => granted.set(s, 'feat')));
    let html = `<h3>Skills &amp; Options</h3>`;
    html += this.section(`${cls.name} skills`, `<div class="cr-chips">${cls.skillList.map((s) => this.chip('skill', s, c.skills.includes(s), SKILL_NAME[s], { locked: granted.get(s), disabled: granted.has(s) })).join('')}</div>`, `${c.skills.length} of ${cls.skillCount}`);
    if (c.cls === 'rogue') {
      const prof = proficientSkills(c, 1);
      html += this.section('Expertise', `<div class="cr-chips">${prof.map((s) => this.chip('expertise', s, !!c.expertise?.includes(s), SKILL_NAME[s])).join('')}</div>`, 'double proficiency in two skills');
    }
    if (c.cls === 'wizard') {
      const prof = proficientSkills(c, 2);
      html += this.section('Scholar (level 2)', `<div class="cr-chips">${SCHOLAR_SKILLS.map((s) => this.chip('scholar', s, c.scholar === s, SKILL_NAME[s], { disabled: !prof.includes(s), locked: prof.includes(s) ? undefined : 'not proficient' })).join('')}</div>`, 'expertise in one of these');
    }
    if (cls.fightingStyleLevel) {
      html += this.section(`Fighting Style${cls.fightingStyleLevel > 1 ? ` (level ${cls.fightingStyleLevel})` : ''}`, `<div class="cr-chips wide">${(Object.keys(FIGHTING_STYLES) as FightingStyle[]).map((f) => this.chip('style', f, c.fightingStyle === f, FIGHTING_STYLES[f].name, { note: FIGHTING_STYLES[f].text })).join('')}</div>`);
    }
    if (c.cls === 'cleric') {
      html += this.section('Divine Order', `<div class="cr-chips wide">${this.chip('order', 'protector', c.divineOrder === 'protector', 'Protector', { note: 'Martial weapons and Heavy armor.' })}${this.chip('order', 'thaumaturge', c.divineOrder === 'thaumaturge', 'Thaumaturge', { note: 'An extra cantrip; + WIS to Arcana and Religion.' })}</div>`);
    }
    const n1 = cls.masteries[1] ?? 0;
    if (n1) {
      const protector = c.divineOrder === 'protector';
      const kitIds = cls.kits.find((k) => k.id === c.kit)!.weapons.map((w) => w.id);
      const weapons = Object.values(WEAPONS).filter((w) => proficientWith(c.cls, w, protector)).sort((a, b) => Number(kitIds.includes(b.id)) - Number(kitIds.includes(a.id)));
      const m = c.masteries ?? [];
      html += this.section('Weapon Mastery', `<div class="cr-chips">${weapons.map((w) => {
        const i = m.indexOf(w.id);
        return this.chip('mastery', w.id, i >= 0 && i < n1, w.name, { note: `${w.mastery}${i >= n1 ? ' · level 4' : ''}`, tip: kitIds.includes(w.id) ? 'In your starting kit' : undefined });
      }).join('')}</div>`, `${Math.min(n1, m.length)} of ${n1}${(cls.masteries[4] ?? 0) > n1 ? ', one more at level 4' : ''} · your kit's weapons first`);
    }
    return html;
  }

  private spellsStep(def: CreatureDef): string {
    const c = this.c, cls = CLASSES[c.cls], casting = cls.casting;
    let html = `<h3>Spells</h3>`;
    const extras = (def.spellcasting?.spells ?? []).filter((s) => s.castWith || s.free);
    if (!casting) html += `<p class="cr-note">${cls.name}s don't cast spells at these levels.</p>`;
    else {
      const extra = c.divineOrder === 'thaumaturge' ? 1 : 0;
      const n1 = casting.cantrips[1] + extra;
      if (n1) {
        const list = c.cantrips ?? [];
        html += this.section('Cantrips', `<div class="cr-chips wide">${casting.cantripList.map((id) => {
          const i = list.indexOf(id);
          return this.chip('cantrip', id, i >= 0 && i < n1, spellName(id), { note: `${i >= n1 ? 'level 4 · ' : ''}${spellText(id)}` });
        }).join('')}</div>`, `${Math.min(n1, list.length)} of ${n1}`);
      }
      const always = (ALWAYS_PREPARED[c.cls] ?? []).flatMap((g) => g.spells.map((id) => ({ id, level: g.level })));
      const ones = casting.list.filter((id) => spellLevel(id) === 1);
      const firsts = (c.spells ?? []).filter((id) => spellLevel(id) === 1);
      const prep = casting.prepared[1];
      if (casting.spellbook) {
        html += this.section('Spellbook', `<p class="cr-note">Six 1st-level spells go in your spellbook; you prepare ${prep} of them each day (★). Click a spell in the book to prepare it or put it back; click again to take it out.</p>
          <div class="cr-chips wide">${ones.map((id) => { const i = firsts.indexOf(id); return this.chip('spell', id, i >= 0, `${i >= 0 && i < prep ? '★ ' : ''}${spellName(id)}`, { note: spellText(id) }); }).join('')}</div>`, `${firsts.length} of 6 · ${Math.min(prep, firsts.length)} prepared`);
      } else {
        html += this.section('Prepared spells', `<div class="cr-chips wide">${ones.map((id) => { const i = firsts.indexOf(id); return this.chip('spell', id, i >= 0 && i < prep, spellName(id), { note: spellText(id) }); }).join('')}</div>`, `${Math.min(prep, firsts.length)} of ${prep} at level 1 · more each level`);
      }
      if (always.length) html += this.section('Always prepared', `<ul class="cr-traits">${always.map((a) => `<li><span class="lvl">${a.level}</span><b>${esc(spellName(a.id))}</b> ${esc(spellText(a.id))}</li>`).join('')}</ul>`, 'from your class and subclass');
    }
    if (extras.length) html += this.section('From your species and feats', `<ul class="cr-traits">${extras.map((s) => `<li><b>${esc(s.name)}</b> ${s.free ? 'Free once per Long Rest. ' : ''}${s.castWith ? `Cast with ${ABILITY_NAME[s.castWith.ability]}. ` : ''}${esc(s.description)}</li>`).join('')}</ul>`);
    return html;
  }

  private lookStep(): string {
    const c = this.c, look = lookFor(c.species, c.lineage, c.cls, CLASSES[c.cls].kits.find((k) => k.id === c.kit)!, c.look);
    const pick = c.look ?? {};
    const skinI = swatchIndex(SKIN_SWATCHES, pick.skin === undefined ? look.skin : pick.skin);
    const hairI = swatchIndex(HAIR_SWATCHES, pick.hair ?? null);
    const sw = (act: string, list: typeof SKIN_SWATCHES, sel: number, base: string) => list.map((s, i) => {
      const t = s.tint;
      const bg = t ? `hsl(${Math.round(t.hue * 360)} ${Math.round(t.sat * 100)}% ${Math.round(Math.min(92, (act === 'hair' ? 32 : 70) * t.light))}%)` : base;
      return `<button class="cr-swatch ${i === sel ? 'on' : ''}" data-act="${act}" data-v="${i}" title="${esc(s.name)}" style="background:${bg}"></button>`;
    }).join('');
    return `<h3>Appearance</h3>
      ${this.section('Name', `<input class="cr-name" data-act="name" maxlength="20" value="${esc(c.name)}" placeholder="Your hero's name">`)}
      ${this.section('Outfit', `<div class="cr-chips">${BODIES.map((b) => this.chip('body', b.id, look.body === b.id, b.name)).join('')}</div>
        <div class="cr-chips">${this.chip('hat', '1', look.hat, 'Hat or helmet')}${this.chip('cape', '1', look.cape, 'Cape')}</div>`, 'weapons follow your starting kit')}
      ${this.section('Skin', `<div class="cr-swatches">${sw('skin', SKIN_SWATCHES, skinI, 'linear-gradient(135deg,#f0c8a0,#d09a70)')}</div>`)}
      ${this.section('Hair', `<div class="cr-swatches">${sw('hair', HAIR_SWATCHES, hairI, 'hsl(14 60% 34%)')}</div>`)}
      ${this.section('Height', `<input type="range" min="0.9" max="1.1" step="0.02" data-act="height" value="${pick.height ?? 1}">`)}
      <p class="cr-note">Drag the figure to turn it.</p>`;
  }

  private reviewStep(def: CreatureDef, errs: string[]): string {
    const c = this.c;
    const feats = originFeats(c, 1).map((f) => ORIGIN_FEATS[f.id].name).join(', ');
    let html = `<h3>${esc(c.name || 'Unnamed hero')}</h3><p class="cr-blurb">${esc(def.description ?? '')} · ${esc(backgroundById(c.background).name)} · ${esc(feats)}</p>`;
    if (errs.length) html += this.section('Still to choose', `<ul class="cr-errors">${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`);
    else html += `<p class="cr-ready">Ready. Press <b>Done</b> to join the party.</p>`;
    html += this.section('Features', `<p class="cr-note">${def.features.map((f) => FEATURE_NAME[f] ?? f).join(' · ')}</p>`);
    const res = [...(def.resist ?? [])];
    if (res.length) html += this.section('Resistances', `<p class="cr-note">${res.map((r) => r[0].toUpperCase() + r.slice(1)).join(', ')}</p>`);
    html += this.section('Inventory', `<p class="cr-note">${Object.entries(def.inventory ?? {}).map(([k, v]) => `${v} × ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(', ')}</p>`);
    return html;
  }

  private sheetHtml(def: CreatureDef, errs: string[]): string {
    const pb = def.pb;
    const init = abilityMod(def.abilities.dex) + (def.features.includes('alert') ? pb : 0);
    const profSkills = proficientSkills(this.c, 1);
    const book = def.spellcasting;
    const cantrips = book?.spells.filter((s) => s.level === 0 && !s.uses) ?? [];
    const leveled = book?.spells.filter((s) => s.level > 0) ?? [];
    const powers = book?.spells.filter((s) => s.level === 0 && s.uses) ?? [];
    return `
      <div class="sh-name">${esc(this.c.name || 'Unnamed')}</div>
      <div class="sh-sub">${esc(def.description ?? '')}</div>
      <div class="sh-stats">
        <div><b>${def.maxHp}</b><span>HP</span></div><div><b>${def.ac}</b><span>AC</span></div>
        <div><b>${def.speed}</b><span>Speed</span></div><div><b>${sign(init)}</b><span>Init</span></div>
      </div>
      <div class="sh-abil">${ABILITIES.map((a) => `<div class="${def.saveProfs.includes(a) ? 'save' : ''}" title="${ABILITY_NAME[a]}${def.saveProfs.includes(a) ? ' (saving throw proficiency)' : ''}"><span>${a.toUpperCase()}</span><b>${def.abilities[a]}</b><i>${sign(abilityMod(def.abilities[a]))}</i></div>`).join('')}</div>
      <h5>Attacks</h5>${def.attacks.map((a) => `<div class="sh-row"><span>${esc(a.name)}</span><span>${sign(a.toHit)} · ${esc(formatDice(a.damage))} ${a.damageType}${a.mastery ? ` · ${a.mastery}` : ''}</span></div>`).join('')}
      ${book && (cantrips.length || leveled.length || powers.length) ? `<h5>Spells${book.slots[1] ? ` · ${book.slots[1]} slots` : ''}${leveled.length || cantrips.some((s) => !s.castWith) ? ` · DC ${book.dc}` : ''}</h5>
        ${cantrips.length ? `<div class="sh-list">${cantrips.map((s) => esc(s.name)).join(', ')}</div>` : ''}
        ${leveled.length ? `<div class="sh-list">${leveled.map((s) => esc(s.name) + (s.free ? ' (free)' : '')).join(', ')}</div>` : ''}
        ${powers.length ? `<div class="sh-list">${powers.map((s) => esc(s.name)).join(', ')}</div>` : ''}` : ''}
      <h5>Skills</h5><div class="sh-list">${profSkills.map((s) => `${SKILL_NAME[s]} ${sign(def.skills[s] ?? 0)}`).join(', ')}</div>
      ${errs.length ? `<div class="sh-warn">${errs.length} thing${errs.length > 1 ? 's' : ''} left to choose</div>` : ''}`;
  }

  // ------------------------------------------------------------ input

  private onInput(e: Event) {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const act = t.dataset.act;
    if (act === 'name' && e.type === 'input') { this.c.name = t.value; this.sheet.querySelector('.sh-name')!.textContent = t.value || 'Unnamed'; return; }
    if (act === 'name') { this.set({}); return; }
    if (act === 'height') { this.set({ look: { ...this.c.look, height: Number(t.value) } }); return; }
    if (act === 'assign' && e.type === 'change') {
      const a = t.dataset.v as Ability, v = Number(t.value);
      const base = { ...this.c.base };
      const other = ABILITIES.find((b) => b !== a && base[b] === v);
      if (other) base[other] = base[a];
      base[a] = v;
      this.set({ base });
    }
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || el.classList.contains('disabled') || (el as HTMLButtonElement).disabled) return;
    const act = el.dataset.act!, v = el.dataset.v ?? '';
    const c = this.c;
    const toggle = <T>(list: T[] | undefined, x: T, max: number) => (list?.includes(x) ? list.filter((y) => y !== x) : [...(list ?? []), x].slice(-max));
    const feat = (i: number, patch: Partial<FeatChoice>) => { const feats = [...(c.feats ?? [])]; feats[i] = { ...(feats[i] ?? {}), ...patch }; this.set({ feats }); };
    switch (act) {
      case 'cancel': this.resolve(null); return;
      case 'next': {
        const i = STEPS.findIndex((s) => s.id === this.step);
        if (this.step === 'review') { if (!validateChoices(c, 1).length) this.resolve(c); return; }
        this.step = STEPS[i + 1].id; this.left.scrollTop = 0; this.render(); return;
      }
      case 'back': { const i = STEPS.findIndex((s) => s.id === this.step); if (i > 0) { this.step = STEPS[i - 1].id; this.left.scrollTop = 0; this.render(); } return; }
      case 'step': this.step = v as StepId; this.left.scrollTop = 0; this.render(); return;
      case 'turn': this.room.rotate(Number(v) * 0.6); return;
      case 'species': this.set({ species: v, lineage: undefined, size: undefined, speciesSkill: c.speciesSkill }); return;
      case 'lineage': this.set({ lineage: v }); return;
      case 'size': this.set({ size: v as Choices['size'] }); return;
      case 'speciesSkill': this.set({ speciesSkill: v as Skill }); return;
      case 'speciesAbility': this.set({ speciesAbility: v as Ability }); return;
      case 'versatileFeat': { const feats = [...(c.feats ?? [])]; feats[1] = {}; this.set({ versatileFeat: v as OriginFeatId, feats }); return; }
      case 'cls': {
        // a new class: place the scores for it if they're the standard array
        const cls = v as ClassId;
        this.set({ cls, kit: '', fightingStyle: undefined, masteries: undefined, cantrips: undefined, spells: undefined, level4: undefined, ...(c.scoreMethod === 'standard' ? { base: placeScores(STANDARD_ARRAY, cls) } : {}) });
        this.room.play(this.id, 'Cheer');
        return;
      }
      case 'kit': this.set({ kit: v }); return;
      case 'background': { const feats = [...(c.feats ?? [])]; feats[0] = {}; this.set({ background: v, boosts: {}, feats }); return; }
      case 'boost2': { const one = backgroundById(c.background).abilities.find((a) => c.boosts[a] === 1 && a !== v) ?? backgroundById(c.background).abilities.find((a) => a !== v)!; this.set({ boosts: { [v]: 2, [one]: 1 } }); return; }
      case 'boost1': { const two = backgroundById(c.background).abilities.find((a) => c.boosts[a] === 2) ?? backgroundById(c.background).abilities.find((a) => a !== v)!; if (two !== v) this.set({ boosts: { [two]: 2, [v]: 1 } }); return; }
      case 'boostEven': this.set({ boosts: Object.fromEntries(backgroundById(c.background).abilities.map((a) => [a, 1])) }); return;
      case 'method':
        if (v === 'rolled' && !this.rolled) this.rolled = rollScores(() => 1 + Math.floor(Math.random() * 6));
        this.set({ scoreMethod: v as Choices['scoreMethod'], base: v === 'rolled' ? placeScores(this.rolled!, c.cls) : placeScores(STANDARD_ARRAY, c.cls) });
        return;
      case 'roll': this.rolled = rollScores(() => 1 + Math.floor(Math.random() * 6)); this.set({ base: placeScores(this.rolled, c.cls) }); return;
      case 'suggest': this.set({ base: c.scoreMethod === 'pointBuy' ? placeScores(STANDARD_ARRAY, c.cls) : placeScores(ABILITIES.map((a) => c.base[a]), c.cls) }); return;
      case 'pb': { const [a, d] = v.split(':'); this.set({ base: { ...c.base, [a]: c.base[a as Ability] + Number(d) } }); return; }
      case 'skill': this.set({ skills: toggle(c.skills, v as Skill, CLASSES[c.cls].skillCount) }); return;
      case 'expertise': this.set({ expertise: toggle(c.expertise, v as Skill, 2) }); return;
      case 'scholar': this.set({ scholar: v as Skill }); return;
      case 'style': this.set({ fightingStyle: v as FightingStyle }); return;
      case 'order': this.set({ divineOrder: v as Choices['divineOrder'], kit: v === 'protector' ? 'protector' : c.kit === 'protector' ? 'cleric' : c.kit, cantrips: c.cantrips }); return;
      case 'mastery': {
        const cls = CLASSES[c.cls], n1 = cls.masteries[1], m = c.masteries ?? [];
        const i = m.indexOf(v);
        this.set({ masteries: i >= 0 && i < n1 ? m.filter((x) => x !== v) : insertPick(m, v, n1, cls.masteries[4]) });
        return;
      }
      case 'cantrip': {
        const casting = CLASSES[c.cls].casting!, extra = c.divineOrder === 'thaumaturge' ? 1 : 0;
        const n1 = casting.cantrips[1] + extra, list = c.cantrips ?? [];
        const i = list.indexOf(v);
        this.set({ cantrips: i >= 0 && i < n1 ? list.filter((x) => x !== v) : insertPick(list, v, n1, casting.cantrips[4] + extra) });
        return;
      }
      case 'spell': {
        const casting = CLASSES[c.cls].casting!, prep = casting.prepared[1];
        const all = c.spells ?? [];
        const firsts = all.filter((id) => spellLevel(id) === 1), rest = all.filter((id) => spellLevel(id) !== 1);
        const i = firsts.indexOf(v);
        let next: string[];
        if (casting.spellbook) {
          if (i < 0) next = insertPick(firsts, v, prep, 6);
          else if (i < prep) next = [...firsts.filter((x) => x !== v), v]; // unprepare: to the back of the book
          else next = firsts.filter((x) => x !== v);
        } else next = i >= 0 && i < prep ? firsts.filter((x) => x !== v) : insertPick(firsts, v, prep, casting.list.filter((id) => spellLevel(id) === 1).length);
        this.set({ spells: [...next, ...rest] });
        return;
      }
      case 'body': this.set({ look: { ...c.look, body: v as NonNullable<Choices['look']>['body'] } }); return;
      case 'hat': this.set({ look: { ...c.look, hat: !lookFor(c.species, c.lineage, c.cls, CLASSES[c.cls].kits.find((k) => k.id === c.kit)!, c.look).hat } }); return;
      case 'cape': this.set({ look: { ...c.look, cape: !lookFor(c.species, c.lineage, c.cls, CLASSES[c.cls].kits.find((k) => k.id === c.kit)!, c.look).cape } }); return;
      case 'skin': this.set({ look: { ...c.look, skin: SKIN_SWATCHES[Number(v)].tint } }); return;
      case 'hair': this.set({ look: { ...c.look, hair: HAIR_SWATCHES[Number(v)].tint } }); return;
      default: break;
    }
    const m = /^(skilled|miList|miCantrip|miSpell|miAbility)(\d)$/.exec(act);
    if (m) {
      const i = Number(m[2]), cur = c.feats?.[i] ?? {};
      if (m[1] === 'skilled') feat(i, { skills: toggle(cur.skills, v as Skill, 3) });
      if (m[1] === 'miList') feat(i, { list: v as FeatChoice['list'], cantrips: [], spell: undefined });
      if (m[1] === 'miCantrip') feat(i, { cantrips: toggle(cur.cantrips, v, 2) });
      if (m[1] === 'miSpell') feat(i, { spell: v });
      if (m[1] === 'miAbility') feat(i, { ability: v as Ability });
    }
  }
}

// ====================================================================== the party screen

interface PartySlot { build: HeroBuild | null; id: string; preset?: string }

/** Choose the party: your own hero and three companions (the ready-made heroes, which you can edit). */
export class PartyScreen {
  private room: Room;
  private slots: PartySlot[];
  private root = document.createElement('div');
  private resolve!: (b: HeroBuild[] | null) => void;

  constructor(r: PixelRenderer, private level: Level) {
    this.room = new Room(r);
    this.slots = [
      { build: null, id: 'hero' },
      ...['torvald', 'maren', 'elowen'].map((p) => ({ build: { choices: structuredClone(PRESET_CHOICES[p]), level }, id: p, preset: p })),
    ];
  }

  run(): Promise<HeroBuild[] | null> {
    setUiScale();
    this.root.className = 'creator party-screen';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.onClick(e));
    const reframe = () => this.frame();
    addEventListener('resize', reframe);
    this.render();
    return new Promise((res) => {
      this.resolve = (v) => { removeEventListener('resize', reframe); this.root.remove(); this.room.dispose(); res(v); };
    });
  }

  private frame() { this.room.frame(LINEUP[1], innerWidth / 2 + (2.0 / 4) * 0, 2.6); this.room.r.lookAt(5.5, 5.5, true); }

  private def(s: PartySlot): CreatureDef | null { return s.build ? buildCharacter(s.build.choices!, s.build.level) : null; }

  private render() {
    this.room.turnable(null);
    this.slots.forEach((s, i) => {
      const d = this.def(s);
      if (d) this.room.show(s.id, d, LINEUP[i]); else this.room.hide(s.id);
    });
    this.frame();
    const ready = this.slots.every((s) => s.build && !validateChoices(s.build.choices!, 1).length);
    this.root.innerHTML = `
      <div class="cr-top panel"><span class="cr-title">Your Party</span><span class="cr-hint">Make your own hero, then pick three companions. Any of them can be edited.</span></div>
      <div class="party-row">${this.slots.map((s, i) => this.slotHtml(s, i)).join('')}</div>
      <div class="cr-bottom">
        <button class="btn secondary" data-act="title">Back</button>
        <button class="btn ${ready ? '' : 'disabled'}" data-act="start">Begin the Adventure</button>
      </div>`;
  }

  private slotHtml(s: PartySlot, i: number): string {
    const d = this.def(s);
    const head = i === 0 ? 'Your hero' : `Companion ${i}`;
    if (!d) {
      return `<div class="party-slot panel empty"><h5>${head}</h5><button class="btn" data-act="create" data-v="${i}">Create your hero</button>
        <button class="mini" data-act="cycle" data-v="${i}">or take a ready-made hero</button></div>`;
    }
    return `<div class="party-slot panel"><h5>${head}</h5>
      <div class="ps-name">${esc(d.name)}</div><div class="ps-sub">${esc(d.description ?? '')}</div>
      <div class="ps-stats"><span>HP <b>${d.maxHp}</b></span><span>AC <b>${d.ac}</b></span><span>Speed <b>${d.speed}</b></span></div>
      <div class="ps-buttons">
        <button class="mini" data-act="edit" data-v="${i}">${icon('stand', 14)} Edit</button>
        ${i === 0 ? `<button class="mini" data-act="create" data-v="${i}">New</button>` : ''}
        <button class="mini" data-act="cycle" data-v="${i}" title="Swap for another ready-made hero">⇄ Swap</button>
      </div></div>`;
  }

  private async onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || el.classList.contains('disabled')) return;
    const act = el.dataset.act!, i = Number(el.dataset.v ?? 0);
    const s = this.slots[i];
    switch (act) {
      case 'title': this.resolve(null); return;
      case 'start':
        this.resolve(this.slots.map((x) => x.build!));
        return;
      case 'cycle': {
        // the next ready-made hero nobody else is using
        const ids = Object.keys(PRESET_CHOICES);
        const used = new Set(this.slots.filter((_, k) => k !== i).map((x) => x.preset));
        const start = s.preset ? ids.indexOf(s.preset) : -1;
        for (let k = 1; k <= ids.length; k++) {
          const p = ids[(start + k) % ids.length];
          if (!used.has(p)) { this.room.hide(s.id); this.slots[i] = { build: { choices: structuredClone(PRESET_CHOICES[p]), level: this.level }, id: i === 0 ? 'hero' : p, preset: p }; break; }
        }
        if (i === 0 && this.slots[0].build) this.slots[0].build.choices!.id = 'hero';
        this.render();
        return;
      }
      case 'create': case 'edit': {
        const initial = act === 'edit' && s.build ? s.build.choices! : newChoices('');
        this.root.style.display = 'none';
        this.slots.forEach((x) => this.room.hide(x.id));
        const id = i === 0 ? 'hero' : s.id;
        const out = await new Creator(this.room, { ...initial, id }, i === 0 ? 'Create your hero' : `Edit ${initial.name}`, id).run();
        this.root.style.display = '';
        if (out) this.slots[i] = { build: { choices: { ...out, id }, level: this.level }, id, preset: act === 'edit' ? s.preset : undefined };
        this.render();
        return;
      }
    }
  }
}

/** Make the party, on a renderer that's showing the dressing room. Resolves null if the player backs out. */
export function chooseParty(r: PixelRenderer, level: Level): Promise<HeroBuild[] | null> {
  r.lookAt(SPOT.x, SPOT.y, true);
  return new PartyScreen(r, level).run();
}

export const _test = { insertPick, PRIORITY };
