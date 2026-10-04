// Tactical AI: a one-turn utility planner. For every square the creature can
// reach it scores "act from here" options (expected damage of attacks and spells,
// healing, Sleep, focus fire, opportunity-attack risk, exposure next round) and
// then uses its Bonus Action smartly (Nimble Escape / Cunning Action, Second Wind,
// potions, Healing Word, Spiritual Weapon, Misty Step).
//
// A turn is a generator of commands: the caller executes each one and sends back
// whether it worked. The game animates between steps (and can stop for a reaction
// prompt); takeTurn() drives it synchronously for tests and simulations.
import { Combat, RuleError, type Command, type GameEvent } from './combat';
import { distanceFt, posKey, samePos, computeCover, COVER_AC, type Pos } from './grid';
import { averageDice, hitChance } from './dice';
import type { AttackProfile, Creature, SpellDef } from './types';
import {
  areaSquares, areaVictims, castBlocker, expectedSpellDamage, failChance, pointError, slotOptions, spellHealing,
  summonCanReach, summonsOf, targetCount, targetError,
} from './spells';

type CastCmd = Extract<Command, { type: 'cast' }>;
/** Something to do with the action: an attack (possibly several, Multiattack), a spell, or another command. */
type Act =
  | { kind: 'attack'; attack: AttackProfile; target: Creature; value: number }
  | { kind: 'cast'; cmd: CastCmd; value: number }
  | { kind: 'other'; cmd: Command; value: number };

interface Option {
  pre: 'none' | 'disengage';
  dest: Pos;
  act?: Act;
  score: number;
}

/** Value of a spell slot, in "expected damage" units: casters keep some fuel for later rounds. */
const SLOT_COST = 2.2;

/** Rough damage-per-round a creature threatens, used to judge danger. */
function threatOf(c: Creature): number {
  const best = Math.max(0, ...c.attacks.map((a) => averageDice(a.damage)));
  const spell = c.spellcasting ? 7 : 0;
  return Math.max(best * c.attacksPerAction + (c.sneakAttackDice ?? 0) * 3.5, spell);
}

type Step = Generator<Command, void, boolean>;

export class TacticalAI {
  /** Sleep aim points and their value, cached for one planning pass. */
  private sleepAims?: { p: Pos; v: number }[];
  /** Visible enemies, cached while one plan is being worked out. */
  private targetCache?: { key: string; list: Creature[] };
  private planning = false;

  constructor(private combat: Combat) {}

  /** Play the active creature's whole turn synchronously. Returns every event produced. */
  takeTurn(id: string): GameEvent[] {
    const events: GameEvent[] = [];
    const gen = this.turn(id);
    let r = gen.next();
    while (!r.done) {
      let ok = true;
      try { events.push(...this.combat.execute(r.value)); } catch (e) { if (e instanceof RuleError) ok = false; else throw e; }
      r = gen.next(ok);
    }
    return events;
  }

  /** The turn as a sequence of commands. Each `yield` returns whether the command succeeded. */
  *turn(id: string): Step {
    const c = this.combat;
    const me = c.get(id);
    const alive = () => !c.over && c.isConscious(me) && c.active?.id === me.id;

    // a drowsy creature (Sleep) can't act; it stays where it is
    if (alive() && !c.cond(me, 'incapacitated')) {
      yield* this.useHealing(me);
      if (alive()) yield* this.bonusFirst(me);
      const plan = alive() ? this.bestOption(me) : undefined;
      if (plan && alive()) {
        if (plan.pre === 'disengage') yield { type: 'disengage', actor: id, via: 'bonus' };
        if (alive() && posKey(plan.dest) !== posKey(me.pos)) yield { type: 'move', actor: id, to: plan.dest };
        if (alive() && plan.act) yield* this.perform(me, plan.act);
        else if (alive() && me.turn.actions > 0) {
          // moved closer without a shot: maybe something is in reach now
          const act = this.bestActFrom(me, me.pos);
          if (act) yield* this.perform(me, act);
          else yield* this.noAttackFallback(me);
        }
      } else if (alive()) yield* this.noAttackFallback(me);

      if (alive()) yield* this.afterAction(me);
      if (alive() && me.turn.actions > 0 && !this.bestActFrom(me, me.pos)) {
        // nothing to hit: dodge if threatened
        if (c.enemiesOf(me).some((e) => c.isConscious(e) && distanceFt(e.pos, me.pos) <= 5)) yield { type: 'dodge', actor: id };
      }
    }
    if (!c.over && c.active?.id === me.id) yield { type: 'endTurn', actor: id };
  }

  /** Carry out an act from the current square. */
  private *perform(me: Creature, act: Act): Step {
    const c = this.combat;
    const alive = () => !c.over && c.isConscious(me) && c.active?.id === me.id;
    if (act.kind === 'cast' || act.kind === 'other') { yield act.cmd; return; }
    // Steady Aim first if we stood still and the shot lacks Advantage
    if (act.attack.kind === 'ranged' && c.has(me, 'steadyAim') && !me.turn.moved && me.turn.bonusActions > 0
      && c.previewAttack(me, act.attack, act.target).mode !== 'advantage') yield { type: 'steadyAim', actor: me.id };
    // Multiattack: re-pick a target for every attack (the first may have dropped)
    for (let i = 0; i < me.attacksPerAction && alive(); i++) {
      const pick = i === 0 && c.isAlive(act.target) ? act : this.bestAttackFromHere(me);
      if (!pick) break;
      if (!(yield { type: 'attack', actor: me.id, attack: pick.attack.id, target: pick.target.id })) break;
    }
    // Light weapon follow-up (two-weapon fighting)
    if (alive() && me.turn.bonusActions > 0) {
      for (const a of me.attacks) {
        const st = c.offhandStatus(me, a);
        const t = st && this.bestTargetFor(me, a);
        if (st && t && (yield { type: 'offhand', actor: me.id, attack: a.id, target: t.id })) break;
      }
    }
  }

  // ------------------------------------------------------------ valuing outcomes

  private targets(me: Creature): Creature[] {
    const c = this.combat;
    // planning asks this for every square it considers; visibility only depends on where we stand now
    const key = `${me.id}@${me.pos.x},${me.pos.y}`;
    if (this.targetCache?.key === key) return this.targetCache.list.filter((t) => c.isAlive(t));
    const list = c.enemiesOf(me).filter((t) => c.isAlive(t) && c.canSee(me, t));
    if (this.planning) this.targetCache = { key, list };
    return list;
  }

  /** Weight expected damage against `t`: finishing blows, dangerous and wounded targets count for more. */
  private damageValue(me: Creature, t: Creature, expected: number, finishWith = expected): number {
    const c = this.combat;
    if (t.hp === 0) return me.side === 'enemy' ? expected * 0.15 : 0; // goblins prefer live threats; heroes never hit the downed
    let v = expected;
    if (!c.isConscious(t)) v *= 1.2; // asleep: helpless
    if (finishWith >= t.hp) v *= 1.6; // can finish it
    v *= 1 + threatOf(t) / 30; // dangerous targets first
    v *= 1 + (1 - t.hp / t.maxHp) * 0.4; // wounded targets
    return v;
  }

  /** Expected-damage score of attacking `t` with `a`, weighted for focus fire. */
  private attackValue(me: Creature, a: AttackProfile, t: Creature, from: Pos): number {
    const c = this.combat;
    if (a.consumes && (me.inv[a.consumes] ?? 0) <= 0) return 0;
    if (distanceFt(from, t.pos) > (a.kind === 'melee' ? a.reach : a.range![1])) return 0;
    const p = c.previewAttack(me, a, t, { from });
    if (!p.inRange || p.cover === 'total') return 0;
    return this.damageValue(me, t, p.expected, p.expected * me.attacksPerAction) * me.attacksPerAction;
  }

  /** Healing is worth a lot on the dying and the badly hurt, nothing on the healthy. */
  private healValue(t: Creature, amount: number): number {
    const c = this.combat;
    if (!c.isAlive(t)) return 0;
    if (t.hp === 0) return 25 + amount;
    const frac = t.hp / t.maxHp;
    if (frac >= 0.5) return 0;
    return Math.min(amount, t.maxHp - t.hp) * (1.5 - frac);
  }

  /** Sleep: one turn lost on a failed save, the rest of the fight on a second failure. */
  private sleepValue(me: Creature, e: Creature): number {
    const c = this.combat;
    if (!c.isConscious(e) || c.cond(e, 'incapacitated') || c.has(e, 'trance')) return 0;
    const fail = failChance(c, e, 'wis', me.spellcasting!.dc);
    const threat = threatOf(e) * (1 + (e.hp / e.maxHp) * 0.3);
    return fail * (threat * 0.8 + fail * threat * 2.2);
  }

  /** How much damage `me` should expect to take from enemies next round standing at `p`. */
  private exposure(me: Creature, p: Pos): number {
    const c = this.combat;
    let total = 0;
    const myAc = c.acOf(me);
    for (const e of c.enemiesOf(me)) {
      if (!c.isConscious(e) || c.cond(e, 'incapacitated')) continue;
      const d = distanceFt(e.pos, p);
      const melee = c.meleeReach(e);
      const ranged = Math.max(0, ...e.attacks.filter((a) => a.kind === 'ranged' && (!a.consumes || (e.inv[a.consumes] ?? 0) > 0)).map((a) => a.range![0]), e.spellcasting ? 60 : 0);
      const cover = computeCover(c.grid, e.pos, p);
      const ac = myAc + (Number.isFinite(COVER_AC[cover]) ? COVER_AC[cover] : 99);
      const toHit = Math.max(0, ...e.attacks.map((a) => a.toHit), e.spellcasting?.attack ?? 0);
      const hit = hitChance(toHit, ac, 'normal');
      if (d <= e.speed + melee) total += threatOf(e) * hitChance(toHit, myAc, 'normal');
      else if (d <= ranged) total += threatOf(e) * 0.7 * hit;
    }
    return total;
  }

  /** Expected opportunity-attack damage walking the given path. */
  private pathRisk(me: Creature, path: Pos[], disengaged: boolean): number {
    if (disengaged) return 0;
    const c = this.combat;
    let risk = 0;
    for (const e of c.enemiesOf(me)) {
      if (!c.canReact(e)) continue;
      const reach = c.meleeReach(e);
      if (!reach) continue;
      for (let i = 1; i < path.length; i++) {
        if (distanceFt(e.pos, path[i - 1]) <= reach && distanceFt(e.pos, path[i]) > reach) {
          const toHit = Math.max(...e.attacks.filter((a) => a.kind === 'melee').map((a) => a.toHit));
          risk += threatOf(e) / e.attacksPerAction * hitChance(toHit, c.acOf(me), 'normal');
          break;
        }
      }
    }
    return risk;
  }

  // ------------------------------------------------------------ spells

  /** A concentration spell whose effect is already gone (everyone woke up, the weapon vanished) is free to replace. */
  private concentrationFree(me: Creature): boolean {
    const c = this.combat;
    if (!me.concentration) return true;
    if (me.concentration === 'spiritualWeapon') return summonsOf(c, me).length === 0;
    return !c.creatures.some((o) => o.conditions.some((k) => k.conc === me.id));
  }

  /** The best way to use each spell from `from`, as acts. */
  private spellActs(me: Creature, from: Pos, kind: 'action' | 'bonus'): Act[] {
    const c = this.combat;
    const book = me.spellcasting;
    if (!book) return [];
    const out: Act[] = [];
    for (const spell of book.spells) {
      if (spell.time !== kind) continue;
      const slot = slotOptions(me, spell)[0];
      if (slot === undefined || castBlocker(c, me, spell, slot)) continue;
      if (spell.concentration && !this.concentrationFree(me)) continue;
      const cost = spell.uses ? 3 : slot * SLOT_COST;
      const best = this.bestCast(me, spell, slot, from);
      if (best && best.value - cost > 0.5) out.push({ kind: 'cast', cmd: best.cmd, value: best.value - cost });
    }
    return out;
  }

  private bestCast(me: Creature, spell: SpellDef, slot: number, from: Pos): { cmd: CastCmd; value: number } | undefined {
    const c = this.combat;
    const cmd = (extra: Partial<CastCmd>): CastCmd => ({ type: 'cast', actor: me.id, spell: spell.id, slot, ...extra });
    const shape = spell.shape;
    const allies = [me, ...c.alliesOf(me)].filter((a) => c.isAlive(a));
    switch (spell.id) {
      case 'shield': case 'mistyStep': case 'shieldOfFaith': case 'aid': return undefined; // used by special rules, or not in a fight
      case 'bless': {
        if (c.round > 3) return undefined;
        const ts = allies.filter((a) => c.isConscious(a) && !targetError(c, me, spell, a, from)).slice(0, targetCount(spell, slot));
        if (ts.length < 2) return undefined;
        return { cmd: cmd({ targets: ts.map((t) => t.id) }), value: ts.length * 3.2 };
      }
      case 'layOnHands': {
        // the whole pool, or what the most hurt ally within reach is missing
        const pool = me.resourcesLeft.layOnHands ?? 0;
        let best: { cmd: CastCmd; value: number } | undefined;
        for (const a of allies) {
          if (targetError(c, me, spell, a, from)) continue;
          const v = this.healValue(a, Math.min(pool, a.maxHp - a.hp));
          if (v > 0 && (!best || v > best.value)) best = { cmd: cmd({ targets: [a.id] }), value: v };
        }
        return best;
      }
      case 'divineFavor':
        // worth it once a foe is close enough to hit this turn or next
        return this.targets(me).some((e) => distanceFt(from, e.pos) <= 10) ? { cmd: cmd({}), value: 3 } : undefined;
      case 'preserveLife': {
        const pool = 5 * (me.level ?? 1);
        let v = 0;
        for (const a of allies) if (distanceFt(from, a.pos) <= 30 && a.hp <= a.maxHp / 2) v += this.healValue(a, Math.min(pool / 2, Math.floor(a.maxHp / 2) - a.hp));
        return v > 0 ? { cmd: cmd({}), value: v } : undefined;
      }
      case 'sleep': {
        // the area doesn't depend on where the caster stands: value each aim point once per plan
        if (!this.sleepAims) {
          const seen = new Set<string>();
          this.sleepAims = [];
          for (const e of this.targets(me)) for (const p of [e.pos, ...c.grid.neighbours(e.pos)]) {
            const k = posKey(p);
            if (seen.has(k)) continue;
            seen.add(k);
            const v = areaVictims(c, me, spell, areaSquares(c, me, spell, p)).reduce((s, t) => s + this.sleepValue(me, t), 0);
            if (v > 0) this.sleepAims.push({ p, v });
          }
          this.sleepAims.sort((a, b) => b.v - a.v);
        }
        const aim = this.sleepAims.find((a) => !pointError(c, me, spell, a.p, from));
        return aim ? { cmd: cmd({ point: aim.p }), value: aim.v } : undefined;
      }
      default: break;
    }
    if (shape.kind === 'cone') {
      let best: { cmd: CastCmd; value: number } | undefined;
      for (const e of this.targets(me)) {
        if (distanceFt(from, e.pos) > shape.length || samePos(from, e.pos)) continue;
        let v = 0;
        for (const t of areaVictims(c, me, spell, areaSquares(c, me, spell, e.pos, from))) {
          const exp = expectedSpellDamage(c, me, spell, slot, t, from);
          v += t.side === me.side ? -exp * (t.hp === 0 ? 10 : 2.5) : this.damageValue(me, t, exp);
        }
        if (!best || v > best.value) best = { cmd: cmd({ point: e.pos }), value: v };
      }
      return best;
    }
    if (shape.kind !== 'single' && shape.kind !== 'multi') return undefined;
    // healing an ally (Divine Spark can do either)
    let best: { cmd: CastCmd; value: number } | undefined;
    if (spell.heal) {
      const amount = averageDice(spellHealing(me, spell, slot));
      for (const a of allies) {
        if (targetError(c, me, { ...spell, damage: undefined }, a, from)) continue;
        const v = this.healValue(a, amount);
        if (v > 0 && (!best || v > best.value)) best = { cmd: cmd({ targets: [a.id] }), value: v };
      }
    }
    if (!spell.damage) return best;
    const foes = this.targets(me).filter((t) => !targetError(c, me, spell, t, from));
    if (!foes.length) return best;
    const n = targetCount(spell, slot);
    if (shape.kind === 'multi') {
      // darts / rays: hand them out one at a time to wherever they add the most
      const per = new Map<Creature, number>(foes.map((t) => [t, expectedSpellDamage(c, me, spell, slot, t, from)]));
      const got = new Map<Creature, number>();
      const ids: string[] = [];
      let total = 0;
      for (let i = 0; i < n; i++) {
        let pick: Creature | undefined, gain = -Infinity;
        for (const t of foes) {
          const k = got.get(t) ?? 0, d = per.get(t)!;
          const g = this.damageValue(me, t, Math.min((k + 1) * d, t.hp + 1)) - this.damageValue(me, t, Math.min(k * d, t.hp + 1));
          if (g > gain) { gain = g; pick = t; }
        }
        got.set(pick!, (got.get(pick!) ?? 0) + 1); ids.push(pick!.id); total += gain;
      }
      return !best || total > best.value ? { cmd: cmd({ targets: ids }), value: total } : best;
    }
    for (const t of foes) {
      let v = this.damageValue(me, t, expectedSpellDamage(c, me, spell, slot, t, from));
      if (spell.id === 'spiritualWeapon') v += 9; // it keeps striking on later turns
      if (spell.id === 'guidingBolt') v += 1.5; // and sets up an ally
      if (!best || v > best.value) best = { cmd: cmd({ targets: [t.id] }), value: v };
    }
    return best;
  }

  // ------------------------------------------------------------ planning

  private canBonus(me: Creature, what: 'disengage' | 'hide' | 'dash'): boolean {
    if (me.turn.bonusActions <= 0) return false;
    if (this.combat.has(me, 'cunningAction')) return true;
    return this.combat.has(me, 'nimbleEscape') && what !== 'dash';
  }

  /** The best thing to do with the action from square `from`. */
  private bestActFrom(me: Creature, from: Pos): Act | undefined {
    const c = this.combat;
    if (me.turn.actions <= 0 && me.turn.attacksLeft <= 0) return undefined;
    let best: Act | undefined;
    for (const t of this.targets(me)) for (const a of me.attacks) {
      const v = this.attackValue(me, a, t, from);
      if (v > (best?.value ?? 0)) best = { kind: 'attack', attack: a, target: t, value: v };
    }
    if (me.turn.actions > 0) {
      for (const act of this.spellActs(me, from, 'action')) if (act.value > (best?.value ?? 0)) best = act;
      // shake a sleeping ally awake
      for (const a of c.alliesOf(me)) {
        if (!a.conditions.some((k) => k.spell === 'sleep') || distanceFt(from, a.pos) > 5) continue;
        const v = threatOf(a) * (c.cond(a, 'unconscious') ? 2 : 0.8);
        if (v > (best?.value ?? 0)) best = { kind: 'other', cmd: { type: 'wake', actor: me.id, target: a.id }, value: v };
      }
    }
    return best;
  }

  bestOption(me: Creature): Option | undefined {
    const c = this.combat;
    const pres: Option['pre'][] = ['none'];
    if (this.canBonus(me, 'disengage') && c.enemiesOf(me).some((e) => c.isConscious(e) && distanceFt(e.pos, me.pos) <= c.meleeReach(e))) pres.push('disengage');
    // lightly armoured creatures with a ranged option play it safer
    const ranged = (me.attacks.some((a) => a.kind === 'ranged') || !!me.spellcasting) && c.acOf(me) < 16;
    let best: Option | undefined;
    const hpFrac = me.hp / me.maxHp;
    const reach = c.reachable(me);
    // what a square offers doesn't depend on how we got there: work it out once
    const perDest = new Map<string, { expo: number; act?: Act }>();
    this.sleepAims = undefined;
    this.targetCache = undefined;
    this.planning = true;
    for (const pre of pres) {
      for (const [k, res] of reach) {
        const dest = res.path[res.path.length - 1];
        const risk = this.pathRisk(me, res.path, pre === 'disengage');
        let here = perDest.get(k);
        if (!here) { here = { expo: this.exposure(me, dest), act: this.bestActFrom(me, dest) }; perDest.set(k, here); }
        const { expo, act } = here;
        // archers, casters and the badly hurt care more about where they end up
        const caution = (ranged ? 0.55 : 0.3) + (1 - hpFrac) * 0.5;
        const moveCost = res.cost * 0.01;
        let score = (act?.value ?? 0) * 2 - risk * 1.5 - expo * caution - moveCost;
        if (pre === 'disengage') score -= 0.5; // costs the Bonus Action
        if (!act) {
          // nothing to do from here: close the distance (hidden enemies included — the AI hunts them down)
          const near = Math.min(...c.enemiesOf(me).filter((e) => c.isConscious(e)).map((e) => distanceFt(e.pos, dest)));
          score = -near * 0.25 - risk * 1.5 - expo * caution * 0.4 - 6;
        }
        if (!best || score > best.score) best = { pre, dest, act, score };
      }
    }
    this.planning = false;
    this.targetCache = undefined;
    return best;
  }

  private bestTargetFor(me: Creature, a: AttackProfile): Creature | undefined {
    let best: Creature | undefined, bv = 0;
    for (const t of this.targets(me)) { const v = this.attackValue(me, a, t, me.pos); if (v > bv) { bv = v; best = t; } }
    return best;
  }

  private bestAttackFromHere(me: Creature): Extract<Act, { kind: 'attack' }> | undefined {
    let best: Extract<Act, { kind: 'attack' }> | undefined;
    for (const t of this.targets(me)) for (const a of me.attacks) {
      const v = this.attackValue(me, a, t, me.pos);
      if (v > (best?.value ?? 0)) best = { kind: 'attack', attack: a, target: t, value: v };
    }
    return best;
  }

  // ------------------------------------------------------------ bonus actions & fallbacks

  private *useHealing(me: Creature): Step {
    const c = this.combat;
    if (me.turn.bonusActions <= 0) return;
    // a dying ally: Healing Word from afar, or a potion from next to them
    const dying = c.alliesOf(me).filter((a) => a.hp === 0 && c.isAlive(a));
    const word = me.spellcasting?.spells.find((s) => s.id === 'healingWord');
    if (word && dying.length) {
      const slot = slotOptions(me, word)[0];
      const t = dying.find((a) => !targetError(c, me, word, a));
      if (slot !== undefined && t && !castBlocker(c, me, word, slot) && (yield { type: 'cast', actor: me.id, spell: 'healingWord', slot, targets: [t.id] })) return;
    }
    const downed = dying.find((a) => distanceFt(a.pos, me.pos) <= 5);
    if (downed && (me.inv.potionOfHealing ?? 0) > 0) { yield { type: 'potion', actor: me.id, target: downed.id }; return; }
    if (me.hp <= me.maxHp * 0.45) {
      if (c.has(me, 'secondWind') && (me.resourcesLeft.secondWind ?? 0) > 0) yield { type: 'secondWind', actor: me.id };
      else if (!me.spellcasting && (me.inv.potionOfHealing ?? 0) > 0) yield { type: 'potion', actor: me.id, target: me.id };
    }
  }

  /** Bonus Action spells worth doing before moving: Spiritual Weapon. */
  private *bonusFirst(me: Creature): Step {
    if (me.turn.bonusActions <= 0 || !me.spellcasting) return;
    yield* this.spiritualWeapon(me);
  }

  private *spiritualWeapon(me: Creature): Step {
    const c = this.combat;
    if (me.turn.bonusActions <= 0) return;
    const s = summonsOf(c, me)[0];
    if (s) {
      let best: Creature | undefined, bv = 0;
      for (const t of this.targets(me)) {
        if (!c.isConscious(t) && t.hp === 0) continue;
        if (!summonCanReach(c, me, s, t)) continue;
        const v = this.damageValue(me, t, 5);
        if (v > bv) { bv = v; best = t; }
      }
      if (best) yield { type: 'summonAttack', actor: me.id, summon: s.id, target: best.id };
      return;
    }
    const act = this.spellActs(me, me.pos, 'bonus').filter((a) => a.kind === 'cast' && a.cmd.spell === 'spiritualWeapon')[0];
    if (act && act.kind === 'cast') yield act.cmd;
  }

  private *afterAction(me: Creature): Step {
    const c = this.combat;
    if (me.turn.bonusActions <= 0) return;
    const adjacent = c.enemiesOf(me).some((e) => c.isConscious(e) && distanceFt(e.pos, me.pos) <= c.meleeReach(e));
    // hit and run: Disengage and step back to the safest square
    if (adjacent && this.canBonus(me, 'disengage') && me.turn.movement >= 5) {
      const bestPos = this.safestSquare(me, [...c.reachable(me).values()].map((r) => r.path[r.path.length - 1]));
      if (bestPos && (yield { type: 'disengage', actor: me.id, via: 'bonus' })) yield { type: 'move', actor: me.id, to: bestPos };
    }
    if (me.turn.bonusActions > 0 && this.canBonus(me, 'hide') && !c.cond(me, 'hidden') && c.hideBlockers(me).length === 0) {
      yield { type: 'hide', actor: me.id, via: 'bonus' };
    }
    if (me.turn.bonusActions <= 0 || !me.spellcasting) return;
    yield* this.spiritualWeapon(me);
    if (me.turn.bonusActions <= 0) return;
    // patch up a badly hurt ally
    const heal = this.spellActs(me, me.pos, 'bonus').find((a) => a.kind === 'cast' && a.cmd.spell === 'healingWord');
    if (heal && heal.kind === 'cast') { if (yield heal.cmd) return; }
    // Misty Step out of a melee
    const misty = me.spellcasting.spells.find((s) => s.id === 'mistyStep');
    if (misty && adjacent && !c.cond(me, 'disengaged')) {
      const slot = slotOptions(me, misty)[0];
      if (slot !== undefined && !castBlocker(c, me, misty, slot)) {
        const squares: Pos[] = [];
        for (let y = me.pos.y - 6; y <= me.pos.y + 6; y++) for (let x = me.pos.x - 6; x <= me.pos.x + 6; x++) if (!pointError(c, me, misty, { x, y })) squares.push({ x, y });
        const to = this.safestSquare(me, squares);
        if (to && this.exposure(me, me.pos) - this.exposure(me, to) > 4) yield { type: 'cast', actor: me.id, spell: 'mistyStep', slot, point: to };
      }
    }
  }

  /** The square with clearly less exposure than here (at most 3/4 of it), if any. */
  private safestSquare(me: Creature, squares: Pos[]): Pos | undefined {
    let bestPos: Pos | undefined, bestE = this.exposure(me, me.pos) * 0.75;
    for (const p of squares) {
      const e = this.exposure(me, p);
      if (e < bestE) { bestE = e; bestPos = p; }
    }
    return bestPos;
  }

  private *noAttackFallback(me: Creature): Step {
    const c = this.combat;
    const visible = this.targets(me).filter((t) => c.isConscious(t));
    const anyEnemy = c.enemiesOf(me).some((e) => c.isConscious(e));
    // nothing in sight but someone is hiding nearby: look for them (after advancing this turn)
    if (!visible.length && anyEnemy && c.enemiesOf(me).some((e) => c.cond(e, 'hidden') && distanceFt(e.pos, me.pos) <= 30)) { yield { type: 'search', actor: me.id }; return; }
    // Dash toward the best spot for next turn
    if (anyEnemy && me.turn.actions > 0) {
      yield { type: 'dash', actor: me.id, via: 'action' };
      const goal = this.bestOption(me);
      if (goal && posKey(goal.dest) !== posKey(me.pos)) yield { type: 'move', actor: me.id, to: goal.dest };
    }
  }
}
