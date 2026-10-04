// Seeded randomness and dice. All game randomness flows through an Rng so a
// fight can be replayed exactly from its seed (handy for tests and bug reports).

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  /** Uniform float in [0, 1). mulberry32. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Integer in [1, sides]. */
  die(sides: number): number { return 1 + Math.floor(this.next() * sides); }
  get state(): number { return this.s; }
}

/** A queue of forced results, consumed before falling back to the real Rng. For tests. */
export class RiggedRng extends Rng {
  constructor(private queue: number[], seed = 1) { super(seed); }
  push(...values: number[]) { this.queue.push(...values); }
  override die(sides: number): number {
    const v = this.queue.shift();
    if (v === undefined) return super.die(sides);
    if (v < 1 || v > sides) throw new Error(`rigged value ${v} out of range for d${sides}`);
    return v;
  }
}

export interface DiceTerm { count: number; sides: number }
export interface DiceExpr { terms: DiceTerm[]; bonus: number }

/** Parse "2d6+3", "1d8", "1d4-1", "5". */
export function parseDice(expr: string): DiceExpr {
  const clean = expr.replace(/\s+/g, '');
  const parts = clean.match(/[+-]?[^+-]+/g) ?? [];
  const out: DiceExpr = { terms: [], bonus: 0 };
  for (const p of parts) {
    const sign = p.startsWith('-') ? -1 : 1;
    const body = p.replace(/^[+-]/, '');
    const m = body.match(/^(\d*)d(\d+)$/);
    if (m) {
      if (sign < 0) throw new Error(`negative dice not supported: ${expr}`);
      out.terms.push({ count: m[1] ? Number(m[1]) : 1, sides: Number(m[2]) });
    } else if (/^\d+$/.test(body)) {
      out.bonus += sign * Number(body);
    } else {
      throw new Error(`bad dice expression: ${expr}`);
    }
  }
  return out;
}

export function formatDice(d: DiceExpr): string {
  const t = d.terms.map((x) => `${x.count}d${x.sides}`).join('+');
  if (!d.bonus) return t || '0';
  return `${t}${d.bonus > 0 ? '+' : '-'}${Math.abs(d.bonus)}`;
}

export function averageDice(d: DiceExpr): number {
  return d.terms.reduce((s, t) => s + (t.count * (t.sides + 1)) / 2, 0) + d.bonus;
}

export interface DiceRoll { rolls: number[]; total: number }

/** Roll the dice in `d`. `doubleDice` implements critical hits (roll the dice twice). */
export function rollDice(rng: Rng, d: DiceExpr, doubleDice = false): DiceRoll {
  const rolls: number[] = [];
  for (const t of d.terms) {
    const n = t.count * (doubleDice ? 2 : 1);
    for (let i = 0; i < n; i++) rolls.push(rng.die(t.sides));
  }
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + d.bonus };
}

export type Advantage = 'advantage' | 'disadvantage' | 'normal';

/** Advantage and disadvantage cancel out entirely, however many sources of each (PHB 2024). */
export function resolveAdvantage(adv: number, dis: number): Advantage {
  if (adv > 0 && dis === 0) return 'advantage';
  if (dis > 0 && adv === 0) return 'disadvantage';
  return 'normal';
}

export interface D20Roll { rolls: number[]; natural: number; mode: Advantage }

/**
 * Roll a d20 Test die. `rerollOnes` models the halfling Luck trait: a natural 1
 * on any die is rerolled once and the new roll must be used.
 */
export function rollD20(rng: Rng, mode: Advantage, rerollOnes = false): D20Roll {
  const one = () => { let v = rng.die(20); if (rerollOnes && v === 1) v = rng.die(20); return v; };
  const a = one();
  if (mode === 'normal') return { rolls: [a], natural: a, mode };
  const b = one();
  return { rolls: [a, b], natural: mode === 'advantage' ? Math.max(a, b) : Math.min(a, b), mode };
}

/** Probability that d20 + mod >= target, accounting for nat 1 / nat 20 on attacks. */
export function hitChance(mod: number, target: number, mode: Advantage, attack = true): number {
  let p = 0;
  for (let n = 1; n <= 20; n++) {
    const success = attack ? n === 20 || (n !== 1 && n + mod >= target) : n + mod >= target;
    if (success) p += 1 / 20;
  }
  if (mode === 'advantage') return 1 - (1 - p) ** 2;
  if (mode === 'disadvantage') return p ** 2;
  return p;
}
