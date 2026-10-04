// Shared mockup scene: one combat moment rendered by every style mockup so they
// can be compared like-for-like. Grid coordinates: x runs to the screen
// bottom-right, y to the screen bottom-left (standard isometric).

export type TileKind = 'floor' | 'wall' | 'door' | 'pillar' | 'rubble' | 'platform' | 'stairs' | 'barrel' | 'brazier';

export interface Tile {
  x: number;
  y: number;
  kind: TileKind;
  /** Floor height in grid units (platform = 1). */
  h: number;
}

const LEGEND: Record<string, TileKind> = {
  '#': 'wall', D: 'door', '.': 'floor', P: 'pillar', r: 'rubble', H: 'platform',
  S: 'stairs', b: 'barrel', B: 'brazier',
};

export const MAP_ROWS = [
  '#####D######',
  '#....B....rr',
  '#.........r.',
  '#..P........',
  '#...........',
  '#.......SHHH',
  '#.......HHHH',
  '#.b.....HHHH',
  '#bb...P.....',
  '#...........',
];

export const W = MAP_ROWS[0].length;
export const H = MAP_ROWS.length;

export const tiles: Tile[] = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const kind = LEGEND[MAP_ROWS[y][x]];
    const h = kind === 'platform' ? 1 : kind === 'stairs' ? 0.5 : 0;
    tiles.push({ x, y, kind, h });
  }
}

export function tileAt(x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= W || y >= H) return undefined;
  return tiles[y * W + x];
}

export type Side = 'party' | 'enemy';
export type Archetype = 'fighter' | 'rogue' | 'goblin' | 'goblinArcher' | 'goblinBoss';

export interface Unit {
  id: string;
  name: string;
  title: string;
  side: Side;
  archetype: Archetype;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ac: number;
  initiative: number;
  /** Facing angle in grid space, radians (0 = +x). */
  facing: number;
  hidden?: boolean;
}

export const units: Unit[] = [
  { id: 'torvald', name: 'Torvald', title: 'Dwarf Fighter 2', side: 'party', archetype: 'fighter', x: 4, y: 5, hp: 22, maxHp: 22, ac: 19, initiative: 15, facing: -0.5 },
  { id: 'nyx', name: 'Nyx', title: 'Halfling Rogue 2', side: 'party', archetype: 'rogue', x: 2, y: 3, hp: 13, maxHp: 17, ac: 14, initiative: 19, facing: 0, hidden: true },
  { id: 'gob1', name: 'Goblin Warrior', title: 'CR 1/4', side: 'enemy', archetype: 'goblin', x: 7, y: 4, hp: 10, maxHp: 10, ac: 15, initiative: 12, facing: Math.PI },
  { id: 'gob2', name: 'Goblin Warrior', title: 'CR 1/4', side: 'enemy', archetype: 'goblinArcher', x: 10, y: 2, hp: 6, maxHp: 10, ac: 15, initiative: 9, facing: Math.PI * 0.8 },
  { id: 'boss', name: 'Goblin Boss', title: 'CR 1', side: 'enemy', archetype: 'goblinBoss', x: 10, y: 6, hp: 21, maxHp: 21, ac: 17, initiative: 14, facing: Math.PI * 1.1 },
  { id: 'gob3', name: 'Goblin Minion', title: 'CR 1/8', side: 'enemy', archetype: 'goblin', x: 6, y: 7, hp: 7, maxHp: 7, ac: 12, initiative: 6, facing: -Math.PI * 0.7 },
];

export const activeId = 'torvald';
export const targetId = 'gob1';
/** The path the cursor is previewing: Torvald steps up next to the goblin. */
export const previewPath: [number, number][] = [[4, 5], [5, 4], [6, 4]];

export function isBlocking(t: Tile | undefined): boolean {
  return !t || t.kind === 'wall' || t.kind === 'pillar' || t.kind === 'barrel' || t.kind === 'brazier';
}

/** Tiles reachable by the active unit this turn, with their movement cost in squares. */
export function reachable(fromX: number, fromY: number, budget: number): Map<string, number> {
  const occupied = new Set(units.map((u) => `${u.x},${u.y}`));
  const best = new Map<string, number>([[`${fromX},${fromY}`, 0]]);
  const queue: [number, number, number][] = [[fromX, fromY, 0]];
  while (queue.length) {
    queue.sort((a, b) => a[2] - b[2]);
    const [x, y, c] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      const t = tileAt(nx, ny);
      if (isBlocking(t) || occupied.has(`${nx},${ny}`)) continue;
      const from = tileAt(x, y)!;
      if (Math.abs(t!.h - from.h) > 0.6) continue; // need stairs to change level
      const nc = c + (t!.kind === 'rubble' ? 2 : 1);
      if (nc > budget) continue;
      const key = `${nx},${ny}`;
      if ((best.get(key) ?? Infinity) <= nc) continue;
      best.set(key, nc);
      queue.push([nx, ny, nc]);
    }
  }
  best.delete(`${fromX},${fromY}`);
  return best;
}

export const log: { kind: 'info' | 'hit' | 'miss' | 'crit' | 'turn' | 'heal'; text: string }[] = [
  { kind: 'turn', text: 'Round 2' },
  { kind: 'info', text: 'Nyx takes the Hide action — Stealth 21 vs DC 15.' },
  { kind: 'info', text: 'Nyx is now Invisible (hidden behind the pillar).' },
  { kind: 'miss', text: 'Goblin Warrior shoots Torvald — 17 vs AC 19. Deflected by his shield.' },
  { kind: 'miss', text: 'Goblin Boss: Shortbow misses Torvald (9).' },
  { kind: 'turn', text: "Torvald's turn" },
];
