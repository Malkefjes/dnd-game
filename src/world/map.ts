// Map format v2: terrain rows plus everything that lives on the map (doors, stairs between
// floors, enemy groups, story notes, rest spots). Pure data, no rendering.
import type { Pos } from '../engine/grid';

export interface Rect { x: number; y: number; w: number; h: number }

export function inRect(r: Rect, p: Pos): boolean { return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h; }

/** A band of monsters that wait in the world and fight together. */
export interface GroupDef {
  id: string;
  name: string;
  /** `model` swaps the 3D figure only (the rules come from `monster`). */
  members: { id: string; monster: string; name?: string; model?: string; at: Pos }[];
  /**
   * Squares that start the fight when a hero steps into them. (Phase 2 replaces this
   * with sight lines and Surprise; until then, entering the room starts the fight.)
   */
  trigger: Rect;
  /** Lying still until disturbed (skeletons on the floor, corpses that aren't corpses). */
  dormant?: boolean;
}

export interface MapDef {
  id: string;
  name: string;
  /** Terrain rows (see MAP_LEGEND in engine/grid.ts). `d` doors start closed. */
  rows: string[];
  /** Where a new game puts the party (one square per hero, in party order). */
  start?: Pos[];
  /** Stairs `<` / `>`: where each leads. `to` names a stairs id on the other map. */
  stairs?: { id: string; at: Pos; to: { map: string; stairs: string }; label: string }[];
  /** Locked doors (Phase 2 adds keys and picking). Unlisted `d` doors open with a click. */
  locked?: { at: Pos; dc: number; key?: string }[];
  groups: GroupDef[];
  notes?: { id: string; at: Pos; title: string; text: string }[];
  rests?: { at: Pos; kind: 'short' | 'long' }[];
}

export const doorId = (p: Pos) => `door@${p.x},${p.y}`;

/** All closable doors on a map. */
export function doorsOf(map: MapDef): Pos[] {
  const out: Pos[] = [];
  map.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'd') out.push({ x, y }); }));
  return out;
}

/** Sanity checks: run by the tests on every shipped map. */
export function validateMap(map: MapDef): string[] {
  const errs: string[] = [];
  const w = map.rows[0]?.length ?? 0;
  map.rows.forEach((r, y) => { if (r.length !== w) errs.push(`${map.id}: row ${y} is ${r.length} wide, expected ${w}`); });
  const glyph = (p: Pos) => map.rows[p.y]?.[p.x];
  const walkable = (p: Pos) => { const g = glyph(p); return g !== undefined && ".,<>DdrSHw".includes(g); };
  for (const s of map.stairs ?? []) if (glyph(s.at) !== '<' && glyph(s.at) !== '>') errs.push(`${map.id}: stairs ${s.id} not on a < or > square`);
  for (const p of map.start ?? []) if (!walkable(p)) errs.push(`${map.id}: start square ${p.x},${p.y} isn't walkable`);
  const ids = new Set<string>();
  for (const g of map.groups) for (const m of g.members) {
    if (!walkable(m.at)) errs.push(`${map.id}: ${m.id} stands on '${glyph(m.at)}' at ${m.at.x},${m.at.y}`);
    if (ids.has(m.id)) errs.push(`${map.id}: duplicate creature id ${m.id}`);
    ids.add(m.id);
  }
  return errs;
}
