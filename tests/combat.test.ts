import { describe, expect, it } from 'vitest';
import { Combat, RuleError, type GameEvent } from '../src/engine/combat';
import { RiggedRng } from '../src/engine/dice';
import { Grid, type Pos } from '../src/engine/grid';
import type { CreatureDef } from '../src/engine/types';
import { torvald, nyx } from '../src/data/heroes';
import { goblinWarrior, goblinBoss, goblinMinion } from '../src/data/monsters';

const OPEN = [
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
  '..........',
];

/** Build a fight. `init` are the raw d20 initiative rolls in the order creatures are added. */
function arena(placed: [CreatureDef, Pos][], init: number[], rows = OPEN) {
  const rng = new RiggedRng([...init]);
  const c = new Combat(Grid.fromRows(rows), rng);
  for (const [d, p] of placed) c.add(d, p);
  const startEvents = c.start();
  return { c, rng, startEvents };
}
const attacks = (ev: GameEvent[]) => ev.filter((e) => e.type === 'attack') as Extract<GameEvent, { type: 'attack' }>[];

describe('initiative and turns', () => {
  it('orders by d20 + DEX, with Alert adding proficiency', () => {
    // Torvald 15+1 = 16, Nyx 10+3+2 = 15, goblin 14+2 = 16 → tie on 16 broken by DEX (goblin 15 > 13)
    const { c } = arena([[torvald(2), { x: 0, y: 0 }], [nyx(2), { x: 1, y: 0 }], [goblinWarrior('g'), { x: 5, y: 5 }]], [15, 10, 14]);
    expect(c.order).toEqual(['g', 'torvald', 'nyx']);
    expect(c.active!.id).toBe('g');
  });

  it('refuses commands out of turn', () => {
    const { c } = arena([[torvald(2), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 5, y: 5 }]], [20, 1]);
    expect(() => c.execute({ type: 'dash', actor: 'g', via: 'action' })).toThrow(RuleError);
  });
});

describe('attacks', () => {
  it('hits, deals damage and Savage Attacker keeps the better damage roll', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(12, 3, 6); // d20 12 (+5 = 17 vs AC 15), damage 3, Savage reroll 6
    const ev = c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'g' });
    expect(attacks(ev)[0]).toMatchObject({ hit: true, total: 17, ac: 15 });
    expect(c.get('g').hp).toBe(10 - (6 + 3));
  });

  it('doubles dice on a natural 20', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinBoss('b'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(20, 4, 4, 8, 8); // crit: 2d8 rolled twice by Savage Attacker; best pair is 16
    c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'b' });
    expect(c.get('b').hp).toBe(21 - (16 + 3));
  });

  it('only gets one attack per Attack action without Extra Attack, two with Action Surge', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinBoss('b'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(2, 2); // miss
    c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'b' });
    expect(() => c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'b' })).toThrow(RuleError);
    c.execute({ type: 'actionSurge', actor: 'torvald' });
    rng.push(2, 2);
    expect(() => c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'b' })).not.toThrow();
    expect(c.get('torvald').resourcesLeft.actionSurge).toBe(0);
  });

  it('Sap gives the target Disadvantage on its next attack', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 1, 1);
    c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'g' });
    expect(c.cond(c.get('g'), 'sapped')).toBeTruthy();
    c.execute({ type: 'endTurn', actor: 'torvald' });
    expect(c.previewAttack(c.get('g'), 'scimitar', c.get('torvald')).mode).toBe('disadvantage');
    rng.push(18, 3, 1); // disadvantage takes the 3
    const ev = c.execute({ type: 'attack', actor: 'g', attack: 'scimitar', target: 'torvald' });
    expect(attacks(ev)[0]).toMatchObject({ mode: 'disadvantage', natural: 3, hit: false });
    expect(c.cond(c.get('g'), 'sapped')).toBeFalsy();
  });

  it('Vex grants Advantage on the next attack, which enables Sneak Attack', () => {
    const { c, rng } = arena([[nyx(2), { x: 0, y: 0 }], [goblinBoss('b'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 1); // hit (15+5=20 vs 17), shortsword 1; no ally nearby → no sneak attack yet
    c.execute({ type: 'attack', actor: 'nyx', attack: 'shortsword', target: 'b' });
    expect(c.get('b').hp).toBe(21 - 4);
    expect(c.previewAttack(c.get('nyx'), 'shortsword', c.get('b')).mode).toBe('advantage');
    expect(c.previewAttack(c.get('nyx'), 'shortsword', c.get('b')).reasons).toContain('Sneak Attack');
  });

  it('Sneak Attack triggers when an ally is next to the target, once per turn', () => {
    const { c, rng } = arena([[nyx(2), { x: 0, y: 0 }], [torvald(2), { x: 2, y: 1 }], [goblinBoss('b'), { x: 1, y: 0 }]], [20, 1, 1]);
    rng.push(15, 2, 5); // hit, shortsword 2 (+3), sneak 5
    c.execute({ type: 'attack', actor: 'nyx', attack: 'shortsword', target: 'b' });
    expect(c.get('b').hp).toBe(21 - 10);
    // Light weapon follow-up with the dagger (Advantage from Vex): no ability modifier, no second sneak attack
    rng.push(15, 15, 3);
    c.execute({ type: 'offhand', actor: 'nyx', attack: 'dagger', target: 'b' });
    expect(c.get('b').hp).toBe(11 - 3);
    expect(c.get('nyx').turn.bonusActions).toBe(0);
  });

  it('the off-hand attack needs a different Light weapon', () => {
    const { c, rng } = arena([[nyx(2), { x: 0, y: 0 }], [goblinBoss('b'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(2, 2);
    c.execute({ type: 'attack', actor: 'nyx', attack: 'dagger', target: 'b' });
    expect(() => c.execute({ type: 'offhand', actor: 'nyx', attack: 'dagger', target: 'b' })).toThrow(RuleError);
  });

  it('ranged attacks suffer Disadvantage at long range and with an enemy adjacent', () => {
    const { c } = arena([[nyx(2), { x: 0, y: 0 }], [goblinWarrior('a'), { x: 1, y: 0 }], [goblinWarrior('b'), { x: 6, y: 0 }]], [20, 1, 1]);
    expect(c.previewAttack(c.get('nyx'), 'shortbow', c.get('b')).mode).toBe('disadvantage');
    const far = arena([[nyx(2), { x: 0, y: 0 }], [goblinWarrior('b'), { x: 9, y: 5 }]], [20, 1]).c;
    expect(far.previewAttack(far.get('nyx'), 'shortbow', far.get('b')).mode).toBe('normal');
  });

  it('goblins add 1d4 when attacking with Advantage', () => {
    const { c, rng } = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [torvald(2), { x: 0, y: 0 }]], [20, 1]);
    c.addCondition(c.get('torvald'), { id: 'prone' });
    rng.push(18, 5, 4, 3); // adv 18, scimitar 4 (+2), bonus d4 3
    c.execute({ type: 'attack', actor: 'g', attack: 'scimitar', target: 'torvald' });
    expect(c.get('torvald').hp).toBe(22 - 9);
  });

  it('thrown javelins are used up and Slow the target', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinBoss('b'), { x: 5, y: 0 }]], [20, 1]);
    rng.push(19, 3, 3);
    c.execute({ type: 'attack', actor: 'torvald', attack: 'javelin-throw', target: 'b' });
    expect(c.get('torvald').inv.javelin).toBe(5);
    expect(c.speedOf(c.get('b'))).toBe(20);
    c.execute({ type: 'endTurn', actor: 'torvald' });
    expect(c.get('b').turn.movement).toBe(20);
    // the slow ends at the start of Torvald's next turn
    c.execute({ type: 'endTurn', actor: 'b' });
    expect(c.speedOf(c.get('b'))).toBe(30);
  });
});

describe('movement and reactions', () => {
  it('provokes an opportunity attack when leaving reach', () => {
    const { c, rng } = arena([[torvald(2), { x: 1, y: 1 }], [goblinWarrior('g'), { x: 2, y: 1 }]], [20, 1]);
    rng.push(19, 4); // goblin OA hits for 6
    const ev = c.execute({ type: 'move', actor: 'torvald', to: { x: 0, y: 4 } });
    expect(attacks(ev)[0]).toMatchObject({ attacker: 'g', opportunity: true, hit: true });
    expect(c.get('torvald').hp).toBe(16);
    expect(c.get('torvald').pos).toEqual({ x: 0, y: 4 });
    expect(c.get('g').turn.reaction).toBe(false);
  });

  it("Disengage prevents opportunity attacks; moving within reach doesn't provoke", () => {
    const { c } = arena([[torvald(2), { x: 1, y: 1 }], [goblinWarrior('g'), { x: 2, y: 1 }]], [20, 1]);
    expect(attacks(c.execute({ type: 'move', actor: 'torvald', to: { x: 1, y: 2 } }))).toHaveLength(0);
    c.execute({ type: 'disengage', actor: 'torvald', via: 'action' });
    expect(attacks(c.execute({ type: 'move', actor: 'torvald', to: { x: 0, y: 5 } }))).toHaveLength(0);
  });

  it('Cunning Action: the rogue can Disengage and Dash as Bonus Actions; the fighter cannot', () => {
    const { c } = arena([[nyx(2), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 9, y: 5 }]], [20, 1]);
    c.execute({ type: 'dash', actor: 'nyx', via: 'bonus' });
    expect(c.get('nyx').turn.movement).toBe(60);
    const f = arena([[torvald(2), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 9, y: 5 }]], [20, 1]).c;
    expect(() => f.execute({ type: 'dash', actor: 'torvald', via: 'bonus' })).toThrow(RuleError);
  });

  it('pays double for rubble and can pass through allies but not stop on them', () => {
    const rows = ['.rr.......', '..........', '..........'];
    const { c } = arena([[torvald(2), { x: 0, y: 0 }], [nyx(2), { x: 1, y: 1 }], [goblinWarrior('g'), { x: 9, y: 2 }]], [20, 1, 1], rows);
    const reach = c.reachable(c.get('torvald'));
    expect(reach.get('1,0')!.cost).toBe(10); // rubble
    expect(reach.get('2,0')!.cost).toBe(20);
    expect(reach.has('1,1')).toBe(false); // can pass through the ally but not stop there
    expect(reach.get('2,2')!.cost).toBe(15); // around (or through) the ally
  });

  it("can't move through an enemy of similar size", () => {
    const rows = ['#.#', '...', '#.#'];
    const { c } = arena([[torvald(2), { x: 1, y: 0 }], [goblinWarrior('g'), { x: 1, y: 1 }]], [20, 1], rows);
    expect(c.reachable(c.get('torvald')).has('1,2')).toBe(false);
  });
});

describe('hiding', () => {
  const rows = ['..........', '...P......', '..........', '..........'];

  it('needs cover from every enemy, then grants Advantage and ends on attacking', () => {
    const { c, rng } = arena([[nyx(2), { x: 3, y: 0 }], [goblinWarrior('g'), { x: 3, y: 3 }]], [20, 1], rows);
    rng.push(12); // Stealth 12 + 7 = 19
    c.execute({ type: 'hide', actor: 'nyx', via: 'bonus' });
    expect(c.cond(c.get('nyx'), 'hidden')?.value).toBe(19);
    expect(c.canSee(c.get('g'), c.get('nyx'))).toBe(false);
    c.execute({ type: 'move', actor: 'nyx', to: { x: 2, y: 0 } });
    expect(c.cond(c.get('nyx'), 'hidden')).toBeFalsy(); // stepped out where the goblin can see
  });

  it("can't hide in plain sight", () => {
    const { c } = arena([[nyx(2), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 3, y: 3 }]], [20, 1], rows);
    expect(() => c.execute({ type: 'hide', actor: 'nyx', via: 'bonus' })).toThrow(/can see/);
  });

  it('attacking from hiding has Advantage and reveals you', () => {
    const { c, rng } = arena([[nyx(2), { x: 3, y: 0 }], [goblinWarrior('g'), { x: 3, y: 3 }]], [20, 1], rows);
    rng.push(12);
    c.execute({ type: 'hide', actor: 'nyx', via: 'bonus' });
    c.execute({ type: 'move', actor: 'nyx', to: { x: 4, y: 0 } }); // peek around: the goblin sees her
    expect(c.cond(c.get('nyx'), 'hidden')).toBeFalsy();
  });
});

describe('dying', () => {
  it('player characters fall unconscious, roll death saves and can be revived with a potion', () => {
    const { c, rng } = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [nyx(2), { x: 0, y: 0 }], [torvald(2), { x: 0, y: 1 }]], [20, 10, 5]);
    c.get('nyx').hp = 3;
    rng.push(19, 6);
    c.execute({ type: 'attack', actor: 'g', attack: 'scimitar', target: 'nyx' });
    const n = c.get('nyx');
    expect(n.hp).toBe(0);
    expect(c.cond(n, 'unconscious')).toBeTruthy();
    expect(c.cond(n, 'prone')).toBeTruthy();
    rng.push(8); // Nyx's death save at the start of her turn: failure
    c.execute({ type: 'endTurn', actor: 'g' });
    expect(n.deathSaves.fail).toBe(1);
    expect(c.active!.id).toBe('torvald'); // the unconscious rogue's turn was skipped
    rng.push(2, 2); // potion 2d4+2 = 6
    c.execute({ type: 'potion', actor: 'torvald', target: 'nyx' });
    expect(n.hp).toBe(6);
    expect(c.cond(n, 'unconscious')).toBeFalsy();
    expect(n.deathSaves).toEqual({ success: 0, fail: 0 });
  });

  it('attacks within 5 ft of an unconscious creature are critical hits', () => {
    const { c, rng } = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [nyx(2), { x: 0, y: 0 }], [torvald(2), { x: 9, y: 5 }]], [20, 1, 1]);
    const n = c.get('nyx');
    c.applyDamage(n, 17, 'slashing', []); // drop her to exactly 0
    expect(c.cond(n, 'unconscious')).toBeTruthy();
    rng.push(12, 5, 1, 1, 1, 1); // advantage vs unconscious: 12 hits; crit doubles the dice
    const ev = c.execute({ type: 'attack', actor: 'g', attack: 'scimitar', target: 'nyx' });
    expect(attacks(ev)[0]).toMatchObject({ hit: true, crit: true, mode: 'advantage' });
    expect(n.deathSaves.fail).toBe(2);
  });

  it('monsters die at 0 HP; massive damage kills a PC outright', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinMinion('m'), { x: 1, y: 0 }], [nyx(2), { x: 5, y: 5 }]], [20, 1, 1]);
    rng.push(15, 8, 8);
    c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'm' });
    expect(c.cond(c.get('m'), 'dead')).toBeTruthy();
    const n = c.get('nyx');
    n.hp = 2;
    c.applyDamage(n, 2 + 17, 'slashing', []);
    expect(c.cond(n, 'dead')).toBeTruthy();
  });

  it('ends the combat when one side is down', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinMinion('m'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(15, 8, 8);
    const ev = c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'm' });
    expect(ev.find((e) => e.type === 'combatEnd')).toMatchObject({ winner: 'party' });
    expect(c.over).toBe('party');
  });
});

describe('features', () => {
  it('Second Wind heals 1d10 + fighter level as a Bonus Action', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinMinion('m'), { x: 5, y: 0 }]], [20, 1]);
    c.get('torvald').hp = 5;
    rng.push(7);
    c.execute({ type: 'secondWind', actor: 'torvald' });
    expect(c.get('torvald').hp).toBe(14);
    expect(c.get('torvald').resourcesLeft.secondWind).toBe(1);
    expect(() => c.execute({ type: 'secondWind', actor: 'torvald' })).toThrow(/Bonus Action/);
  });

  it('Goblin Boss redirects an attack onto an adjacent ally', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinBoss('b'), { x: 1, y: 0 }], [goblinMinion('m'), { x: 2, y: 0 }]], [20, 1, 1]);
    rng.push(15, 8, 8);
    const ev = c.execute({ type: 'attack', actor: 'torvald', attack: 'longsword', target: 'b' });
    expect(ev.find((e) => e.type === 'swap')).toBeTruthy();
    // the minion swapped into the boss's square and took the hit
    expect(c.cond(c.get('m'), 'dead')).toBeTruthy();
    expect(c.get('b').hp).toBe(21);
    expect(c.get('b').pos).toEqual({ x: 2, y: 0 });
  });

  it('Shove can knock a target prone, giving melee attackers Advantage', () => {
    const { c, rng } = arena([[torvald(2), { x: 0, y: 0 }], [goblinWarrior('g'), { x: 1, y: 0 }]], [20, 1]);
    rng.push(3); // goblin's save: DEX 3+2 = 5 vs DC 13
    c.execute({ type: 'shove', actor: 'torvald', target: 'g', effect: 'prone' });
    expect(c.cond(c.get('g'), 'prone')).toBeTruthy();
    expect(c.previewAttack(c.get('torvald'), 'longsword', c.get('g')).mode).toBe('advantage');
  });

  it('Nimble Escape lets goblins Disengage as a Bonus Action', () => {
    const { c } = arena([[goblinWarrior('g'), { x: 1, y: 0 }], [torvald(2), { x: 0, y: 0 }]], [20, 1]);
    c.execute({ type: 'disengage', actor: 'g', via: 'bonus' });
    expect(attacks(c.execute({ type: 'move', actor: 'g', to: { x: 6, y: 0 } }))).toHaveLength(0);
    expect(() => c.execute({ type: 'dash', actor: 'g', via: 'bonus' })).toThrow(RuleError);
  });
});
