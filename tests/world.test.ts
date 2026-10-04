import { describe, expect, it } from 'vitest';
import { TacticalAI } from '../src/engine/ai';
import { World } from '../src/world/world';
import { validateMap } from '../src/world/map';
import { ABBEY } from '../src/data/maps/abbey';

const party = [{ preset: 'torvald', level: 1 }, { preset: 'nyx', level: 1 }, { preset: 'maren', level: 1 }, { preset: 'elowen', level: 1 }] as const;
const newGame = (seed = 1) => World.newGame(ABBEY, { seed, mapId: 'abbey-1', party: party.map((p) => ({ ...p })) });

describe('maps', () => {
  it('every shipped floor is well-formed', () => {
    for (const m of Object.values(ABBEY)) expect(validateMap(m)).toEqual([]);
  });
});

describe('the world', () => {
  it('starts a new game with the party at level 1 on the start squares', () => {
    const w = newGame();
    expect(w.state.party.map((h) => h.pos)).toEqual(ABBEY['abbey-1'].start);
    expect(w.state.party.find((h) => h.id === 'torvald')!.hp).toBe(13);
    expect(w.state.party.find((h) => h.id === 'elowen')!.slotsLeft).toEqual([0, 2]);
  });

  it('walks around graves; a closed door blocks the way until opened', () => {
    const w = newGame();
    const path = w.pathTo('torvald', { x: 8, y: 7 })!;
    expect(path[path.length - 1]).toEqual({ x: 8, y: 7 });
    expect(path.every((p) => w.grid.cell(p.x, p.y)!.blocksMove === false)).toBe(true);
    // the chapel lies behind a closed door at (8, 6)
    w.setPos('torvald', { x: 8, y: 7 });
    expect(w.pathTo('torvald', { x: 8, y: 4 })).toBeUndefined();
    expect(w.setDoor({ x: 8, y: 6 }, true)).toBe(true);
    expect(w.pathTo('torvald', { x: 8, y: 4 })).toBeDefined();
  });

  it("can't walk onto a monster", () => {
    const w = newGame();
    expect(w.pathTo('torvald', { x: 7, y: 10 })).toBeUndefined();
  });

  it('stepping onto a group\'s ground starts its fight', () => {
    const w = newGame();
    expect(w.triggeredBy({ x: 3, y: 19 })).toBeUndefined();
    expect(w.triggeredBy({ x: 3, y: 14 })?.id).toBe('graveyard');
  });

  it('a fight carries HP and spent resources back, and the beaten group stays beaten', () => {
    // play the graveyard fight with the AI on both sides, from a few seeds, until the party wins one
    for (let seed = 1; seed < 20; seed++) {
      const w = newGame(seed);
      w.state.party.forEach((h, i) => w.setPos(h.id, { x: 2 + i, y: 14 }));
      const combat = w.beginCombat('graveyard');
      const ai = new TacticalAI(combat);
      combat.start();
      for (let t = 0; t < 300 && !combat.over; t++) ai.takeTurn(combat.active!.id);
      if (w.finishCombat(combat, 'graveyard') !== 'victory') continue;
      expect(w.groups().map((g) => g.id)).not.toContain('graveyard');
      for (const h of w.state.party) {
        const c = combat.get(h.id);
        if (!h.dead) expect(h.hp).toBe(Math.max(1, c.hp)); // downed heroes get up with 1 HP
        expect(h.slotsLeft).toEqual(c.slotsLeft);
        expect(h.conditions.every((k) => k.id === 'aided')).toBe(true);
      }
      return;
    }
    throw new Error('the party never won the graveyard fight');
  });

  it('saves and loads to the same state, dice included', () => {
    const w = newGame(42);
    w.setDoor({ x: 8, y: 6 }, true);
    w.setPos('nyx', { x: 5, y: 16 });
    w.rng.next(); w.rng.next();
    const json = w.serialize();
    const back = World.load(ABBEY, json);
    expect(back.serialize()).toBe(json);
    expect(back.grid.cell(8, 6)!.blocksMove).toBe(false); // the open door stays open
    expect(back.rng.next()).toBe(w.rng.next()); // the next roll is the same one
  });

  it('takes the stairs to the crypt and back', () => {
    const w = newGame();
    w.travel('down');
    expect(w.state.mapId).toBe('crypt-1');
    expect(w.grid.width).toBe(20);
    for (const h of w.state.party) expect(w.grid.cell(h.pos.x, h.pos.y)!.blocksMove).toBe(false);
    w.travel('up');
    expect(w.state.mapId).toBe('abbey-1');
    const near = w.state.party.every((h) => Math.max(Math.abs(h.pos.x - 25), Math.abs(h.pos.y - 4)) <= 2);
    expect(near).toBe(true);
  });
});

describe('heroes from the creator', () => {
  it('a party of creator choices builds, saves and loads', async () => {
    const { newChoices, complete } = await import('../src/data/build/defaults');
    const { presetBuild } = await import('../src/world/world');
    const { ABBEY } = await import('../src/data/maps/abbey');
    const hero = complete({ ...newChoices('Vesper'), id: 'hero', species: 'tiefling', cls: 'paladin', background: 'acolyte' });
    const w = World.newGame(ABBEY, { seed: 3, mapId: 'abbey-1', party: [{ choices: hero, level: 1 }, presetBuild('torvald', 1), presetBuild('maren', 1), presetBuild('elowen', 1)] });
    expect(w.state.party.map((h) => h.id)).toEqual(['hero', 'torvald', 'maren', 'elowen']);
    const back = World.load(ABBEY, w.serialize());
    const def = back.heroDef(back.state.party[0]);
    expect(def.description).toBe('Tiefling Paladin 1');
    expect(def.look?.horns).toBe(true);
    expect(def.resist).toEqual(['poison']);
  });
});
