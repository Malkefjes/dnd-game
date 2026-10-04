// Phase 1 rules: the Paladin, species traits, origin feats, Fighting Styles, Cleave, temporary HP.
import { describe, expect, it } from 'vitest';
import { Combat, RuleError, type GameEvent } from '../src/engine/combat';
import { RiggedRng } from '../src/engine/dice';
import { Grid, type Pos } from '../src/engine/grid';
import type { CreatureDef } from '../src/engine/types';
import { buildCharacter, type Choices } from '../src/data/build/builder';
import { maren, torvald } from '../src/data/heroes';
import { goblinWarrior, skeleton, zombie } from '../src/data/monsters';
import { WEAPONS, weaponAttacks } from '../src/data/weapons';
import { areaSquares, spellOf } from '../src/engine/spells';

const OPEN = ['..........', '..........', '..........', '..........', '..........', '..........'];

function arena(placed: [CreatureDef, Pos][], init: number[]) {
  const rng = new RiggedRng([...init]);
  const c = new Combat(Grid.fromRows(OPEN), rng);
  for (const [d, p] of placed) c.add(d, p);
  c.start();
  return { c, rng };
}
const damages = (ev: GameEvent[]) => ev.filter((e) => e.type === 'damage') as Extract<GameEvent, { type: 'damage' }>[];
const attacks = (ev: GameEvent[]) => ev.filter((e) => e.type === 'attack') as Extract<GameEvent, { type: 'attack' }>[];

/** Dwarf Paladin, Acolyte (Magic Initiate: Bless). STR 15, CHA 16. Longsword with Dueling: +4, 1d8+4. */
const PAL: Choices = {
  id: 'pal', name: 'Pal', species: 'dwarf', cls: 'paladin', background: 'acolyte', scoreMethod: 'standard',
  base: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 }, boosts: { cha: 2, wis: 1 },
  skills: ['athletics', 'medicine'], fightingStyle: 'dueling', masteries: ['longsword', 'javelin'], kit: 'paladin',
  feats: [{ cantrips: ['sacredFlame', 'guidance'], spell: 'bless', ability: 'cha' }],
  spells: ['divineFavor', 'heroism', 'protectionFromEvilAndGood', 'cureWounds', 'shieldOfFaith'],
};
const pal = (level = 2) => buildCharacter(PAL, level);

/** A level 1 fighter (Farmer: Tough, so no Savage Attacker rerolls). STR 17, CON 14. */
const fighter = (o: Partial<Choices> = {}, level = 1) => buildCharacter({
  id: 'f', name: 'F', species: 'dwarf', cls: 'fighter', background: 'farmer', scoreMethod: 'standard',
  base: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }, boosts: { str: 2, con: 1 }, skills: ['perception', 'history'],
  fightingStyle: 'defense', masteries: ['greatsword', 'flail', 'javelin'], kit: 'greatsword', ...o,
}, level);

describe('Paladin', () => {
  it('Divine Smite: asked after a melee hit; the free casting first, +1d8 against undead', () => {
    const { c, rng } = arena([[pal(), { x: 0, y: 0 }], [zombie('z'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 5, 3, 3, 3); // 15 + 4 hits AC 8; longsword 5 + 4; smite 3d8 (2 + 1 for undead)
    const ev = c.execute({ type: 'attack', actor: 'pal', attack: 'longsword', target: 'z' });
    expect(ev.some((e) => e.type === 'cast' && e.spell === 'divineSmite')).toBe(true);
    expect(damages(ev).map((d) => d.amount)).toEqual([9, 9]);
    expect(damages(ev)[1]).toMatchObject({ damageType: 'radiant', parts: ['Divine Smite'] });
    const p = c.get('pal');
    expect(p.resourcesLeft.paladinsSmite).toBe(0);
    expect(p.slotsLeft[1]).toBe(2);
    expect(p.turn.bonusActions).toBe(0);
    expect(c.get('z').hp).toBe(0);
  });

  it('Divine Smite with a slot: the player picks the level; one slot per turn', () => {
    const { c, rng } = arena([[pal(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    const asked: number[][] = [];
    c.decide = (p) => { if (p.kind === 'smite') { asked.push(p.options); return 1; } return true; };
    c.get('pal').resourcesLeft.paladinsSmite = 0;
    rng.push(15, 1, 2, 2); // hit; 1 + 4; smite 2d8 = 4
    c.execute({ type: 'attack', actor: 'pal', attack: 'longsword', target: 'g' });
    expect(asked).toEqual([[1]]);
    expect(c.get('g').hp).toBe(10 - 5 - 4);
    expect(c.get('pal').slotsLeft[1]).toBe(1);
  });

  it('the default policy saves slots for crits, fiends and undead', () => {
    const { c } = arena([[pal(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }], [skeleton('s'), { x: 0, y: 1 }]], [20, 1, 1]);
    expect(c.defaultReaction({ kind: 'smite', reactor: 'pal', target: 'g', options: [1], crit: false })).toBe(false);
    expect(c.defaultReaction({ kind: 'smite', reactor: 'pal', target: 'g', options: [1], crit: true })).toBe(1);
    expect(c.defaultReaction({ kind: 'smite', reactor: 'pal', target: 's', options: [1], crit: false })).toBe(1);
    expect(c.defaultReaction({ kind: 'smite', reactor: 'pal', target: 'g', options: [0, 1], crit: false })).toBe(0);
  });

  it('Lay on Hands heals what is missing from the pool (5 × level)', () => {
    const { c } = arena([[pal(), { x: 0, y: 0 }], [torvald(2), { x: 1, y: 0 }], [goblinWarrior('g'), { x: 6, y: 0 }]], [20, 1, 1]);
    const t = c.get('torvald');
    t.hp = t.maxHp - 4;
    c.execute({ type: 'cast', actor: 'pal', spell: 'layOnHands', slot: 0, targets: ['torvald'] });
    expect(t.hp).toBe(t.maxHp);
    expect(c.get('pal').resourcesLeft.layOnHands).toBe(6);
    expect(c.get('pal').turn.bonusActions).toBe(0);
  });

  it('Magic Initiate: Bless once for free, cast with the chosen ability; then only with slots', () => {
    const { c } = arena([[pal(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 6, y: 0 }]], [20, 1]);
    const p = c.get('pal');
    c.execute({ type: 'cast', actor: 'pal', spell: 'bless', slot: 0, targets: ['pal'] });
    expect(c.cond(p, 'blessed')).toBeTruthy();
    expect(p.resourcesLeft.magicInitiate0).toBe(0);
    expect(p.slotsLeft[1]).toBe(2);
    p.turn.actions = 1;
    expect(() => c.execute({ type: 'cast', actor: 'pal', spell: 'bless', slot: 0, targets: ['pal'] })).toThrow('free casting is used up');
  });

  it('Divine Favor adds 1d4 Radiant to weapon hits', () => {
    const { c, rng } = arena([[pal(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    c.execute({ type: 'cast', actor: 'pal', spell: 'divineFavor', slot: 1 });
    c.get('pal').resourcesLeft.paladinsSmite = 0;
    rng.push(15, 1, 3); // hit; 1 + 4; favor 3. No bonus action left, so no smite question
    const ev = c.execute({ type: 'attack', actor: 'pal', attack: 'longsword', target: 'g' });
    expect(damages(ev).map((d) => [d.amount, d.damageType])).toEqual([[5, 'slashing'], [3, 'radiant']]);
  });

  it('Heroism: temporary HP (CHA) at the start of each turn, lost before HP', () => {
    const { c, rng } = arena([[pal(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 6, y: 0 }]], [20, 1]);
    const p = c.get('pal');
    c.execute({ type: 'cast', actor: 'pal', spell: 'heroism', slot: 1, targets: ['pal'] });
    expect(p.concentration).toBe('heroism');
    c.execute({ type: 'endTurn', actor: 'pal' });
    c.execute({ type: 'endTurn', actor: 'g' });
    expect(p.tempHp).toBe(3);
    rng.push(15); // concentration save
    c.applyDamage(p, 5, 'slashing', []);
    expect(p.tempHp).toBe(0);
    expect(p.hp).toBe(p.maxHp - 2);
    expect(p.concentration).toBe('heroism');
  });

  it('Protection from Evil and Good: needs Holy Water; undead attack the ward with Disadvantage', () => {
    const { c } = arena([[pal(), { x: 0, y: 0 }], [skeleton('s'), { x: 1, y: 0 }], [goblinWarrior('g'), { x: 0, y: 1 }]], [20, 1, 1]);
    const p = c.get('pal');
    expect(() => c.execute({ type: 'cast', actor: 'pal', spell: 'protectionFromEvilAndGood', slot: 1, targets: ['pal'] })).toThrow('Holy Water');
    p.inv.holyWater = 1;
    c.execute({ type: 'cast', actor: 'pal', spell: 'protectionFromEvilAndGood', slot: 1, targets: ['pal'] });
    expect(p.inv.holyWater).toBe(0);
    expect(c.previewAttack(c.get('s'), 'shortsword', p).reasons).toContain('− Protection from Evil and Good');
    expect(c.previewAttack(c.get('g'), 'scimitar', p).mode).toBe('normal');
  });

  it('Sacred Weapon starts the Attack action and adds CHA to melee weapon attacks', () => {
    const { c } = arena([[pal(3), { x: 0, y: 0 }], [skeleton('s'), { x: 1, y: 0 }]], [20, 1]);
    const p = c.get('pal');
    const before = c.previewAttack(p, 'longsword', c.get('s')).attack.toHit;
    c.execute({ type: 'cast', actor: 'pal', spell: 'sacredWeapon', slot: 0 });
    expect(p.turn).toMatchObject({ actions: 0, attacksLeft: 1 });
    expect(p.resourcesLeft.channelDivinity).toBe(1);
    expect(c.previewAttack(p, 'longsword', c.get('s')).attack.toHit).toBe(before + 3);
  });

  it('Divine Smite is always prepared from level 2, not at level 1', () => {
    expect(pal(1).spellcasting!.spells.some((s) => s.id === 'divineSmite')).toBe(false);
    const { c } = arena([[pal(1), { x: 0, y: 0 }], [zombie('z'), { x: 1, y: 0 }]], [20, 1]);
    expect(() => spellOf(c.get('pal'), 'divineSmite')).toThrow(RuleError);
  });
});

describe('fighting styles and masteries', () => {
  it('Great Weapon Fighting treats 1s and 2s as 3s', () => {
    const { c, rng } = arena([[fighter({ fightingStyle: 'greatWeapon' }), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 1, 2); // hit; 2d6 → 3 + 3, + 3
    c.execute({ type: 'attack', actor: 'f', attack: 'greatsword', target: 'g' });
    expect(c.get('g').hp).toBe(1);
  });

  it('Cleave: a second attack on a creature next to the first, without the ability modifier', () => {
    const base = fighter();
    const axe: CreatureDef = { ...base, attacks: weaponAttacks(WEAPONS.greataxe, { abilities: base.abilities, pb: 2, mastery: true }) };
    const { c, rng } = arena([[axe, { x: 0, y: 0 }], [goblinWarrior('g1'), { x: 1, y: 0 }], [goblinWarrior('g2'), { x: 1, y: 1 }]], [20, 1, 1]);
    rng.push(15, 6, 15, 6); // hit g1 for 6 + 3; cleave g2: hit, 6 + 0
    const ev = c.execute({ type: 'attack', actor: 'f', attack: 'greataxe', target: 'g1' });
    expect(attacks(ev).map((a) => a.target)).toEqual(['g1', 'g2']);
    expect(c.get('g1').hp).toBe(1);
    expect(c.get('g2').hp).toBe(4);
  });
});

describe('species traits', () => {
  it('Breath Weapon: replaces an attack; a 30-ft line, DEX save, damage of the ancestry', () => {
    const d = fighter({ species: 'dragonborn', lineage: 'red' });
    const { c, rng } = arena([[d, { x: 0, y: 0 }], [goblinWarrior('g1'), { x: 1, y: 0 }], [goblinWarrior('g2'), { x: 3, y: 0 }], [goblinWarrior('g3'), { x: 3, y: 2 }]], [20, 1, 1, 1]);
    const f = c.get('f');
    expect(areaSquares(c, f, spellOf(f, 'breathLine'), { x: 9, y: 0 })).toHaveLength(6);
    expect(spellOf(f, 'breathLine').castWith!.dc).toBe(8 + 2 + 2);
    rng.push(1, 20, 7); // g1 fails, g2 saves; 1d10 = 7
    c.execute({ type: 'cast', actor: 'f', spell: 'breathLine', slot: 0, point: { x: 5, y: 0 } });
    expect(c.get('g1').hp).toBe(3);
    expect(c.get('g2').hp).toBe(7);
    expect(c.get('g3').hp).toBe(10);
    expect(f.turn).toMatchObject({ actions: 0, attacksLeft: 0 });
    expect(f.resourcesLeft.breathWeapon).toBe(1);
  });

  it('Adrenaline Rush: Dash and temporary HP; Relentless Endurance keeps an orc at 1 HP once', () => {
    const { c } = arena([[fighter({ species: 'orc' }), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 6, y: 0 }]], [20, 1]);
    const f = c.get('f');
    c.execute({ type: 'cast', actor: 'f', spell: 'adrenalineRush', slot: 0 });
    expect(f.turn.movement).toBe(60);
    expect(f.tempHp).toBe(2);
    c.applyDamage(f, f.hp + 2 + 1, 'slashing', []);
    expect(f.hp).toBe(1);
    expect(f.resourcesLeft.relentlessEndurance).toBe(0);
    c.applyDamage(f, 3, 'slashing', []);
    expect(f.hp).toBe(0);
  });

  it('Stone\'s Endurance and Storm\'s Thunder are reactions to damage', () => {
    const { c, rng } = arena([[fighter({ species: 'goliath', lineage: 'stone' }), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    const f = c.get('f');
    rng.push(5); // 1d12 = 5, + CON 2
    c.applyDamage(f, 10, 'slashing', []);
    expect(f.hp).toBe(f.maxHp - 3);
    expect(f.turn.reaction).toBe(false);
    expect(f.resourcesLeft.giantAncestry).toBe(1);

    const s = arena([[fighter({ species: 'goliath', lineage: 'storm' }), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    s.rng.push(4);
    s.c.applyDamage(s.c.get('f'), 3, 'slashing', [], s.c.get('g'));
    expect(s.c.get('g').hp).toBe(6);
  });

  it('Fire\'s Burn adds 1d10 Fire to a hit', () => {
    const { c, rng } = arena([[fighter({ species: 'goliath', lineage: 'fire' }), { x: 0, y: 0 }], [zombie('z'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 1, 1, 4); // hit; 2d6 = 2, + 3; Fire's Burn 4
    const ev = c.execute({ type: 'attack', actor: 'f', attack: 'greatsword', target: 'z' });
    expect(damages(ev).map((d) => d.damageType)).toEqual(['slashing', 'fire']);
    expect(c.get('z').hp).toBe(15 - 5 - 4);
  });

  it('Gnomish Cunning: Advantage on mental saves', () => {
    const { c, rng } = arena([[fighter({ species: 'gnome', lineage: 'rock', speciesAbility: 'int' }), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 6, y: 0 }]], [20, 1]);
    rng.push(2, 18);
    expect(c.savingThrow(c.get('f'), 'wis', 12)).toBe(true);
    rng.push(2, 18, 2);
    expect(c.savingThrow(c.get('f'), 'dex', 12)).toBe(false);
  });

  it('Chill Touch (a tiefling cantrip, cast with CHA): no healing until the end of your next turn', () => {
    const t = fighter({ species: 'tiefling', lineage: 'chthonic', speciesAbility: 'cha' });
    const { c, rng } = arena([[t, { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 4);
    c.execute({ type: 'cast', actor: 'f', spell: 'chillTouch', slot: 0, targets: ['g'] });
    expect(c.get('g').hp).toBe(6);
    c.heal(c.get('g'), 3);
    expect(c.get('g').hp).toBe(6);
    c.execute({ type: 'endTurn', actor: 'f' });
    c.execute({ type: 'endTurn', actor: 'g' });
    c.execute({ type: 'endTurn', actor: 'f' });
    c.heal(c.get('g'), 3);
    expect(c.get('g').hp).toBe(9);
  });
});

describe('feats and cantrips', () => {
  it('Tavern Brawler: Unarmed Strike 1d4 + STR, rerolling 1s', () => {
    const { c, rng } = arena([[fighter({ species: 'human', speciesSkill: 'athletics', versatileFeat: 'tavernBrawler' }), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 1, 3); // hit; 1 → rerolled 3, + 3
    c.execute({ type: 'attack', actor: 'f', attack: 'unarmed', target: 'g' });
    expect(c.get('g').hp).toBe(4);
  });

  it('Healer: healing spells reroll 1s', () => {
    const cleric = buildCharacter({
      id: 'h', name: 'H', species: 'dwarf', cls: 'cleric', background: 'hermit', scoreMethod: 'standard',
      base: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 }, boosts: { wis: 2, con: 1 }, skills: ['insight', 'history'],
      divineOrder: 'protector', kit: 'protector', cantrips: ['sacredFlame', 'tollTheDead', 'guidance'], spells: ['cureWounds', 'bless', 'healingWord', 'guidingBolt'],
    }, 1);
    const { c, rng } = arena([[cleric, { x: 0, y: 0 }], [torvald(2), { x: 1, y: 0 }], [goblinWarrior('g'), { x: 6, y: 0 }]], [20, 1, 1]);
    const t = c.get('torvald'); t.hp = 1;
    rng.push(1, 5, 4); // 2d8: 1 → 5, 4; + WIS 3
    c.execute({ type: 'cast', actor: 'h', spell: 'cureWounds', slot: 1, targets: ['torvald'] });
    expect(t.hp).toBe(1 + 5 + 4 + 3);
  });

  it('Spare the Dying stabilises a dying ally within 15 ft', () => {
    const { c } = arena([[maren(4), { x: 0, y: 0 }], [torvald(2), { x: 3, y: 0 }], [goblinWarrior('g'), { x: 8, y: 0 }]], [20, 1, 1]);
    const t = c.get('torvald');
    c.applyDamage(t, t.hp, 'slashing', []);
    c.execute({ type: 'cast', actor: 'maren', spell: 'spareTheDying', slot: 0, targets: ['torvald'] });
    expect(c.cond(t, 'stable')).toBeTruthy();
  });
});
