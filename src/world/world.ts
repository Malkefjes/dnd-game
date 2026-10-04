// The campaign: what lasts between fights. The party (HP, spent slots, items, where they
// stand), every floor's doors and enemy groups, and the dice. A Combat runs *inside* the
// world: beginCombat() builds one from the current state, finishCombat() writes the
// results back. Pure TypeScript like the engine, so it's unit-tested and saves as JSON.
import { Combat, type CarriedState } from '../engine/combat';
import { Rng } from '../engine/dice';
import { Grid, posKey, samePos, type Pos } from '../engine/grid';
import type { Condition, CreatureDef } from '../engine/types';
import { PRESETS, type Level } from '../data/heroes';
import { MONSTERS } from '../data/monsters';
import { doorId, doorsOf, inRect, type GroupDef, type MapDef } from './map';

/** How a hero is built. Phase 1 turns this into the character creator's choices. */
export interface HeroBuild { preset: string; level: Level }

export interface HeroState extends CarriedState {
  id: string;
  build: HeroBuild;
  pos: Pos;
  dead: boolean;
  xp: number;
}

export interface FloorState {
  /** Groups that have been beaten. */
  defeated: string[];
  /** Doors that are open, by door id. */
  open: string[];
  /** Notes the party has read. */
  read: string[];
}

export interface WorldState {
  version: 1;
  mapId: string;
  party: HeroState[];
  floors: Record<string, FloorState>;
  rng: unknown;
  /** Bumped on every save, shown on the load screen. */
  saves: number;
}

/** Conditions that outlast a fight. Everything else (Bless, Dodge, Prone, Sleep…) ends with it. */
const LASTING: Condition['id'][] = ['aided'];

export class World {
  grid!: Grid;
  readonly rng: Rng;

  constructor(readonly maps: Record<string, MapDef>, public state: WorldState) {
    this.rng = new Rng(1);
    this.rng.load(state.rng);
    this.enterFloor(state.mapId);
  }

  static newGame(maps: Record<string, MapDef>, opts: { seed: number; mapId: string; party: HeroBuild[] }): World {
    const map = maps[opts.mapId];
    const party = opts.party.map((build, i): HeroState => {
      const def = PRESETS[build.preset](build.level);
      return {
        id: def.id, build, pos: { ...(map.start?.[i] ?? { x: 1, y: 1 }) }, dead: false, xp: 0,
        hp: def.maxHp, maxHp: def.maxHp, slotsLeft: [...(def.spellcasting?.slots ?? [])],
        resourcesLeft: { ...(def.resources ?? {}) }, inv: { ...(def.inventory ?? {}) }, conditions: [],
      };
    });
    const rng = new Rng(opts.seed);
    return new World(maps, { version: 1, mapId: opts.mapId, party, floors: {}, rng: rng.save(), saves: 0 });
  }

  static load(maps: Record<string, MapDef>, json: string): World {
    const state = JSON.parse(json) as WorldState;
    if (state.version !== 1) throw new Error(`unknown save version ${state.version}`);
    return new World(maps, state);
  }

  /** The save file. The dice come along, so a reload rolls exactly what the next roll would have been. */
  serialize(): string {
    this.state.rng = this.rng.save();
    return JSON.stringify(this.state);
  }

  get map(): MapDef { return this.maps[this.state.mapId]; }
  get floor(): FloorState {
    const id = this.state.mapId;
    return (this.state.floors[id] ??= { defeated: [], open: [], read: [] });
  }

  heroDef(h: HeroState): CreatureDef { return PRESETS[h.build.preset](h.build.level); }
  living(): HeroState[] { return this.state.party.filter((h) => !h.dead); }

  /** Enemy groups still waiting on this floor. */
  groups(): GroupDef[] { return this.map.groups.filter((g) => !this.floor.defeated.includes(g.id)); }

  private enterFloor(id: string) {
    this.state.mapId = id;
    this.grid = Grid.fromRows(this.map.rows);
    for (const d of doorsOf(this.map)) if (this.floor.open.includes(doorId(d))) this.grid.setOpen(d.x, d.y, true);
  }

  // ------------------------------------------------------------ moving around

  /** Squares taken by monsters (heroes can walk through each other, not through enemies). */
  private blocked(): Set<string> {
    return new Set(this.groups().flatMap((g) => g.members.map((m) => posKey(m.at))));
  }

  /** Shortest walk (5-ft diagonals, difficult terrain, ledges, no corner cutting), or undefined. */
  pathTo(heroId: string, to: Pos): Pos[] | undefined {
    const hero = this.state.party.find((h) => h.id === heroId);
    if (!hero) return undefined;
    const g = this.grid, blocked = this.blocked();
    if (blocked.has(posKey(to)) || g.cell(to.x, to.y)?.blocksMove) return undefined;
    if (this.living().some((h) => h.id !== heroId && samePos(h.pos, to))) return undefined;
    const dist = new Map<string, number>([[posKey(hero.pos), 0]]);
    const prev = new Map<string, Pos>();
    const open: { p: Pos; d: number }[] = [{ p: hero.pos, d: 0 }];
    while (open.length) {
      open.sort((a, b) => a.d - b.d);
      const { p, d } = open.shift()!;
      if (samePos(p, to)) break;
      if (d > (dist.get(posKey(p)) ?? Infinity)) continue;
      for (const n of g.neighbours(p)) {
        const step = g.stepCost(p, n);
        if (!isFinite(step) || blocked.has(posKey(n))) continue;
        const nd = d + step;
        if (nd >= (dist.get(posKey(n)) ?? Infinity)) continue;
        dist.set(posKey(n), nd); prev.set(posKey(n), p); open.push({ p: n, d: nd });
      }
    }
    if (!dist.has(posKey(to))) return undefined;
    const path = [to];
    while (!samePos(path[0], hero.pos)) path.unshift(prev.get(posKey(path[0]))!);
    return path;
  }

  setPos(heroId: string, p: Pos) { const h = this.state.party.find((x) => x.id === heroId); if (h) h.pos = { ...p }; }

  /** The group whose ground this square is, if any is still waiting. */
  triggeredBy(p: Pos): GroupDef | undefined { return this.groups().find((g) => inRect(g.trigger, p)); }

  // ------------------------------------------------------------ doors, stairs, notes

  doorAt(p: Pos): { id: string; open: boolean; locked?: { dc: number; key?: string } } | undefined {
    if (this.map.rows[p.y]?.[p.x] !== 'd') return undefined;
    const id = doorId(p);
    return { id, open: this.floor.open.includes(id), locked: this.map.locked?.find((l) => samePos(l.at, p)) };
  }

  /** Open or close a door. A door with someone standing in it can't close. */
  setDoor(p: Pos, open: boolean): boolean {
    const d = this.doorAt(p);
    if (!d || d.open === open) return false;
    if (!open && (this.living().some((h) => samePos(h.pos, p)) || this.blocked().has(posKey(p)))) return false;
    if (open && d.locked) return false; // Phase 2: keys, Thieves' Tools, forcing it
    this.floor.open = open ? [...this.floor.open, d.id] : this.floor.open.filter((x) => x !== d.id);
    this.grid.setOpen(p.x, p.y, open);
    return true;
  }

  stairsAt(p: Pos) { return this.map.stairs?.find((s) => samePos(s.at, p)); }

  /** Take the party to another floor; they arrive around the matching stairs. */
  travel(stairsId: string) {
    const from = this.map.stairs?.find((s) => s.id === stairsId);
    if (!from) throw new Error(`no stairs ${stairsId}`);
    this.enterFloor(from.to.map);
    const arrive = this.map.stairs!.find((s) => s.id === from.to.stairs)!.at;
    const spots = this.freeAround(arrive, this.living().length);
    this.living().forEach((h, i) => { h.pos = spots[i] ?? arrive; });
  }

  /** Nearest free walkable squares around `p` (breadth-first), for placing the party. */
  freeAround(p: Pos, n: number): Pos[] {
    const out: Pos[] = [], seen = new Set([posKey(p)]), queue = [p], blocked = this.blocked();
    while (queue.length && out.length < n) {
      const q = queue.shift()!;
      const c = this.grid.cell(q.x, q.y);
      if (c && !c.blocksMove && !blocked.has(posKey(q))) out.push(q);
      for (const nb of this.grid.neighbours(q)) {
        if (seen.has(posKey(nb)) || !isFinite(this.grid.stepCost(q, nb))) continue;
        seen.add(posKey(nb)); queue.push(nb);
      }
    }
    return out;
  }

  noteAt(p: Pos) { return this.map.notes?.find((n) => samePos(n.at, p)); }
  markRead(id: string) { if (!this.floor.read.includes(id)) this.floor.read.push(id); }

  // ------------------------------------------------------------ fights

  /** Build the fight with a group: the living heroes as they are now, against the group's members. */
  beginCombat(groupId: string): Combat {
    const group = this.map.groups.find((g) => g.id === groupId)!;
    const combat = new Combat(this.grid, this.rng);
    for (const h of this.living()) combat.add(this.heroDef(h), h.pos, h);
    for (const m of group.members) combat.add(MONSTERS[m.monster](m.id, m.name), m.at);
    return combat;
  }

  /**
   * Write a finished fight back. The heroes keep their HP, spent slots and items. Rulings: a hero
   * left at 0 HP but alive gets up with 1 HP once the fight is over (the 2024 rules have a stable
   * creature regain 1 HP after 1d4 hours; exploration doesn't count hours yet), and effects that
   * last a minute or less end with the fight.
   */
  finishCombat(combat: Combat, groupId: string): 'victory' | 'defeat' {
    for (const h of this.state.party) {
      const c = combat.creatures.find((x) => x.id === h.id);
      if (!c) continue;
      h.dead = !combat.isAlive(c);
      h.hp = h.dead ? 0 : Math.max(1, c.hp);
      h.maxHp = c.maxHp;
      h.slotsLeft = [...c.slotsLeft];
      h.resourcesLeft = { ...c.resourcesLeft };
      h.inv = { ...c.inv };
      h.conditions = c.conditions.filter((k) => LASTING.includes(k.id)).map((k) => ({ ...k }));
      h.pos = { ...c.pos };
    }
    if (combat.over === 'party') {
      this.floor.defeated.push(groupId);
      return 'victory';
    }
    return 'defeat';
  }
}
