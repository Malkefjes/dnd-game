// The Hollow Abbey. Phase 0 test floors: the shape of the real thing (graveyard, chapel,
// cloister, scriptorium, stairs to the crypt) with placeholder fights. Phase 5 replaces
// the contents. Legend: see MAP_LEGEND in engine/grid.ts.
import type { MapDef } from '../../world/map';

export const ABBEY_1: MapDef = {
  id: 'abbey-1',
  name: 'The Ruined Abbey',
  rows: [
    '############################',
    '#.......a.....rr.#.........#',
    '#...P.......P.r..#.b.....b.#',
    '#................#.........#',
    '#...P.......P....#.b.....>.#',
    '#................#.........#',
    '########d#############d#####',
    '#,,,,,,,,,,,,,,,,#.........#',
    '#,,,,,,,,,,,,,,,,#.........#',
    '#,,t,,t,,t,,t,,,,#..P...P..#',
    '#,,,,,,,,,,,,,t,,#.........#',
    '#,,,,,,,,,,,,,,,,#....r....#',
    '#,,t,,t,,t,,t,,,,#.........#',
    '#,,,,,,,,,,,,,,,,D..P...P..#',
    '#,,,,,,,,,,,,,,,,#.........#',
    '#,,t,,t,,t,,,,,,,#....r....#',
    '#,,,,,,,,,,,,,,,,#.........#',
    '#,,,,,,,,,,,,,,,,#..P...P..#',
    '#,,,,t,,,,,,,,,,,#.........#',
    '#,,,,,,,,,,,,,,,,#.........#',
    '#,,,,,,,,,,,,,,bb#.........#',
    '############################',
  ],
  start: [{ x: 3, y: 19 }, { x: 2, y: 19 }, { x: 3, y: 20 }, { x: 2, y: 20 }],
  stairs: [{ id: 'down', at: { x: 25, y: 4 }, to: { map: 'crypt-1', stairs: 'up' }, label: 'Down into the crypts' }],
  groups: [
    {
      id: 'graveyard', name: 'The restless graves', dormant: true, trigger: { x: 1, y: 7, w: 16, h: 8 },
      members: [
        { id: 'grave1', monster: 'skeleton', at: { x: 7, y: 10 } },
        { id: 'grave2', monster: 'skeleton', at: { x: 10, y: 13 } },
        { id: 'grave3', monster: 'skeleton', at: { x: 13, y: 11 } },
      ],
    },
    {
      id: 'chapel', name: 'The faithful', trigger: { x: 1, y: 1, w: 16, h: 5 },
      members: [
        { id: 'chapel1', monster: 'zombie', name: 'Brother Ansel', at: { x: 6, y: 3 } },
        { id: 'chapel2', monster: 'zombie', name: 'Sister Wenna', at: { x: 10, y: 2 } },
      ],
    },
    {
      id: 'cloister', name: 'The cloister watch', trigger: { x: 18, y: 7, w: 9, h: 14 },
      members: [
        { id: 'cloister1', monster: 'skeleton', at: { x: 21, y: 8 } },
        { id: 'cloister2', monster: 'skeleton', at: { x: 25, y: 15 } },
        { id: 'cloister3', monster: 'zombie', at: { x: 23, y: 12 } },
      ],
    },
  ],
  notes: [
    { id: 'altar', at: { x: 8, y: 2 }, title: 'The altar of Saint Aldric', text: 'The altar cloth is rotted through. Someone has scratched a single word into the stone with a knife: BELOW.' },
    { id: 'journal', at: { x: 21, y: 3 }, title: 'A water-stained journal', text: '"The bells stopped on the feast of Saint Aldric. Prior Hesk says the crypt must stay sealed. Prior Hesk has not slept in nine days, and neither, I think, has anything beneath us."' },
  ],
  rests: [{ at: { x: 22, y: 3 }, kind: 'short' }],
};

export const CRYPT_1: MapDef = {
  id: 'crypt-1',
  name: 'The Crypts',
  rows: [
    '####################',
    '#.<...####....a..rr#',
    '#........d.........#',
    '#.....####..c...c..#',
    '#.....####.........#',
    '#...######....P....#',
    '#...######.........#',
    '#...######..c...c..#',
    '#...######.........#',
    '#...######....P....#',
    '#..................#',
    '#...######..c...c..#',
    '#...######........r#',
    '####################',
  ],
  stairs: [{ id: 'up', at: { x: 2, y: 1 }, to: { map: 'abbey-1', stairs: 'down' }, label: 'Up to the abbey' }],
  groups: [
    {
      id: 'ossuary', name: 'The ossuary', trigger: { x: 10, y: 1, w: 9, h: 12 },
      members: [
        { id: 'oss1', monster: 'skeleton', at: { x: 13, y: 5 } },
        { id: 'oss2', monster: 'skeleton', at: { x: 15, y: 10 } },
        { id: 'oss3', monster: 'zombie', at: { x: 17, y: 6 } },
      ],
    },
  ],
  notes: [
    { id: 'inscription', at: { x: 11, y: 2 }, title: 'An inscription', text: 'HERE THE FAITHFUL WAIT FOR THE MORNING. Below it, newer and cut deeper: THE MORNING IS NOT COMING.' },
  ],
};

export const ABBEY: Record<string, MapDef> = { [ABBEY_1.id]: ABBEY_1, [CRYPT_1.id]: CRYPT_1 };
