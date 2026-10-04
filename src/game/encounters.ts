// Milestone 1 encounter: the goblin den.
import { Combat } from '../engine/combat';
import { Rng } from '../engine/dice';
import { Grid } from '../engine/grid';
import { torvald, nyx } from '../data/heroes';
import { goblinWarrior, goblinBoss, goblinMinion } from '../data/monsters';

/** Legend: # wall, D door, . floor, P pillar, r rubble (difficult), H platform, S stairs, b barrels, B brazier. */
export const GOBLIN_DEN = [
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

export function goblinDen(seed = Date.now()): Combat {
  const combat = new Combat(Grid.fromRows(GOBLIN_DEN), new Rng(seed));
  combat.add(torvald(), { x: 2, y: 9 });
  combat.add(nyx(), { x: 1, y: 9 });
  combat.add(goblinWarrior('gob1'), { x: 7, y: 3 });
  combat.add(goblinWarrior('gob2', 'Goblin Archer'), { x: 10, y: 2 });
  combat.add(goblinMinion('gob3'), { x: 6, y: 5 });
  combat.add(goblinBoss('boss', 'Grukk the Boss'), { x: 10, y: 6 });
  return combat;
}
