// Battle grid: terrain, movement cost and line of sight / cover.
// One square = 5 feet. Diagonal steps cost the same as orthogonal ones.

export type Terrain = 'floor' | 'wall' | 'pillar' | 'obstacle' | 'difficult' | 'door' | 'stairs' | 'platform' | 'void';

export interface Cell {
  terrain: Terrain;
  /** Floor height in 5-foot levels (a platform is 1, stairs 0.5). */
  height: number;
  blocksMove: boolean;
  blocksSight: boolean;
  difficult: boolean;
}

export interface Pos { x: number; y: number }

export const FEET_PER_SQUARE = 5;

const TERRAIN: Record<Terrain, Omit<Cell, 'terrain' | 'height'>> = {
  floor: { blocksMove: false, blocksSight: false, difficult: false },
  door: { blocksMove: false, blocksSight: false, difficult: false },
  stairs: { blocksMove: false, blocksSight: false, difficult: false },
  platform: { blocksMove: false, blocksSight: false, difficult: false },
  difficult: { blocksMove: false, blocksSight: false, difficult: true },
  wall: { blocksMove: true, blocksSight: true, difficult: false },
  pillar: { blocksMove: true, blocksSight: true, difficult: false },
  // waist-high things: crates, barrels. Block movement, give cover, don't block sight entirely.
  obstacle: { blocksMove: true, blocksSight: true, difficult: false },
  // outside the map: nothing there
  void: { blocksMove: true, blocksSight: true, difficult: false },
};

/**
 * Map glyphs. Doors (`d`) start closed: a closed door blocks movement and sight
 * until opened (Grid.setOpen). `D` is an open archway. `<` and `>` are stairs to
 * another floor; `,` is bare earth (the graveyard).
 */
export const MAP_LEGEND: Record<string, Terrain> = {
  '#': 'wall', D: 'door', '.': 'floor', P: 'pillar', r: 'difficult', H: 'platform', S: 'stairs', b: 'obstacle', B: 'obstacle',
  d: 'door', ',': 'floor', '<': 'floor', '>': 'floor', t: 'obstacle', c: 'obstacle', a: 'obstacle', w: 'difficult', ' ': 'void',
};
/** Glyphs for doors that open and close. */
export const CLOSABLE = new Set(['d']);

export class Grid {
  readonly cells: Cell[];
  constructor(readonly width: number, readonly height: number, cells: Cell[]) {
    if (cells.length !== width * height) throw new Error('cell count mismatch');
    this.cells = cells;
  }

  static fromRows(rows: string[], legend: Record<string, Terrain> = MAP_LEGEND): Grid {
    const h = rows.length, w = rows[0].length;
    const cells: Cell[] = [];
    for (const row of rows) {
      if (row.length !== w) throw new Error('ragged map rows');
      for (const ch of row) {
        const terrain = legend[ch];
        if (!terrain) throw new Error(`unknown map glyph '${ch}'`);
        const height = terrain === 'platform' ? 1 : terrain === 'stairs' ? 0.5 : 0;
        const cell: Cell = { terrain, height, ...TERRAIN[terrain] };
        if (CLOSABLE.has(ch)) { cell.blocksMove = true; cell.blocksSight = true; }
        cells.push(cell);
      }
    }
    return new Grid(w, h, cells);
  }

  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

  /** Open or close a door. Line of sight changes, so the cover cache is dropped. */
  setOpen(x: number, y: number, open: boolean) {
    const c = this.cell(x, y);
    if (!c || c.terrain !== 'door') return;
    if (c.blocksMove === !open) return;
    c.blocksMove = !open; c.blocksSight = !open;
    coverCache.delete(this);
  }
  cell(x: number, y: number): Cell | undefined { return this.inBounds(x, y) ? this.cells[y * this.width + x] : undefined; }

  /** Extra cost in feet to step from a to an adjacent b, or Infinity if the step is impossible. */
  stepCost(a: Pos, b: Pos): number {
    const ca = this.cell(a.x, a.y), cb = this.cell(b.x, b.y);
    if (!ca || !cb || cb.blocksMove) return Infinity;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return Infinity;
    // no squeezing diagonally past a wall corner
    if (dx !== 0 && dy !== 0) {
      if (this.cell(a.x + dx, a.y)?.blocksMove || this.cell(a.x, a.y + dy)?.blocksMove) return Infinity;
    }
    let cost = FEET_PER_SQUARE;
    if (cb.difficult) cost += FEET_PER_SQUARE;
    // Climbing a 5-foot ledge costs extra movement (1 extra foot per foot climbed).
    const dh = Math.abs(cb.height - ca.height);
    if (dh > 0.5) cost += FEET_PER_SQUARE * Math.round(dh);
    return cost;
  }

  neighbours(p: Pos): Pos[] {
    const out: Pos[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) { const x = p.x + dx, y = p.y + dy; if (this.inBounds(x, y)) out.push({ x, y }); }
    }
    return out;
  }
}

/** Distance in feet between two squares (diagonals count as 5 ft). */
export function distanceFt(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * FEET_PER_SQUARE;
}

export function samePos(a: Pos, b: Pos): boolean { return a.x === b.x && a.y === b.y; }
export function posKey(p: Pos): string { return `${p.x},${p.y}`; }

// ---------------------------------------------------------------- cover

export type Cover = 'none' | 'half' | 'three-quarters' | 'total';
export const COVER_AC: Record<Cover, number> = { none: 0, half: 2, 'three-quarters': 5, total: Infinity };
const COVER_RANK: Record<Cover, number> = { none: 0, half: 1, 'three-quarters': 2, total: 3 };
export function maxCover(a: Cover, b: Cover): Cover { return COVER_RANK[a] >= COVER_RANK[b] ? a : b; }
export function coverAtLeast(c: Cover, min: Cover): boolean { return COVER_RANK[c] >= COVER_RANK[min]; }

/** Does the segment p→q pass through the interior of the unit square at (cx, cy)? (Liang–Barsky) */
function segmentHitsSquare(px: number, py: number, qx: number, qy: number, cx: number, cy: number, inset = 0.08): boolean {
  const minX = cx + inset, maxX = cx + 1 - inset, minY = cy + inset, maxY = cy + 1 - inset;
  let t0 = 0, t1 = 1;
  const dx = qx - px, dy = qy - py;
  // the four slab tests, unrolled (this is the hottest loop in the AI)
  const ps = [-dx, dx, -dy, dy], qs = [px - minX, maxX - px, py - minY, maxY - py];
  for (let i = 0; i < 4; i++) {
    const p = ps[i], q = qs[i];
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}

/** Squares a segment could touch (bounding box), excluding the two endpoint squares. */
function* candidateSquares(a: Pos, b: Pos): Generator<Pos> {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
    yield { x, y };
  }
}

/**
 * Cover the target has against the attacker. We sample the attacker's square
 * (centre + four inset corners) and trace to a 3×3 lattice of points inside the
 * target's square, keeping the attacker point with the clearest view (as the DMG
 * corner method intends, without its quirk of edge-grazing lines counting as
 * blocked). Blocked share: 0 → none, ≤ 4/9 → half, < 9/9 → three-quarters,
 * all → total. A creature on the centre line adds at most half cover.
 */
export function computeCover(grid: Grid, attacker: Pos, target: Pos, creatureSquares: Pos[] = []): Cover {
  if (samePos(attacker, target)) return 'none';
  let cover = terrainCover(grid, attacker, target);
  if (cover === 'none' && creatureSquares.length) {
    const ax = attacker.x + 0.5, ay = attacker.y + 0.5, tx = target.x + 0.5, ty = target.y + 0.5;
    if (creatureSquares.some((c) => !samePos(c, attacker) && !samePos(c, target) && segmentHitsSquare(ax, ay, tx, ty, c.x, c.y, 0.2))) cover = 'half';
  }
  return cover;
}

const COVERS: Cover[] = ['none', 'half', 'three-quarters', 'total'];
const coverCache = new WeakMap<Grid, Int8Array>();

/** Cover from terrain alone. Terrain never changes mid-fight, so results are memoised per grid (0 = not yet known). */
function terrainCover(grid: Grid, attacker: Pos, target: Pos): Cover {
  const n = grid.width * grid.height;
  let cache = coverCache.get(grid);
  if (!cache) { cache = new Int8Array(n * n); coverCache.set(grid, cache); }
  const key = (attacker.y * grid.width + attacker.x) * n + target.y * grid.width + target.x;
  const hit = cache[key];
  if (hit) return COVERS[hit - 1];
  const lo = 0.15, hi = 0.85;
  const from: [number, number][] = [[0.5, 0.5], [lo, lo], [hi, lo], [lo, hi], [hi, hi]].map(([a, b]) => [attacker.x + a, attacker.y + b]);
  const to: [number, number][] = [];
  for (const a of [lo, 0.5, hi]) for (const b of [lo, 0.5, hi]) to.push([target.x + a, target.y + b]);
  const blockers: Pos[] = [];
  for (const sq of candidateSquares(attacker, target)) if (grid.cell(sq.x, sq.y)?.blocksSight) blockers.push(sq);
  let best = Infinity;
  for (const [ax, ay] of from) {
    let blocked = 0;
    for (const [tx, ty] of to) if (blockers.some((s) => segmentHitsSquare(ax, ay, tx, ty, s.x, s.y, 0))) blocked++;
    best = Math.min(best, blocked);
    if (best === 0) break;
  }
  const cover: Cover = best === 0 ? 'none' : best <= 4 ? 'half' : best < to.length ? 'three-quarters' : 'total';
  cache[key] = COVERS.indexOf(cover) + 1;
  return cover;
}

export function hasLineOfSight(grid: Grid, a: Pos, b: Pos): boolean {
  return computeCover(grid, a, b) !== 'total';
}
