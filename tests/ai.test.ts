import { describe, expect, it } from 'vitest';
import { TacticalAI } from '../src/engine/ai';
import { goblinDen } from '../src/game/encounters';
import type { Combat } from '../src/engine/combat';

/** Play a whole fight with the AI controlling both sides. */
export function autoplay(combat: Combat, maxRounds = 40) {
  const ai = new TacticalAI(combat);
  combat.start();
  let turns = 0;
  while (!combat.over && combat.round <= maxRounds) {
    ai.takeTurn(combat.active!.id);
    if (++turns > maxRounds * 10) break;
  }
  return { winner: combat.over, rounds: combat.round };
}

describe('tactical AI', () => {
  it('plays 100 full goblin-den fights without errors and they all finish', () => {
    let party = 0, totalRounds = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = autoplay(goblinDen(seed));
      expect(r.winner, `seed ${seed} did not finish`).not.toBeNull();
      if (r.winner === 'party') party++;
      totalRounds += r.rounds;
    }
    // A fair-but-dangerous fight: the heroes should usually, but not always, win.
    console.log(`party win rate ${(party).toFixed(0)}%, avg ${(totalRounds / 100).toFixed(1)} rounds`);
    expect(party).toBeGreaterThan(30);
    expect(party).toBeLessThan(100);
  }, 60000);

  it('goblin archers keep their distance', () => {
    const combat = goblinDen(7);
    const ai = new TacticalAI(combat);
    combat.start();
    // Run until the archer has had a turn
    let guard = 0;
    while (!combat.over && guard++ < 40) {
      const id = combat.active!.id;
      ai.takeTurn(id);
      if (id === 'gob2') break;
    }
    const archer = combat.get('gob2');
    const heroes = combat.creatures.filter((c) => c.side === 'party' && combat.isConscious(c));
    if (combat.isConscious(archer) && heroes.length) {
      const nearest = Math.min(...heroes.map((h) => Math.max(Math.abs(h.pos.x - archer.pos.x), Math.abs(h.pos.y - archer.pos.y))));
      expect(nearest).toBeGreaterThan(1);
    }
  });
});
