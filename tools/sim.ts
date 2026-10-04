// Run AI-vs-AI fights in the goblin den and print stats, or a full log for one seed.
//   npx tsx tools/sim.ts            → stats over 300 seeds
//   npx tsx tools/sim.ts 3          → play-by-play of seed 3
import { TacticalAI } from '../src/engine/ai';
import { goblinDen } from '../src/game/encounters';

const seedArg = process.argv[2];
function play(seed: number, verbose: boolean) {
  const c = goblinDen(seed);
  const ai = new TacticalAI(c);
  const out = [...c.start()];
  let turns = 0;
  while (!c.over && c.round <= 40 && turns++ < 400) out.push(...ai.takeTurn(c.active!.id));
  if (verbose) for (const e of out) if (e.type === 'log') console.log(e.text);
  return { winner: c.over, rounds: c.round, survivors: c.creatures.filter((x) => x.side === 'party' && c.isConscious(x)).length };
}
if (seedArg) console.log(play(Number(seedArg), true));
else {
  const N = Number(process.env.N) || 300; let win = 0, rounds = 0, unfinished = 0; const surv = [0, 0, 0, 0, 0];
  for (let s = 1; s <= N; s++) { const r = play(s, false); if (r.winner === 'party') { win++; surv[r.survivors]++; } if (!r.winner) unfinished++; rounds += r.rounds; }
  console.log(`party wins ${(win / N * 100).toFixed(1)}%  unfinished ${unfinished}  avg rounds ${(rounds / N).toFixed(1)}  heroes standing at the end (1/2/3/4): ${surv.slice(1).join("/")}`);
}
