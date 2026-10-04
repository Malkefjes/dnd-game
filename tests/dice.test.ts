import { describe, expect, it } from 'vitest';
import { Rng, RiggedRng, parseDice, formatDice, averageDice, rollDice, rollD20, resolveAdvantage, hitChance } from '../src/engine/dice';

describe('dice', () => {
  it('parses and formats expressions', () => {
    expect(parseDice('2d6+3')).toEqual({ terms: [{ count: 2, sides: 6 }], bonus: 3 });
    expect(parseDice('d8')).toEqual({ terms: [{ count: 1, sides: 8 }], bonus: 0 });
    expect(parseDice('1d4-1').bonus).toBe(-1);
    expect(formatDice(parseDice('1d8+3'))).toBe('1d8+3');
    expect(() => parseDice('2x6')).toThrow();
  });

  it('averages', () => {
    expect(averageDice(parseDice('1d8+3'))).toBe(7.5);
    expect(averageDice(parseDice('2d6'))).toBe(7);
  });

  it('is deterministic for a seed', () => {
    const a = new Rng(42), b = new Rng(42);
    const xs = Array.from({ length: 20 }, () => a.die(20));
    expect(Array.from({ length: 20 }, () => b.die(20))).toEqual(xs);
    expect(xs.every((x) => x >= 1 && x <= 20)).toBe(true);
  });

  it('doubles dice on a crit', () => {
    const r = rollDice(new RiggedRng([3, 5]), parseDice('1d8+3'), true);
    expect(r.rolls).toEqual([3, 5]);
    expect(r.total).toBe(11);
  });

  it('rolls advantage and disadvantage', () => {
    expect(rollD20(new RiggedRng([4, 17]), 'advantage').natural).toBe(17);
    expect(rollD20(new RiggedRng([4, 17]), 'disadvantage').natural).toBe(4);
  });

  it('halfling Luck rerolls natural 1s', () => {
    expect(rollD20(new RiggedRng([1, 12]), 'normal', true).natural).toBe(12);
    expect(rollD20(new RiggedRng([1, 12]), 'normal', false).natural).toBe(1);
  });

  it('cancels advantage and disadvantage completely', () => {
    expect(resolveAdvantage(2, 1)).toBe('normal');
    expect(resolveAdvantage(1, 0)).toBe('advantage');
    expect(resolveAdvantage(0, 3)).toBe('disadvantage');
  });

  it('computes hit chance with natural 1/20', () => {
    expect(hitChance(5, 15, 'normal')).toBeCloseTo(0.55);
    expect(hitChance(5, 40, 'normal')).toBeCloseTo(0.05); // only a natural 20
    expect(hitChance(30, 5, 'normal')).toBeCloseTo(0.95); // a natural 1 always misses
    expect(hitChance(5, 15, 'advantage')).toBeCloseTo(1 - 0.45 ** 2);
  });
});
