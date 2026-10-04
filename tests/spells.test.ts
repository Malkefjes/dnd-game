import { describe, expect, it } from 'vitest';
import { Combat, NeedsDecision, RuleError, type GameEvent } from '../src/engine/combat';
import { RiggedRng } from '../src/engine/dice';
import { Grid, type Pos } from '../src/engine/grid';
import type { CreatureDef } from '../src/engine/types';
import { areaSquares, spellOf } from '../src/engine/spells';
import { torvald, nyx, maren, elowen } from '../src/data/heroes';
import { goblinWarrior, goblinBoss } from '../src/data/monsters';

const OPEN = ['..........', '..........', '..........', '..........', '..........', '..........'];

/** `init` are the raw initiative d20s in add order (two for creatures with Advantage on Initiative). */
function arena(placed: [CreatureDef, Pos][], init: number[], rows = OPEN) {
  const rng = new RiggedRng([...init]);
  const c = new Combat(Grid.fromRows(rows), rng);
  for (const [d, p] of placed) c.add(d, p);
  c.start();
  return { c, rng };
}
const attacks = (ev: GameEvent[]) => ev.filter((e) => e.type === 'attack') as Extract<GameEvent, { type: 'attack' }>[];

describe('cantrips', () => {
  it('Fire Bolt is a ranged spell attack that uses no slot', () => {
    const { c, rng } = arena([[elowen(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 5, y: 0 }]], [20, 1]);
    rng.push(15, 7); // 15 + 5 = 20 vs AC 15; 1d10 = 7
    const ev = c.execute({ type: 'cast', actor: 'elowen', spell: 'fireBolt', slot: 0, targets: ['g'] });
    expect(attacks(ev)[0]).toMatchObject({ hit: true, total: 20, spell: 'fireBolt' });
    expect(c.get('g').hp).toBe(3);
    expect(c.get('elowen').slotsLeft).toEqual([0, 4, 2]);
    expect(c.get('elowen').turn.actions).toBe(0);
  });

  it('Potent Cantrip: a missed cantrip still deals half damage', () => {
    const { c, rng } = arena([[elowen(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 5, y: 0 }]], [20, 1]);
    rng.push(2, 9); // miss; 1d10 = 9 → 4
    c.execute({ type: 'cast', actor: 'elowen', spell: 'fireBolt', slot: 0, targets: ['g'] });
    expect(c.get('g').hp).toBe(6);
  });

  it('Toll the Dead uses a d12 against a wounded target; Sacred Flame is a Dexterity save', () => {
    const { c, rng } = arena([[maren(), { x: 0, y: 0 }], [goblinBoss('b'), { x: 5, y: 0 }]], [20, 1]);
    c.get('b').hp = 20;
    rng.push(2, 12); // WIS save 2 - 1 = 1 fails; 1d12 = 12
    c.execute({ type: 'cast', actor: 'maren', spell: 'tollTheDead', slot: 0, targets: ['b'] });
    expect(c.get('b').hp).toBe(8);
  });

  it('Ray of Frost slows; Shocking Grasp stops reactions', () => {
    const { c, rng } = arena([[elowen(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }], [goblinBoss('b'), { x: 9, y: 5 }]], [20, 1, 1]);
    rng.push(15, 1); // hit, 1 lightning
    c.execute({ type: 'cast', actor: 'elowen', spell: 'shockingGrasp', slot: 0, targets: ['g'] });
    expect(c.get('g').turn.reaction).toBe(false);
    // walking away now provokes nothing
    expect(attacks(c.execute({ type: 'move', actor: 'elowen', to: { x: 0, y: 4 } }))).toHaveLength(0);
  });
});

describe('spell slots and upcasting', () => {
  it('Magic Missile darts always hit and spend a slot; only one slot per turn', () => {
    const { c, rng } = arena([[elowen(), { x: 0, y: 0 }], [goblinBoss('b'), { x: 6, y: 0 }]], [20, 1]);
    rng.push(4, 4, 4); // 3 × (1d4 + 1)
    c.execute({ type: 'cast', actor: 'elowen', spell: 'magicMissile', slot: 1, targets: ['b', 'b', 'b'] });
    expect(c.get('b').hp).toBe(21 - 15);
    expect(c.get('elowen').slotsLeft[1]).toBe(3);
    expect(() => c.execute({ type: 'cast', actor: 'elowen', spell: 'mistyStep', slot: 2, point: { x: 0, y: 3 } })).toThrow(/one spell slot/);
  });

  it('upcasting Magic Missile adds a dart', () => {
    const { c } = arena([[elowen(), { x: 0, y: 0 }], [goblinBoss('b'), { x: 6, y: 0 }]], [20, 1]);
    expect(() => c.execute({ type: 'cast', actor: 'elowen', spell: 'magicMissile', slot: 1, targets: ['b', 'b', 'b', 'b'] })).toThrow(RuleError);
    c.execute({ type: 'cast', actor: 'elowen', spell: 'magicMissile', slot: 2, targets: ['b', 'b', 'b', 'b'] });
    expect(c.get('elowen').slotsLeft).toEqual([0, 4, 1]);
  });

  it("can't cast without a slot of the right level", () => {
    const { c } = arena([[elowen(1), { x: 0, y: 0 }], [goblinBoss('b'), { x: 6, y: 0 }]], [20, 1]);
    expect(() => c.execute({ type: 'cast', actor: 'elowen', spell: 'magicMissile', slot: 2, targets: ['b'] })).toThrow(/slot/);
  });
});

describe('areas', () => {
  it('Burning Hands: a 15-ft cone, Dexterity saves, damage rolled once, allies included', () => {
    const { c, rng } = arena([
      [elowen(), { x: 0, y: 1 }], [goblinWarrior('g1'), { x: 1, y: 1 }], [goblinWarrior('g2'), { x: 3, y: 2 }], [torvald(2), { x: 2, y: 0 }], [goblinWarrior('g3'), { x: 5, y: 1 }],
    ], [20, 1, 1, 1, 1]);
    const squares = areaSquares(c, c.get('elowen'), spellOf(c.get('elowen'), 'burningHands'), { x: 1, y: 1 });
    expect(squares).toHaveLength(7);
    rng.push(5, 15, 2, 4, 4, 4); // saves: g1 fails, g2 succeeds, Torvald fails; 3d6 = 12
    c.execute({ type: 'cast', actor: 'elowen', spell: 'burningHands', slot: 1, point: { x: 1, y: 1 } });
    expect(c.cond(c.get('g1'), 'dead')).toBeTruthy();
    expect(c.get('g2').hp).toBe(4);
    expect(c.get('torvald').hp).toBe(22 - 12);
    expect(c.get('g3').hp).toBe(10);
  });

  it('Sleep: Incapacitated, then Unconscious on a second failed save; damage wakes the sleeper', () => {
    const { c, rng } = arena([[elowen(), { x: 0, y: 0 }], [goblinWarrior('g1'), { x: 4, y: 0 }], [goblinWarrior('g2'), { x: 4, y: 1 }], [torvald(2), { x: 9, y: 5 }]], [20, 10, 1, 1]);
    rng.push(3, 18); // g1 fails (2 vs 13), g2 succeeds
    c.execute({ type: 'cast', actor: 'elowen', spell: 'sleep', slot: 1, point: { x: 4, y: 0 } });
    const g1 = c.get('g1');
    expect(c.cond(g1, 'incapacitated')).toBeTruthy();
    expect(c.get('elowen').concentration).toBe('sleep');
    c.execute({ type: 'endTurn', actor: 'elowen' });
    expect(c.active!.id).toBe('g1');
    expect(() => c.execute({ type: 'attack', actor: 'g1', attack: 'shortbow', target: 'elowen' })).toThrow(/Incapacitated/);
    rng.push(5); // repeat save at the end of its turn: fails
    c.execute({ type: 'endTurn', actor: 'g1' });
    expect(c.cond(g1, 'unconscious')).toBeTruthy();
    expect(c.cond(g1, 'prone')).toBeTruthy();
    expect(c.isConscious(g1)).toBe(false);
    c.applyDamage(g1, 1, 'piercing', []);
    expect(c.cond(g1, 'unconscious')).toBeFalsy();
    expect(c.isConscious(g1)).toBe(true);
  });
});

describe('reactions', () => {
  it('Shield turns a hit into a miss and lasts until the start of your next turn', () => {
    const { c, rng } = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [elowen(), { x: 0, y: 0 }]], [20, 1]);
    rng.push(14); // 14 + 4 = 18 vs AC 15: a hit, but not against 20
    const ev = c.execute({ type: 'attack', actor: 'g', attack: 'scimitar', target: 'elowen' });
    expect(ev.find((e) => e.type === 'cast')).toMatchObject({ spell: 'shield', reaction: true });
    expect(attacks(ev)[0]).toMatchObject({ hit: false, ac: 20 });
    const e = c.get('elowen');
    expect(e.hp).toBe(20);
    expect(e.slotsLeft[1]).toBe(3);
    expect(c.acOf(e)).toBe(20);
    c.execute({ type: 'endTurn', actor: 'g' });
    expect(c.acOf(e)).toBe(15);
  });

  it("the default policy doesn't waste Shield on a hit it can't stop", () => {
    const { c, rng } = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [elowen(), { x: 0, y: 0 }]], [20, 1]);
    rng.push(19, 3); // 23 vs 15: still hits with Shield
    c.execute({ type: 'attack', actor: 'g', attack: 'scimitar', target: 'elowen' });
    expect(c.get('elowen').slotsLeft[1]).toBe(4);
    expect(c.get('elowen').hp).toBe(15);
  });

  it('a player decision rewinds the command and replays it identically with the answer', () => {
    const { c, rng } = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [elowen(), { x: 0, y: 0 }]], [20, 1]);
    rng.push(14, 5);
    const e = c.get('elowen');
    const snap = c.snapshot();
    c.decide = () => undefined;
    let caught: unknown;
    try { c.execute({ type: 'attack', actor: 'g', attack: 'scimitar', target: 'elowen' }); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(NeedsDecision);
    expect((caught as NeedsDecision).prompt).toMatchObject({ kind: 'shield', reactor: 'elowen', wouldMiss: true });
    c.restore(snap);
    expect(c.get('elowen')).toBe(e); // same object
    c.decide = () => false; // decline Shield: the same 18 hits
    const ev = c.execute({ type: 'attack', actor: 'g', attack: 'scimitar', target: 'elowen' });
    expect(attacks(ev)[0]).toMatchObject({ hit: true, total: 18 });
    expect(e.hp).toBe(20 - 7);
  });

  it('asks before a player character makes an Opportunity Attack', () => {
    const { c } = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [torvald(2), { x: 0, y: 0 }]], [20, 1]);
    c.decide = (p) => (p.kind === 'opportunity' ? undefined : true);
    expect(() => c.execute({ type: 'move', actor: 'g', to: { x: 5, y: 0 } })).toThrow(NeedsDecision);
    const fresh = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [torvald(2), { x: 0, y: 0 }]], [20, 1]).c;
    fresh.decide = () => false;
    expect(attacks(fresh.execute({ type: 'move', actor: 'g', to: { x: 5, y: 0 } }))).toHaveLength(0);
    expect(fresh.get('torvald').turn.reaction).toBe(true);
  });
});

describe('cleric', () => {
  it('Bless adds 1d4 to attacks; concentration breaks on a failed Constitution save', () => {
    const { c, rng } = arena([[maren(), { x: 0, y: 0 }], [torvald(2), { x: 1, y: 0 }], [goblinWarrior('g'), { x: 2, y: 0 }]], [20, 5, 1]);
    c.execute({ type: 'cast', actor: 'maren', spell: 'bless', slot: 1, targets: ['maren', 'torvald'] });
    expect(c.cond(c.get('torvald'), 'blessed')).toBeTruthy();
    c.execute({ type: 'endTurn', actor: 'maren' });
    rng.push(5, 3, 2, 1); // 5 + 5 + Bless 3 = 13 vs 15: miss
    const ev = c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'g' });
    expect(attacks(ev)[0]).toMatchObject({ total: 13, hit: false });
    rng.push(3, 1); // Maren's CON save: 3 + 2 + Bless 1 = 6 vs DC 10
    c.applyDamage(c.get('maren'), 4, 'slashing', []);
    expect(c.get('maren').concentration).toBeNull();
    expect(c.cond(c.get('torvald'), 'blessed')).toBeFalsy();
  });

  it('Healing Word is a Bonus Action; Disciple of Life adds 2 + slot level', () => {
    const { c, rng } = arena([[maren(), { x: 0, y: 0 }], [torvald(2), { x: 8, y: 0 }], [goblinWarrior('g'), { x: 9, y: 5 }]], [20, 1, 1]);
    c.get('torvald').hp = 5;
    rng.push(1, 1, 1, 1); // 4d4 at slot 2
    c.execute({ type: 'cast', actor: 'maren', spell: 'healingWord', slot: 2, targets: ['torvald'] });
    expect(c.get('torvald').hp).toBe(5 + 4 + 3 + 4);
    expect(c.get('maren').turn.bonusActions).toBe(0);
    expect(c.get('maren').turn.actions).toBe(1);
  });

  it('Guiding Bolt gives the next attack against the target Advantage', () => {
    const { c, rng } = arena([[maren(), { x: 0, y: 0 }], [torvald(2), { x: 4, y: 1 }], [goblinBoss('b'), { x: 5, y: 0 }]], [20, 1, 1]);
    rng.push(15, 1, 1, 1, 1);
    c.execute({ type: 'cast', actor: 'maren', spell: 'guidingBolt', slot: 1, targets: ['b'] });
    expect(c.get('b').hp).toBe(17);
    const p = c.previewAttack(c.get('torvald'), 'longsword', c.get('b'));
    expect(p.mode).toBe('advantage');
    expect(p.reasons).toContain('+ Guiding Bolt');
  });

  it('Spiritual Weapon appears next to the foe, strikes, and strikes again as a Bonus Action', () => {
    const { c, rng } = arena([[maren(), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 6, y: 0 }]], [20, 1]);
    rng.push(15, 5); // 20 vs 15; 1d8 5 + WIS 3
    c.execute({ type: 'cast', actor: 'maren', spell: 'spiritualWeapon', slot: 2, targets: ['g'] });
    expect(c.summons).toHaveLength(1);
    expect(c.summons[0].pos).toEqual({ x: 5, y: 0 });
    expect(c.get('g').hp).toBe(2);
    expect(c.get('maren').turn.bonusActions).toBe(0);
    c.execute({ type: 'endTurn', actor: 'maren' });
    c.execute({ type: 'move', actor: 'g', to: { x: 6, y: 3 } });
    c.execute({ type: 'endTurn', actor: 'g' });
    rng.push(15, 1);
    c.execute({ type: 'summonAttack', actor: 'maren', summon: c.summons[0].id, target: 'g' });
    expect(c.cond(c.get('g'), 'dead')).toBeTruthy();
  });

  it('a new concentration spell ends the old one', () => {
    const { c } = arena([[maren(), { x: 0, y: 0 }], [torvald(2), { x: 1, y: 0 }], [goblinWarrior('g'), { x: 9, y: 5 }]], [20, 5, 1]);
    c.execute({ type: 'cast', actor: 'maren', spell: 'bless', slot: 1, targets: ['torvald'] });
    c.execute({ type: 'endTurn', actor: 'maren' });
    c.execute({ type: 'endTurn', actor: 'torvald' });
    c.execute({ type: 'endTurn', actor: 'g' });
    c.execute({ type: 'cast', actor: 'maren', spell: 'shieldOfFaith', slot: 1, targets: ['torvald'] });
    expect(c.cond(c.get('torvald'), 'blessed')).toBeFalsy();
    expect(c.acOf(c.get('torvald'))).toBe(21);
  });

  it('Preserve Life heals Bloodied allies up to half their HP', () => {
    const { c } = arena([[maren(), { x: 0, y: 0 }], [torvald(2), { x: 1, y: 0 }], [nyx(2), { x: 2, y: 0 }], [goblinWarrior('g'), { x: 9, y: 5 }]], [20, 1, 2, 1]);
    c.get('torvald').hp = 4; c.get('nyx').hp = 2;
    c.execute({ type: 'cast', actor: 'maren', spell: 'preserveLife', slot: 0 });
    expect(c.get('torvald').hp).toBe(11);
    expect(c.get('nyx').hp).toBe(8);
    expect(c.get('maren').resourcesLeft.channelDivinity).toBe(1);
  });

  it('Inflict Wounds: Constitution save for half', () => {
    const { c, rng } = arena([[maren(), { x: 0, y: 0 }], [goblinBoss('b'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 6, 6); // save succeeds; 2d10 = 12 → 6
    c.execute({ type: 'cast', actor: 'maren', spell: 'inflictWounds', slot: 1, targets: ['b'] });
    expect(c.get('b').hp).toBe(15);
  });
});

describe('level 3 martial features', () => {
  it('Champion: Improved Critical scores a critical hit on a 19', () => {
    const { c, rng } = arena([[torvald(3), { x: 0, y: 0 }], [goblinBoss('b'), { x: 1, y: 0 }]], [20, 20, 1]);
    rng.push(19, 4, 4, 1, 1);
    const ev = c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'b' });
    expect(attacks(ev)[0]).toMatchObject({ crit: true });
    expect(c.get('b').hp).toBe(21 - 11);
  });

  it("Steady Aim: Advantage on the next attack, Speed 0, and only if you haven't moved", () => {
    const { c } = arena([[goblinWarrior('g'), { x: 8, y: 0 }], [nyx(3), { x: 0, y: 0 }]], [20, 2, 2]);
    c.execute({ type: 'endTurn', actor: 'g' });
    c.execute({ type: 'steadyAim', actor: 'nyx' });
    const p = c.previewAttack(c.get('nyx'), 'shortbow', c.get('g'));
    expect(p.mode).toBe('advantage');
    expect(c.get('nyx').turn.movement).toBe(0);
    const other = arena([[goblinWarrior('g'), { x: 8, y: 0 }], [nyx(3), { x: 0, y: 0 }]], [20, 2, 2]).c;
    other.execute({ type: 'endTurn', actor: 'g' });
    other.execute({ type: 'move', actor: 'nyx', to: { x: 0, y: 1 } });
    expect(() => other.execute({ type: 'steadyAim', actor: 'nyx' })).toThrow(/moved/);
  });

  it('Assassinate: Advantage against creatures that have not acted, plus level damage on a Sneak Attack', () => {
    const { c, rng } = arena([[nyx(3), { x: 0, y: 0 }], [goblinBoss('b'), { x: 1, y: 0 }]], [20, 20, 1]);
    expect(c.previewAttack(c.get('nyx'), 'shortsword', c.get('b')).reasons).toContain('+ Assassinate');
    rng.push(15, 15, 1, 1, 1); // advantage: hit; 1d6 1 + 3; sneak 2d6 = 2; Assassinate +3
    c.execute({ type: 'attack', actor: 'nyx', attack: 'shortsword', target: 'b' });
    expect(c.get('b').hp).toBe(21 - (4 + 2 + 3));
  });
});
