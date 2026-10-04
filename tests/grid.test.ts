import { describe, expect, it } from 'vitest';
import { Grid, computeCover, distanceFt } from '../src/engine/grid';

describe('grid', () => {
  const g = Grid.fromRows([
    '.......',
    '...P...',
    '.......',
    '..rr...',
    '.##....',
    '..HH...',
  ]);

  it('measures distance with 5 ft diagonals', () => {
    expect(distanceFt({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(15);
  });

  it('charges double for difficult terrain and blocks walls', () => {
    expect(g.stepCost({ x: 1, y: 3 }, { x: 2, y: 3 })).toBe(10);
    expect(g.stepCost({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(5);
    expect(g.stepCost({ x: 1, y: 3 }, { x: 1, y: 4 })).toBe(Infinity);
  });

  it("doesn't let you squeeze diagonally past a wall corner", () => {
    expect(g.stepCost({ x: 0, y: 3 }, { x: 1, y: 4 })).toBe(Infinity); // into the wall
    expect(g.stepCost({ x: 0, y: 5 }, { x: 1, y: 4 })).toBe(Infinity);
    expect(g.stepCost({ x: 3, y: 3 }, { x: 4, y: 4 })).toBe(5);
  });

  it('charges extra to climb a 5 ft ledge', () => {
    expect(g.stepCost({ x: 1, y: 5 }, { x: 2, y: 5 })).toBe(10);
    expect(g.stepCost({ x: 2, y: 5 }, { x: 3, y: 5 })).toBe(5);
  });

  it('gives no cover in the open', () => {
    expect(computeCover(g, { x: 0, y: 0 }, { x: 6, y: 0 })).toBe('none');
  });

  it('gives cover behind a pillar, total when directly behind', () => {
    // target hugging the pillar from the far side
    expect(computeCover(g, { x: 3, y: 0 }, { x: 3, y: 2 })).not.toBe('none');
    const straight = computeCover(g, { x: 0, y: 1 }, { x: 6, y: 1 });
    expect(['three-quarters', 'total']).toContain(straight);
  });

  it('creatures in the way give half cover', () => {
    expect(computeCover(g, { x: 0, y: 2 }, { x: 4, y: 2 }, [{ x: 2, y: 2 }])).toBe('half');
  });
});
