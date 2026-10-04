// The game: one stage (renderer, HUD, overlays, effects) for the whole campaign. Out of
// combat it runs exploration on the current floor: walk the party, open doors, read notes,
// take the stairs. Stepping onto an enemy group's ground starts a fight, which runs in a
// CombatView on the same stage; when it's over the results go back into the World and
// exploration resumes. Phase 2 replaces the trigger areas with sight lines and Surprise.
import type { Combat } from '../engine/combat';
import { distanceFt, posKey, type Pos } from '../engine/grid';
import { PixelRenderer } from '../render/pixel-renderer';
import { Overlays } from '../render/overlays';
import { Effects } from '../render/effects';
import type { Archetype } from '../render/models';
import { Hud, esc, type Slot } from '../ui/hud';
import { World, monsterDef, type HeroState } from '../world/world';
import { inRect, type GroupDef } from '../world/map';
import { CombatView, CONDITION_ICON, type Stage } from './controller';

export interface GameHooks {
  /** Persist a save (the JSON from World.serialize). */
  save(json: string): void;
  /** Back to the title / last save after a defeat. */
  loadLast(): void;
  newGame(): void;
}

/** What a click in exploration would do. */
type Intent =
  | { kind: 'walk'; path: Pos[]; danger?: GroupDef }
  | { kind: 'door'; at: Pos; open: boolean; via?: Pos[] }
  | { kind: 'stairs'; id: string; label: string; path: Pos[] }
  | { kind: 'note'; id: string; title: string; text: string; via?: Pos[] }
  | { kind: 'info'; html: string }
  | { kind: 'invalid'; reason: string };

export class Game {
  readonly r: PixelRenderer;
  readonly hud: Hud;
  readonly world: World;
  private stage: Stage;
  /** The fight in progress, if any. */
  view?: CombatView;
  private selected = '';
  private walking = false;
  private keys = new Set<string>();
  private intent: Intent | null = null;
  /** Groups lying still until disturbed (their figures play dead). */
  private dormant = new Set<string>();

  static async create(container: HTMLElement, world: World, hooks: GameHooks, onProgress?: (done: number, total: number) => void) {
    const r = await PixelRenderer.create(container, world.map.rows, onProgress);
    return new Game(r, world, hooks);
  }

  private constructor(r: PixelRenderer, world: World, private hooks: GameHooks) {
    this.r = r;
    this.world = world;
    const portraits: Record<string, string> = {};
    this.hud = new Hud((id) => portraits[id]);
    this.stage = { r, hud: this.hud, ov: new Overlays(r), fx: new Effects(r), vm: new Map(), portraits, mouse: { x: -1, y: -1, dirty: false } };
    this.selected = world.living()[0]?.id ?? '';
    this.populate();
    this.hud.onSlot = (k) => (this.view ? this.view.handleSlot(k) : this.exploreSlot(k));
    this.hud.onEndTurn = () => this.view?.handleEndTurn();
    this.hud.onPartyClick = (id) => (this.view ? this.view.handlePartyClick(id) : this.select(id));
    this.bindInput();
    r.onUpdate((dt) => this.tick(dt));
    r.start();
    this.refreshExplore();
  }

  // ------------------------------------------------------------ debug / tool handles

  get combat(): Combat | undefined { return this.view?.combat; }
  get busy(): boolean { return this.walking || (this.view ? (this.view as unknown as { busy: boolean }).busy : false); }

  // ------------------------------------------------------------ the floor's figures

  /** Put the party and this floor's waiting monsters on the stage. */
  private populate() {
    const { r, vm } = this.stage;
    vm.clear();
    this.dormant.clear();
    for (const h of this.world.state.party) {
      const def = this.world.heroDef(h);
      r.addFigure(h.id, def.model as Archetype, 'party', h.pos.x, h.pos.y, -Math.PI / 4);
      vm.set(h.id, { name: def.name, side: 'party', hp: h.hp, maxHp: h.maxHp, pos: { ...h.pos }, conds: new Set(h.conditions.map((k) => k.id)), dead: h.dead });
      if (h.dead) { const f = r.figures.get(h.id)!; f.down = true; f.character.once('Death_A', { hold: true, speed: 50 }); f.ring.visible = false; }
    }
    for (const g of this.world.groups()) {
      if (g.dormant) this.dormant.add(g.id);
      const cx = g.trigger.x + g.trigger.w / 2, cy = g.trigger.y + g.trigger.h / 2;
      for (const m of g.members) {
        const def = monsterDef(m);
        r.addFigure(m.id, def.model as Archetype, 'enemy', m.at.x, m.at.y, Math.atan2(cy - m.at.y, cx - m.at.x) + Math.PI);
        vm.set(m.id, { name: def.name, side: 'enemy', hp: def.maxHp, maxHp: def.maxHp, pos: { ...m.at }, conds: new Set(), dead: false });
        if (g.dormant) {
          const f = r.figures.get(m.id)!;
          f.ring.visible = false;
          f.character.once(f.character.has('Skeletons_Inactive_Floor_Pose') ? 'Skeletons_Inactive_Floor_Pose' : 'Lie_Down', { hold: true, speed: 50 });
        }
      }
    }
    for (const d of this.world.floor.open) {
      const [x, y] = d.replace('door@', '').split(',').map(Number);
      r.setDoorOpen(x, y, true, true);
    }
    Object.assign(this.stage.portraits, r.renderPortraits());
    // (portrait rendering shows every ring again) the dead and the dormant have none
    for (const [id, v] of vm) {
      const g = this.groupOf(id);
      if (v.dead || (g && this.dormant.has(g.id))) r.figures.get(id)!.ring.visible = false;
    }
    const party = this.world.living();
    const lead = party.find((h) => h.id === this.selected) ?? party[0];
    if (lead) r.lookAt(lead.pos.x, lead.pos.y, true);
  }

  // ------------------------------------------------------------ input

  private bindInput() {
    const cv = this.r.renderer.domElement;
    const mouse = this.stage.mouse;
    cv.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.dirty = true; });
    cv.addEventListener('mouseleave', () => { mouse.x = -1; this.view?.handleLeave(); this.clearHover(); });
    cv.addEventListener('click', () => { if (this.view) this.view.handleClick(); else this.exploreClick(); });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.view?.handleCancel(); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.r.setZoom(this.r.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12)); mouse.dirty = true; }, { passive: false });
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
      if (e.target instanceof HTMLInputElement || document.querySelector('.modal-back')) return;
      this.keys.add(e.key.toLowerCase());
      if (this.view) { this.view.handleKey(e); return; }
      if (e.key === 'Tab') { e.preventDefault(); this.cycleSelected(e.shiftKey ? -1 : 1); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  private tick(dt: number) {
    const { r, hud, vm, mouse } = this.stage;
    // keyboard panning (screen-relative)
    const k = this.keys; let sx = 0, sy = 0;
    if (k.has('a') || k.has('arrowleft')) sx -= 1; if (k.has('d') || k.has('arrowright')) sx += 1;
    if (k.has('w') || k.has('arrowup')) sy -= 1; if (k.has('s') || k.has('arrowdown')) sy += 1;
    if (sx || sy) { const sp = dt * 8; r.pan((sx + sy) * sp * 0.7, (-sx + sy) * sp * 0.7); mouse.dirty = true; }
    if (this.view) this.view.update();
    else if (mouse.dirty && mouse.x >= 0) this.exploreHover();
    // nameplates follow their figures
    for (const [id, v] of vm) {
      const fig = r.figures.get(id);
      if (!fig) continue;
      const hiddenEnemy = v.side === 'enemy' && v.conds.has('hidden');
      const sleeping = [...this.dormant].some((g) => this.groupOf(id)?.id === g);
      const p = r.projectHead(id, 0.18);
      let icons = [...v.conds].map((x) => CONDITION_ICON[x] ?? '').join('');
      if (v.conds.has('unconscious') && v.hp > 0) icons = `Zz${icons}`;
      hud.plate(id, v.side, p.x, p.y, v.hp / v.maxHp, icons, !v.dead && !hiddenEnemy && !sleeping && fig.group.visible);
    }
  }

  private groupOf(creatureId: string): GroupDef | undefined { return this.world.map.groups.find((g) => g.members.some((m) => m.id === creatureId)); }

  // ------------------------------------------------------------ exploration: HUD

  private select(id: string) {
    const h = this.world.state.party.find((x) => x.id === id);
    if (!h || h.dead) return;
    this.selected = id;
    this.r.lookAt(h.pos.x, h.pos.y);
    this.refreshExplore();
  }

  private cycleSelected(step: number) {
    const living = this.world.living();
    const i = living.findIndex((h) => h.id === this.selected);
    if (living.length) this.select(living[(i + step + living.length) % living.length].id);
  }

  private refreshExplore() {
    if (this.view) return;
    const { hud, vm, ov } = this.stage;
    hud.setInitiativeVisible(false);
    hud.renderParty(this.world.state.party.map((h) => {
      const v = vm.get(h.id)!;
      const def = this.world.heroDef(h);
      const slots = h.slotsLeft.map((n, l) => (l > 0 && def.spellcasting?.slots[l] ? `${n}/${def.spellcasting.slots[l]}` : '')).filter(Boolean).join(' · ');
      return { id: h.id, name: def.name, hp: v.hp, maxHp: v.maxHp, status: h.dead ? 'Dead' : slots ? `Spell slots ${slots}` : def.description ?? '', active: h.id === this.selected, dead: h.dead, side: 'party' };
    }));
    const h = this.world.state.party.find((x) => x.id === this.selected);
    if (h) {
      const def = this.world.heroDef(h);
      const save: Slot = { key: 'save', icon: 'save', label: 'Save', cost: 'free', enabled: !this.walking, selected: false, tip: '<div class="tname">Save the game</div><div class="tip-note">The game also saves when you change floors and after every fight.</div>' };
      hud.renderHotbar({
        id: h.id, name: def.name, title: def.description ?? '', hp: h.hp, maxHp: h.maxHp, ac: def.ac, side: 'party',
        actions: 0, bonus: 0, reaction: true, movement: 0, speed: def.speed, slots: [save], waiting: this.walking,
        explore: { hint: `<b>${esc(this.world.map.name)}.</b> Click to walk; the party follows. <b>Tab</b> or a portrait picks who leads. Click doors, notes and stairs to use them.` },
      });
    }
    ov.setReach([]);
    ov.setActive(h && !h.dead ? h.pos : null);
    const marks: Parameters<Overlays['setMarkers']>[0] = [];
    for (const n of this.world.map.notes ?? []) if (!this.world.floor.read.includes(n.id)) marks.push({ at: n.at, kind: 'note' });
    for (const s of this.world.map.stairs ?? []) marks.push({ at: s.at, kind: 'stairs' });
    ov.setMarkers(marks);
  }

  private exploreSlot(key: string) {
    if (key === 'save') { this.saveGame(); this.hud.banner('Game saved'); }
  }

  private saveGame() { this.world.state.saves++; this.hooks.save(this.world.serialize()); }

  private clearHover() { this.stage.ov.clearPlanning(); this.hud.tooltip(null); this.hud.cursorTag(null); }

  // ------------------------------------------------------------ exploration: intents

  private heroPos(): Pos | undefined { return this.world.state.party.find((h) => h.id === this.selected && !h.dead)?.pos; }

  /** A path for the leader to a square next to `p` (or onto it when it's walkable). */
  private pathNextTo(p: Pos): Pos[] | undefined {
    const from = this.heroPos();
    if (!from) return undefined;
    if (distanceFt(from, p) <= 5) return [from];
    let best: Pos[] | undefined;
    for (const n of this.world.grid.neighbours(p)) {
      const path = this.world.pathTo(this.selected, n);
      if (path && (!best || path.length < best.length)) best = path;
    }
    return best;
  }

  private intentAt(tile: Pos | undefined, creatureId: string | undefined): Intent | null {
    const w = this.world;
    if (creatureId) {
      const v = this.stage.vm.get(creatureId);
      if (v?.side === 'enemy' && !this.dormant.has(this.groupOf(creatureId)?.id ?? '')) {
        const g = this.groupOf(creatureId);
        return { kind: 'info', html: `<div class="tip-head"><span class="tname enemy">${esc(v.name)}</span><span class="tsub">${esc(g?.name ?? '')}</span></div><div class="tip-note">Walk into their room to fight them.</div>` };
      }
      if (v?.side === 'party') return { kind: 'info', html: `<div class="tname ally">${esc(v.name)}</div><div class="tip-note">Click the portrait (or Tab) to lead with this hero.</div>` };
    }
    if (!tile) return null;
    const door = w.doorAt(tile);
    if (door) {
      if (door.locked && !door.open) return { kind: 'invalid', reason: 'Locked' };
      const via = this.pathNextTo(tile);
      if (!via) return { kind: 'invalid', reason: "Can't get to the door" };
      return { kind: 'door', at: tile, open: !door.open, via };
    }
    const note = w.noteAt(tile);
    if (note) {
      const via = this.pathNextTo(tile);
      return via ? { kind: 'note', id: note.id, title: note.title, text: note.text, via } : { kind: 'invalid', reason: "Can't get there" };
    }
    const stairs = w.stairsAt(tile);
    const path = w.pathTo(this.selected, tile);
    if (stairs) return path ? { kind: 'stairs', id: stairs.id, label: stairs.label, path } : { kind: 'invalid', reason: "Can't get there" };
    if (!path) return { kind: 'invalid', reason: w.grid.cell(tile.x, tile.y)?.blocksMove ? 'Blocked' : "Can't get there" };
    if (path.length < 2) return null;
    const danger = w.groups().find((g) => path.some((p) => inRect(g.trigger, p)));
    return { kind: 'walk', path, danger };
  }

  private exploreHover() {
    const { ov, mouse, hud } = this.stage;
    mouse.dirty = false;
    this.clearHover();
    if (this.walking || document.querySelector('.modal-back')) return;
    const pick = this.r.pick(mouse.x, mouse.y);
    const it = this.intentAt(pick.tile, pick.creatureId);
    this.intent = it;
    if (!it) return;
    const tag = (text: string, warn = false) => hud.cursorTag(text, mouse.x, mouse.y - 10, warn);
    switch (it.kind) {
      case 'walk': {
        ov.setPath(it.path, !!it.danger);
        const end = it.path[it.path.length - 1];
        ov.setHover(end);
        const ft = (it.path.length - 1) * 5;
        tag(it.danger ? `⚔ ${ft} ft · into ${it.danger.name}` : `${ft} ft`, !!it.danger);
        break;
      }
      case 'door': if (it.via && it.via.length > 1) ov.setPath(it.via); ov.setHover(it.at); tag(it.open ? 'Open the door' : 'Close the door'); break;
      case 'stairs': ov.setPath(it.path); ov.setHover(it.path[it.path.length - 1]); tag(it.label); break;
      case 'note': if (it.via && it.via.length > 1) ov.setPath(it.via); tag(`Read: ${it.title}`); break;
      case 'info': hud.tooltip(it.html, mouse.x, mouse.y); break;
      case 'invalid': tag(it.reason, true); break;
    }
    this.r.renderer.domElement.style.cursor = it.kind === 'invalid' ? 'not-allowed' : 'pointer';
  }

  private async exploreClick() {
    if (this.walking || this.view) return;
    this.exploreHover();
    const it = this.intent;
    if (!it) return;
    this.clearHover();
    switch (it.kind) {
      case 'walk': await this.walkParty(it.path); break;
      case 'door': {
        if (it.via && it.via.length > 1 && !(await this.walkParty(it.via))) return;
        if (this.world.setDoor(it.at, it.open)) { await this.r.setDoorOpen(it.at.x, it.at.y, it.open); this.refreshExplore(); }
        else this.hud.banner(it.open ? "It won't open" : "Something's in the way");
        break;
      }
      case 'note': {
        if (it.via && it.via.length > 1 && !(await this.walkParty(it.via))) return;
        this.world.markRead(it.id);
        this.refreshExplore();
        this.hud.modal(`<h2>${esc(this.world.map.name)}</h2><h1>${esc(it.title)}</h1><p>${esc(it.text)}</p>`, [{ label: 'Close', onClick: () => {} }]);
        break;
      }
      case 'stairs': {
        if (!(await this.walkParty(it.path))) return;
        this.hud.modal(`<h2>Stairs</h2><h1>${esc(it.label)}</h1><p>The whole party goes together.</p>`, [
          { label: 'Go', onClick: () => this.travel(it.id) }, { label: 'Stay', secondary: true, onClick: () => {} },
        ]);
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------ exploration: moving

  /**
   * Walk the leader along `path` with the rest of the party following to free squares
   * around the destination. Everyone steps together; if anyone sets foot on a group's
   * ground the walk stops there and the fight begins. Returns false if a fight started.
   */
  private async walkParty(path: Pos[]): Promise<boolean> {
    const w = this.world, { r, vm } = this.stage;
    const leader = w.state.party.find((h) => h.id === this.selected)!;
    const dest = path[path.length - 1];
    // claim squares: the leader's destination first, then the nearest free ones for the others
    const followers = w.living().filter((h) => h.id !== leader.id);
    const plans = new Map<string, Pos[]>([[leader.id, path]]);
    const claimed = new Set([posKey(dest)]);
    const spots = w.freeAround(dest, followers.length + 6).filter((p) => !claimed.has(posKey(p)));
    const origin = new Map(w.living().map((h) => [h.id, { ...h.pos }]));
    w.setPos(leader.id, dest);
    for (const f of followers.sort((a, b) => distanceFt(a.pos, dest) - distanceFt(b.pos, dest))) {
      const spot = spots.filter((p) => !claimed.has(posKey(p))).sort((a, b) => distanceFt(a, f.pos) - distanceFt(b, f.pos))[0];
      const fp = spot && w.pathTo(f.id, spot);
      if (fp) { plans.set(f.id, fp); claimed.add(posKey(spot)); w.setPos(f.id, spot); }
    }
    // walk it out in lock-step, checking each square for an ambush
    this.walking = true;
    this.refreshExplore();
    const steps = Math.max(...[...plans.values()].map((p) => p.length));
    for (const [id] of plans) { const ch = r.figures.get(id)!.character; ch.loop(ch.spec.walk ?? 'Running_A', 0.15); }
    const at = new Map(origin);
    let fight: GroupDef | undefined;
    for (let i = 1; i < steps && !fight; i++) {
      const moves: Promise<void>[] = [];
      for (const [id, p] of plans) {
        if (i >= p.length) continue;
        moves.push(this.stepFigure(id, p[i - 1], p[i]));
        at.set(id, p[i]);
      }
      await Promise.all(moves);
      for (const [id, p] of at) { vm.get(id)!.pos = { ...p }; fight ??= w.triggeredBy(p); }
      const lead = at.get(leader.id)!;
      r.ensureVisible(lead.x, lead.y, 0.5);
    }
    for (const [id] of plans) { const ch = r.figures.get(id)!.character; ch.loop(ch.spec.idle ?? 'Idle', 0.2); }
    if (fight) {
      // stop where everyone is now; two heroes passing through the same square: the later one takes the nearest free one
      const taken = new Set<string>();
      for (const h of w.living()) w.setPos(h.id, { x: -99, y: -99 }); // nobody blocks while we re-place
      for (const [id, p] of at) {
        let q = p;
        if (taken.has(posKey(q))) { q = w.freeAround(p, 12).find((c) => !taken.has(posKey(c))) ?? p; this.placeFigure(id, q); }
        taken.add(posKey(q)); w.setPos(id, q); vm.get(id)!.pos = { ...q };
      }
    }
    this.walking = false;
    this.refreshExplore();
    if (fight) { await this.startFight(fight); return false; }
    return true;
  }

  private stepFigure(id: string, a: Pos, b: Pos): Promise<void> {
    const r = this.r;
    const fig = r.figures.get(id)!.group;
    const y0 = r.floorY(a.x, a.y), y1 = r.floorY(b.x, b.y);
    r.face(id, b.x, b.y);
    const climb = Math.abs(y1 - y0) > 0.4, diag = a.x !== b.x && a.y !== b.y;
    return r.tween(climb ? 0.34 : diag ? 0.27 : 0.21, (k) => {
      fig.position.x = a.x + (b.x - a.x) * k;
      fig.position.z = a.y + (b.y - a.y) * k;
      fig.position.y = y0 + (y1 - y0) * k + (climb ? Math.sin(Math.PI * k) * 0.3 : 0);
    });
  }

  private placeFigure(id: string, p: Pos) { const g = this.r.figures.get(id)!.group; g.position.set(p.x, this.r.floorY(p.x, p.y), p.y); }

  private async travel(stairsId: string) {
    this.world.travel(stairsId);
    this.clearHover();
    this.r.loadMap(this.world.map.rows);
    this.populate();
    this.saveGame();
    this.refreshExplore();
    this.hud.banner(this.world.map.name);
    // arriving on a group's ground starts the fight at once
    const g = this.world.living().map((h) => this.world.triggeredBy(h.pos)).find(Boolean);
    if (g) await this.startFight(g);
  }

  /** Fights already underway when the game loads (a save made mid-room, or the dev den). */
  async checkAmbush() {
    const g = this.world.living().map((h) => this.world.triggeredBy(h.pos)).find(Boolean);
    if (g) await this.startFight(g);
  }

  // ------------------------------------------------------------ fights

  private async startFight(group: GroupDef) {
    const { r } = this.stage;
    this.clearHover();
    this.stage.ov.setMarkers([]);
    if (this.dormant.has(group.id)) {
      // the dead rise
      this.dormant.delete(group.id);
      const rising = group.members.map((m) => {
        const f = r.figures.get(m.id)!;
        f.ring.visible = true;
        const anim = f.character.has('Skeletons_Awaken_Floor') ? 'Skeletons_Awaken_Floor' : 'Lie_StandUp';
        return f.character.once(anim, { speed: 1.3 }).done;
      });
      this.hud.banner(group.name, true);
      await Promise.race([Promise.all(rising), r.wait(2.2)]);
    } else this.hud.banner(group.name, true);
    const combat = this.world.beginCombat(group.id);
    this.hud.setInitiativeVisible(true);
    this.view = new CombatView(this.stage, combat, (winner) => this.endFight(group, combat, winner));
    await this.view.begin();
  }

  private endFight(group: GroupDef, combat: Combat, winner: 'party' | 'enemy') {
    const { r, vm } = this.stage;
    this.view = undefined;
    const result = this.world.finishCombat(combat, group.id);
    if (result === 'defeat') {
      this.hud.modal('<h2>Defeat</h2><h1>The Abbey Claims Them</h1><p>The party has fallen. The dead do not stay quiet for long, and soon there will be four more of them.</p>',
        [{ label: 'Load last save', onClick: () => this.hooks.loadLast() }, { label: 'New game', secondary: true, onClick: () => this.hooks.newGame() }]);
      return;
    }
    // heroes: carried results; the fallen-but-alive get back up
    for (const h of this.world.state.party) this.syncHero(h);
    // anything of the group still breathing (asleep, at 1 HP) is finished off
    for (const m of group.members) {
      const v = vm.get(m.id);
      if (v && !v.dead) { v.dead = true; const f = r.figures.get(m.id)!; f.ring.visible = false; f.down = true; f.character.once('Death_A', { hold: true }); }
    }
    if (this.world.state.party.find((h) => h.id === this.selected)?.dead) this.selected = this.world.living()[0]?.id ?? '';
    void winner;
    this.saveGame();
    this.refreshExplore();
    this.stage.mouse.dirty = true;
  }

  private syncHero(h: HeroState) {
    const { r, vm } = this.stage;
    const v = vm.get(h.id)!;
    v.hp = h.hp; v.maxHp = h.maxHp; v.pos = { ...h.pos }; v.conds = new Set(h.conditions.map((k) => k.id)); v.dead = h.dead;
    const f = r.figures.get(h.id)!;
    if (!h.dead && f.down) { f.down = false; f.character.once('Lie_StandUp', { speed: 1.3 }); }
  }
}
