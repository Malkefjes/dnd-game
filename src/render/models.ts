// The visual map (tile kinds and floor heights) plus small shared helpers.
import * as THREE from 'three';

export type TileKind = 'floor' | 'wall' | 'door' | 'pillar' | 'rubble' | 'platform' | 'stairs' | 'barrel' | 'brazier';
export interface Tile { x: number; y: number; kind: TileKind; h: number }
export type Archetype = 'fighter' | 'rogue' | 'goblin' | 'goblinArcher' | 'goblinBoss';

const LEGEND: Record<string, TileKind> = {
  '#': 'wall', D: 'door', '.': 'floor', P: 'pillar', r: 'rubble', H: 'platform', S: 'stairs', b: 'barrel', B: 'brazier',
};

/** The visual map, built from the same rows as the rules grid. */
export class DungeonMap {
  readonly tiles: Tile[] = [];
  readonly width: number;
  readonly height: number;
  constructor(readonly rows: string[]) {
    this.height = rows.length; this.width = rows[0].length;
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const kind = LEGEND[ch] ?? 'floor';
      this.tiles.push({ x, y, kind, h: kind === 'platform' ? 1 : kind === 'stairs' ? 0.5 : 0 });
    }));
  }
  tileAt(x: number, y: number): Tile | undefined {
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? undefined : this.tiles[y * this.width + x];
  }
  floorY(x: number, y: number): number { return (this.tileAt(x, y)?.h ?? 0) * LEVEL; }
  center(): THREE.Vector3 { return new THREE.Vector3((this.width - 1) / 2, 0, (this.height - 1) / 2); }
  isWall(x: number, y: number): boolean { const k = this.tileAt(x, y)?.kind; return k === 'wall' || k === 'door'; }
}


export const LEVEL = 0.6; // world units per grid height unit

/** Deterministic PRNG so the dungeon dressing is identical every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
