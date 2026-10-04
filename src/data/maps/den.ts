// The Milestone 1–2 goblin den as a world map: a dev-only fight (?den=1) for the screenshot,
// playtest and pan-check tools. The whole map is the goblins' ground, so the fight starts at once.
import { GOBLIN_DEN, goblinDen } from '../../game/encounters';
import type { MapDef } from '../../world/map';

const placed = goblinDen(1).creatures;

export const DEN: MapDef = {
  id: 'den',
  name: 'The Goblin Den',
  rows: GOBLIN_DEN,
  start: placed.filter((c) => c.side === 'party').map((c) => ({ ...c.pos })),
  groups: [{
    id: 'den', name: "Grukk's war band", trigger: { x: 0, y: 0, w: GOBLIN_DEN[0].length, h: GOBLIN_DEN.length },
    members: placed.filter((c) => c.side === 'enemy').map((c) => ({
      id: c.id, name: c.name, model: c.model,
      monster: c.model === 'goblinBoss' ? 'goblinBoss' : c.model === 'hobgoblin' ? 'hobgoblinWarrior' : c.cr === '1/8' ? 'goblinMinion' : 'goblinWarrior',
      at: { ...c.pos },
    })),
  }],
};
