// The goblin den: Grukk's war band against a party of four.
import { Combat } from '../engine/combat';
import { Rng } from '../engine/dice';
import { Grid } from '../engine/grid';
import { torvald, nyx, maren, elowen, type Level } from '../data/heroes';
import { goblinWarrior, goblinBoss, goblinMinion, hobgoblinWarrior } from '../data/monsters';

/** Legend: # wall, D door, . floor, P pillar, r rubble (difficult), H platform, S stairs, b barrels, B brazier. */
export const GOBLIN_DEN = [
  '######D########',
  '#....B......rr.',
  '#...........r..',
  '#..P......P....',
  '#..............',
  '#..........SHHH',
  '#..........HHHH',
  '#.bb.......HHHH',
  '#b.....P...HHHH',
  '#..............',
  '#..............',
  '#..............',
];

export function goblinDen(seed = Date.now(), level: Level = 3): Combat {
  const combat = new Combat(Grid.fromRows(GOBLIN_DEN), new Rng(seed));
  combat.add(torvald(level), { x: 3, y: 9 });
  combat.add(nyx(level), { x: 4, y: 10 });
  combat.add(maren(level), { x: 2, y: 10 });
  combat.add(elowen(level), { x: 3, y: 11 });
  combat.add(goblinWarrior('gob1'), { x: 6, y: 3 });
  combat.add(goblinWarrior('gob4'), { x: 8, y: 5 });
  combat.add({ ...goblinWarrior('gob2', 'Goblin Archer'), model: 'goblinArcher' }, { x: 13, y: 5 });
  combat.add({ ...goblinWarrior('gob6', 'Goblin Archer'), model: 'goblinArcher' }, { x: 14, y: 8 });
  combat.add(goblinMinion('gob3'), { x: 5, y: 5 });
  combat.add(goblinMinion('gob7'), { x: 4, y: 1 });
  combat.add(hobgoblinWarrior('hob1'), { x: 7, y: 2 });
  combat.add(hobgoblinWarrior('hob2'), { x: 10, y: 4 });
  combat.add(hobgoblinWarrior('hob3'), { x: 9, y: 1 });
  combat.add(goblinBoss('boss', 'Grukk the Boss'), { x: 13, y: 7 });
  return combat;
}
