// Combat view: one fight on the shared stage. Player input → engine commands, engine
// events → animation, and the AI's turns. The engine is authoritative; the view model
// (vm) mirrors it event-by-event so the HUD and figures change exactly when animations do.
// The Game (game.ts) owns the stage, the input and exploration, and runs one of these per fight.
import * as THREE from 'three';
import { Combat, NeedsDecision, RuleError, type Answer, type AttackPreview, type Command, type GameEvent, type ReactionPrompt } from '../engine/combat';
import { TacticalAI } from '../engine/ai';
import { formatDice } from '../engine/dice';
import { distanceFt, samePos, type Pos } from '../engine/grid';
import type { AttackProfile, Creature, SpellDef } from '../engine/types';
import {
  areaSquares, areaVictims, castBlocker, failChance, pointError, slotOptions, spellAttackProfile, spellDamage, spellHealing, spellOf,
  spellStats, summonCanReach, summonsOf, targetCount, targetError, weaponSpot,
} from '../engine/spells';
import { PixelRenderer } from '../render/pixel-renderer';
import { Overlays } from '../render/overlays';
import { DAMAGE_COLOR, Effects, SPELL_COLOR } from '../render/effects';
import { Hud, esc, hpBar, type HotbarState, type Slot } from '../ui/hud';

type Mode =
  | { kind: 'default' }
  | { kind: 'attack'; attack: string; offhand: boolean }
  | { kind: 'shove'; effect: 'push' | 'prone' }
  | { kind: 'potion' }
  | { kind: 'help' }
  /** Aiming a spell. Multi-target spells collect `targets` click by click. */
  | { kind: 'spell'; spell: string; slot: number; targets: string[] }
  | { kind: 'summon'; summon: string };

interface Approach { dest: Pos; path: Pos[]; cost: number; provokers: Creature[] }
type Plan =
  | { kind: 'move'; approach: Approach }
  | { kind: 'attack'; target: Creature; attack: AttackProfile; offhand: boolean; approach: Approach; preview: AttackPreview }
  | { kind: 'shove'; target: Creature; effect: 'push' | 'prone'; approach: Approach; dc: number }
  | { kind: 'potion'; target: Creature; approach: Approach }
  | { kind: 'help'; target: Creature; approach: Approach }
  /** `complete` false: the click only adds a target to a multi-target spell. */
  | { kind: 'cast'; spell: SpellDef; slot: number; targets: Creature[]; point?: Pos; area?: Pos[]; approach: Approach; complete: boolean; at: Pos }
  | { kind: 'summonAttack'; summon: string; target: Creature }
  | { kind: 'info'; html: string; at: Pos }
  | { kind: 'invalid'; reason: string; at: Pos };

/** What the screen shows for a creature, updated as animations play. */
export interface VM { name: string; side: 'party' | 'enemy'; hp: number; maxHp: number; pos: Pos; conds: Set<string>; dead: boolean }

/** Everything a fight draws on, owned by the Game and shared between fights. */
export interface Stage {
  r: PixelRenderer;
  hud: Hud;
  ov: Overlays;
  fx: Effects;
  vm: Map<string, VM>;
  portraits: Record<string, string>;
  mouse: { x: number; y: number; dirty: boolean };
}

export const CONDITION_ICON: Record<string, string> = {
  hidden: '👁', prone: '⤵', dodging: '🛡', sapped: '⇩', slowed: '🐌', disengaged: '↯', stable: '✚', vexing: '',
  incapacitated: 'z', blessed: '✦', shieldOfFaith: '⛨', shielded: '◈', guided: '✧', chilled: '❄', steadyAim: '◎', aided: '♥',
};
const CONDITION_NAME: Record<string, string> = {
  hidden: 'Hidden', prone: 'Prone', dodging: 'Dodging', sapped: 'Sapped', slowed: 'Slowed', disengaged: 'Disengaged', stable: 'Stable', unconscious: 'Unconscious', vexing: 'Vexing',
  incapacitated: 'Drowsy', blessed: 'Blessed', shieldOfFaith: 'Shield of Faith', shielded: 'Shield', guided: 'Marked', chilled: 'Chilled', steadyAim: 'Steady Aim', aided: 'Aid',
  favored: 'Divine Favor', heroism: 'Heroism', warded: 'Warded', sacredWeapon: 'Sacred Weapon', noHealing: 'Can\'t heal',
};
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th'];

export class CombatView {
  readonly combat: Combat;
  readonly r: PixelRenderer;
  readonly hud: Hud;
  private ai: TacticalAI;
  private ov: Overlays;
  private fx: Effects;
  private vm: Map<string, VM>;
  private mode: Mode = { kind: 'default' };
  private busy = true;
  private mouse: Stage['mouse'];
  private plan: Plan | null = null;
  private activeId = '';
  private round = 1;

  /** `onEnd` runs once the fight is decided (after the last animation). */
  constructor(stage: Stage, combat: Combat, private onEnd: (winner: 'party' | 'enemy') => void) {
    this.combat = combat;
    this.r = stage.r; this.hud = stage.hud; this.ov = stage.ov; this.fx = stage.fx;
    this.vm = stage.vm; this.mouse = stage.mouse;
    this.ai = new TacticalAI(combat);
    // creatures joining the fight start with clean slates on screen
    for (const c of combat.creatures) {
      const v = this.vm.get(c.id);
      if (v) { v.hp = c.hp; v.maxHp = c.maxHp; v.pos = { ...c.pos }; v.conds = new Set(c.conditions.map((k) => k.id)); }
    }
  }

  /** Input from the Game while this fight is on. */
  handleClick() {
    if (this.busy || !this.isPlayerTurn()) return;
    this.updateHover();
    const p = this.plan;
    if (!p) return;
    if (p.kind === 'cast' && !p.complete && this.mode.kind === 'spell') {
      // multi-target spell: this click only picks a target
      this.mode = { ...this.mode, targets: p.targets.map((t) => t.id) };
      this.refreshHotbar(); this.mouse.dirty = true;
      return;
    }
    if (p.kind === 'move' || p.kind === 'attack' || p.kind === 'shove' || p.kind === 'potion' || p.kind === 'help' || p.kind === 'cast' || p.kind === 'summonAttack') this.execPlan(p);
  }

  handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.cancelMode();
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      // with darts / rays / blessings picked, Space casts; otherwise it ends the turn
      if (this.mode.kind === 'spell' && this.mode.targets.length) this.onSlot('castNow'); else this.endTurn();
    }
    const n = e.code.startsWith('Digit') ? (Number(e.code.slice(5)) + 9) % 10 : -1;
    if (n >= 0) {
      const slots = e.shiftKey ? this.spellSlots() : this.slots();
      if (slots[n] && slots[n].enabled) this.onSlot(slots[n].key);
    }
  }

  handleCancel() { this.cancelMode(); }
  handleLeave() { this.ov.clearPlanning(); this.hud.tooltip(null); this.hud.cursorTag(null); }
  handleSlot(k: string) { this.onSlot(k); }
  handleEndTurn() { this.endTurn(); }
  handlePartyClick(id: string) { const v = this.vm.get(id)!; this.r.lookAt(v.pos.x, v.pos.y); }

  /** Called every frame by the Game. */
  update() { if (this.mouse.dirty && this.mouse.x >= 0) this.updateHover(); }

  // ------------------------------------------------------------ flow

  async begin() {
    const events = this.combat.start();
    await this.play(events);
    await this.continueFlow();
  }

  private isPlayerTurn(): boolean {
    const a = this.combat.active;
    return !!a && a.controller === 'player' && !this.combat.over;
  }

  private async continueFlow() {
    for (;;) {
      if (this.combat.over) { this.busy = true; this.refreshHud(); this.finish(this.combat.over); return; }
      const a = this.combat.active!;
      if (a.controller === 'ai') {
        this.busy = true;
        this.refreshHud();
        await this.r.wait(0.35);
        // the AI turn runs one command at a time, animating as it goes (and pausing for reaction prompts)
        const turn = this.ai.turn(a.id);
        let step = turn.next();
        while (!step.done) step = turn.next(!((await this.run(step.value)) instanceof RuleError));
        continue;
      }
      this.busy = false;
      this.mode = { kind: 'default' };
      this.refreshHud();
      this.mouse.dirty = true;
      return;
    }
  }

  private async act(cmd: Command): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.ov.clearPlanning(); this.ov.setReach([]); this.hud.tooltip(null); this.hud.cursorTag(null);
    const res = await this.run(cmd);
    if (res instanceof RuleError) {
      const a = this.combat.active!;
      const p = this.r.projectHead(a.id);
      this.hud.float(p.x, p.y, res.message, 'miss');
      this.busy = false; this.refreshHud(); return false;
    }
    this.busy = false;
    if (cmd.type === 'endTurn' || this.combat.over || !this.isPlayerTurn() || this.combat.active!.id !== cmd.actor) await this.continueFlow();
    else { this.refreshHud(); this.mouse.dirty = true; }
    return true;
  }

  /**
   * Execute a command and animate its events. If a player has to decide a reaction
   * mid-way, the engine stops (NeedsDecision): rewind, show what happened so far,
   * ask, and replay the command with the answers. The seeded RNG makes the replay
   * identical up to the question, so the events already shown are skipped.
   */
  private async run(cmd: Command): Promise<GameEvent[] | RuleError> {
    const c = this.combat;
    const answers: Answer[] = [];
    let shown = 0;
    try {
      for (;;) {
        const snap = c.snapshot();
        let asked = 0;
        c.decide = (p) => {
          if (c.get(p.reactor).controller !== 'player') return c.defaultReaction(p);
          return asked < answers.length ? answers[asked++] : undefined;
        };
        try {
          const events = c.execute(cmd);
          await this.play(events.slice(shown));
          return events;
        } catch (e) {
          if (e instanceof RuleError) return e;
          if (!(e instanceof NeedsDecision)) throw e;
          c.restore(snap);
          await this.play(e.events.slice(shown));
          shown = e.events.length;
          answers.push(await this.askReaction(e.prompt));
        }
      }
    } finally {
      c.decide = (p) => c.defaultReaction(p);
    }
  }

  private async askReaction(p: ReactionPrompt): Promise<Answer> {
    const c = this.combat;
    const reactor = c.get(p.reactor);
    const v = this.vm.get(reactor.id)!;
    this.r.ensureVisible(v.pos.x, v.pos.y);
    if (p.kind === 'smite') {
      const t = c.get(p.target);
      const holy = t.type === 'fiend' || t.type === 'undead';
      const opts = p.options.map((l) => ({ label: l === 0 ? 'Smite (free)' : `Smite (${ORDINAL[l]} slot, ${reactor.slotsLeft[l]} left)`, l }));
      const i = await this.hud.ask(`<h3>Divine Smite · ${esc(reactor.name)}</h3><p>${esc(reactor.name)} ${p.crit ? '<b>critically</b> hits' : 'hits'} ${esc(t.name)}. Smite for <b>2d8 Radiant</b>${holy ? ' <b>+1d8</b> (it\'s ' + esc(t.type!) + ')' : ''}, +1d8 per slot level above 1st${p.crit ? ', dice doubled' : ''}?</p>
        <p class="tip-note">Uses your Bonus Action.</p>`,
        [...opts.map((o, k) => ({ label: k === 0 ? `${o.label} (Y)` : o.label })), { label: 'No (N)', secondary: true }]);
      return i < opts.length ? opts[i].l : false;
    }
    if (p.kind === 'stonesEndurance') {
      const i = await this.hud.ask(`<h3>Reaction · ${esc(reactor.name)}</h3><p>${esc(reactor.name)} is about to take ${p.amount} damage. Use <b>Stone's Endurance</b> to reduce it by 1d12 + CON?</p>
        <p class="tip-note">${reactor.resourcesLeft.giantAncestry ?? 0} Giant Ancestry uses left.</p>`,
        [{ label: 'Brace (Y)' }, { label: 'Take it (N)', secondary: true }]);
      return i === 0;
    }
    if (p.kind === 'stormsThunder') {
      const atk = c.get(p.attacker);
      const i = await this.hud.ask(`<h3>Reaction · ${esc(reactor.name)}</h3><p>${esc(atk.name)} hurt ${esc(reactor.name)}. Use <b>Storm's Thunder</b> to deal 1d8 Thunder damage back?</p>
        <p class="tip-note">${reactor.resourcesLeft.giantAncestry ?? 0} Giant Ancestry uses left.</p>`,
        [{ label: 'Thunder (Y)' }, { label: 'Hold (N)', secondary: true }]);
      return i === 0;
    }
    if (p.kind === 'opportunity') {
      const t = c.get(p.target);
      const atk = c.bestMeleeAttack(reactor, t);
      const chance = atk ? Math.round(c.previewAttack(reactor, atk, t).chance * 100) : 0;
      const i = await this.hud.ask(`<h3>Reaction · ${esc(reactor.name)}</h3><p>${esc(t.name)} is leaving ${esc(reactor.name)}'s reach. Make an Opportunity Attack${atk ? ` with ${esc(atk.name)} (${chance}% to hit)` : ''}?</p>`,
        [{ label: 'Attack (Y)' }, { label: 'Let it go (N)', secondary: true }]);
      return i === 0;
    }
    const atk = c.get(p.attacker);
    const left = reactor.slotsLeft.map((n, l) => (l > 0 && n > 0 ? `${ORDINAL[l]}: ${n}` : '')).filter(Boolean).join(', ');
    const i = await this.hud.ask(`<h3>Reaction · ${esc(reactor.name)}</h3><p>${esc(atk.name)} hits ${esc(reactor.name)} — ${p.total} against AC ${p.ac}.
      Cast <b>Shield</b> for +5 AC until ${esc(reactor.name)}'s next turn? ${p.wouldMiss ? 'The attack would <b>miss</b>.' : 'It would <b>still hit</b>, but Shield lasts for later attacks.'}</p>
      <p class="tip-note">Uses a spell slot (${esc(left)}).</p>`,
      [{ label: 'Cast Shield (Y)' }, { label: 'Take the hit (N)', secondary: true }]);
    return i === 0;
  }

  private async execPlan(plan: Plan) {
    const a = this.combat.active!;
    const ap = 'approach' in plan ? plan.approach : undefined;
    if (ap && !samePos(ap.dest, a.pos)) {
      const ok = await this.act({ type: 'move', actor: a.id, to: ap.dest });
      if (!ok || !this.isPlayerTurn() || this.combat.active!.id !== a.id || !this.combat.isConscious(a)) return;
      if (!samePos(a.pos, ap.dest)) return; // interrupted
    }
    switch (plan.kind) {
      case 'attack':
        if (!this.combat.isAlive(plan.target)) return;
        await this.act({ type: plan.offhand ? 'offhand' : 'attack', actor: a.id, attack: plan.attack.id, target: plan.target.id });
        if (this.isPlayerTurn()) this.mode = { kind: 'default' };
        break;
      case 'shove': await this.act({ type: 'shove', actor: a.id, target: plan.target.id, effect: plan.effect }); this.mode = { kind: 'default' }; break;
      case 'potion': await this.act({ type: 'potion', actor: a.id, target: plan.target.id }); this.mode = { kind: 'default' }; break;
      case 'help': await this.act({ type: 'stabilize', actor: a.id, target: plan.target.id }); this.mode = { kind: 'default' }; break;
      case 'cast':
        this.mode = { kind: 'default' };
        await this.act({ type: 'cast', actor: a.id, spell: plan.spell.id, slot: plan.slot, targets: plan.targets.map((t) => t.id), point: plan.point });
        break;
      case 'summonAttack':
        this.mode = { kind: 'default' };
        await this.act({ type: 'summonAttack', actor: a.id, summon: plan.summon, target: plan.target.id });
        break;
      default: break;
    }
    this.refreshHud(); this.mouse.dirty = true;
  }

  private endTurn() { if (this.isPlayerTurn() && !this.busy) this.act({ type: 'endTurn', actor: this.combat.active!.id }); }

  // ------------------------------------------------------------ planning (hover)

  private approachFor(a: Creature, valid: (from: Pos) => boolean): Approach | undefined {
    if (valid(a.pos)) return { dest: a.pos, path: [a.pos], cost: 0, provokers: [] };
    let best: Approach | undefined, bestScore = Infinity;
    for (const [, res] of this.combat.reachable(a)) {
      const dest = res.path[res.path.length - 1];
      if (!valid(dest)) continue;
      const provokers = this.combat.provokersAlong(a, res.path);
      const score = provokers.length * 1000 + res.cost;
      if (score < bestScore) { bestScore = score; best = { dest, path: res.path, cost: res.cost, provokers }; }
    }
    return best;
  }

  private canAttackNow(a: Creature, offhand: boolean, atk: AttackProfile): string | null {
    if (atk.consumes && (a.inv[atk.consumes] ?? 0) <= 0) return `No ${atk.consumes}s left`;
    if (offhand) return this.combat.offhandStatus(a, atk) ? null : 'Off-hand attack not available';
    if (a.turn.attacksLeft <= 0 && a.turn.actions <= 0) return 'No action left';
    return null;
  }

  private planAttack(a: Creature, t: Creature, atk: AttackProfile, offhand: boolean): Plan {
    const why = this.canAttackNow(a, offhand, atk);
    if (why) return { kind: 'invalid', reason: why, at: t.pos };
    const ap = this.approachFor(a, (from) => { const p = this.combat.previewAttack(a, atk.id, t, { from, offhand }); return p.inRange && p.cover !== 'total'; });
    if (!ap) return { kind: 'invalid', reason: `Can't reach ${t.name} with ${atk.name} this turn`, at: t.pos };
    return { kind: 'attack', target: t, attack: atk, offhand, approach: ap, preview: this.combat.previewAttack(a, atk.id, t, { from: ap.dest, offhand }) };
  }

  private computePlan(tile: Pos | undefined, creatureId: string | undefined): Plan | null {
    const a = this.combat.active!;
    let target = creatureId ? this.combat.get(creatureId) : tile ? this.combat.creatureAt(tile) : undefined;
    if (target && target.side !== a.side && this.combat.cond(target, 'hidden')) target = undefined; // you can't see it
    if (target && !this.combat.isAlive(target)) target = undefined;
    const at = target?.pos ?? tile;
    if (!at) return null;
    const m = this.mode;
    if (m.kind === 'spell') return this.planSpell(a, m, target, at);
    if (m.kind === 'summon') {
      const s = this.combat.summons.find((x) => x.id === m.summon);
      if (!s || !target || target.side === a.side) return { kind: 'invalid', reason: 'Pick an enemy for the weapon', at };
      if (a.turn.bonusActions <= 0) return { kind: 'invalid', reason: 'Bonus Action already used', at };
      if (!summonCanReach(this.combat, a, s, target)) return { kind: 'invalid', reason: 'The weapon can only fly 20 ft', at };
      return { kind: 'summonAttack', summon: s.id, target };
    }

    if (target && target.side !== a.side) {
      if (m.kind === 'attack') return this.planAttack(a, target, this.combat.attackOf(a, m.attack), m.offhand);
      if (m.kind === 'shove') {
        if (a.turn.attacksLeft <= 0 && a.turn.actions <= 0) return { kind: 'invalid', reason: 'No action left', at };
        const ap = this.approachFor(a, (from) => distanceFt(from, target!.pos) <= 5);
        if (!ap) return { kind: 'invalid', reason: 'Too far away to shove', at };
        return { kind: 'shove', target, effect: m.effect, approach: ap, dc: 8 + this.combat.modOf(a, 'str') + a.pb };
      }
      if (m.kind !== 'default') return { kind: 'invalid', reason: 'Not a valid target', at };
      // default: the best available attack (approaching if needed)
      let best: Plan | null = null, bestScore = -Infinity;
      for (const atk of a.attacks) {
        const p = this.planAttack(a, target, atk, false);
        if (p.kind !== 'attack') continue;
        const score = p.preview.expected - p.approach.provokers.length * 3 - p.approach.cost / 200;
        if (score > bestScore) { bestScore = score; best = p; }
      }
      return best ?? { kind: 'info', html: this.creatureInfo(target), at };
    }
    if (target && target.side === a.side) {
      // a fallen friend: Healing Word from afar if we have it
      if (m.kind === 'default' && target.hp === 0 && a.spellcasting?.spells.some((x) => x.id === 'healingWord')) {
        const hw = spellOf(a, 'healingWord');
        const slot = slotOptions(a, hw)[0];
        if (slot !== undefined && !castBlocker(this.combat, a, hw, slot)) return this.planSpell(a, { kind: 'spell', spell: 'healingWord', slot, targets: [] }, target, at);
      }
      if (m.kind === 'potion' || (m.kind === 'default' && target.hp === 0 && (a.inv.potionOfHealing ?? 0) > 0 && a.turn.bonusActions > 0)) {
        if ((a.inv.potionOfHealing ?? 0) <= 0) return { kind: 'invalid', reason: 'No potions left', at };
        if (a.turn.bonusActions <= 0) return { kind: 'invalid', reason: 'Bonus Action already used', at };
        const ap = this.approachFor(a, (from) => distanceFt(from, target!.pos) <= 5);
        if (!ap) return { kind: 'invalid', reason: 'Too far away', at };
        return { kind: 'potion', target, approach: ap };
      }
      if (m.kind === 'help') {
        if (target.hp > 0 || this.combat.cond(target, 'stable')) return { kind: 'invalid', reason: `${target.name} doesn't need first aid`, at };
        if (a.turn.actions <= 0) return { kind: 'invalid', reason: 'No action left', at };
        const ap = this.approachFor(a, (from) => distanceFt(from, target!.pos) <= 5);
        if (!ap) return { kind: 'invalid', reason: 'Too far away', at };
        return { kind: 'help', target, approach: ap };
      }
      return { kind: 'info', html: this.creatureInfo(target), at };
    }
    if (m.kind !== 'default') return { kind: 'invalid', reason: 'Pick a target', at };
    if (samePos(at, a.pos)) return null;
    const res = this.combat.reachable(a).get(`${at.x},${at.y}`);
    const cell = this.combat.grid.cell(at.x, at.y);
    if (!res) return { kind: 'invalid', reason: cell?.blocksMove ? 'Blocked' : a.turn.movement <= 0 ? 'No movement left' : 'Too far', at };
    return { kind: 'move', approach: { dest: at, path: res.path, cost: res.cost, provokers: this.combat.provokersAlong(a, res.path) } };
  }

  private planSpell(a: Creature, m: Extract<Mode, { kind: 'spell' }>, target: Creature | undefined, at: Pos): Plan {
    const c = this.combat;
    const sp = spellOf(a, m.spell);
    const why = castBlocker(c, a, sp, m.slot);
    if (why) return { kind: 'invalid', reason: why, at };
    const shape = sp.shape;
    const none: Approach = { dest: a.pos, path: [a.pos], cost: 0, provokers: [] };
    if (shape.kind === 'single') {
      if (!target) return { kind: 'invalid', reason: sp.affects === 'ally' ? 'Pick an ally' : 'Pick a target', at };
      const err = targetError(c, a, sp, target);
      if (err && (err.startsWith('Pick') || err.includes('dead') || err.includes('unhurt') || err.includes('already') || err.includes('Already'))) return { kind: 'invalid', reason: err, at };
      const ap = this.approachFor(a, (from) => !targetError(c, a, sp, target, from));
      if (!ap) return { kind: 'invalid', reason: err ?? `Can't reach ${target.name} this turn`, at };
      return { kind: 'cast', spell: sp, slot: m.slot, targets: [target], approach: ap, complete: true, at };
    }
    if (shape.kind === 'multi') {
      if (!target) return { kind: 'invalid', reason: 'Pick a target', at };
      const err = targetError(c, a, sp, target);
      if (err) return { kind: 'invalid', reason: err, at };
      if (!shape.repeat && m.targets.includes(target.id)) return { kind: 'invalid', reason: `${target.name} is already chosen`, at };
      const targets = [...m.targets, target.id].map((id) => c.get(id));
      return { kind: 'cast', spell: sp, slot: m.slot, targets, approach: none, complete: targets.length >= targetCount(sp, m.slot), at };
    }
    if (shape.kind === 'sphere' || shape.kind === 'cone' || shape.kind === 'line' || shape.kind === 'point') {
      const err = pointError(c, a, sp, at);
      if (err) return { kind: 'invalid', reason: err, at };
      const area = shape.kind === 'point' ? [at] : areaSquares(c, a, sp, at);
      return { kind: 'cast', spell: sp, slot: m.slot, targets: [], point: at, area, approach: none, complete: true, at };
    }
    return { kind: 'invalid', reason: 'Click the spell again to cast it', at };
  }

  /** Tooltip for aiming a spell. */
  private castTooltip(p: Extract<Plan, { kind: 'cast' }>): string {
    const c = this.combat, a = c.active!;
    const sp = p.spell, slot = p.slot;
    const book = spellStats(a, sp);
    const lines: string[] = [];
    const lvl = sp.uses ? 'Channel Divinity' : sp.level === 0 ? 'Cantrip' : slot === 0 ? 'Free casting' : `${ORDINAL[slot]}-level slot`;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const who = (t: Creature) => `<span class="${t.side === a.side ? 'tip-warn' : ''}">${esc(t.name)}</span>`;
    if (p.area) {
      const victims = sp.shape.kind === 'point' ? [] : areaVictims(c, a, sp, p.area);
      if (sp.id === 'sleep') lines.push(...victims.map((t) => `<div class="tip-row"><span>${esc(t.name)}</span><span>${c.has(t, 'trance') ? 'immune' : `${pct(failChance(c, t, 'wis', book.dc))} falls asleep`}</span></div>`));
      else if (sp.save && sp.damage) {
        lines.push(`<div class="tip-row"><span>${esc(formatDice(spellDamage(a, sp, slot)))} ${sp.damage.type}</span><span>${sp.save.toUpperCase()} save DC ${book.dc}</span></div>`);
        lines.push(...victims.map((t) => `<div class="tip-row">${who(t)}<span>${pct(failChance(c, t, sp.save!, book.dc))} fails</span></div>`));
        if (victims.some((t) => t.side === a.side)) lines.push('<div class="tip-warn">⚠ Your allies are in the area!</div>');
      }
      if (!victims.length && sp.shape.kind !== 'point') lines.push('<div class="tip-note">Nobody in the area.</div>');
    }
    if (sp.shape.kind === 'multi') {
      const n = targetCount(sp, slot);
      const counts = new Map<string, number>();
      for (const t of p.targets) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
      lines.push(`<div class="tip-row big"><span>${p.targets.length} of ${n} ${sp.id === 'magicMissile' ? 'darts' : sp.id === 'scorchingRay' ? 'rays' : 'targets'}</span></div>`);
      lines.push(`<div class="tip-note">${[...counts].map(([k, v]) => `${esc(k)}${v > 1 ? ` ×${v}` : ''}`).join(', ')}</div>`);
      if (!p.complete) lines.push('<div class="tip-note">Click to add. Space casts with what you have.</div>');
    }
    const t = p.targets[p.targets.length - 1];
    if (t && sp.damage && t.side !== a.side) {
      if (sp.attack) {
        const from = sp.id === 'spiritualWeapon' ? weaponSpot(c, a, t, p.approach.dest) ?? p.approach.dest : p.approach.dest;
        const pr = c.previewAttack(a, spellAttackProfile(a, sp, slot, t), t, { from });
        lines.push(`<div class="tip-row big"><span>${esc(t.name)}</span><span class="chance">${pct(pr.chance)}</span></div>`);
        lines.push(`<div class="tip-row"><span>+${book.attack} vs AC ${pr.ac}</span><span>${esc(formatDice(spellDamage(a, sp, slot, t)))} ${sp.damage.type}</span></div>`);
        if (pr.reasons.length) lines.push(`<div class="tip-note">${esc(pr.reasons.join(' · '))}</div>`);
      } else if (sp.save) {
        lines.push(`<div class="tip-row big"><span>${esc(t.name)}</span><span class="chance">${pct(failChance(c, t, sp.save, book.dc))}</span></div>`);
        lines.push(`<div class="tip-row"><span>${sp.save.toUpperCase()} save DC ${book.dc}${sp.half ? ', half on a success' : ''}</span><span>${esc(formatDice(spellDamage(a, sp, slot, t)))} ${sp.damage.type}</span></div>`);
      } else if (sp.id === 'magicMissile') lines.push(`<div class="tip-row"><span>Always hits</span><span>${esc(formatDice(spellDamage(a, sp, slot)))} force each</span></div>`);
    } else if (t && sp.heal) {
      lines.push(`<div class="tip-row big"><span>${esc(t.name)}</span><span class="chance">+${esc(formatDice(spellHealing(a, sp, slot)))}</span></div>`);
      if (t.hp === 0) lines.push('<div class="tip-good">Brings them back to consciousness.</div>');
    } else if (t) lines.push(`<div class="tip-row big"><span>${esc(t.name)}</span></div>`);
    if (sp.concentration && a.concentration) lines.push(`<div class="tip-warn">Ends your concentration on ${esc(spellOf(a, a.concentration).name)}.</div>`);
    if (sp.time === 'bonus') lines.push('<div class="tip-note">Bonus Action.</div>');
    const ap = p.approach;
    const move = (ap.cost > 0 ? `<div class="tip-note">Moves ${ap.cost} ft first.</div>` : '') +
      (ap.provokers.length ? `<div class="tip-warn">⚠ Provokes an opportunity attack from ${ap.provokers.map((x) => esc(x.name)).join(', ')}.</div>` : '');
    return `<div class="tip-head"><span class="tname">${esc(sp.name)}</span><span class="tsub">${lvl}</span></div>${lines.join('')}${move}`;
  }

  private creatureInfo(c: Creature): string {
    const v = this.vm.get(c.id)!;
    const conds = [...v.conds].map((k) => CONDITION_NAME[k]).filter(Boolean).join(', ');
    return `<div class="tip-head"><span class="tname ${c.side === 'party' ? 'ally' : 'enemy'}">${esc(c.name)}</span><span class="tsub">${c.cr ? `CR ${c.cr}` : esc(c.description ?? '')}</span></div>
      ${hpBar(v.hp, c.maxHp)}
      <div class="tip-row"><span>AC ${c.ac}</span><span>Speed ${c.speed} ft</span></div>
      ${conds ? `<div class="tip-note">${esc(conds)}</div>` : ''}
      ${c.side === 'enemy' && c.description ? `<div class="tip-note">${esc(c.description)}</div>` : ''}`;
  }

  private planTooltip(p: Plan): string | null {
    const a = this.combat.active!;
    const approachNote = (ap: Approach) => (ap.cost > 0 ? `<div class="tip-note">Moves ${ap.cost} ft first.</div>` : '') +
      (ap.provokers.length ? `<div class="tip-warn">⚠ Provokes an opportunity attack from ${ap.provokers.map((x) => esc(x.name)).join(', ')}.</div>` : '');
    switch (p.kind) {
      case 'attack': {
        const v = this.vm.get(p.target.id)!;
        const pr = p.preview;
        const mastery = p.attack.mastery ? `<div class="tip-note">Mastery — ${MASTERY_TEXT[p.attack.mastery] ?? p.attack.mastery}</div>` : '';
        const mode = pr.mode === 'normal' ? '' : `<div class="${pr.mode === 'advantage' ? 'tip-good' : 'tip-warn'}">${pr.mode === 'advantage' ? 'Advantage' : 'Disadvantage'}: ${esc(pr.reasons.filter((r) => r.startsWith(pr.mode === 'advantage' ? '+' : '−')).map((r) => r.slice(2)).join(', '))}</div>`;
        const extras = pr.reasons.filter((r) => !r.startsWith('+') && !r.startsWith('−'));
        return `<div class="tip-head"><span class="tname enemy">${esc(p.target.name)}</span><span class="tsub">AC ${p.target.ac}${p.target.cr ? ` · CR ${p.target.cr}` : ''}</span></div>
          ${hpBar(v.hp, p.target.maxHp)}
          <div class="tip-row big"><span>${esc(p.attack.name)}${p.offhand ? ' (off-hand)' : ''}</span><span class="chance">${Math.round(pr.chance * 100)}%</span></div>
          <div class="tip-row"><span>+${p.attack.toHit} vs AC ${pr.ac}</span><span>${esc(pr.damageText)} ${p.attack.damageType}</span></div>
          ${mode}${extras.length ? `<div class="tip-note">${esc(extras.join(' · '))}</div>` : ''}${mastery}
          ${p.offhand && this.combat.offhandStatus(a, p.attack) === 'bonus' ? '<div class="tip-note">Uses your Bonus Action.</div>' : ''}
          ${approachNote(p.approach)}`;
      }
      case 'shove':
        return `<div class="tip-head"><span class="tname enemy">${esc(p.target.name)}</span><span class="tsub">Shove</span></div>
          <div class="tip-row big"><span>${p.effect === 'prone' ? 'Knock Prone' : 'Push 5 ft'}</span><span class="chance">DC ${p.dc}</span></div>
          <div class="tip-note">The target makes a Strength or Dexterity saving throw (its choice).</div>${approachNote(p.approach)}`;
      case 'potion':
        return `<div class="tip-head"><span class="tname ally">${esc(p.target.name)}</span><span class="tsub">Potion of Healing</span></div>
          <div class="tip-row big"><span>Heal 2d4+2</span><span class="chance">${a.inv.potionOfHealing ?? 0} left</span></div>
          <div class="tip-note">Bonus Action.${p.target.hp === 0 ? ' Brings them back to consciousness.' : ''}</div>${approachNote(p.approach)}`;
      case 'help':
        return `<div class="tip-head"><span class="tname ally">${esc(p.target.name)}</span><span class="tsub">First Aid</span></div>
          <div class="tip-row big"><span>Stabilise</span><span class="chance">DC 10</span></div>
          <div class="tip-note">Wisdom (Medicine) check. A stable creature stops making death saves.</div>${approachNote(p.approach)}`;
      case 'cast': return this.castTooltip(p);
      case 'summonAttack': {
        const s = this.combat.summons.find((x) => x.id === p.summon)!;
        const pr = this.combat.previewAttack(a, spellAttackProfile(a, spellOf(a, 'spiritualWeapon'), s.slot, p.target), p.target, { from: weaponSpot(this.combat, a, p.target, a.pos, s.pos, 20) ?? s.pos });
        return `<div class="tip-head"><span class="tname enemy">${esc(p.target.name)}</span><span class="tsub">Spiritual Weapon</span></div>
          <div class="tip-row big"><span>Strike</span><span class="chance">${Math.round(pr.chance * 100)}%</span></div>
          <div class="tip-row"><span>+${a.spellcasting!.attack} vs AC ${pr.ac}</span><span>${esc(pr.damageText)} force</span></div>
          <div class="tip-note">Bonus Action: the weapon flies up to 20 ft and strikes.</div>`;
      }
      case 'info': return p.html;
      default: return null;
    }
  }

  private updateHover() {
    this.mouse.dirty = false;
    if (this.busy || !this.isPlayerTurn()) { this.ov.clearPlanning(); this.hud.tooltip(null); this.hud.cursorTag(null); return; }
    const pick = this.r.pick(this.mouse.x, this.mouse.y);
    const plan = this.computePlan(pick.tile, pick.creatureId);
    this.plan = plan;
    this.ov.clearPlanning();
    this.hud.tooltip(null); this.hud.cursorTag(null);
    if (!plan) { this.refreshHotbar(); return; }
    this.ov.setHover(plan.kind === 'move' ? plan.approach.dest : 'target' in plan ? plan.target.pos : plan.at);
    const ap = 'approach' in plan ? plan.approach : undefined;
    if (ap && ap.path.length > 1) this.ov.setPath(ap.path, ap.provokers.length > 0);
    if (plan.kind === 'attack' || plan.kind === 'shove') this.ov.setTarget(plan.target.pos);
    if (plan.kind === 'potion' || plan.kind === 'help') this.ov.setTarget(plan.target.pos, true);
    if (plan.kind === 'summonAttack') this.ov.setTarget(plan.target.pos);
    if (plan.kind === 'cast') {
      if (plan.area) this.ov.setArea(plan.area, SPELL_COLOR[plan.spell.id] ?? 0xff8a3a);
      if (plan.targets.length) this.ov.setTarget(plan.targets.map((t) => t.pos), plan.spell.affects === 'ally' || plan.targets[0].side === this.combat.active!.side);
    }
    const tip = this.planTooltip(plan);
    if (tip) this.hud.tooltip(tip, this.mouse.x, this.mouse.y);
    if (plan.kind === 'move') {
      const end = this.r.project(this.r.worldOf(plan.approach.dest.x, plan.approach.dest.y));
      const w = plan.approach.provokers.length;
      this.hud.cursorTag(`${plan.approach.cost} ft${w ? ` · ⚠ ${w} opportunity attack${w > 1 ? 's' : ''}` : ''}`, end.x, end.y, w > 0);
    }
    if (plan.kind === 'invalid') this.hud.cursorTag(plan.reason, this.mouse.x, this.mouse.y - 10, true);
    this.refreshHotbar(ap?.cost);
    this.r.renderer.domElement.style.cursor = plan.kind === 'attack' || plan.kind === 'shove' || plan.kind === 'cast' || plan.kind === 'summonAttack' ? 'crosshair' : plan.kind === 'invalid' ? 'not-allowed' : 'pointer';
  }

  // ------------------------------------------------------------ input

  private cancelMode() { this.mode = { kind: 'default' }; this.refreshHotbar(); this.mouse.dirty = true; }

  // ------------------------------------------------------------ hotbar

  private slots(): Slot[] {
    const a = this.combat.active;
    if (!a || a.controller !== 'player') return [];
    const c = this.combat;
    const out: Slot[] = [];
    const attackOk = a.turn.attacksLeft > 0 || a.turn.actions > 0;
    const sel = (m: Mode) => JSON.stringify(m) === JSON.stringify(this.mode);
    for (const atk of a.attacks) {
      const ammo = atk.consumes ? a.inv[atk.consumes] ?? 0 : undefined;
      const iconName = atk.kind === 'ranged' ? (atk.id.includes('javelin') ? 'javelin' : atk.id.includes('dagger') ? 'dagger' : 'bow') : atk.id.includes('dagger') ? 'dagger' : 'sword';
      const range = atk.kind === 'ranged' ? `range ${atk.range![0]}/${atk.range![1]} ft` : `reach ${atk.reach} ft`;
      out.push({
        key: `attack:${atk.id}`, icon: iconName, label: atk.name, cost: a.turn.attacksLeft > 0 ? 'free' : 'action', uses: ammo,
        enabled: attackOk && (ammo === undefined || ammo > 0), selected: sel({ kind: 'attack', attack: atk.id, offhand: false }),
        tip: `<div class="tname">${esc(atk.name)}</div><div class="tip-row"><span>+${atk.toHit} to hit, ${range}</span></div><div class="tip-row"><span>${formatDmg(atk)} ${atk.damageType}</span></div>${atk.mastery ? `<div class="tip-note">Mastery — ${MASTERY_TEXT[atk.mastery]}</div>` : ''}${atk.finesse && c.has(a, 'sneakAttack') ? '<div class="tip-note">Finesse: can Sneak Attack.</div>' : ''}`,
      });
    }
    const light = a.attacks.filter((x) => x.light && x.offhandDamage && x.kind === 'melee');
    if (light.length > 1) {
      const avail = light.find((x) => c.offhandStatus(a, x));
      const atk = avail ?? light[light.length - 1];
      const st = avail ? c.offhandStatus(a, avail) : null;
      out.push({ key: `offhand:${atk.id}`, icon: 'offhand', label: 'Off-hand Attack', cost: st === 'free' ? 'free' : 'bonus', enabled: !!st, selected: sel({ kind: 'attack', attack: atk.id, offhand: true }),
        tip: `<div class="tname">Off-hand Attack (${esc(atk.name)})</div><div class="tip-note">After attacking with a Light weapon, strike with a different Light weapon as a Bonus Action. No ability modifier to damage.</div>` });
    }
    out.push({ key: 'shove', icon: 'shove', label: 'Shove', cost: a.turn.attacksLeft > 0 ? 'free' : 'action', enabled: attackOk, selected: this.mode.kind === 'shove',
      tip: `<div class="tname">Shove</div><div class="tip-note">Replaces an attack. Push a creature 5 ft away or knock it Prone (STR or DEX save vs DC ${8 + c.modOf(a, 'str') + a.pb}). Click again to switch between push and prone.</div><div class="tip-note">Current: ${this.mode.kind === 'shove' && this.mode.effect === 'push' ? 'Push' : 'Prone'}</div>` });
    const cunning = c.has(a, 'cunningAction') && a.turn.bonusActions > 0;
    const via = (_k: string) => (cunning ? 'bonus' : 'action') as 'bonus' | 'action';
    const canVia = (k: string) => (via(k) === 'bonus' ? a.turn.bonusActions > 0 : a.turn.actions > 0);
    out.push({ key: 'dash', icon: 'dash', label: 'Dash', cost: via('dash'), enabled: canVia('dash'), selected: false, tip: `<div class="tname">Dash${cunning ? ' (Cunning Action)' : ''}</div><div class="tip-note">Gain extra movement equal to your Speed this turn.</div>` });
    out.push({ key: 'disengage', icon: 'disengage', label: 'Disengage', cost: via('d'), enabled: canVia('d'), selected: false, tip: `<div class="tname">Disengage${cunning ? ' (Cunning Action)' : ''}</div><div class="tip-note">Your movement doesn't provoke Opportunity Attacks for the rest of the turn.</div>` });
    out.push({ key: 'dodge', icon: 'dodge', label: 'Dodge', cost: 'action', enabled: a.turn.actions > 0, selected: false, tip: '<div class="tname">Dodge</div><div class="tip-note">Until your next turn, attacks against you have Disadvantage and you have Advantage on DEX saves.</div>' });
    const blockers = c.hideBlockers(a);
    out.push({ key: 'hide', icon: 'hide', label: 'Hide', cost: via('h'), enabled: canVia('h') && !c.cond(a, 'hidden'), selected: false,
      tip: `<div class="tname">Hide${cunning ? ' (Cunning Action)' : ''}</div><div class="tip-note">DC 15 Dexterity (Stealth). You must be out of every enemy's sight (three-quarters cover or better). While hidden you attack with Advantage.</div>${blockers.length ? `<div class="tip-warn">Seen by: ${blockers.map((b) => esc(b.name)).join(', ')}</div>` : '<div class="tip-good">No enemy can see you here.</div>'}` });
    if (c.alliesOf(a).some((x) => x.hp === 0 && c.isAlive(x)))
      out.push({ key: 'help', icon: 'help', label: 'First Aid', cost: 'action', enabled: a.turn.actions > 0, selected: this.mode.kind === 'help', tip: '<div class="tname">Help: First Aid</div><div class="tip-note">DC 10 Wisdom (Medicine) check to stabilise a dying ally.</div>' });
    if ((a.inv.potionOfHealing ?? 0) > 0 || a.inventory?.potionOfHealing)
      out.push({ key: 'potion', icon: 'potion', label: 'Potion', cost: 'bonus', uses: a.inv.potionOfHealing ?? 0, enabled: (a.inv.potionOfHealing ?? 0) > 0 && a.turn.bonusActions > 0, selected: this.mode.kind === 'potion', tip: '<div class="tname">Potion of Healing</div><div class="tip-note">Bonus Action: drink it, or feed it to a creature within 5 ft. Heals 2d4+2.</div>' });
    if (c.has(a, 'secondWind'))
      out.push({ key: 'secondWind', icon: 'secondWind', label: 'Second Wind', cost: 'bonus', uses: a.resourcesLeft.secondWind, enabled: (a.resourcesLeft.secondWind ?? 0) > 0 && a.turn.bonusActions > 0, selected: false, tip: `<div class="tname">Second Wind</div><div class="tip-note">Bonus Action: regain 1d10 + ${a.level} HP.</div>` });
    if (c.has(a, 'actionSurge'))
      out.push({ key: 'actionSurge', icon: 'actionSurge', label: 'Action Surge', cost: 'free', uses: a.resourcesLeft.actionSurge, enabled: (a.resourcesLeft.actionSurge ?? 0) > 0, selected: false, tip: '<div class="tname">Action Surge</div><div class="tip-note">Take one additional action this turn. Once per rest.</div>' });
    if (c.has(a, 'steadyAim'))
      out.push({ key: 'steadyAim', icon: 'steadyAim', label: 'Steady Aim', cost: 'bonus', enabled: a.turn.bonusActions > 0 && !a.turn.moved && !c.cond(a, 'steadyAim'), selected: false,
        tip: `<div class="tname">Steady Aim</div><div class="tip-note">Bonus Action, only if you haven't moved this turn: Advantage on your next attack roll, but your Speed is 0 until the end of the turn.</div>${a.turn.moved ? '<div class="tip-warn">You have already moved.</div>' : ''}` });
    if (c.cond(a, 'prone'))
      out.unshift({ key: 'stand', icon: 'stand', label: 'Stand Up', cost: 'free', enabled: a.turn.movement >= Math.ceil(c.speedOf(a) / 2), selected: false, tip: '<div class="tname">Stand Up</div><div class="tip-note">Costs half your Speed.</div>' });
    return out;
  }

  /** The second hotbar row: spells, Channel Divinity and Spiritual Weapon strikes. */
  private spellSlots(): Slot[] {
    const a = this.combat.active;
    if (!a || a.controller !== 'player' || !a.spellcasting) return [];
    const c = this.combat;
    const book = a.spellcasting;
    const out: Slot[] = [];
    for (const s of summonsOf(c, a)) {
      out.push({ key: `summon:${s.id}`, icon: 'strike', label: 'Spiritual Weapon', cost: 'bonus', enabled: a.turn.bonusActions > 0, selected: this.mode.kind === 'summon',
        tip: '<div class="tname">Spiritual Weapon: Strike</div><div class="tip-note">Bonus Action: move the weapon up to 20 ft and make a melee spell attack against a creature within 5 ft of it.</div>' });
    }
    for (const sp of book.spells) {
      if (sp.utility) continue;
      const opts = slotOptions(a, sp);
      const slot = this.mode.kind === 'spell' && this.mode.spell === sp.id ? this.mode.slot : opts[0];
      const why = sp.time === 'reaction' || sp.time === 'onHit' ? 'reaction' : slot === undefined ? 'No spell slots left' : castBlocker(c, a, sp, slot);
      const level = sp.uses ? (sp.school === 'Channel Divinity' ? 'Channel Divinity' : sp.school) : sp.level === 0 ? 'Cantrip' : `${ORDINAL[sp.level]}-level ${sp.school}`;
      const st = spellStats(a, sp);
      const stats = [
        sp.time === 'bonus' ? 'Bonus Action' : sp.time === 'reaction' ? 'Reaction' : sp.time === 'onHit' ? 'Bonus Action, after a hit' : sp.time === 'attack' ? 'Part of the Attack action' : 'Action',
        sp.range === 0 ? 'Self' : sp.range === 5 ? 'Touch' : `${sp.range} ft`,
        sp.attack ? `+${st.attack} to hit` : sp.save ? `${sp.save.toUpperCase()} save DC ${st.dc}` : '',
        sp.free && (a.resourcesLeft[sp.free] ?? 0) > 0 ? 'Free casting ready' : '',
        sp.concentration ? 'Concentration' : '',
      ].filter(Boolean).join(' · ');
      out.push({
        key: `spell:${sp.id}`, icon: sp.icon, label: sp.name, kind: sp.uses ? 'feature' : sp.level === 0 ? 'cantrip' : 'spell', cost: sp.time === 'reaction' ? 'reaction' : sp.time === 'bonus' ? 'bonus' : 'action',
        uses: sp.uses ? a.resourcesLeft[sp.uses] ?? 0 : undefined,
        enabled: why === null, selected: this.mode.kind === 'spell' && this.mode.spell === sp.id,
        tip: `<div class="tip-head"><span class="tname">${esc(sp.name)}</span><span class="tsub">${level}</span></div><div class="tip-row"><span>${esc(stats)}</span></div><div class="tip-note">${esc(sp.description)}</div>${why && why !== 'reaction' ? `<div class="tip-warn">${esc(why)}</div>` : ''}${sp.time === 'reaction' || sp.time === 'onHit' ? '<div class="tip-good">You will be asked when it can be used.</div>' : ''}`,
      });
    }
    return out;
  }

  private onSlot(key: string) {
    if (this.busy || !this.isPlayerTurn()) return;
    const a = this.combat.active!;
    const [kind, arg] = key.split(':');
    const cunning = this.combat.has(a, 'cunningAction') && a.turn.bonusActions > 0;
    switch (kind) {
      case 'attack': this.toggleMode({ kind: 'attack', attack: arg, offhand: false }); break;
      case 'offhand': this.toggleMode({ kind: 'attack', attack: arg, offhand: true }); break;
      case 'shove': this.mode = this.mode.kind === 'shove' ? (this.mode.effect === 'prone' ? { kind: 'shove', effect: 'push' } : { kind: 'default' }) : { kind: 'shove', effect: 'prone' }; break;
      case 'potion': this.toggleMode({ kind: 'potion' }); break;
      case 'help': this.toggleMode({ kind: 'help' }); break;
      case 'dash': this.act({ type: 'dash', actor: a.id, via: cunning ? 'bonus' : 'action' }); break;
      case 'disengage': this.act({ type: 'disengage', actor: a.id, via: cunning ? 'bonus' : 'action' }); break;
      case 'hide': this.act({ type: 'hide', actor: a.id, via: cunning ? 'bonus' : 'action' }); break;
      case 'dodge': this.act({ type: 'dodge', actor: a.id }); break;
      case 'secondWind': this.act({ type: 'secondWind', actor: a.id }); break;
      case 'actionSurge': this.act({ type: 'actionSurge', actor: a.id }); break;
      case 'stand': this.act({ type: 'standUp', actor: a.id }); break;
      case 'steadyAim': this.act({ type: 'steadyAim', actor: a.id }); break;
      case 'summon': this.toggleMode({ kind: 'summon', summon: arg }); break;
      case 'spell': {
        const sp = spellOf(a, arg);
        const slot = slotOptions(a, sp)[0];
        if (slot === undefined) break;
        // spells without a target go off at once
        if (sp.shape.kind === 'self' || sp.shape.kind === 'emanation') { this.mode = { kind: 'default' }; this.act({ type: 'cast', actor: a.id, spell: sp.id, slot }); break; }
        if (this.mode.kind === 'spell' && this.mode.spell === sp.id) this.mode = { kind: 'default' };
        else this.mode = { kind: 'spell', spell: sp.id, slot, targets: [] };
        break;
      }
      case 'slotLevel':
        if (this.mode.kind === 'spell') {
          const sp = spellOf(a, this.mode.spell);
          const slot = Number(arg);
          this.mode = { ...this.mode, slot, targets: this.mode.targets.slice(0, Math.max(1, targetCount(sp, slot))) };
        }
        break;
      case 'castNow':
        if (this.mode.kind === 'spell' && this.mode.targets.length) {
          const m = this.mode;
          this.mode = { kind: 'default' };
          this.act({ type: 'cast', actor: a.id, spell: m.spell, slot: m.slot, targets: m.targets });
        }
        break;
    }
    this.refreshHotbar(); this.mouse.dirty = true;
  }

  private toggleMode(m: Mode) { this.mode = JSON.stringify(m) === JSON.stringify(this.mode) ? { kind: 'default' } : m; }

  // ------------------------------------------------------------ HUD refresh

  private refreshHud() {
    const c = this.combat;
    const order = c.order.length ? c.order : c.creatures.map((x) => x.id);
    this.hud.renderInitiative(order.map((id) => {
      const cr = c.get(id), v = this.vm.get(id)!;
      return { id, name: cr.name, side: cr.side, initiative: cr.initiative, hpFrac: v.hp / cr.maxHp, dead: v.dead, active: id === this.activeId, hidden: cr.side === 'enemy' && v.conds.has('hidden') };
    }), this.round);
    this.hud.renderParty(c.creatures.filter((x) => x.side === 'party').map((cr) => {
      const v = this.vm.get(cr.id)!;
      let status = [...v.conds].map((k) => CONDITION_NAME[k]).filter(Boolean).join(', ');
      if (v.hp === 0 && !v.dead && !v.conds.has('stable')) status = `Dying — saves ${cr.deathSaves.success}✓ ${cr.deathSaves.fail}✗`;
      if (v.dead) status = 'Dead';
      if (cr.tempHp > 0 && !v.dead) status = `+${cr.tempHp} temp HP${status ? ` · ${status}` : ''}`;
      if (cr.concentration && !v.dead) status = `◈ ${spellOf(cr, cr.concentration).name}${status ? ` · ${status}` : ''}`;
      return { id: cr.id, name: cr.name, hp: v.hp, maxHp: cr.maxHp, status: status || cr.description || '', active: cr.id === this.activeId, dead: v.dead, side: cr.side };
    }));
    this.refreshHotbar();
    const a = c.active;
    this.ov.setActive(a && !this.busy ? this.vm.get(a.id)!.pos : a ? this.vm.get(a.id)!.pos : null);
    if (a && a.controller === 'player' && !this.busy && !c.over) {
      const tiles = [...c.reachable(a).values()].map((r) => r.path[r.path.length - 1]);
      this.ov.setReach(tiles, a.pos);
    } else this.ov.setReach([]);
  }

  private refreshHotbar(previewMove?: number) {
    const a = this.combat.active;
    if (!a || a.controller !== 'player' || this.combat.over) {
      this.hud.renderHotbar(null, a && !this.combat.over ? a.name : undefined);
      return;
    }
    const v = this.vm.get(a.id)!;
    const state: HotbarState = {
      id: a.id, name: a.name, title: a.description ?? '', hp: v.hp, maxHp: a.maxHp, ac: this.combat.acOf(a), side: a.side,
      actions: a.turn.actions, bonus: a.turn.bonusActions, reaction: a.turn.reaction, movement: a.turn.movement, speed: this.combat.speedOf(a),
      previewMove, slots: this.slots(), waiting: this.busy, spells: this.spellSlots(),
      pips: a.spellcasting ? a.spellcasting.slots.map((max, level) => ({ level, max, left: a.slotsLeft[level] ?? 0 })).filter((p) => p.level > 0 && p.max > 0) : undefined,
      concentration: a.concentration ? spellOf(a, a.concentration).name : undefined,
    };
    const m = this.mode;
    if (m.kind === 'spell') {
      const sp = spellOf(a, m.spell);
      const options: NonNullable<HotbarState['picker']>['options'] = [];
      // upcasting: every slot level that has a slot left
      const levels = slotOptions(a, sp);
      if (sp.level > 0 && levels.length > 1) for (const l of levels) options.push({ key: `slotLevel:${l}`, label: l === 0 ? 'Free' : `${ORDINAL[l]} (${a.slotsLeft[l]})`, selected: l === m.slot, enabled: true });
      if (sp.shape.kind === 'multi') options.push({ key: 'castNow', label: `Cast now (${m.targets.length}/${targetCount(sp, m.slot)})`, selected: false, enabled: m.targets.length > 0 });
      state.picker = { title: `${sp.name}${sp.level > 0 ? ` · ${m.slot === 0 ? 'free casting' : `${ORDINAL[m.slot]} level`}` : ''}`, options };
    }
    this.hud.renderHotbar(state);
  }

  // ------------------------------------------------------------ event animation

  private async play(events: GameEvent[]) {
    for (const e of events) await this.animate(e);
    this.refreshHud();
  }

  private head(id: string, extra = 0.3) { return this.r.projectHead(id, extra); }

  private async animate(e: GameEvent) {
    const r = this.r;
    switch (e.type) {
      case 'log': this.hud.log(e.text, e.tone); return;
      case 'turnStart': {
        this.activeId = e.id; this.round = e.round;
        const c = this.combat.get(e.id), v = this.vm.get(e.id)!;
        r.ensureVisible(v.pos.x, v.pos.y, 0.55);
        this.ov.setActive(v.pos);
        this.refreshHud();
        if (c.side === 'party') { this.hud.banner(`${c.name}'s Turn`); await r.wait(0.5); }
        else if (!v.conds.has('hidden')) await r.wait(0.15);
        return;
      }
      case 'move': {
        const v = this.vm.get(e.id)!;
        const hiddenEnemy = this.combat.get(e.id).side === 'enemy' && v.conds.has('hidden');
        const ch = r.figures.get(e.id)!.character;
        if (!hiddenEnemy) ch.loop(ch.spec.walk ?? 'Running_A', 0.15);
        for (let i = 1; i < e.path.length; i++) {
          const a = e.path[i - 1], b = e.path[i];
          const fig = r.figures.get(e.id)!.group;
          const y0 = r.floorY(a.x, a.y), y1 = r.floorY(b.x, b.y);
          r.face(e.id, b.x, b.y);
          const climb = Math.abs(y1 - y0) > 0.4;
          const diag = a.x !== b.x && a.y !== b.y;
          await r.tween(hiddenEnemy ? 0.05 : climb ? 0.36 : diag ? 0.3 : 0.24, (k) => {
            fig.position.x = a.x + (b.x - a.x) * k;
            fig.position.z = a.y + (b.y - a.y) * k;
            fig.position.y = y0 + (y1 - y0) * k + (climb ? Math.sin(Math.PI * k) * 0.3 : 0);
          });
          v.pos = { ...b };
          if (!hiddenEnemy) r.ensureVisible(b.x, b.y, 0.75);
        }
        ch.loop(ch.spec.idle ?? 'Idle', 0.2);
        return;
      }
      case 'attack': {
        if (e.spell) { await this.animateSpellAttack(e); return; }
        const atk = this.combat.get(e.attacker).attacks.find((x) => x.id === e.attack)!;
        const tv = this.vm.get(e.target)!;
        // a hidden attacker is revealed by attacking
        r.face(e.attacker, tv.pos.x, tv.pos.y);
        const roll = this.head(e.attacker, 0.45);
        const modeTxt = e.mode === 'advantage' ? ' ▲' : e.mode === 'disadvantage' ? ' ▼' : '';
        this.hud.float(roll.x, roll.y, `${e.opportunity ? 'Opportunity! ' : ''}d20 ${e.natural} → ${e.total}${modeTxt}`, 'roll');
        const ch = r.figures.get(e.attacker)!.character;
        const thrown = !!atk.consumes && !atk.consumes.includes('arrow');
        if (atk.kind === 'ranged' && !thrown) ch.showRanged(true);
        const offhand = atk.id === 'dagger' && this.combat.get(e.attacker).attacks.some((x) => x.id === 'shortsword') && !!ch.spec.offhand;
        const anim = atk.kind === 'melee' ? (offhand ? ch.spec.offhand! : ch.spec.melee) : thrown ? 'Throw' : ch.spec.ranged;
        const play = ch.once(anim, { impactAt: atk.kind === 'melee' ? 0.42 : 0.35, speed: 1.15 });
        await play.impact;
        if (atk.kind === 'ranged') await this.projectile(e.attacker, e.target, atk.id);
        play.done.then(() => ch.showRanged(false));
        const hp = this.head(e.target);
        if (!e.hit) {
          this.hud.float(hp.x, hp.y, 'Miss', 'miss');
          const tf = r.figures.get(e.target)!;
          if (!tf.down) { const dodge = tf.character.once(Math.random() < 0.5 ? 'Dodge_Left' : 'Block', { speed: 1.4 }); await Promise.race([dodge.done, r.wait(0.45)]); }
        } else if (e.crit) this.hud.float(hp.x, hp.y - 26, 'Critical!', 'crit');
        return;
      }
      case 'damage': {
        const v = this.vm.get(e.target)!;
        v.hp = e.hp;
        r.flash(e.target);
        const p = this.head(e.target);
        this.hud.float(p.x, p.y, `−${e.amount}`, 'dmg');
        const tf = r.figures.get(e.target)!;
        if (!tf.down && e.hp > 0) tf.character.once(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { speed: 1.2 });
        this.refreshHud();
        await r.wait(0.3);
        return;
      }
      case 'heal': {
        const v = this.vm.get(e.target)!; v.hp = e.hp;
        r.flash(e.target, 0x40ff60, 0.3);
        const p = this.head(e.target); this.hud.float(p.x, p.y, `+${e.amount}`, 'heal');
        this.refreshHud(); await r.wait(0.35);
        return;
      }
      case 'condition': {
        const v = this.vm.get(e.target)!;
        const side = this.combat.get(e.target).side;
        if (e.added) v.conds.add(e.condition); else v.conds.delete(e.condition);
        if (e.condition === 'hidden') {
          this.r.setOpacity(e.target, e.added ? (side === 'party' ? 0.45 : 0) : 1);
          if (!e.added) { const p = this.head(e.target); this.hud.float(p.x, p.y, 'Spotted!', 'info'); }
        }
        if (e.condition === 'prone' || e.condition === 'unconscious') await this.setLying(e.target, v.conds.has('prone') || v.conds.has('unconscious'), v.conds.has('unconscious') ? 'Death_B' : 'Lie_Down');
        if (e.added && (e.condition === 'sapped' || e.condition === 'slowed')) { const p = this.head(e.target, 0.1); this.hud.float(p.x, p.y + 18, CONDITION_NAME[e.condition], 'info'); }
        this.refreshHud();
        return;
      }
      case 'down': { const p = this.head(e.id); this.hud.float(p.x, p.y - 20, 'Down!', 'crit'); await r.wait(0.3); return; }
      case 'death': {
        const v = this.vm.get(e.id)!; v.dead = true; v.conds.clear();
        await this.setLying(e.id, true, 'Death_A');
        const f = r.figures.get(e.id)!;
        f.ring.visible = false;
        f.materials.forEach((m) => m.color.multiplyScalar(0.45));
        this.refreshHud();
        await r.wait(0.25);
        return;
      }
      case 'swap': {
        const a = this.vm.get(e.a)!, b = this.vm.get(e.b)!;
        const pa = { ...a.pos }, pb = { ...b.pos };
        a.pos = pb; b.pos = pa;
        await Promise.all([this.slide(e.a, pa, pb, 0.25), this.slide(e.b, pb, pa, 0.25)]);
        return;
      }
      case 'push': { const v = this.vm.get(e.target)!; v.pos = { ...e.to }; await this.slide(e.target, e.from, e.to, 0.22); return; }
      case 'save': {
        const p = this.head(e.target, 0.6);
        this.hud.float(p.x, p.y, `${e.ability.toUpperCase()} save ${e.total} vs ${e.dc} ${e.success ? '✓' : '✗'}`, e.success ? 'heal' : 'dmg');
        await r.wait(0.45); return;
      }
      case 'check': {
        const p = this.head(e.actor, 0.6);
        const name = e.skill[0].toUpperCase() + e.skill.slice(1);
        this.hud.float(p.x, p.y, `${name} ${e.total}${e.dc ? ` vs ${e.dc} ${e.success ? '✓' : '✗'}` : ''}`, 'roll');
        await r.wait(0.45); return;
      }
      case 'action': {
        const ch = r.figures.get(e.id)!.character;
        if (e.target && e.target !== e.id) { const tv = this.vm.get(e.target)!; r.face(e.id, tv.pos.x, tv.pos.y); }
        const anim = { shove: 'Unarmed_Melee_Attack_Punch_A', potion: 'Use_Item', secondWind: 'Use_Item', stabilize: 'Interact', dodge: 'Block', search: 'Interact', hide: '', dash: '', disengage: '', steadyAim: '2H_Ranged_Aiming', wake: 'Interact' }[e.action];
        if (anim) { const play = ch.once(anim, { impactAt: 0.5, speed: 1.2 }); await play.impact; }
        return;
      }
      case 'cast': await this.animateCast(e); return;
      case 'spellHit': await this.animateSpellHit(e); return;
      case 'summon': this.fx.summonWeapon(e.summon.id, e.summon.pos); await r.wait(0.3); return;
      case 'summonMove': await this.fx.moveWeapon(e.id, e.to); return;
      case 'unsummon': this.fx.unsummonWeapon(e.id); return;
      case 'teleport': {
        const v = this.vm.get(e.id)!;
        const f = r.figures.get(e.id)!;
        this.fx.burst(r.worldOf(e.from.x, e.from.y).setY(r.floorY(e.from.x, e.from.y) + 0.6), SPELL_COLOR.mistyStep, 24, 0.6, 1.2);
        await r.tween(0.2, (k) => { f.group.scale.setScalar(1 - k * 0.9); });
        f.group.position.set(e.to.x, r.floorY(e.to.x, e.to.y), e.to.y);
        v.pos = { ...e.to };
        r.ensureVisible(e.to.x, e.to.y);
        this.fx.burst(r.worldOf(e.to.x, e.to.y).setY(r.floorY(e.to.x, e.to.y) + 0.6), SPELL_COLOR.mistyStep, 24, 0.6, 1.2);
        await r.tween(0.2, (k) => { f.group.scale.setScalar(0.1 + k * 0.9); });
        f.group.scale.setScalar(1);
        return;
      }
      case 'concentration': case 'maxHp': this.refreshHud(); return;
      case 'tempHp': {
        const p = this.head(e.target);
        if (e.tempHp > 0) this.hud.float(p.x, p.y, `${e.tempHp} temp HP`, 'heal');
        this.refreshHud();
        return;
      }
      case 'deathSave': {
        const p = this.head(e.target, 0.2);
        this.hud.float(p.x, p.y, `Death save: ${e.natural}  (${e.success}✓ ${e.fail}✗)`, e.natural >= 10 ? 'roll' : 'dmg');
        this.refreshHud(); await r.wait(0.8); return;
      }
      default: return;
    }
  }

  /** Chest-height point of a figure, in world space. */
  private chest(id: string, k = 0.6): THREE.Vector3 {
    const f = this.r.figures.get(id)!;
    return f.group.position.clone().add(new THREE.Vector3(0, f.down ? 0.25 : f.headHeight * k, 0));
  }

  /** A spell going off: the caster's gesture, then whatever the spell looks like at its destination. */
  private async animateCast(e: Extract<GameEvent, { type: 'cast' }>) {
    const r = this.r;
    const caster = r.figures.get(e.actor)!;
    const def = this.combat.get(e.actor).spellcasting?.spells.find((s) => s.id === e.spell);
    const color = (e.spell.startsWith('breath') && def?.damage ? DAMAGE_COLOR[def.damage.type] : undefined) ?? SPELL_COLOR[e.spell] ?? 0xffffff;
    if (e.spell === 'divineSmite') {
      // the smite rides on the weapon blow: a pillar of light on the target, no casting gesture
      const t = e.targets[0];
      if (t) await this.fx.column(this.vm.get(t)!.pos, color);
      return;
    }
    if (e.reaction) {
      // Shield: a flash of force around the caster
      const p = this.head(e.actor, 0.5); this.hud.float(p.x, p.y, 'Shield!', 'info');
      await this.fx.bubble(caster.group.position.clone(), color);
      return;
    }
    const first = e.targets.find((t) => t !== e.actor);
    const aim = first ? this.vm.get(first)!.pos : e.point;
    if (aim) r.face(e.actor, aim.x, aim.y);
    const offensive = ['fireBolt', 'rayOfFrost', 'shockingGrasp', 'magicMissile', 'scorchingRay', 'guidingBolt', 'burningHands', 'sleep', 'sacredFlame', 'tollTheDead', 'inflictWounds', 'divineSpark', 'chillTouch', 'poisonSpray', 'produceFlame', 'breathCone', 'breathLine'].includes(e.spell);
    const anim = offensive ? 'Spellcast_Shoot' : 'Spellcast_Raise';
    const play = caster.character.once(anim, { impactAt: 0.5, speed: 1.25 });
    // a glow in the caster's hands while the spell gathers
    this.fx.rise(this.chest(e.actor, 0.7), color, 10, 0.5);
    await play.impact;
    switch (e.spell) {
      case 'burningHands': case 'breathCone': case 'breathLine': await this.fx.area(e.area ?? [], color, 'fire'); break;
      case 'divineFavor': case 'sacredWeapon': case 'heroism': case 'protectionFromEvilAndGood':
        await this.fx.rise(this.chest(first ?? e.actor, 0.4), color, 18, 0.6); break;
      case 'sleep': await this.fx.area(e.area ?? [], color, 'mist'); break;
      case 'sacredFlame': if (first) await this.fx.column(this.vm.get(first)!.pos, color); break;
      case 'divineSpark':
        if (first && this.combat.get(first).side !== this.combat.get(e.actor).side) await this.fx.column(this.vm.get(first)!.pos, color);
        break;
      case 'tollTheDead': case 'inflictWounds': if (first) await this.fx.pulse(this.vm.get(first)!.pos, color); break;
      case 'preserveLife': await this.fx.rise(caster.group.position.clone().setY(caster.group.position.y + 0.2), color, 40, 1); break;
      default: break;
    }
  }

  /** Spell attacks fly from the caster's hands (or swing from the Spiritual Weapon). */
  private async animateSpellAttack(e: Extract<GameEvent, { type: 'attack' }>) {
    const r = this.r;
    const color = SPELL_COLOR[e.spell!] ?? 0xffffff;
    const to = this.chest(e.target);
    const tv = this.vm.get(e.target)!;
    const roll = this.head(e.attacker, 0.45);
    const modeTxt = e.mode === 'advantage' ? ' ▲' : e.mode === 'disadvantage' ? ' ▼' : '';
    this.hud.float(roll.x, roll.y, `d20 ${e.natural} → ${e.total}${modeTxt}`, 'roll');
    if (e.summon) await this.fx.swingWeapon(e.summon, to);
    else {
      r.face(e.attacker, tv.pos.x, tv.pos.y);
      const from = this.chest(e.attacker, 0.7);
      // a missed shot sails past
      const dest = e.hit ? to : to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.3, (Math.random() - 0.5) * 0.9));
      if (e.spell === 'shockingGrasp') { this.fx.burst(to, color, 20, 0.4, 1.2); await r.wait(0.15); }
      else if (e.spell === 'rayOfFrost' || e.spell === 'scorchingRay') await this.fx.beam(from, dest, color, e.spell === 'rayOfFrost' ? 0.06 : 0.05, 0.25);
      else await this.fx.bolt(from, dest, color, e.spell === 'guidingBolt' ? 0.15 : 0.11, 13, 0.25);
    }
    const hp = this.head(e.target);
    if (!e.hit) this.hud.float(hp.x, hp.y, 'Miss', 'miss');
    else if (e.crit) this.hud.float(hp.x, hp.y - 26, 'Critical!', 'crit');
  }

  /** Effects that land without an attack roll: darts, heals, blessings. */
  private async animateSpellHit(e: Extract<GameEvent, { type: 'spellHit' }>) {
    const color = SPELL_COLOR[e.spell] ?? 0xffffff;
    const to = this.chest(e.target);
    if (e.spell === 'magicMissile') {
      const from = this.chest(e.actor, 0.7);
      await this.fx.bolt(from, to, color, 0.08, 11, 0.6 + Math.random() * 0.5);
      return;
    }
    const f = this.r.figures.get(e.target)!;
    if (['healingWord', 'cureWounds', 'preserveLife', 'divineSpark', 'bless', 'shieldOfFaith', 'aid'].includes(e.spell)) {
      await this.fx.rise(f.group.position.clone().setY(f.group.position.y + 0.1), color, 22, 0.7);
    }
  }

  private slide(id: string, from: Pos, to: Pos, dur: number) {
    const g = this.r.figures.get(id)!.group;
    const y0 = this.r.floorY(from.x, from.y), y1 = this.r.floorY(to.x, to.y);
    return this.r.tween(dur, (k) => { const s = k * k * (3 - 2 * k); g.position.set(from.x + (to.x - from.x) * s, y0 + (y1 - y0) * s, from.y + (to.y - from.y) * s); });
  }

  /** Knock down (Lie_Down / Death_B / Death_A, held) or get back up (Lie_StandUp). */
  private async setLying(id: string, lying: boolean, anim = 'Death_B') {
    const f = this.r.figures.get(id)!;
    if (f.down === lying) return;
    f.down = lying;
    if (lying) { const p = f.character.once(anim, { hold: true, speed: 1.1 }); await Promise.race([p.done, this.r.wait(0.9)]); }
    else { const p = f.character.once('Lie_StandUp', { speed: 1.3 }); await Promise.race([p.done, this.r.wait(0.9)]); }
  }

  private async projectile(from: string, to: string, kind: string) {
    const a = this.r.figures.get(from)!, b = this.r.figures.get(to)!;
    const p0 = a.group.position.clone().add(new THREE.Vector3(0, a.headHeight * 0.75, 0));
    const p1 = b.group.position.clone().add(new THREE.Vector3(0, b.headHeight * 0.6, 0));
    const len = kind.includes('javelin') ? 0.7 : kind.includes('dagger') ? 0.25 : 0.42;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.03), new THREE.MeshStandardMaterial({ color: kind.includes('dagger') ? 0xd8dde3 : 0x8a6a40, emissive: 0x332211 }));
    this.r.scene.add(mesh);
    const dist = p0.distanceTo(p1);
    const arc = Math.min(0.9, dist * 0.08);
    const at = (k: number) => p0.clone().lerp(p1, k).add(new THREE.Vector3(0, Math.sin(Math.PI * k) * arc, 0));
    await this.r.tween(Math.min(0.45, 0.12 + dist * 0.04), (k) => {
      const p = at(k), q = at(Math.min(1, k + 0.02));
      mesh.position.copy(p);
      mesh.lookAt(q); mesh.rotateY(Math.PI / 2);
    });
    this.r.scene.remove(mesh); mesh.geometry.dispose();
  }

  // ------------------------------------------------------------ end

  /** The fight is decided: the winners cheer, the HUD clears and the Game takes over. */
  private async finish(winner: 'party' | 'enemy') {
    for (const c of this.combat.creatures) if (c.side === winner && this.combat.isConscious(c)) this.r.figures.get(c.id)?.character.once('Cheer', { speed: 1.1 });
    this.ov.clearPlanning(); this.ov.setReach([]); this.ov.setActive(null);
    this.hud.tooltip(null); this.hud.cursorTag(null);
    this.hud.banner(winner === 'party' ? 'Victory' : 'The party has fallen', winner !== 'party');
    await this.r.wait(1.4);
    this.onEnd(winner);
  }
}

const MASTERY_TEXT: Record<string, string> = {
  sap: 'Sap: on a hit, the target has Disadvantage on its next attack roll.',
  vex: 'Vex: on a hit, you have Advantage on your next attack against that target.',
  slow: 'Slow: on a hit, the target\'s Speed drops by 10 ft until your next turn.',
  nick: 'Nick: the off-hand attack is part of the Attack action instead of a Bonus Action.',
  push: 'Push: on a hit, push the target up to 10 ft away.',
  topple: 'Topple: on a hit, the target makes a CON save or falls Prone.',
  graze: 'Graze: on a miss, you still deal damage equal to your ability modifier.',
  cleave: 'Cleave: on a hit, attack a second creature next to the first.',
};

function formatDmg(a: AttackProfile): string {
  const t = a.damage.terms.map((x) => `${x.count}d${x.sides}`).join('+');
  return a.damage.bonus ? `${t}${a.damage.bonus > 0 ? '+' : ''}${a.damage.bonus}` : t;
}
