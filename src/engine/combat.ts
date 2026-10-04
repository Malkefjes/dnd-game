// The combat state machine. Pure logic: no rendering, no timers. Every command
// returns the events it produced so a renderer can animate them in order.
import { Rng, rollD20, rollDice, resolveAdvantage, hitChanceWithDie, averageDice, parseDice, formatDice, type Advantage, type DiceExpr } from './dice';
import { Grid, distanceFt, samePos, posKey, computeCover, COVER_AC, coverAtLeast, type Pos, type Cover } from './grid';
import { abilityMod, SIZE_RANK, SKILL_ABILITY, type Ability, type AttackProfile, type Condition, type ConditionId, type Creature, type CreatureDef, type Skill, type Summon, type TurnState } from './types';
import { castSpell, attackWithSummon, endConcentration, canCastShield, castShield, spellAttackRider, sleepEndOfTurn } from './spells';

// ---------------------------------------------------------------- events

export type GameEvent =
  | { type: 'log'; text: string; tone?: 'info' | 'good' | 'bad' | 'turn' }
  | { type: 'initiative'; order: { id: string; total: number }[] }
  | { type: 'turnStart'; id: string; round: number }
  | { type: 'move'; id: string; path: Pos[]; cost: number }
  | { type: 'attack'; attacker: string; target: string; attack: string; d20: number[]; natural: number; total: number; ac: number; hit: boolean; crit: boolean; mode: Advantage; cover: Cover; opportunity?: boolean; spell?: string; summon?: string }
  | { type: 'damage'; target: string; amount: number; damageType: string; hp: number; parts: string[] }
  | { type: 'heal'; target: string; amount: number; hp: number }
  | { type: 'condition'; target: string; condition: ConditionId; added: boolean }
  | { type: 'save'; target: string; ability: Ability; natural: number; total: number; dc: number; success: boolean }
  | { type: 'check'; actor: string; skill: Skill; natural: number; total: number; dc?: number; success?: boolean }
  | { type: 'deathSave'; target: string; natural: number; success: number; fail: number }
  | { type: 'swap'; a: string; b: string }
  | { type: 'push'; target: string; from: Pos; to: Pos }
  | { type: 'down'; id: string }
  | { type: 'death'; id: string }
  | { type: 'resource'; id: string; resource: string; left: number }
  /** A non-attack action was taken (for flavour animation). */
  | { type: 'action'; id: string; action: 'shove' | 'potion' | 'secondWind' | 'hide' | 'dodge' | 'stabilize' | 'dash' | 'disengage' | 'search' | 'steadyAim' | 'wake'; target?: string }
  /** A spell (or Channel Divinity) is cast. `area` lists the squares of an area spell. */
  | { type: 'cast'; actor: string; spell: string; slot: number; targets: string[]; point?: Pos; area?: Pos[]; reaction?: boolean }
  /** An effect that always hits (a Magic Missile dart, a heal, a blessing landing). */
  | { type: 'spellHit'; actor: string; target: string; spell: string }
  | { type: 'concentration'; id: string; spell: string | null }
  | { type: 'summon'; summon: Summon }
  | { type: 'summonMove'; id: string; from: Pos; to: Pos }
  | { type: 'unsummon'; id: string }
  | { type: 'teleport'; id: string; from: Pos; to: Pos }
  | { type: 'maxHp'; target: string; maxHp: number }
  | { type: 'combatEnd'; winner: 'party' | 'enemy' };

// ---------------------------------------------------------------- commands

export type ActionSource = 'action' | 'bonus';
export type Command =
  | { type: 'move'; actor: string; to: Pos }
  | { type: 'attack'; actor: string; attack: string; target: string }
  | { type: 'offhand'; actor: string; attack: string; target: string }
  | { type: 'dash'; actor: string; via: ActionSource }
  | { type: 'disengage'; actor: string; via: ActionSource }
  | { type: 'hide'; actor: string; via: ActionSource }
  | { type: 'dodge'; actor: string }
  | { type: 'search'; actor: string }
  | { type: 'shove'; actor: string; target: string; effect: 'push' | 'prone' }
  | { type: 'secondWind'; actor: string }
  | { type: 'actionSurge'; actor: string }
  | { type: 'potion'; actor: string; target: string }
  | { type: 'stabilize'; actor: string; target: string }
  | { type: 'standUp'; actor: string }
  /** Cast a spell. `slot` is the slot level (0 for cantrips and Channel Divinity). */
  | { type: 'cast'; actor: string; spell: string; slot: number; targets?: string[]; point?: Pos }
  /** Spiritual Weapon: move it up to 20 ft and attack a creature within 5 ft of it (Bonus Action). */
  | { type: 'summonAttack'; actor: string; summon: string; target: string }
  | { type: 'steadyAim'; actor: string }
  /** Shake a creature out of magical sleep (an action, within 5 ft). */
  | { type: 'wake'; actor: string; target: string }
  | { type: 'endTurn'; actor: string };

/** A decision a creature's controller must make mid-command. */
export type ReactionPrompt =
  | { kind: 'opportunity'; reactor: string; target: string }
  | { kind: 'shield'; reactor: string; attacker: string; total: number; ac: number; wouldMiss: boolean };

/**
 * Thrown when `decide` returns undefined: a player has to choose. The command is
 * abandoned half-way, so the caller restores a snapshot, asks, and replays the
 * command with the answer (the seeded RNG makes the replay identical up to here).
 * `events` are those emitted before the question, so the UI can show them first.
 */
export class NeedsDecision extends Error {
  constructor(readonly prompt: ReactionPrompt, readonly events: GameEvent[]) { super(`decision needed: ${prompt.kind}`); }
}

export class RuleError extends Error {}

export interface AttackPreview {
  attack: AttackProfile;
  mode: Advantage;
  reasons: string[];
  cover: Cover;
  ac: number;
  chance: number;
  /** Expected damage including crits, sneak attack and on-advantage riders. */
  expected: number;
  damageText: string;
  inRange: boolean;
  longRange: boolean;
  usesBonusAction: boolean;
}

export interface PathResult { path: Pos[]; cost: number }

const POTION = parseDice('2d4+2');

export class Combat {
  readonly creatures: Creature[] = [];
  readonly order: string[] = [];
  round = 0;
  turnIndex = -1;
  over: 'party' | 'enemy' | null = null;
  /** Spell effects on the map (Spiritual Weapon). */
  summons: Summon[] = [];
  /**
   * Who decides reactions. The default policy always takes Opportunity Attacks and
   * casts Shield only when it turns a hit into a miss. The game UI replaces it and
   * returns undefined for a player's creature, which raises NeedsDecision.
   */
  decide: (p: ReactionPrompt) => boolean | undefined = (p) => this.defaultReaction(p);
  private events: GameEvent[] = [];
  /** Increments every time any creature's turn starts; "once per turn" features key off it. */
  turnSerial = 0;
  private onceUsed = new Map<string, number>();
  private summonSerial = 0;

  constructor(readonly grid: Grid, readonly rng: Rng) {}

  // ------------------------------------------------------------ setup

  add(def: CreatureDef, pos: Pos): Creature {
    if (this.creatures.some((c) => c.id === def.id)) throw new Error(`duplicate id ${def.id}`);
    const c: Creature = {
      ...def, hp: def.maxHp, pos: { ...pos }, initiative: 0, conditions: [], turnsStarted: 0,
      turn: freshTurn(def.speed), resourcesLeft: { ...(def.resources ?? {}) }, inv: { ...(def.inventory ?? {}) }, deathSaves: { success: 0, fail: 0 },
      slotsLeft: [...(def.spellcasting?.slots ?? [])], concentration: null,
    };
    this.creatures.push(c);
    return c;
  }

  get(id: string): Creature {
    const c = this.creatures.find((x) => x.id === id);
    if (!c) throw new Error(`no creature ${id}`);
    return c;
  }

  get active(): Creature | undefined { return this.turnIndex >= 0 ? this.get(this.order[this.turnIndex]) : undefined; }

  /** Roll initiative (d20 + DEX, Alert adds PB) and start the first turn. */
  start(): GameEvent[] {
    this.events = [];
    const rolls = this.creatures.map((c) => {
      const bonus = abilityMod(c.abilities.dex) + (this.has(c, 'alert') ? c.pb : 0);
      // Remarkable Athlete (Champion) and Assassinate (Assassin): Advantage on Initiative
      const adv = this.has(c, 'remarkableAthlete') || this.has(c, 'assassinate');
      const r = rollD20(this.rng, adv ? 'advantage' : 'normal', this.has(c, 'luck'));
      c.initiative = r.natural + bonus;
      return { c, total: c.initiative, tiebreak: c.abilities.dex + this.rng.next() };
    });
    rolls.sort((a, b) => b.total - a.total || b.tiebreak - a.tiebreak);
    this.order.push(...rolls.map((r) => r.c.id));
    this.emit({ type: 'initiative', order: rolls.map((r) => ({ id: r.c.id, total: r.total })) });
    this.emit({ type: 'log', tone: 'turn', text: `Initiative: ${rolls.map((r) => `${r.c.name} ${r.total}`).join(', ')}` });
    this.round = 1;
    this.turnIndex = -1;
    this.advanceTurn();
    return this.flush();
  }

  // ------------------------------------------------------------ queries

  has(c: Creature, f: Creature['features'][number]): boolean { return c.features.includes(f); }
  cond(c: Creature, id: ConditionId): Condition | undefined { return c.conditions.find((x) => x.id === id); }
  isAlive(c: Creature): boolean { return !this.cond(c, 'dead'); }
  /** Unconscious covers both dying (0 HP) and magical sleep. */
  isConscious(c: Creature): boolean { return this.isAlive(c) && c.hp > 0 && !this.cond(c, 'unconscious'); }
  /** Incapacitated: no actions, Bonus Actions or Reactions (also implied by Unconscious and death). */
  incapacitated(c: Creature): boolean { return !this.isConscious(c) || !!this.cond(c, 'incapacitated'); }
  /** Can take a reaction right now. */
  canReact(c: Creature): boolean { return c.turn.reaction && !this.incapacitated(c); }
  enemiesOf(c: Creature): Creature[] { return this.creatures.filter((o) => o.side !== c.side && this.isAlive(o)); }
  alliesOf(c: Creature): Creature[] { return this.creatures.filter((o) => o.side === c.side && o.id !== c.id && this.isAlive(o)); }
  creatureAt(p: Pos): Creature | undefined { return this.creatures.find((c) => this.isAlive(c) && samePos(c.pos, p)); }
  speedOf(c: Creature): number {
    if (this.cond(c, 'steadyAim')) return 0;
    return Math.max(0, c.speed - (this.cond(c, 'slowed') ? 10 : 0) - (this.cond(c, 'chilled') ? 10 : 0));
  }
  /** Armor Class including Shield (+5) and Shield of Faith (+2). */
  acOf(c: Creature): number { return c.ac + (this.cond(c, 'shielded') ? 5 : 0) + (this.cond(c, 'shieldOfFaith') ? 2 : 0); }
  modOf(c: Creature, a: Ability): number { return abilityMod(c.abilities[a]); }
  skillMod(c: Creature, s: Skill): number { return c.skills[s] ?? this.modOf(c, SKILL_ABILITY[s]); }
  saveMod(c: Creature, a: Ability): number { return this.modOf(c, a) + (c.saveProfs.includes(a) ? c.pb : 0); }

  /** Can `viewer` currently see `target`? Hidden creatures are unseen until found. */
  canSee(viewer: Creature, target: Creature): boolean {
    if (!this.isConscious(viewer)) return false;
    if (this.cond(target, 'hidden') && viewer.side !== target.side) return false;
    return computeCover(this.grid, viewer.pos, target.pos) !== 'total';
  }

  coverBetween(attacker: Creature, target: Creature): Cover {
    const others = this.creatures.filter((c) => this.isAlive(c) && c.id !== attacker.id && c.id !== target.id).map((c) => c.pos);
    return computeCover(this.grid, attacker.pos, target.pos, others);
  }

  // ------------------------------------------------------------ movement

  /** Is `p` a square `c` could stand in? */
  canStand(c: Creature, p: Pos): boolean {
    const cell = this.grid.cell(p.x, p.y);
    if (!cell || cell.blocksMove) return false;
    const o = this.creatureAt(p);
    return !o || o.id === c.id;
  }

  /** Can `c` move through the square occupied by `o`? (PHB 2024: allies, incapacitated, Tiny, or 2+ sizes different.) */
  private canPass(c: Creature, o: Creature): boolean {
    if (o.side === c.side || this.incapacitated(o)) return true;
    const diff = Math.abs(SIZE_RANK[c.size] - SIZE_RANK[o.size]);
    if (o.size === 'tiny' || diff >= 2) return true;
    if (this.has(c, 'halflingNimbleness') && SIZE_RANK[o.size] > SIZE_RANK[c.size]) return true;
    return false;
  }

  /** Dijkstra over the grid from `c`'s position. Another creature's space is Difficult Terrain. */
  reachable(c: Creature, budget = c.turn.movement): Map<string, PathResult> {
    const start = c.pos;
    const best = new Map<string, PathResult>([[posKey(start), { path: [start], cost: 0 }]]);
    const open: PathResult[] = [{ path: [start], cost: 0 }];
    while (open.length) {
      open.sort((a, b) => a.cost - b.cost);
      const cur = open.shift()!;
      const here = cur.path[cur.path.length - 1];
      if ((best.get(posKey(here))?.cost ?? Infinity) < cur.cost) continue;
      for (const n of this.grid.neighbours(here)) {
        let step = this.grid.stepCost(here, n);
        if (!isFinite(step)) continue;
        const o = this.creatureAt(n);
        if (o && o.id !== c.id) {
          if (!this.canPass(c, o)) continue;
          if (!this.grid.cell(n.x, n.y)!.difficult) step += 5;
        }
        const cost = cur.cost + step;
        if (cost > budget) continue;
        const k = posKey(n);
        if ((best.get(k)?.cost ?? Infinity) <= cost) continue;
        const res = { path: [...cur.path, n], cost };
        best.set(k, res);
        open.push(res);
      }
    }
    // you can move through occupied squares but not stop in them
    for (const [k, v] of best) { const end = v.path[v.path.length - 1]; if (!this.canStand(c, end)) best.delete(k); }
    return best;
  }

  /** Enemies that would get an opportunity attack if `c` stepped from a to b. */
  private opportunityAttackers(c: Creature, a: Pos, b: Pos): Creature[] {
    if (this.cond(c, 'disengaged')) return [];
    return this.enemiesOf(c).filter((e) => {
      if (!this.canReact(e) || !this.canSee(e, c)) return false;
      const reach = this.meleeReach(e);
      if (reach === 0) return false;
      return distanceFt(e.pos, a) <= reach && distanceFt(e.pos, b) > reach;
    });
  }

  /** Enemies that would make an opportunity attack if `c` walked this path (UI warnings, planning). */
  provokersAlong(c: Creature, path: Pos[]): Creature[] {
    const out = new Set<Creature>();
    for (let i = 1; i < path.length; i++) for (const e of this.opportunityAttackers(c, path[i - 1], path[i])) out.add(e);
    return [...out];
  }

  meleeReach(c: Creature): number { return Math.max(0, ...c.attacks.filter((a) => a.kind === 'melee').map((a) => a.reach)); }

  // ------------------------------------------------------------ attack math

  attackOf(c: Creature, id: string): AttackProfile {
    const a = c.attacks.find((x) => x.id === id);
    if (!a) throw new RuleError(`${c.name} has no attack ${id}`);
    return a;
  }

  /** Work out advantage, cover, hit chance and expected damage for an attack — used by the rules, the UI and the AI. */
  previewAttack(attacker: Creature, attackId: string | AttackProfile, target: Creature, opts: { offhand?: boolean; opportunity?: boolean; from?: Pos } = {}): AttackPreview {
    const atk = typeof attackId === 'string' ? this.attackOf(attacker, attackId) : attackId;
    const from = opts.from ?? attacker.pos;
    const dist = distanceFt(from, target.pos);
    const adv: string[] = [], dis: string[] = [];
    let inRange: boolean, longRange = false;
    if (atk.kind === 'melee') inRange = dist <= atk.reach;
    else {
      const [normal, long] = atk.range!;
      inRange = dist <= long;
      longRange = dist > normal;
      if (longRange) dis.push('long range');
      // ranged attack while a hostile creature that can see you is within 5 ft
      if (this.enemiesOf(attacker).some((e) => distanceFt(e.pos, from) <= 5 && this.canSee(e, attacker))) dis.push('enemy within 5 ft');
    }
    if (this.cond(attacker, 'prone')) dis.push('you are prone');
    if (this.cond(attacker, 'sapped')) dis.push('sapped');
    if (this.cond(attacker, 'hidden') || this.cond(attacker, 'invisible')) adv.push('unseen attacker');
    if (this.cond(target, 'hidden')) dis.push('target unseen');
    if (this.cond(target, 'dodging') && this.isConscious(target) && this.canSee(target, attacker)) dis.push('target dodging');
    if (this.cond(target, 'prone')) (dist <= 5 ? adv : dis).push(dist <= 5 ? 'target prone' : 'target prone (far)');
    if (this.cond(target, 'unconscious')) adv.push('target unconscious');
    if (attacker.conditions.some((x) => x.id === 'vexing' && x.against === target.id)) adv.push('vex');
    if (this.cond(target, 'guided')) adv.push('Guiding Bolt');
    if (this.has(attacker, 'packTactics') && this.alliesOf(attacker).some((a) => !this.incapacitated(a) && distanceFt(a.pos, target.pos) <= 5)) adv.push('Pack Tactics');
    if (this.cond(attacker, 'steadyAim')) adv.push('Steady Aim');
    if (this.has(attacker, 'assassinate') && this.round === 1 && target.turnsStarted === 0) adv.push('Assassinate');
    const mode = resolveAdvantage(adv.length, dis.length);

    const saved = attacker.pos;
    attacker.pos = from;
    const cover = this.coverBetween(attacker, target);
    attacker.pos = saved;
    const ac = this.acOf(target) + (isFinite(COVER_AC[cover]) ? COVER_AC[cover] : 0);

    const bless = this.cond(attacker, 'blessed') ? 4 : 0;
    const critOn = this.critOn(attacker, atk);
    const chance = cover === 'total' || !inRange ? 0 : hitChanceWithDie(atk.toHit, ac, mode, bless, true, critOn);
    const critChance = cover === 'total' || !inRange ? 0 : (this.autoCrit(attacker, target, from) ? chance : hitChanceWithDie(atk.toHit, 99, mode, 0, true, critOn));
    const dmgExpr = opts.offhand ? (atk.offhandDamage ?? atk.damage) : atk.damage;
    const diceAvg = averageDice({ terms: dmgExpr.terms, bonus: 0 });
    let perHit = averageDice(dmgExpr);
    let extraDice = 0;
    const sneak = this.sneakAttackApplies(attacker, atk, target, mode, from);
    if (sneak) extraDice += (attacker.sneakAttackDice ?? 1) * 3.5;
    if (atk.bonusOnAdvantage && mode === 'advantage') extraDice += averageDice(atk.bonusOnAdvantage);
    if (atk.extraDamage) extraDice += averageDice(atk.extraDamage.dice);
    perHit += extraDice;
    const expected = Math.max(0, chance * perHit + critChance * (diceAvg + extraDice));
    // Potent Cantrip: a missed cantrip still deals half damage
    const potent = atk.cantrip && this.has(attacker, 'potentCantrip') ? (1 - chance) * Math.floor(averageDice(dmgExpr) / 2) : 0;
    const expectedAll = expected + potent;
    const reasons = [...adv.map((r) => `+ ${r}`), ...dis.map((r) => `− ${r}`)];
    if (bless) reasons.push('Bless +1d4');
    if (cover !== 'none') reasons.push(`${cover} cover`);
    if (sneak) reasons.push('Sneak Attack');
    let damageText = formatDice(dmgExpr);
    if (sneak) damageText += ` +${attacker.sneakAttackDice ?? 1}d6`;
    return { attack: atk, mode, reasons, cover, ac, chance, expected: expectedAll, damageText, inRange, longRange, usesBonusAction: !!opts.offhand };
  }

  /** Lowest natural d20 that crits: Improved Critical (Champion) makes weapon attacks crit on 19–20. */
  critOn(attacker: Creature, atk: AttackProfile): number { return this.has(attacker, 'improvedCritical') && atk.weapon ? 19 : 20; }

  private autoCrit(attacker: Creature, target: Creature, from: Pos): boolean {
    return !!this.cond(target, 'unconscious') && distanceFt(from, target.pos) <= 5 && attacker.id !== target.id;
  }

  private sneakAttackApplies(attacker: Creature, atk: AttackProfile, target: Creature, mode: Advantage, from: Pos): boolean {
    if (!this.has(attacker, 'sneakAttack') || this.usedThisTurn(attacker, 'sneakAttack')) return false;
    if (!atk.weapon || !(atk.finesse || atk.kind === 'ranged') || mode === 'disadvantage') return false;
    if (mode === 'advantage') return true;
    // an ally of yours (enemy of the target) within 5 ft of it, not incapacitated
    return this.alliesOf(attacker).some((a) => this.isConscious(a) && distanceFt(a.pos, target.pos) <= 5 && !samePos(a.pos, from));
  }

  // ------------------------------------------------------------ command dispatch

  /** Commands the actor could legally issue right now (shape only; targets are validated on execute). */
  canAct(actor: Creature): boolean { return this.active?.id === actor.id && !this.over && this.isConscious(actor); }

  execute(cmd: Command): GameEvent[] {
    this.events = [];
    if (this.over) throw new RuleError('combat is over');
    const actor = this.get(cmd.actor);
    if (this.active?.id !== actor.id) throw new RuleError(`it is not ${actor.name}'s turn`);
    if (cmd.type !== 'endTurn' && !this.isConscious(actor)) throw new RuleError(`${actor.name} can't act`);
    if (this.cond(actor, 'incapacitated') && cmd.type !== 'endTurn' && cmd.type !== 'move' && cmd.type !== 'standUp') throw new RuleError(`${actor.name} is Incapacitated`);
    switch (cmd.type) {
      case 'move': this.doMove(actor, cmd.to); break;
      case 'attack': this.doAttackAction(actor, cmd.attack, this.get(cmd.target)); break;
      case 'offhand': this.doOffhand(actor, cmd.attack, this.get(cmd.target)); break;
      case 'dash': this.spend(actor, cmd.via, 'Dash'); actor.turn.movement += this.speedOf(actor); actor.turn.dashed++; this.log(`${actor.name} Dashes.`); break;
      case 'disengage': this.spend(actor, cmd.via, 'Disengage'); this.addCondition(actor, { id: 'disengaged', expires: { creature: actor.id, when: 'end', turn: actor.turnsStarted } }); this.log(`${actor.name} Disengages.`); break;
      case 'hide': this.doHide(actor, cmd.via); break;
      case 'dodge': this.spend(actor, 'action', 'Dodge'); this.addCondition(actor, { id: 'dodging', expires: { creature: actor.id, when: 'start', turn: actor.turnsStarted + 1 } }); this.emit({ type: 'action', id: actor.id, action: 'dodge' }); this.log(`${actor.name} takes the Dodge action.`); break;
      case 'search': this.doSearch(actor); break;
      case 'shove': this.doShove(actor, this.get(cmd.target), cmd.effect); break;
      case 'secondWind': this.doSecondWind(actor); break;
      case 'actionSurge': this.doActionSurge(actor); break;
      case 'potion': this.doPotion(actor, this.get(cmd.target)); break;
      case 'stabilize': this.doStabilize(actor, this.get(cmd.target)); break;
      case 'standUp': this.doStandUp(actor); break;
      case 'cast': castSpell(this, actor, cmd); break;
      case 'summonAttack': attackWithSummon(this, actor, cmd.summon, this.get(cmd.target)); break;
      case 'steadyAim': this.doSteadyAim(actor); break;
      case 'wake': this.doWake(actor, this.get(cmd.target)); break;
      case 'endTurn': this.advanceTurn(); break;
    }
    this.checkEnd();
    return this.flush();
  }

  // ------------------------------------------------------------ turn flow

  private advanceTurn() {
    const prev = this.active;
    if (prev) this.endOfTurn(prev);
    if (this.checkEnd()) return;
    for (let guard = 0; guard < this.order.length * 2 + 2; guard++) {
      this.turnIndex++;
      if (this.turnIndex >= this.order.length) { this.turnIndex = 0; this.round++; this.log(`Round ${this.round}`, 'turn'); }
      const c = this.get(this.order[this.turnIndex]);
      if (!this.isAlive(c)) continue;
      this.startOfTurn(c);
      if (this.checkEnd()) return;
      // unconscious creatures roll their death save and pass
      if (!this.isConscious(c)) { this.endOfTurn(c); continue; }
      return;
    }
  }

  private startOfTurn(c: Creature) {
    this.turnSerial++;
    c.turnsStarted++;
    c.turn = freshTurn(this.speedOf(c));
    this.expire(c.id, 'start');
    c.turn.movement = this.speedOf(c); // Slow from the previous round may have just expired
    if (this.cond(c, 'incapacitated')) { c.turn.actions = 0; c.turn.bonusActions = 0; }
    this.emit({ type: 'turnStart', id: c.id, round: this.round });
    this.log(`${c.name}'s turn`, 'turn');
    if (c.hp === 0 && c.pc && this.isAlive(c) && !this.cond(c, 'stable')) this.deathSave(c);
  }

  private endOfTurn(c: Creature) {
    this.expire(c.id, 'end');
    sleepEndOfTurn(this, c);
  }

  private expire(creatureId: string, when: 'start' | 'end') {
    for (const c of this.creatures) {
      const owner = this.get(creatureId);
      const keep: Condition[] = [];
      for (const k of c.conditions) {
        const e = k.expires;
        if (e && e.creature === creatureId && e.when === when && owner.turnsStarted >= e.turn) this.emit({ type: 'condition', target: c.id, condition: k.id, added: false });
        else keep.push(k);
      }
      c.conditions = keep;
    }
  }

  private checkEnd(): boolean {
    if (this.over) return true;
    const party = this.creatures.filter((c) => c.side === 'party');
    const enemies = this.creatures.filter((c) => c.side === 'enemy');
    let winner: 'party' | 'enemy' | null = null;
    if (enemies.every((c) => !this.isConscious(c))) winner = 'party';
    else if (party.every((c) => !this.isConscious(c))) winner = 'enemy';
    if (winner) {
      this.over = winner;
      this.emit({ type: 'combatEnd', winner });
      this.log(winner === 'party' ? 'Victory!' : 'The party has fallen…', winner === 'party' ? 'good' : 'bad');
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ economy

  spend(c: Creature, via: ActionSource, what: string) {
    if (via === 'action') {
      if (c.turn.actions <= 0) throw new RuleError(`${c.name} has no action left for ${what}`);
      c.turn.actions--;
      c.turn.attacksLeft = 0; // starting another action ends any Attack action in progress
    } else {
      const allowed = (what === 'Dash' || what === 'Disengage' || what === 'Hide') && this.has(c, 'cunningAction')
        || (what === 'Disengage' || what === 'Hide') && this.has(c, 'nimbleEscape');
      if (!allowed) throw new RuleError(`${c.name} can't ${what} as a Bonus Action`);
      if (c.turn.bonusActions <= 0) throw new RuleError(`${c.name} has already used their Bonus Action`);
      c.turn.bonusActions--;
    }
  }

  useBonus(c: Creature, what: string) {
    if (c.turn.bonusActions <= 0) throw new RuleError(`${c.name} has already used their Bonus Action (${what})`);
    c.turn.bonusActions--;
  }

  // ------------------------------------------------------------ actions

  private doMove(c: Creature, to: Pos) {
    if (samePos(c.pos, to)) return;
    if (this.cond(c, 'prone')) this.doStandUp(c);
    const res = this.reachable(c).get(posKey(to));
    if (!res) throw new RuleError(`${c.name} can't reach (${to.x}, ${to.y})`);
    const walked: Pos[] = [c.pos];
    // the path is emitted in segments, split wherever an opportunity attack interrupts it
    let seg: Pos[] = [c.pos], segCost = 0;
    const flushSeg = () => { if (seg.length > 1) this.emit({ type: 'move', id: c.id, path: seg, cost: segCost }); seg = [c.pos]; segCost = 0; };
    for (let i = 1; i < res.path.length; i++) {
      const a = res.path[i - 1], b = res.path[i];
      // step cost recomputed so mid-move speed changes (Slow) are respected
      let step = this.grid.stepCost(a, b);
      const occ = this.creatureAt(b);
      if (occ && occ.id !== c.id && !this.grid.cell(b.x, b.y)!.difficult) step += 5;
      if (step > c.turn.movement) break;
      const provokers = this.opportunityAttackers(c, a, b);
      if (provokers.length) flushSeg();
      for (const e of provokers) {
        if (!this.isConscious(c)) break;
        const atk = this.bestMeleeAttack(e, c);
        if (!atk) continue;
        if (!this.ask({ kind: 'opportunity', reactor: e.id, target: c.id })) continue;
        e.turn.reaction = false;
        this.log(`${c.name} provokes an Opportunity Attack from ${e.name}!`, 'bad');
        this.resolveAttack(e, atk.id, c, { opportunity: true });
      }
      if (!this.isConscious(c)) break;
      c.pos = b; c.turn.movement -= step; c.turn.moved = true; segCost += step; walked.push(b); seg.push(b);
      this.revealCheck();
    }
    // an interrupted move can't leave a creature inside another one's space: step back
    while (walked.length > 1 && this.creatures.some((o) => o.id !== c.id && this.isAlive(o) && samePos(o.pos, c.pos))) {
      walked.pop(); c.pos = walked[walked.length - 1]; seg.push(c.pos);
    }
    flushSeg();
  }

  /** The best melee attack `e` has against `t` (for Opportunity Attacks and AI). */
  bestMeleeAttack(e: Creature, t: Creature): AttackProfile | undefined {
    return e.attacks.filter((a) => a.kind === 'melee').sort((a, b) => averageDice(b.damage) - averageDice(a.damage))
      .find((a) => distanceFt(e.pos, t.pos) <= a.reach);
  }

  private doAttackAction(c: Creature, attackId: string, target: Creature) {
    const atk = this.attackOf(c, attackId);
    if (c.turn.attacksLeft <= 0) {
      if (c.turn.actions <= 0) throw new RuleError(`${c.name} has no action left to attack`);
      this.validateAttack(c, atk, target);
      c.turn.actions--;
      c.turn.attacksLeft = c.attacksPerAction;
    } else this.validateAttack(c, atk, target);
    c.turn.attacksLeft--;
    if (atk.light) c.turn.lightWeapon = baseWeapon(atk.id);
    this.resolveAttack(c, attackId, target);
  }

  /** Light property extra attack: a Bonus Action, or part of the Attack action with Nick (once per turn). */
  private doOffhand(c: Creature, attackId: string, target: Creature) {
    const atk = this.attackOf(c, attackId);
    if (!atk.light || !atk.offhandDamage) throw new RuleError(`${atk.name} isn't a Light weapon`);
    if (!c.turn.lightWeapon) throw new RuleError('the off-hand attack follows an Attack action made with a Light weapon');
    if (c.turn.lightWeapon === baseWeapon(atk.id)) throw new RuleError('the off-hand attack must use a different Light weapon');
    if (c.turn.offhandUsed) throw new RuleError('already made the off-hand attack this turn');
    this.validateAttack(c, atk, target);
    if (atk.mastery === 'nick' && !c.turn.nickUsed) c.turn.nickUsed = true;
    else this.useBonus(c, 'off-hand attack');
    c.turn.offhandUsed = true;
    this.resolveAttack(c, attackId, target, { offhand: true });
  }

  /** Can `c` make the off-hand attack with `atk` now? Returns whether it would cost the Bonus Action. */
  offhandStatus(c: Creature, atk: AttackProfile): 'free' | 'bonus' | null {
    if (!atk.light || !atk.offhandDamage || !c.turn.lightWeapon || c.turn.lightWeapon === baseWeapon(atk.id) || c.turn.offhandUsed) return null;
    if (atk.mastery === 'nick' && !c.turn.nickUsed) return 'free';
    return c.turn.bonusActions > 0 ? 'bonus' : null;
  }

  private validateAttack(c: Creature, atk: AttackProfile, target: Creature) {
    if (target.id === c.id) throw new RuleError("can't attack yourself");
    if (!this.isAlive(target)) throw new RuleError(`${target.name} is already dead`);
    if (atk.consumes && (c.inv[atk.consumes] ?? 0) <= 0) throw new RuleError(`out of ${atk.consumes}s`);
    const p = this.previewAttack(c, atk.id, target);
    if (!p.inRange) throw new RuleError(`${target.name} is out of range`);
    if (p.cover === 'total') throw new RuleError(`no line of sight to ${target.name}`);
  }

  /** Roll an attack and apply everything that follows from it. */
  resolveAttack(attacker: Creature, attackId: string | AttackProfile, target: Creature, opts: { offhand?: boolean; opportunity?: boolean; from?: Pos; summon?: string } = {}) {
    let atk = typeof attackId === 'string' ? this.attackOf(attacker, attackId) : attackId;
    const from = opts.from ?? attacker.pos;
    // Goblin Boss: Redirect Attack — swap with an adjacent ally who becomes the target
    if (this.has(target, 'redirectAttack') && this.canReact(target) && this.canSee(target, attacker)) {
      const ally = this.alliesOf(target).find((a) => this.isConscious(a) && distanceFt(a.pos, target.pos) <= 5 && (a.size === 'small' || a.size === 'medium'));
      if (ally) {
        target.turn.reaction = false;
        const tp = target.pos; target.pos = ally.pos; ally.pos = tp;
        this.emit({ type: 'swap', a: target.id, b: ally.id });
        this.log(`${target.name} yanks ${ally.name} into the way!`, 'bad');
        target = ally;
        // the swap may have put the new target out of reach
        if (!this.previewAttack(attacker, atk, target, { from }).inRange) { this.log(`The attack can't reach ${target.name}.`); return; }
      }
    }
    const p = this.previewAttack(attacker, atk, target, { ...opts, from });
    atk = p.attack;
    if (atk.consumes) attacker.inv[atk.consumes] = Math.max(0, (attacker.inv[atk.consumes] ?? 0) - 1);
    // attacking reveals a hidden attacker (after the roll benefits from it)
    const d20 = rollD20(this.rng, p.mode, this.has(attacker, 'luck'));
    // Bless: +1d4, rolled after the d20
    const blessDie = this.cond(attacker, 'blessed') ? this.rng.die(4) : 0;
    const total = d20.natural + atk.toHit + blessDie;
    const critOn = this.critOn(attacker, atk);
    let ac = p.ac;
    let hit = d20.natural >= critOn || (d20.natural !== 1 && total >= ac);
    // Shield: a reaction that can turn the hit into a miss (not a critical hit)
    if (hit && d20.natural < critOn && canCastShield(this, target)) {
      const wouldMiss = total < ac + 5;
      if (this.ask({ kind: 'shield', reactor: target.id, attacker: attacker.id, total, ac, wouldMiss })) {
        castShield(this, target);
        ac += 5;
        hit = total >= ac;
      }
    }
    const crit = hit && (d20.natural >= critOn || this.autoCrit(attacker, target, from));
    this.emit({ type: 'attack', attacker: attacker.id, target: target.id, attack: atk.id, d20: d20.rolls, natural: d20.natural, total, ac, hit, crit, mode: p.mode, cover: p.cover, opportunity: opts.opportunity, spell: atk.spell, summon: opts.summon });
    const modeText = p.mode === 'normal' ? '' : ` with ${p.mode === 'advantage' ? 'Advantage' : 'Disadvantage'} (${d20.rolls.join(', ')})`;
    this.log(`${attacker.name} ${opts.opportunity ? 'lashes out at' : 'attacks'} ${target.name} with ${atk.name}${modeText}: ${total}${blessDie ? ` (Bless +${blessDie})` : ''} vs AC ${ac} — ${crit ? 'CRITICAL HIT!' : hit ? 'hit' : 'miss'}.`, hit ? (attacker.side === 'party' ? 'good' : 'bad') : 'info');
    this.removeCondition(attacker, 'sapped');
    this.removeCondition(attacker, 'steadyAim');
    this.removeCondition(target, 'guided');
    attacker.conditions = attacker.conditions.filter((x) => !(x.id === 'vexing' && x.against === target.id));
    if (this.cond(attacker, 'hidden')) { this.removeCondition(attacker, 'hidden'); this.log(`${attacker.name} is no longer hidden.`); }

    if (!hit) {
      if (atk.mastery === 'graze' && atk.abilityMod > 0) this.applyDamage(target, atk.abilityMod, atk.damageType, ['Graze'], attacker);
      // Potent Cantrip (Evoker): half the cantrip's damage on a miss, no other effect
      if (atk.cantrip && this.has(attacker, 'potentCantrip')) {
        const half = Math.floor(rollDice(this.rng, atk.damage).total / 2);
        if (half > 0) this.applyDamage(target, half, atk.damageType, ['Potent Cantrip'], attacker);
      }
      return;
    }
    // damage
    const base = opts.offhand ? (atk.offhandDamage ?? atk.damage) : atk.damage;
    let dice = rollDice(this.rng, { terms: base.terms, bonus: 0 }, crit);
    const parts: string[] = [];
    if (this.has(attacker, 'savageAttacker') && atk.weapon && !this.usedThisTurn(attacker, 'savageAttacker')) {
      this.markUsed(attacker, 'savageAttacker');
      const again = rollDice(this.rng, { terms: base.terms, bonus: 0 }, crit);
      if (again.total > dice.total) { dice = again; }
      parts.push('Savage Attacker');
    }
    let amount = dice.total + base.bonus;
    const extra = (d: DiceExpr, label: string) => { const r = rollDice(this.rng, d, crit); amount += r.total; parts.push(`${label} ${r.total}`); };
    if (atk.bonusOnAdvantage && p.mode === 'advantage') extra(atk.bonusOnAdvantage, 'advantage bonus');
    if (this.sneakAttackApplies(attacker, atk, target, p.mode, from)) {
      this.markUsed(attacker, 'sneakAttack');
      extra({ terms: [{ count: attacker.sneakAttackDice ?? 1, sides: 6 }], bonus: 0 }, 'Sneak Attack');
      // Assassinate: a first-round Sneak Attack adds the rogue's level as extra damage
      if (this.has(attacker, 'assassinate') && this.round === 1) { amount += attacker.level ?? 0; parts.push(`Assassinate ${attacker.level ?? 0}`); }
    }
    this.applyDamage(target, Math.max(1, amount), atk.damageType, parts, attacker, crit);
    // a rider of another damage type (rolled last; a separate instance of damage)
    if (atk.extraDamage && this.isAlive(target)) {
      const r = rollDice(this.rng, atk.extraDamage.dice, crit);
      this.applyDamage(target, r.total, atk.extraDamage.type, [], attacker, crit);
    }
    if (this.isAlive(target)) this.applyMastery(attacker, atk, target);
    if (atk.spell && this.isAlive(target)) spellAttackRider(this, attacker, atk.spell, target);
  }

  private applyMastery(attacker: Creature, atk: AttackProfile, target: Creature) {
    const next = (when: 'start' | 'end') => ({ creature: attacker.id, when, turn: attacker.turnsStarted + 1 });
    switch (atk.mastery) {
      case 'sap':
        this.addCondition(target, { id: 'sapped', source: attacker.id, expires: next('start') });
        this.log(`Sap: ${target.name} has Disadvantage on its next attack.`);
        break;
      case 'vex':
        attacker.conditions = attacker.conditions.filter((x) => !(x.id === 'vexing' && x.against === target.id));
        this.addCondition(attacker, { id: 'vexing', against: target.id, expires: next('end') });
        this.log(`Vex: ${attacker.name} has Advantage on the next attack against ${target.name}.`);
        break;
      case 'slow':
        if (!this.cond(target, 'slowed')) {
          this.addCondition(target, { id: 'slowed', source: attacker.id, expires: next('start') });
          if (this.active?.id === target.id) target.turn.movement = Math.max(0, target.turn.movement - 10);
          this.log(`Slow: ${target.name}'s Speed drops by 10 ft.`);
        }
        break;
      case 'push': this.push(attacker, target, 10); break;
      case 'topple': {
        const dc = 8 + atk.abilityMod + attacker.pb;
        if (!this.savingThrow(target, 'con', dc)) { this.addCondition(target, { id: 'prone' }); this.log(`Topple: ${target.name} is knocked Prone.`); }
        break;
      }
      default: break;
    }
  }

  /** Push `target` straight away from `from` by up to `feet`. */
  private push(from: Creature, target: Creature, feet: number) {
    if (SIZE_RANK[target.size] > SIZE_RANK.large) return;
    const dx = Math.sign(target.pos.x - from.pos.x), dy = Math.sign(target.pos.y - from.pos.y);
    const start = { ...target.pos };
    for (let i = 0; i < feet / 5; i++) {
      const n = { x: target.pos.x + dx, y: target.pos.y + dy };
      const cell = this.grid.cell(n.x, n.y);
      if (!cell || cell.blocksMove || this.creatureAt(n)) break;
      target.pos = n;
    }
    if (!samePos(start, target.pos)) { this.emit({ type: 'push', target: target.id, from: start, to: { ...target.pos } }); this.log(`${target.name} is pushed back.`); this.revealCheck(); }
  }

  savingThrow(c: Creature, ability: Ability, dc: number, mode: Advantage = 'normal'): boolean {
    const unconscious = !!this.cond(c, 'unconscious');
    if (unconscious && (ability === 'str' || ability === 'dex')) {
      this.emit({ type: 'save', target: c.id, ability, natural: 0, total: 0, dc, success: false });
      return false;
    }
    if (ability === 'dex' && this.cond(c, 'dodging')) mode = mode === 'disadvantage' ? 'normal' : 'advantage';
    const r = rollD20(this.rng, mode, this.has(c, 'luck'));
    const bless = this.cond(c, 'blessed') ? this.rng.die(4) : 0;
    const total = r.natural + this.saveMod(c, ability) + bless;
    const success = total >= dc;
    this.emit({ type: 'save', target: c.id, ability, natural: r.natural, total, dc, success });
    this.log(`${c.name} ${ability.toUpperCase()} save: ${total} vs DC ${dc} — ${success ? 'success' : 'failure'}.`);
    return success;
  }

  private skillCheck(c: Creature, skill: Skill, dc?: number): number {
    const r = rollD20(this.rng, 'normal', this.has(c, 'luck'));
    const total = r.natural + this.skillMod(c, skill);
    this.emit({ type: 'check', actor: c.id, skill, natural: r.natural, total, dc, success: dc === undefined ? undefined : total >= dc });
    return total;
  }

  // ------------------------------------------------------------ damage & death

  applyDamage(target: Creature, amount: number, damageType: string, parts: string[], source?: Creature, crit = false) {
    if (!this.isAlive(target)) return;
    if (target.hp === 0 && target.pc) {
      // damage while at 0 HP: a failed death save (two on a crit); massive damage kills outright
      if (amount >= target.maxHp) { this.kill(target); return; }
      target.deathSaves.fail += crit ? 2 : 1;
      this.emit({ type: 'damage', target: target.id, amount, damageType, hp: 0, parts });
      this.log(`${target.name} takes ${amount} damage while dying (${target.deathSaves.fail} failed death saves).`, 'bad');
      if (target.deathSaves.fail >= 3) this.kill(target);
      else this.removeCondition(target, 'stable');
      return;
    }
    const before = target.hp;
    target.hp = Math.max(0, target.hp - amount);
    this.emit({ type: 'damage', target: target.id, amount, damageType, hp: target.hp, parts });
    this.log(`${target.name} takes ${amount} ${damageType} damage${parts.length ? ` (${parts.join(', ')})` : ''}. ${target.hp}/${target.maxHp} HP.`, target.side === 'party' ? 'bad' : 'good');
    // damage ends magical sleep
    if (target.hp > 0 && target.conditions.some((k) => k.spell === 'sleep')) {
      for (const k of target.conditions.filter((x) => x.spell === 'sleep')) this.removeCondition(target, k.id);
      this.log(`${target.name} wakes up!`, target.side === 'party' ? 'good' : 'bad');
    }
    // concentration: Constitution save, DC 10 or half the damage (max 30)
    if (target.hp > 0 && target.concentration) {
      const dc = Math.min(30, Math.max(10, Math.floor(amount / 2)));
      if (!this.savingThrow(target, 'con', dc)) endConcentration(this, target, 'loses concentration');
    }
    if (target.hp === 0) {
      const overflow = amount - before;
      if (!target.pc) { this.kill(target, source); return; }
      if (overflow >= target.maxHp) { this.kill(target); return; }
      target.deathSaves = { success: 0, fail: 0 };
      if (target.conditions.some((k) => k.spell === 'sleep')) for (const k of target.conditions.filter((x) => x.spell === 'sleep')) this.removeCondition(target, k.id);
      this.addCondition(target, { id: 'unconscious' });
      if (!this.cond(target, 'prone')) this.addCondition(target, { id: 'prone' });
      target.conditions = target.conditions.filter((c) => c.id !== 'hidden' && c.id !== 'dodging');
      this.emit({ type: 'down', id: target.id });
      this.log(`${target.name} falls unconscious!`, 'bad');
    }
  }

  private kill(c: Creature, by?: Creature) {
    if (c.concentration) endConcentration(this, c);
    c.hp = 0;
    c.conditions = [{ id: 'dead' }];
    this.emit({ type: 'death', id: c.id });
    this.log(c.pc ? `${c.name} has died.` : `${c.name} is slain${by ? ` by ${by.name}` : ''}!`, c.side === 'party' ? 'bad' : 'good');
  }

  heal(c: Creature, amount: number) {
    if (!this.isAlive(c)) return;
    const wasDown = c.hp === 0;
    c.hp = Math.min(c.maxHp, c.hp + amount);
    this.emit({ type: 'heal', target: c.id, amount, hp: c.hp });
    this.log(`${c.name} regains ${amount} HP (${c.hp}/${c.maxHp}).`, 'good');
    if (wasDown && c.hp > 0) {
      c.deathSaves = { success: 0, fail: 0 };
      this.removeCondition(c, 'unconscious');
      this.removeCondition(c, 'stable');
      this.log(`${c.name} regains consciousness (still Prone).`, 'good');
    }
  }

  private deathSave(c: Creature) {
    const r = rollD20(this.rng, 'normal', this.has(c, 'luck'));
    if (r.natural === 20) { this.emit({ type: 'deathSave', target: c.id, natural: 20, ...c.deathSaves }); this.log(`${c.name} rolls a natural 20 on a death save!`, 'good'); this.heal(c, 1); return; }
    if (r.natural === 1) c.deathSaves.fail += 2;
    else if (r.natural >= 10) c.deathSaves.success++;
    else c.deathSaves.fail++;
    this.emit({ type: 'deathSave', target: c.id, natural: r.natural, ...c.deathSaves });
    this.log(`${c.name} death save: ${r.natural} (${c.deathSaves.success} successes, ${c.deathSaves.fail} failures).`, r.natural >= 10 ? 'info' : 'bad');
    if (c.deathSaves.fail >= 3) this.kill(c);
    else if (c.deathSaves.success >= 3) { this.addCondition(c, { id: 'stable' }); this.log(`${c.name} is stable.`); }
  }

  // ------------------------------------------------------------ other actions

  /**
   * Hide (PHB 2024): DC 15 Dexterity (Stealth) while out of every enemy's line of
   * sight — here, at least three-quarters cover from each enemy that could see you.
   */
  hideBlockers(c: Creature): Creature[] {
    return this.enemiesOf(c).filter((e) => this.isConscious(e) && !coverAtLeast(computeCover(this.grid, e.pos, c.pos), 'three-quarters'));
  }

  private doHide(c: Creature, via: ActionSource) {
    if (this.cond(c, 'hidden')) throw new RuleError(`${c.name} is already hidden`);
    const seen = this.hideBlockers(c);
    if (seen.length) throw new RuleError(`${c.name} can't hide: ${seen.map((s) => s.name).join(', ')} can see them`);
    this.spend(c, via, 'Hide');
    this.emit({ type: 'action', id: c.id, action: 'hide' });
    const total = this.skillCheck(c, 'stealth', 15);
    if (total >= 15) {
      this.addCondition(c, { id: 'hidden', value: total });
      this.log(`${c.name} hides (Stealth ${total}).`, 'good');
    } else this.log(`${c.name} tries to hide but fails (Stealth ${total}).`);
  }

  /** Hidden creatures are found as soon as an enemy has a clear view of them. */
  revealCheck() {
    for (const c of this.creatures) {
      if (!this.cond(c, 'hidden')) continue;
      const spotter = this.hideBlockers(c)[0];
      if (spotter) { this.removeCondition(c, 'hidden'); this.log(`${spotter.name} spots ${c.name}!`, c.side === 'party' ? 'bad' : 'good'); }
    }
  }

  private doSearch(c: Creature) {
    this.spend(c, 'action', 'Search');
    this.emit({ type: 'action', id: c.id, action: 'search' });
    const total = this.skillCheck(c, 'perception');
    let found = 0;
    for (const e of this.enemiesOf(c)) {
      const h = this.cond(e, 'hidden');
      if (h && total >= (h.value ?? 15) && computeCover(this.grid, c.pos, e.pos) !== 'total') { this.removeCondition(e, 'hidden'); found++; this.log(`${c.name} finds ${e.name}!`); }
    }
    if (!found) this.log(`${c.name} searches but finds nothing (Perception ${total}).`);
  }

  /** Unarmed Strike → Shove: STR or DEX save (target's choice) vs 8 + STR + PB. */
  private doShove(c: Creature, target: Creature, effect: 'push' | 'prone') {
    if (distanceFt(c.pos, target.pos) > 5) throw new RuleError(`${target.name} is out of reach`);
    if (SIZE_RANK[target.size] > SIZE_RANK[c.size] + 1) throw new RuleError(`${target.name} is too big to shove`);
    if (c.turn.attacksLeft <= 0) {
      if (c.turn.actions <= 0) throw new RuleError('no action left to shove');
      c.turn.actions--; c.turn.attacksLeft = c.attacksPerAction;
    }
    c.turn.attacksLeft--;
    const dc = 8 + this.modOf(c, 'str') + c.pb;
    const ability: Ability = this.saveMod(target, 'str') >= this.saveMod(target, 'dex') ? 'str' : 'dex';
    this.emit({ type: 'action', id: c.id, action: 'shove', target: target.id });
    this.log(`${c.name} tries to shove ${target.name}${effect === 'prone' ? ' to the ground' : ''}.`);
    if (this.cond(c, 'hidden')) this.removeCondition(c, 'hidden');
    if (this.savingThrow(target, ability, dc)) { this.log(`${target.name} holds firm.`); return; }
    if (effect === 'prone') { this.addCondition(target, { id: 'prone' }); this.log(`${target.name} is knocked Prone.`, 'good'); }
    else {
      const start = { ...target.pos };
      this.push(c, target, 5);
      if (samePos(start, target.pos)) this.log(`${target.name} has nowhere to go.`);
    }
  }

  private doSecondWind(c: Creature) {
    if (!this.has(c, 'secondWind')) throw new RuleError(`${c.name} doesn't have Second Wind`);
    if ((c.resourcesLeft.secondWind ?? 0) <= 0) throw new RuleError('no uses of Second Wind left');
    this.useBonus(c, 'Second Wind');
    c.resourcesLeft.secondWind--;
    this.emit({ type: 'resource', id: c.id, resource: 'secondWind', left: c.resourcesLeft.secondWind });
    const r = rollDice(this.rng, { terms: [{ count: 1, sides: 10 }], bonus: c.level ?? 1 });
    this.emit({ type: 'action', id: c.id, action: 'secondWind' });
    this.log(`${c.name} uses Second Wind.`);
    this.heal(c, r.total);
  }

  private doActionSurge(c: Creature) {
    if (!this.has(c, 'actionSurge')) throw new RuleError(`${c.name} doesn't have Action Surge`);
    if ((c.resourcesLeft.actionSurge ?? 0) <= 0) throw new RuleError('Action Surge is spent');
    c.resourcesLeft.actionSurge--;
    c.turn.actions++;
    this.emit({ type: 'resource', id: c.id, resource: 'actionSurge', left: c.resourcesLeft.actionSurge });
    this.log(`${c.name} surges with renewed vigour! (+1 action)`, 'good');
  }

  /** Potion of Healing: a Bonus Action to drink or administer to a creature within 5 ft (PHB 2024). */
  private doPotion(c: Creature, target: Creature) {
    if ((c.inv.potionOfHealing ?? 0) <= 0) throw new RuleError('no Potions of Healing');
    if (distanceFt(c.pos, target.pos) > 5) throw new RuleError(`${target.name} is too far away`);
    if (!this.isAlive(target)) throw new RuleError(`${target.name} is beyond saving`);
    this.useBonus(c, 'potion');
    c.inv.potionOfHealing--;
    this.emit({ type: 'action', id: c.id, action: 'potion', target: target.id });
    this.log(target.id === c.id ? `${c.name} drinks a Potion of Healing.` : `${c.name} pours a Potion of Healing down ${target.name}'s throat.`);
    this.heal(target, rollDice(this.rng, POTION).total);
  }

  /** Help action, first aid: DC 10 Wisdom (Medicine) to stabilise a dying creature. */
  private doStabilize(c: Creature, target: Creature) {
    if (distanceFt(c.pos, target.pos) > 5) throw new RuleError(`${target.name} is too far away`);
    if (target.hp > 0 || !this.isAlive(target) || this.cond(target, 'stable')) throw new RuleError(`${target.name} doesn't need first aid`);
    this.spend(c, 'action', 'Help');
    this.emit({ type: 'action', id: c.id, action: 'stabilize', target: target.id });
    const total = this.skillCheck(c, 'medicine', 10);
    if (total >= 10) { this.addCondition(target, { id: 'stable' }); target.deathSaves = { success: 0, fail: 0 }; this.log(`${c.name} stabilises ${target.name}.`, 'good'); }
    else this.log(`${c.name} fails to stabilise ${target.name} (Medicine ${total}).`, 'bad');
  }

  private doStandUp(c: Creature) {
    if (!this.cond(c, 'prone')) throw new RuleError(`${c.name} isn't prone`);
    const cost = Math.ceil(this.speedOf(c) / 2);
    if (c.turn.movement < cost) throw new RuleError('not enough movement to stand up');
    c.turn.movement -= cost;
    this.removeCondition(c, 'prone');
    this.log(`${c.name} stands up.`);
  }

  /** Steady Aim (Rogue 3): Bonus Action, only if you haven't moved; Advantage on your next attack, Speed 0 this turn. */
  private doSteadyAim(c: Creature) {
    if (!this.has(c, 'steadyAim')) throw new RuleError(`${c.name} can't use Steady Aim`);
    if (c.turn.moved) throw new RuleError('Steady Aim only works if you haven\'t moved this turn');
    this.useBonus(c, 'Steady Aim');
    this.addCondition(c, { id: 'steadyAim', expires: { creature: c.id, when: 'end', turn: c.turnsStarted } });
    c.turn.movement = 0;
    this.emit({ type: 'action', id: c.id, action: 'steadyAim' });
    this.log(`${c.name} takes careful aim.`);
  }

  /** Sleep: "someone within 5 feet of it takes an action to shake it out of the spell's effect". */
  private doWake(c: Creature, target: Creature) {
    if (distanceFt(c.pos, target.pos) > 5) throw new RuleError(`${target.name} is too far away`);
    if (!target.conditions.some((k) => k.spell === 'sleep')) throw new RuleError(`${target.name} isn't under a sleep spell`);
    this.spend(c, 'action', 'wake');
    this.emit({ type: 'action', id: c.id, action: 'wake', target: target.id });
    for (const k of target.conditions.filter((x) => x.spell === 'sleep')) this.removeCondition(target, k.id);
    this.log(`${c.name} shakes ${target.name} awake.`, c.side === 'party' ? 'good' : 'bad');
  }

  // ------------------------------------------------------------ reactions & replay

  /** Ask whoever controls the reactor. Undefined means "a player must choose": abandon the command. */
  ask(p: ReactionPrompt): boolean {
    const answer = this.decide(p);
    if (answer === undefined) throw new NeedsDecision(p, [...this.events]);
    return answer;
  }

  defaultReaction(p: ReactionPrompt): boolean {
    if (p.kind === 'shield') return p.wouldMiss;
    return true;
  }

  /** Everything needed to rewind a command (see NeedsDecision). */
  snapshot(): unknown {
    return structuredClone({
      creatures: this.creatures, round: this.round, turnIndex: this.turnIndex, over: this.over, turnSerial: this.turnSerial,
      onceUsed: [...this.onceUsed], summons: this.summons, summonSerial: this.summonSerial, rng: this.rng.save(),
    });
  }

  restore(snap: unknown) {
    const s = structuredClone(snap) as { creatures: Creature[]; round: number; turnIndex: number; over: Combat['over']; turnSerial: number; onceUsed: [string, number][]; summons: Summon[]; summonSerial: number; rng: unknown };
    // keep object identity: the UI holds references to creatures
    for (const saved of s.creatures) {
      const c = this.get(saved.id) as unknown as Record<string, unknown>;
      for (const k of Object.keys(c)) delete c[k];
      Object.assign(c, saved);
    }
    this.round = s.round; this.turnIndex = s.turnIndex; this.over = s.over; this.turnSerial = s.turnSerial;
    this.onceUsed = new Map(s.onceUsed); this.summons = s.summons; this.summonSerial = s.summonSerial;
    this.rng.load(s.rng);
    this.events = [];
  }

  nextSummonId(): string { return `summon${++this.summonSerial}`; }

  // ------------------------------------------------------------ helpers

  addCondition(c: Creature, k: Condition) {
    c.conditions.push(k);
    this.emit({ type: 'condition', target: c.id, condition: k.id, added: true });
    // Incapacitated (and Unconscious, which includes it) breaks concentration
    if ((k.id === 'incapacitated' || k.id === 'unconscious') && c.concentration) endConcentration(this, c);
  }

  removeCondition(c: Creature, id: ConditionId) {
    if (!this.cond(c, id)) return;
    c.conditions = c.conditions.filter((x) => x.id !== id);
    this.emit({ type: 'condition', target: c.id, condition: id, added: false });
  }

  usedThisTurn(c: Creature, what: string): boolean { return this.onceUsed.get(`${c.id}:${what}`) === this.turnSerial; }
  markUsed(c: Creature, what: string) { this.onceUsed.set(`${c.id}:${what}`, this.turnSerial); }

  log(text: string, tone: 'info' | 'good' | 'bad' | 'turn' = 'info') { this.emit({ type: 'log', text, tone }); }
  emit(e: GameEvent) { this.events.push(e); }
  private flush(): GameEvent[] { const e = this.events; this.events = []; return e; }
}

function freshTurn(speed: number): TurnState {
  return { actions: 1, bonusActions: 1, reaction: true, movement: speed, attacksLeft: 0, lightWeapon: '', offhandUsed: false, nickUsed: false, dashed: 0, moved: false };
}

/** "dagger-throw" and "dagger" are the same weapon. */
function baseWeapon(attackId: string): string { return attackId.replace(/-throw$/, ''); }
