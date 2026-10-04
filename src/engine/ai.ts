// Tactical AI: a one-turn utility planner. For every square the creature can
// reach it scores "attack from here" options (expected damage, focus fire,
// opportunity-attack risk, exposure next round) and then uses its Bonus Action
// smartly (Nimble Escape / Cunning Action, Second Wind, potions).
import { Combat, RuleError, type Command, type GameEvent } from './combat';
import { distanceFt, posKey, computeCover, COVER_AC, type Pos } from './grid';
import { averageDice, hitChance } from './dice';
import type { AttackProfile, Creature } from './types';

interface Option {
  pre: 'none' | 'disengage';
  dest: Pos;
  target?: Creature;
  attack?: AttackProfile;
  score: number;
}

/** Rough damage-per-round a creature threatens, used to judge danger. */
function threatOf(c: Creature): number {
  const best = Math.max(0, ...c.attacks.map((a) => averageDice(a.damage)));
  return best * c.attacksPerAction + (c.sneakAttackDice ?? 0) * 3.5;
}

export class TacticalAI {
  constructor(private combat: Combat) {}

  /** Play the active creature's whole turn. Returns every event produced. */
  takeTurn(id: string): GameEvent[] {
    const c = this.combat;
    const me = c.get(id);
    const events: GameEvent[] = [];
    const run = (cmd: Command) => {
      try { events.push(...c.execute(cmd)); return true; } catch (e) { if (e instanceof RuleError) return false; throw e; }
    };
    const alive = () => !c.over && c.isConscious(me) && c.active?.id === me.id;

    if (alive()) this.useHealing(me, run);
    const plan = alive() ? this.bestOption(me) : undefined;
    if (plan && alive()) {
      if (plan.pre === 'disengage') run({ type: 'disengage', actor: id, via: 'bonus' });
      if (alive() && posKey(plan.dest) !== posKey(me.pos)) run({ type: 'move', actor: id, to: plan.dest });
      if (alive() && plan.attack && plan.target) {
        // Multiattack: re-pick a target for every attack (the first may have dropped)
        for (let i = 0; i < me.attacksPerAction && alive(); i++) {
          const pick = i === 0 && c.isAlive(plan.target) ? { target: plan.target, attack: plan.attack } : this.bestAttackFromHere(me);
          if (!pick) break;
          if (!run({ type: 'attack', actor: id, attack: pick.attack.id, target: pick.target.id })) break;
        }
        // Light weapon follow-up (two-weapon fighting)
        if (alive() && me.turn.bonusActions > 0) {
          for (const a of me.attacks) {
            const st = c.offhandStatus(me, a);
            const t = st && this.bestTargetFor(me, a);
            if (st && t && run({ type: 'offhand', actor: id, attack: a.id, target: t.id })) break;
          }
        }
      } else if (alive() && me.turn.actions > 0) {
        // moved closer without a shot: maybe something is visible now
        const pick = this.bestAttackFromHere(me);
        if (pick) run({ type: 'attack', actor: id, attack: pick.attack.id, target: pick.target.id });
        else this.noAttackFallback(me, run);
      }
    } else if (alive()) this.noAttackFallback(me, run);

    if (alive()) this.afterAction(me, run);
    if (alive() && me.turn.actions > 0 && !this.bestAttackFromHere(me)) {
      // nothing to hit: dodge if threatened
      if (c.enemiesOf(me).some((e) => c.isConscious(e) && distanceFt(e.pos, me.pos) <= 5)) run({ type: 'dodge', actor: id });
    }
    if (!c.over && c.active?.id === me.id) events.push(...c.execute({ type: 'endTurn', actor: id }));
    return events;
  }

  // ------------------------------------------------------------ planning

  private targets(me: Creature): Creature[] {
    return this.combat.enemiesOf(me).filter((t) => this.combat.isAlive(t) && this.combat.canSee(me, t));
  }

  /** Expected-damage score of attacking `t` with `a`, weighted for focus fire. */
  private attackValue(me: Creature, a: AttackProfile, t: Creature, from: Pos): number {
    const c = this.combat;
    if (a.consumes && (me.inv[a.consumes] ?? 0) <= 0) return 0;
    const p = c.previewAttack(me, a.id, t, { from });
    if (!p.inRange || p.cover === 'total') return 0;
    let v = p.expected;
    if (!c.isConscious(t)) v *= me.side === 'enemy' ? 0.15 : 0; // goblins prefer live threats; heroes never hit the downed
    else {
      if (p.expected * me.attacksPerAction >= t.hp) v *= 1.6; // can finish it
      v *= 1 + threatOf(t) / 30; // dangerous targets first
      v *= 1 + (1 - t.hp / t.maxHp) * 0.4; // wounded targets
    }
    return v * me.attacksPerAction;
  }

  /** How much damage `me` should expect to take from enemies next round standing at `p`. */
  private exposure(me: Creature, p: Pos): number {
    const c = this.combat;
    let total = 0;
    for (const e of c.enemiesOf(me)) {
      if (!c.isConscious(e)) continue;
      const d = distanceFt(e.pos, p);
      const melee = c.meleeReach(e);
      const ranged = Math.max(0, ...e.attacks.filter((a) => a.kind === 'ranged' && (!a.consumes || (e.inv[a.consumes] ?? 0) > 0)).map((a) => a.range![0]));
      const cover = computeCover(c.grid, e.pos, p);
      const ac = me.ac + (Number.isFinite(COVER_AC[cover]) ? COVER_AC[cover] : 99);
      const toHit = Math.max(0, ...e.attacks.map((a) => a.toHit));
      const hit = hitChance(toHit, ac, 'normal');
      if (d <= e.speed + melee) total += threatOf(e) * hitChance(toHit, me.ac, 'normal');
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
      if (!c.isConscious(e) || !e.turn.reaction) continue;
      const reach = c.meleeReach(e);
      if (!reach) continue;
      for (let i = 1; i < path.length; i++) {
        if (distanceFt(e.pos, path[i - 1]) <= reach && distanceFt(e.pos, path[i]) > reach) {
          const toHit = Math.max(...e.attacks.filter((a) => a.kind === 'melee').map((a) => a.toHit));
          risk += threatOf(e) / e.attacksPerAction * hitChance(toHit, me.ac, 'normal');
          break;
        }
      }
    }
    return risk;
  }

  private canBonus(me: Creature, what: 'disengage' | 'hide' | 'dash'): boolean {
    if (me.turn.bonusActions <= 0) return false;
    if (this.combat.has(me, 'cunningAction')) return true;
    return this.combat.has(me, 'nimbleEscape') && what !== 'dash';
  }

  bestOption(me: Creature): Option | undefined {
    const c = this.combat;
    const pres: Option['pre'][] = ['none'];
    if (this.canBonus(me, 'disengage') && c.enemiesOf(me).some((e) => c.isConscious(e) && distanceFt(e.pos, me.pos) <= c.meleeReach(e))) pres.push('disengage');
    // lightly armoured creatures with a ranged option play it safer
    const ranged = me.attacks.some((a) => a.kind === 'ranged') && me.ac < 16;
    let best: Option | undefined;
    const hpFrac = me.hp / me.maxHp;
    for (const pre of pres) {
      const reach = c.reachable(me);
      for (const [, res] of reach) {
        const dest = res.path[res.path.length - 1];
        const risk = this.pathRisk(me, res.path, pre === 'disengage');
        const expo = this.exposure(me, dest);
        let bestAtk = 0; let pick: { a: AttackProfile; t: Creature } | undefined;
        if (me.turn.actions > 0) {
          for (const t of this.targets(me)) for (const a of me.attacks) {
            const v = this.attackValue(me, a, t, dest);
            if (v > bestAtk) { bestAtk = v; pick = { a, t }; }
          }
        }
        // archers and the badly hurt care more about where they end up
        const caution = (ranged ? 0.55 : 0.3) + (1 - hpFrac) * 0.5;
        const moveCost = res.cost * 0.01;
        let score = bestAtk * 2 - risk * 1.5 - expo * caution - moveCost;
        if (pre === 'disengage') score -= 0.5; // costs the Bonus Action
        if (!pick) {
          // no attack from here: value closing in on the nearest enemy
          const near = Math.min(...c.enemiesOf(me).filter((e) => c.isConscious(e)).map((e) => distanceFt(e.pos, dest)));
          // nothing to shoot: close the distance (hidden enemies included — the AI hunts them down)
          score = -near * 0.25 - risk * 1.5 - expo * caution * 0.4 - 6;
        }
        if (!best || score > best.score) best = { pre, dest, target: pick?.t, attack: pick?.a, score };
      }
    }
    return best;
  }

  private bestTargetFor(me: Creature, a: AttackProfile): Creature | undefined {
    let best: Creature | undefined, bv = 0;
    for (const t of this.targets(me)) { const v = this.attackValue(me, a, t, me.pos); if (v > bv) { bv = v; best = t; } }
    return best;
  }

  private bestAttackFromHere(me: Creature): { target: Creature; attack: AttackProfile } | undefined {
    let best: { target: Creature; attack: AttackProfile } | undefined, bv = 0;
    for (const t of this.targets(me)) for (const a of me.attacks) {
      const v = this.attackValue(me, a, t, me.pos);
      if (v > bv) { bv = v; best = { target: t, attack: a }; }
    }
    return best;
  }

  // ------------------------------------------------------------ bonus actions & fallbacks

  private useHealing(me: Creature, run: (c: Command) => boolean) {
    const c = this.combat;
    // pick up a dying ally first
    const downed = c.alliesOf(me).find((a) => a.hp === 0 && c.isAlive(a) && distanceFt(a.pos, me.pos) <= 5);
    if (downed && (me.inv.potionOfHealing ?? 0) > 0 && me.turn.bonusActions > 0) { run({ type: 'potion', actor: me.id, target: downed.id }); return; }
    if (me.hp <= me.maxHp * 0.45 && me.turn.bonusActions > 0) {
      if (c.has(me, 'secondWind') && (me.resourcesLeft.secondWind ?? 0) > 0) run({ type: 'secondWind', actor: me.id });
      else if ((me.inv.potionOfHealing ?? 0) > 0) run({ type: 'potion', actor: me.id, target: me.id });
    }
  }

  private afterAction(me: Creature, run: (c: Command) => boolean) {
    const c = this.combat;
    if (me.turn.bonusActions <= 0) return;
    const adjacent = c.enemiesOf(me).some((e) => c.isConscious(e) && distanceFt(e.pos, me.pos) <= c.meleeReach(e));
    // hit and run: Disengage and step back to the safest square
    if (adjacent && this.canBonus(me, 'disengage') && me.turn.movement >= 5) {
      const here = this.exposure(me, me.pos);
      let bestPos: Pos | undefined, bestE = here * 0.75;
      for (const [, res] of c.reachable(me)) {
        const p = res.path[res.path.length - 1];
        const e = this.exposure(me, p);
        if (e < bestE) { bestE = e; bestPos = p; }
      }
      if (bestPos && run({ type: 'disengage', actor: me.id, via: 'bonus' })) { run({ type: 'move', actor: me.id, to: bestPos }); }
    }
    if (me.turn.bonusActions > 0 && this.canBonus(me, 'hide') && !c.cond(me, 'hidden') && c.hideBlockers(me).length === 0) {
      run({ type: 'hide', actor: me.id, via: 'bonus' });
    }
  }

  private noAttackFallback(me: Creature, run: (c: Command) => boolean) {
    const c = this.combat;
    const visible = this.targets(me).filter((t) => c.isConscious(t));
    const anyEnemy = c.enemiesOf(me).some((e) => c.isConscious(e));
    // nothing in sight but someone is hiding nearby: look for them (after advancing this turn)
    if (!visible.length && anyEnemy && c.enemiesOf(me).some((e) => c.cond(e, 'hidden') && distanceFt(e.pos, me.pos) <= 30)) { run({ type: 'search', actor: me.id }); return; }
    // Dash toward the best spot for next turn
    if (anyEnemy && me.turn.actions > 0) {
      run({ type: 'dash', actor: me.id, via: 'action' });
      const goal = this.bestOption(me);
      if (goal && posKey(goal.dest) !== posKey(me.pos)) run({ type: 'move', actor: me.id, to: goal.dest });
    }
  }
}
