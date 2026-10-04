// Game controller: player input → engine commands, engine events → animation,
// and the AI's turns. The engine is authoritative; the view model (vm) mirrors
// it event-by-event so the HUD and figures change exactly when animations do.
import * as THREE from 'three';
import { Combat, RuleError, type AttackPreview, type Command, type GameEvent } from '../engine/combat';
import { TacticalAI } from '../engine/ai';
import { distanceFt, samePos, type Pos } from '../engine/grid';
import type { AttackProfile, Creature } from '../engine/types';
import { PixelRenderer } from '../render/pixel-renderer';
import { Overlays } from '../render/overlays';
import type { Archetype } from '../render/models';
import { Hud, esc, hpBar, type Slot } from '../ui/hud';

type Mode =
  | { kind: 'default' }
  | { kind: 'attack'; attack: string; offhand: boolean }
  | { kind: 'shove'; effect: 'push' | 'prone' }
  | { kind: 'potion' }
  | { kind: 'help' };

interface Approach { dest: Pos; path: Pos[]; cost: number; provokers: Creature[] }
type Plan =
  | { kind: 'move'; approach: Approach }
  | { kind: 'attack'; target: Creature; attack: AttackProfile; offhand: boolean; approach: Approach; preview: AttackPreview }
  | { kind: 'shove'; target: Creature; effect: 'push' | 'prone'; approach: Approach; dc: number }
  | { kind: 'potion'; target: Creature; approach: Approach }
  | { kind: 'help'; target: Creature; approach: Approach }
  | { kind: 'info'; html: string; at: Pos }
  | { kind: 'invalid'; reason: string; at: Pos };

interface VM { hp: number; pos: Pos; conds: Set<string>; dead: boolean }

const CONDITION_ICON: Record<string, string> = { hidden: '👁', prone: '⤵', dodging: '🛡', sapped: '⇩', slowed: '🐌', disengaged: '↯', stable: '✚', vexing: '' };
const CONDITION_NAME: Record<string, string> = { hidden: 'Hidden', prone: 'Prone', dodging: 'Dodging', sapped: 'Sapped', slowed: 'Slowed', disengaged: 'Disengaged', stable: 'Stable', unconscious: 'Unconscious', vexing: 'Vexing' };

export class GameController {
  readonly combat: Combat;
  readonly r: PixelRenderer;
  readonly hud: Hud;
  private ai: TacticalAI;
  private ov: Overlays;
  private vm = new Map<string, VM>();
  private mode: Mode = { kind: 'default' };
  private busy = true;
  private mouse = { x: -1, y: -1, dirty: false };
  private plan: Plan | null = null;
  private portraits: Record<string, string> = {};
  private activeId = '';
  private round = 1;
  private keys = new Set<string>();

  constructor(container: HTMLElement, rows: string[], combat: Combat, private restart: () => void) {
    this.combat = combat;
    this.r = new PixelRenderer(container, rows);
    this.ov = new Overlays(this.r);
    this.ai = new TacticalAI(combat);
    for (const c of combat.creatures) {
      const enemy = combat.enemiesOf(c)[0];
      const facing = enemy ? Math.atan2(enemy.pos.y - c.pos.y, enemy.pos.x - c.pos.x) : 0;
      this.r.addFigure(c.id, (c.model ?? 'goblin') as Archetype, c.side, c.pos.x, c.pos.y, facing);
      this.vm.set(c.id, { hp: c.hp, pos: { ...c.pos }, conds: new Set(), dead: false });
    }
    this.portraits = this.r.renderPortraits();
    this.hud = new Hud((id) => this.portraits[id]);
    this.hud.onSlot = (k) => this.onSlot(k);
    this.hud.onEndTurn = () => this.endTurn();
    this.hud.onPartyClick = (id) => { const v = this.vm.get(id)!; this.r.lookAt(v.pos.x, v.pos.y); };
    this.bindInput();
    this.r.onUpdate((dt) => this.tick(dt));
    const party = combat.creatures.filter((c) => c.side === 'party');
    const cx = party.reduce((s, c) => s + c.pos.x, 0) / party.length, cy = party.reduce((s, c) => s + c.pos.y, 0) / party.length;
    this.r.lookAt(cx + 2, cy - 2, true);
    this.r.start();
    this.refreshHud();
  }

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
      if (this.combat.over) { this.busy = true; this.refreshHud(); this.showEnd(this.combat.over); return; }
      const a = this.combat.active!;
      if (a.controller === 'ai') {
        this.busy = true;
        this.refreshHud();
        await this.r.wait(0.35);
        const events = this.ai.takeTurn(a.id);
        await this.play(events);
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
    let events: GameEvent[];
    try { events = this.combat.execute(cmd); }
    catch (e) {
      if (!(e instanceof RuleError)) throw e;
      const a = this.combat.active!;
      const p = this.r.projectHead(a.id);
      this.hud.float(p.x, p.y, e.message, 'miss');
      this.busy = false; this.refreshHud(); return false;
    }
    await this.play(events);
    this.busy = false;
    if (cmd.type === 'endTurn' || this.combat.over || !this.isPlayerTurn() || this.combat.active!.id !== cmd.actor) await this.continueFlow();
    else { this.refreshHud(); this.mouse.dirty = true; }
    return true;
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
    const tip = this.planTooltip(plan);
    if (tip) this.hud.tooltip(tip, this.mouse.x, this.mouse.y);
    if (plan.kind === 'move') {
      const end = this.r.project(this.r.worldOf(plan.approach.dest.x, plan.approach.dest.y));
      const w = plan.approach.provokers.length;
      this.hud.cursorTag(`${plan.approach.cost} ft${w ? ` · ⚠ ${w} opportunity attack${w > 1 ? 's' : ''}` : ''}`, end.x, end.y, w > 0);
    }
    if (plan.kind === 'invalid') this.hud.cursorTag(plan.reason, this.mouse.x, this.mouse.y - 10, true);
    this.refreshHotbar(ap?.cost);
    this.r.renderer.domElement.style.cursor = plan.kind === 'attack' || plan.kind === 'shove' ? 'crosshair' : plan.kind === 'invalid' ? 'not-allowed' : 'pointer';
  }

  // ------------------------------------------------------------ input

  private bindInput() {
    const cv = this.r.renderer.domElement;
    cv.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.dirty = true; });
    cv.addEventListener('mouseleave', () => { this.mouse.x = -1; this.ov.clearPlanning(); this.hud.tooltip(null); this.hud.cursorTag(null); });
    cv.addEventListener('click', () => {
      if (this.busy || !this.isPlayerTurn()) return;
      this.updateHover();
      const p = this.plan;
      if (!p) return;
      if (p.kind === 'move') this.execPlan(p);
      else if (p.kind === 'attack' || p.kind === 'shove' || p.kind === 'potion' || p.kind === 'help') this.execPlan(p);
    });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cancelMode(); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.r.setZoom(this.r.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12)); this.mouse.dirty = true; }, { passive: false });
    // drag with the middle or right mouse button to pan
    let drag: { x: number; y: number } | null = null;
    cv.addEventListener('mousedown', (e) => { if (e.button === 1 || e.button === 2) drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('mouseup', () => { drag = null; });
    addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
      const s = (this.r.zoom * 2) / innerHeight;
      // screen right = world (+1, 0, -1)/√2, screen down ≈ world (+1, 0, +1)
      this.r.pan((-dx * s) / Math.SQRT2 - (dy * s) / Math.SQRT2 * 1.4, (dx * s) / Math.SQRT2 - (dy * s) / Math.SQRT2 * 1.4);
    });
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') this.cancelMode();
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.endTurn(); }
      const n = '1234567890'.indexOf(e.key);
      if (n >= 0) { const slots = this.slots(); if (slots[n] && slots[n].enabled) this.onSlot(slots[n].key); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  private cancelMode() { this.mode = { kind: 'default' }; this.refreshHotbar(); this.mouse.dirty = true; }

  private tick(dt: number) {
    // keyboard panning (screen-relative)
    const k = this.keys; let sx = 0, sy = 0;
    if (k.has('a') || k.has('arrowleft')) sx -= 1; if (k.has('d') || k.has('arrowright')) sx += 1;
    if (k.has('w') || k.has('arrowup')) sy -= 1; if (k.has('s') || k.has('arrowdown')) sy += 1;
    if (sx || sy) { const sp = dt * 8; this.r.pan((sx + sy) * sp * 0.7, (-sx + sy) * sp * 0.7); this.mouse.dirty = true; }
    if (this.mouse.dirty && this.mouse.x >= 0) this.updateHover();
    // nameplates follow their figures
    for (const c of this.combat.creatures) {
      const v = this.vm.get(c.id)!;
      const fig = this.r.figures.get(c.id)!;
      const hiddenEnemy = c.side === 'enemy' && v.conds.has('hidden');
      const p = this.r.projectHead(c.id, 0.18);
      const icons = [...v.conds].map((x) => CONDITION_ICON[x] ?? '').join('');
      this.hud.plate(c.id, c.side, p.x, p.y, v.hp / c.maxHp, icons, !v.dead && !hiddenEnemy && fig.group.visible);
    }
  }

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
    if (c.cond(a, 'prone'))
      out.unshift({ key: 'stand', icon: 'stand', label: 'Stand Up', cost: 'free', enabled: a.turn.movement >= Math.ceil(c.speedOf(a) / 2), selected: false, tip: '<div class="tname">Stand Up</div><div class="tip-note">Costs half your Speed.</div>' });
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
    this.hud.renderHotbar({
      id: a.id, name: a.name, title: a.description ?? '', hp: v.hp, maxHp: a.maxHp, ac: a.ac, side: a.side,
      actions: a.turn.actions, bonus: a.turn.bonusActions, reaction: a.turn.reaction, movement: a.turn.movement, speed: this.combat.speedOf(a),
      previewMove, slots: this.slots(), waiting: this.busy,
    });
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
        r.lookAt(v.pos.x, v.pos.y);
        this.ov.setActive(v.pos);
        this.refreshHud();
        if (c.side === 'party') { this.hud.banner(`${c.name}'s Turn`); await r.wait(0.5); }
        else if (!v.conds.has('hidden')) await r.wait(0.15);
        return;
      }
      case 'move': {
        const v = this.vm.get(e.id)!;
        const hiddenEnemy = this.combat.get(e.id).side === 'enemy' && v.conds.has('hidden');
        for (let i = 1; i < e.path.length; i++) {
          const a = e.path[i - 1], b = e.path[i];
          const fig = r.figures.get(e.id)!.group;
          const y0 = r.floorY(a.x, a.y), y1 = r.floorY(b.x, b.y);
          r.face(e.id, b.x, b.y);
          const climb = Math.abs(y1 - y0) > 0.4;
          await r.tween(hiddenEnemy ? 0.05 : climb ? 0.3 : 0.17, (k) => {
            fig.position.x = a.x + (b.x - a.x) * k;
            fig.position.z = a.y + (b.y - a.y) * k;
            fig.position.y = y0 + (y1 - y0) * k + Math.sin(Math.PI * k) * (climb ? 0.35 : 0.07);
          });
          v.pos = { ...b };
          if (!hiddenEnemy) r.lookAt(b.x, b.y);
        }
        return;
      }
      case 'attack': {
        const atk = this.combat.get(e.attacker).attacks.find((x) => x.id === e.attack)!;
        const tv = this.vm.get(e.target)!;
        // a hidden attacker is revealed by attacking
        r.face(e.attacker, tv.pos.x, tv.pos.y);
        const roll = this.head(e.attacker, 0.45);
        const modeTxt = e.mode === 'advantage' ? ' ▲' : e.mode === 'disadvantage' ? ' ▼' : '';
        this.hud.float(roll.x, roll.y, `${e.opportunity ? 'Opportunity! ' : ''}d20 ${e.natural} → ${e.total}${modeTxt}`, 'roll');
        if (atk.kind === 'ranged') await this.projectile(e.attacker, e.target, atk.id);
        else await this.lunge(e.attacker, tv.pos);
        const hp = this.head(e.target);
        if (!e.hit) { this.hud.float(hp.x, hp.y, 'Miss', 'miss'); await this.dodge(e.target, e.attacker); }
        else if (e.crit) this.hud.float(hp.x, hp.y - 26, 'Critical!', 'crit');
        return;
      }
      case 'damage': {
        const v = this.vm.get(e.target)!;
        v.hp = e.hp;
        r.flash(e.target);
        const p = this.head(e.target);
        this.hud.float(p.x, p.y, `−${e.amount}`, 'dmg');
        await this.shake(e.target);
        this.refreshHud();
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
        if (e.condition === 'prone' || e.condition === 'unconscious') await this.setLying(e.target, v.conds.has('prone') || v.conds.has('unconscious'));
        if (e.added && (e.condition === 'sapped' || e.condition === 'slowed')) { const p = this.head(e.target, 0.1); this.hud.float(p.x, p.y + 18, CONDITION_NAME[e.condition], 'info'); }
        this.refreshHud();
        return;
      }
      case 'down': { const p = this.head(e.id); this.hud.float(p.x, p.y - 20, 'Down!', 'crit'); await r.wait(0.3); return; }
      case 'death': {
        const v = this.vm.get(e.id)!; v.dead = true; v.conds.clear();
        await this.setLying(e.id, true);
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
      case 'deathSave': {
        const p = this.head(e.target, 0.2);
        this.hud.float(p.x, p.y, `Death save: ${e.natural}  (${e.success}✓ ${e.fail}✗)`, e.natural >= 10 ? 'roll' : 'dmg');
        this.refreshHud(); await r.wait(0.8); return;
      }
      default: return;
    }
  }

  private slide(id: string, from: Pos, to: Pos, dur: number) {
    const g = this.r.figures.get(id)!.group;
    const y0 = this.r.floorY(from.x, from.y), y1 = this.r.floorY(to.x, to.y);
    return this.r.tween(dur, (k) => { const s = k * k * (3 - 2 * k); g.position.set(from.x + (to.x - from.x) * s, y0 + (y1 - y0) * s, from.y + (to.y - from.y) * s); });
  }

  private async lunge(id: string, toward: Pos) {
    const g = this.r.figures.get(id)!.group;
    const start = g.position.clone();
    const dir = new THREE.Vector3(toward.x - start.x, 0, toward.y - start.z).normalize().multiplyScalar(0.32);
    await this.r.tween(0.1, (k) => g.position.copy(start).addScaledVector(dir, k));
    await this.r.tween(0.16, (k) => g.position.copy(start).addScaledVector(dir, 1 - k));
  }

  private async dodge(id: string, from: string) {
    const g = this.r.figures.get(id)!.group, a = this.r.figures.get(from)!.group;
    const start = g.position.clone();
    const away = start.clone().sub(a.position).setY(0).normalize();
    const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(0.14);
    await this.r.tween(0.18, (k) => g.position.copy(start).addScaledVector(side, Math.sin(Math.PI * k)));
  }

  private async shake(id: string) {
    const g = this.r.figures.get(id)!.group;
    const start = g.position.clone();
    await this.r.tween(0.2, (k) => { g.position.x = start.x + Math.sin(k * 40) * 0.05 * (1 - k); });
    g.position.copy(start);
  }

  private async setLying(id: string, lying: boolean) {
    const f = this.r.figures.get(id)!;
    if (f.down === lying) return;
    f.down = lying;
    const from = f.fig.rotation.z, to = lying ? Math.PI / 2 * 0.92 : 0;
    await this.r.tween(0.3, (k) => { f.fig.rotation.z = from + (to - from) * k; f.fig.position.y = 0.06 + (lying ? k : 1 - k) * 0.05; });
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

  private showEnd(winner: 'party' | 'enemy') {
    const party = this.combat.creatures.filter((c) => c.side === 'party');
    const standing = party.filter((c) => this.combat.isConscious(c)).map((c) => c.name);
    const rounds = this.round;
    const html = winner === 'party'
      ? `<h2>Victory</h2><h1>The Den is Cleared</h1><p>Grukk's war band lies broken after ${rounds} round${rounds > 1 ? 's' : ''}. ${standing.length === party.length ? 'Both heroes are still standing.' : `${standing.join(' and ')} stands among the bodies.`}</p>`
      : `<h2>Defeat</h2><h1>The Goblins Feast</h1><p>Torvald and Nyx fall in the goblin den after ${rounds} round${rounds > 1 ? 's' : ''}. Grukk will be telling this story for years.</p>`;
    setTimeout(() => this.hud.modal(html, [{ label: 'Play Again', onClick: () => this.restart() }]), 900);
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
