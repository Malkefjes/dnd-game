// Spellcasting (2024 rules): slots, concentration, spell attacks, saving throws,
// areas of effect on the grid, healing, buffs, Sleep, Shield, Spiritual Weapon.
// Spell data lives in src/data/spells.ts; anything a data field can't express is
// handled here by spell id.
import { averageDice, hitChance, parseDice, rollDice, scaleDice, type DiceExpr } from './dice';
import { computeCover, distanceFt, samePos, type Pos } from './grid';
import { abilityMod, type AttackProfile, type Creature, type SpellDef, type Summon } from './types';
import { RuleError, type Combat, type Command } from './combat';

// ---------------------------------------------------------------- lookups

export function spellOf(c: Creature, id: string): SpellDef {
  const s = c.spellcasting?.spells.find((x) => x.id === id);
  if (!s) throw new RuleError(`${c.name} doesn't know ${id}`);
  return s;
}

export function knows(c: Creature, id: string): boolean { return !!c.spellcasting?.spells.some((x) => x.id === id); }

/** Spellcasting ability modifier. */
export function castingMod(c: Creature): number { return c.spellcasting ? abilityMod(c.abilities[c.spellcasting.ability]) : 0; }

/** Cantrip damage dice multiply at character levels 5, 11 and 17. */
function cantripMultiplier(c: Creature): number { const l = c.level ?? 1; return l >= 17 ? 4 : l >= 11 ? 3 : l >= 5 ? 2 : 1; }

/** Darts, rays or targets the spell gets at this slot level. */
export function targetCount(spell: SpellDef, slot: number): number {
  if (spell.shape.kind === 'multi') return spell.shape.count + spell.shape.perSlot * Math.max(0, slot - spell.level);
  return spell.shape.kind === 'single' ? 1 : 0;
}

/** Damage dice for one hit / one target (Toll the Dead checks the target's HP). */
export function spellDamage(c: Creature, spell: SpellDef, slot: number, target?: Creature): DiceExpr {
  const d = spell.damage!;
  let base = parseDice(d.dice);
  if (spell.id === 'tollTheDead' && target && target.hp < target.maxHp) base = parseDice('1d12');
  const scaled = spell.level === 0 && !spell.uses
    ? scaleDice(base, { multiply: cantripMultiplier(c) })
    : scaleDice(base, { per: d.upcast ? parseDice(d.upcast) : undefined, extra: Math.max(0, slot - spell.level) });
  return d.addMod ? { terms: scaled.terms, bonus: scaled.bonus + castingMod(c) } : scaled;
}

export function spellHealing(c: Creature, spell: SpellDef, slot: number): DiceExpr {
  const h = spell.heal!;
  const scaled = scaleDice(parseDice(h.dice), { per: h.upcast ? parseDice(h.upcast) : undefined, extra: Math.max(0, slot - spell.level) });
  // Disciple of Life (Life Domain): a spell cast with a slot that restores HP adds 2 + the slot's level
  const disciple = c.features.includes('discipleOfLife') && slot > 0 ? 2 + slot : 0;
  return { terms: scaled.terms, bonus: scaled.bonus + (h.addMod ? castingMod(c) : 0) + disciple };
}

/** A spell attack as an AttackProfile, so it goes through the normal attack pipeline. */
export function spellAttackProfile(c: Creature, spell: SpellDef, slot: number, target?: Creature): AttackProfile {
  const melee = spell.attack === 'melee';
  return {
    id: spell.id, name: spell.name, kind: melee ? 'melee' : 'ranged', reach: melee ? Math.max(5, spell.range) : 0,
    range: melee ? undefined : [spell.range, spell.range], toHit: c.spellcasting!.attack,
    damage: spellDamage(c, spell, slot, target), damageType: spell.damage!.type, ability: c.spellcasting!.ability, abilityMod: castingMod(c),
    weapon: false, spell: spell.id, cantrip: spell.level === 0 && !spell.uses,
  };
}

/** Slot levels this spell can be cast with right now ([0] for cantrips and Channel Divinity). */
export function slotOptions(c: Creature, spell: SpellDef): number[] {
  if (spell.level === 0) return [0];
  const out: number[] = [];
  for (let l = spell.level; l < c.slotsLeft.length; l++) if ((c.slotsLeft[l] ?? 0) > 0) out.push(l);
  return out;
}

/** Why the spell can't be cast at all right now (economy, slots), or null. Targets are checked separately. */
export function castBlocker(combat: Combat, c: Creature, spell: SpellDef, slot: number): string | null {
  if (spell.time === 'reaction') return 'Cast as a Reaction when you are hit';
  if (spell.utility) return 'No use in a fight';
  // Breath Weapon, Sacred Weapon and Divine Smite get their own timing rules with the Paladin's engine work
  if (spell.time === 'attack' || spell.time === 'onHit') return 'Not playable yet';
  if (spell.consumes && (c.inv[spell.consumes] ?? 0) <= 0) return `Needs ${spell.consumes === 'holyWater' ? 'a flask of Holy Water' : spell.consumes}`;
  if (combat.cond(c, 'incapacitated')) return 'Incapacitated';
  if (spell.time === 'action' && c.turn.actions <= 0) return 'No action left';
  if (spell.time === 'bonus' && c.turn.bonusActions <= 0) return 'Bonus Action already used';
  if (spell.uses) return (c.resourcesLeft[spell.uses] ?? 0) > 0 ? null : 'No Channel Divinity left';
  if (spell.level === 0) return slot === 0 ? null : 'Cantrips use no slot';
  if (slot < spell.level || (c.slotsLeft[slot] ?? 0) <= 0) return `No level ${slot} spell slot left`;
  // 2024: on a turn you can expend only one spell slot to cast a spell
  if (combat.usedThisTurn(c, 'spellSlot')) return 'Only one spell slot per turn';
  return null;
}

// ---------------------------------------------------------------- targeting

/** Squares an area spell covers. Spheres are centred on a square (grid distance); cones start at the caster. */
export function areaSquares(combat: Combat, caster: Creature, spell: SpellDef, aim: Pos, from: Pos = caster.pos): Pos[] {
  const g = combat.grid;
  const out: Pos[] = [];
  const shape = spell.shape;
  if (shape.kind === 'sphere') {
    const r = shape.radius / 5;
    for (let y = aim.y - r; y <= aim.y + r; y++) for (let x = aim.x - r; x <= aim.x + r; x++) {
      const cell = g.cell(x, y);
      // an area spreads in straight lines from its point of origin
      if (cell && !cell.blocksSight && computeCover(g, aim, { x, y }) !== 'total') out.push({ x, y });
    }
  } else if (shape.kind === 'cone') {
    // A cone is as wide as it is long: half-angle atan(1/2). The caster's square isn't included.
    const L = shape.length / 5;
    const dx0 = aim.x - from.x, dy0 = aim.y - from.y, len0 = Math.hypot(dx0, dy0);
    if (!len0) return out;
    const half = Math.atan(0.5) + 0.01;
    for (let dy = -L; dy <= L; dy++) for (let dx = -L; dx <= L; dx++) {
      if (!dx && !dy) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * dx0 + dy * dy0) / (Math.hypot(dx, dy) * len0))));
      if (ang > half) continue;
      const p = { x: from.x + dx, y: from.y + dy };
      const cell = g.cell(p.x, p.y);
      if (cell && !cell.blocksSight && computeCover(g, from, p) !== 'total') out.push(p);
    }
  } else if (shape.kind === 'emanation') {
    const r = shape.radius / 5;
    for (let y = from.y - r; y <= from.y + r; y++) for (let x = from.x - r; x <= from.x + r; x++) if (g.cell(x, y)) out.push({ x, y });
  }
  return out;
}

export function creaturesIn(combat: Combat, squares: Pos[]): Creature[] {
  return combat.creatures.filter((c) => combat.isAlive(c) && squares.some((s) => samePos(s, c.pos)));
}

/** Who an area actually affects: Burning Hands hits everyone; Sleep and Preserve Life only the creatures you choose. */
export function areaVictims(combat: Combat, caster: Creature, spell: SpellDef, squares: Pos[]): Creature[] {
  const inside = creaturesIn(combat, squares);
  if (spell.affects === 'enemy') return inside.filter((c) => c.side !== caster.side);
  if (spell.affects === 'ally') return inside.filter((c) => c.side === caster.side);
  return inside.filter((c) => c.id !== caster.id);
}

/** Can `caster` target `t` with `spell` from `from`? Returns the reason it can't, or null. */
export function targetError(combat: Combat, caster: Creature, spell: SpellDef, t: Creature, from: Pos = caster.pos): string | null {
  if (!combat.isAlive(t)) return `${t.name} is dead`;
  const enemy = t.side !== caster.side;
  if (spell.affects === 'enemy' && !enemy) return 'Pick an enemy';
  if (spell.affects === 'ally' && enemy) return 'Pick an ally';
  if (enemy && combat.cond(t, 'hidden')) return `You can't see ${t.name}`;
  const range = spell.id === 'spiritualWeapon' ? spell.range + 5 : Math.max(5, spell.range);
  if (distanceFt(from, t.pos) > range) return `Out of range (${spell.range === 5 ? 'touch' : `${spell.range} ft`})`;
  if (!samePos(from, t.pos)) {
    const saved = caster.pos; caster.pos = from;
    const cover = spell.attack ? combat.coverBetween(caster, t) : computeCover(combat.grid, from, t.pos);
    caster.pos = saved;
    if (cover === 'total') return `No line of sight to ${t.name}`;
  }
  if (spell.id === 'spiritualWeapon' && !weaponSpot(combat, caster, t, from)) return 'No room for the weapon next to it';
  if (spell.heal && !spell.damage && t.hp >= t.maxHp) return `${t.name} is unhurt`;
  if (spell.id === 'aid' && combat.cond(t, 'aided')) return `${t.name} already has Aid`;
  if (spell.id === 'bless' && combat.cond(t, 'blessed')) return `${t.name} is already Blessed`;
  if (spell.id === 'shieldOfFaith' && combat.cond(t, 'shieldOfFaith')) return 'Already shielded by faith';
  return null;
}

/** Can the caster aim an area spell / Misty Step at this square? */
export function pointError(combat: Combat, caster: Creature, spell: SpellDef, p: Pos, from: Pos = caster.pos): string | null {
  const cell = combat.grid.cell(p.x, p.y);
  if (!cell) return 'Off the map';
  if (spell.shape.kind === 'cone') return samePos(p, from) ? 'Aim away from yourself' : null;
  if (distanceFt(from, p) > spell.range) return `Out of range (${spell.range} ft)`;
  if (computeCover(combat.grid, from, p) === 'total') return 'No line of sight';
  if (spell.shape.kind === 'point') {
    if (cell.blocksMove) return 'Blocked';
    const o = combat.creatureAt(p);
    if (o && o.id !== caster.id) return 'Occupied';
    if (samePos(p, from)) return 'Pick another square';
  }
  return null;
}

/** Where Spiritual Weapon appears to strike `t`: a square within range of the caster and within 5 ft of the target. */
export function weaponSpot(combat: Combat, caster: Creature, t: Creature, from: Pos = caster.pos, current?: Pos, move = 0): Pos | undefined {
  let best: Pos | undefined, bestScore = Infinity;
  for (const n of [t.pos, ...combat.grid.neighbours(t.pos)]) {
    if (samePos(n, t.pos)) continue;
    const cell = combat.grid.cell(n.x, n.y);
    if (!cell || cell.blocksMove) continue;
    if (current) { if (distanceFt(current, n) > move) continue; }
    else if (distanceFt(from, n) > 60 || computeCover(combat.grid, from, n) === 'total') continue;
    if (computeCover(combat.grid, n, t.pos) === 'total') continue;
    const occupied = combat.creatureAt(n) ? 10 : 0;
    const score = occupied + distanceFt(current ?? from, n) / 5;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  // already next to the target: it can stay put
  if (current && distanceFt(current, t.pos) <= 5 && (!best || distanceFt(current, best) > 0)) return current;
  return best;
}

// ---------------------------------------------------------------- estimates (AI and tooltips)

/** Chance that `t` fails a save against `dc`. */
export function failChance(combat: Combat, t: Creature, ability: Creature['saveProfs'][number], dc: number): number {
  if (combat.cond(t, 'unconscious') && (ability === 'str' || ability === 'dex')) return 1;
  const mod = combat.saveMod(t, ability) + (combat.cond(t, 'blessed') ? 2.5 : 0);
  const mode = ability === 'dex' && combat.cond(t, 'dodging') ? 'advantage' : 'normal';
  return 1 - hitChance(Math.round(mod), dc, mode, false);
}

/** Expected damage of a damaging spell against one target (per dart/ray for multi). */
export function expectedSpellDamage(combat: Combat, caster: Creature, spell: SpellDef, slot: number, t: Creature, from: Pos = caster.pos): number {
  if (!spell.damage) return 0;
  if (spell.id === 'magicMissile') return combat.cond(t, 'shielded') ? 0 : averageDice(spellDamage(caster, spell, slot, t));
  if (spell.attack) {
    const atkFrom = spell.id === 'spiritualWeapon' ? (weaponSpot(combat, caster, t, from) ?? from) : from;
    return combat.previewAttack(caster, spellAttackProfile(caster, spell, slot, t), t, { from: atkFrom }).expected;
  }
  if (spell.save) {
    const avg = averageDice(spellDamage(caster, spell, slot, t));
    const fail = failChance(combat, t, spell.save, caster.spellcasting!.dc);
    const onSave = spell.half ? 0.5 : spell.level === 0 && !spell.uses && combat.has(caster, 'potentCantrip') ? 0.5 : 0;
    return avg * (fail + (1 - fail) * onSave);
  }
  return 0;
}

// ---------------------------------------------------------------- casting

function spendSlot(combat: Combat, c: Creature, slot: number) {
  c.slotsLeft[slot]--;
  combat.markUsed(c, 'spellSlot');
  combat.emit({ type: 'resource', id: c.id, resource: `slot${slot}`, left: c.slotsLeft[slot] });
}

function startConcentration(combat: Combat, c: Creature, spell: SpellDef) {
  if (c.concentration) endConcentration(combat, c, `drops ${c.concentration}`);
  c.concentration = spell.id;
  combat.emit({ type: 'concentration', id: c.id, spell: spell.id });
}

/** End a creature's concentration: everything its spell sustains ends with it. */
export function endConcentration(combat: Combat, c: Creature, why?: string) {
  const spell = c.concentration;
  if (!spell) return;
  c.concentration = null;
  combat.emit({ type: 'concentration', id: c.id, spell: null });
  if (why) combat.log(`${c.name} ${why} — ${nameOf(c, spell)} ends.`, c.side === 'party' ? 'bad' : 'good');
  for (const o of combat.creatures) for (const k of o.conditions.filter((x) => x.conc === c.id)) {
    o.conditions = o.conditions.filter((x) => x !== k);
    combat.emit({ type: 'condition', target: o.id, condition: k.id, added: false });
  }
  for (const s of combat.summons.filter((x) => x.owner === c.id)) combat.emit({ type: 'unsummon', id: s.id });
  combat.summons = combat.summons.filter((x) => x.owner !== c.id);
}

function nameOf(c: Creature, id: string): string { return c.spellcasting?.spells.find((s) => s.id === id)?.name ?? id; }

export function castSpell(combat: Combat, c: Creature, cmd: Extract<Command, { type: 'cast' }>) {
  const spell = spellOf(c, cmd.spell);
  const slot = spell.level === 0 ? 0 : cmd.slot;
  const why = castBlocker(combat, c, spell, slot);
  if (why) throw new RuleError(why);

  // validate targets before anything is spent
  const ids = cmd.targets ?? [];
  const targets = ids.map((id) => combat.get(id));
  let area: Pos[] | undefined;
  const shape = spell.shape;
  if (shape.kind === 'single' || shape.kind === 'multi') {
    const max = targetCount(spell, slot);
    if (!targets.length) throw new RuleError('Pick a target');
    if (targets.length > max) throw new RuleError(`At most ${max} target${max > 1 ? 's' : ''}`);
    if (shape.kind === 'multi' && !shape.repeat && new Set(ids).size !== ids.length) throw new RuleError('Each target only once');
    for (const t of targets) { const e = targetError(combat, c, spell, t); if (e) throw new RuleError(e); }
  } else if (shape.kind === 'sphere' || shape.kind === 'cone' || shape.kind === 'point') {
    if (!cmd.point) throw new RuleError('Pick a point');
    const e = pointError(combat, c, spell, cmd.point);
    if (e) throw new RuleError(e);
    if (shape.kind !== 'point') area = areaSquares(combat, c, spell, cmd.point);
  } else if (shape.kind === 'emanation') area = areaSquares(combat, c, spell, c.pos);

  // pay for it
  if (spell.time === 'action') combat.spend(c, 'action', 'Magic');
  else combat.useBonus(c, spell.name);
  if (spell.uses) {
    c.resourcesLeft[spell.uses]--;
    combat.emit({ type: 'resource', id: c.id, resource: spell.uses, left: c.resourcesLeft[spell.uses] });
  } else if (slot > 0) spendSlot(combat, c, slot);
  if (spell.concentration) startConcentration(combat, c, spell);

  combat.emit({ type: 'cast', actor: c.id, spell: spell.id, slot, targets: ids, point: cmd.point, area });
  combat.log(`${c.name} casts ${spell.name}${slot > spell.level && spell.level > 0 ? ` at level ${slot}` : ''}${targets.length ? ` on ${[...new Set(targets)].map((t) => t.name).join(', ')}` : ''}.`);
  // casting a spell (Verbal component) gives away a hidden caster
  if (combat.cond(c, 'hidden')) { combat.removeCondition(c, 'hidden'); combat.log(`${c.name} is no longer hidden.`); }

  resolve(combat, c, spell, slot, targets, cmd.point, area);
}

function resolve(combat: Combat, c: Creature, spell: SpellDef, slot: number, targets: Creature[], point: Pos | undefined, area: Pos[] | undefined) {
  const dc = c.spellcasting!.dc;
  switch (spell.id) {
    case 'magicMissile': {
      // every dart hits; Shield stops them all
      for (const t of targets) {
        if (!combat.isAlive(t)) continue;
        combat.emit({ type: 'spellHit', actor: c.id, target: t.id, spell: spell.id });
        if (combat.cond(t, 'shielded')) { combat.log(`The dart fizzles against ${t.name}'s Shield.`); continue; }
        const r = rollDice(combat.rng, spellDamage(c, spell, slot, t));
        combat.applyDamage(t, r.total, 'force', ['Magic Missile'], c);
      }
      return;
    }
    case 'bless':
    case 'shieldOfFaith': {
      const cond = spell.id === 'bless' ? 'blessed' : 'shieldOfFaith';
      for (const t of targets) { combat.emit({ type: 'spellHit', actor: c.id, target: t.id, spell: spell.id }); combat.addCondition(t, { id: cond, conc: c.id, source: c.id }); }
      return;
    }
    case 'aid': {
      const bonus = 5 * (slot - 1);
      for (const t of targets) {
        combat.emit({ type: 'spellHit', actor: c.id, target: t.id, spell: spell.id });
        t.maxHp += bonus;
        combat.emit({ type: 'maxHp', target: t.id, maxHp: t.maxHp });
        combat.addCondition(t, { id: 'aided', source: c.id, value: bonus });
        combat.heal(t, bonus);
      }
      return;
    }
    case 'sleep': {
      for (const t of areaVictims(combat, c, spell, area!)) {
        if (!combat.isConscious(t)) continue;
        // creatures that don't sleep, such as elves, automatically succeed
        if (combat.has(t, 'trance')) { combat.log(`${t.name} doesn't sleep.`); continue; }
        if (combat.savingThrow(t, 'wis', dc)) continue;
        combat.addCondition(t, { id: 'incapacitated', spell: 'sleep', conc: c.id, source: c.id });
        combat.log(`${t.name} grows drowsy and is Incapacitated.`, t.side === 'party' ? 'bad' : 'good');
      }
      return;
    }
    case 'mistyStep': {
      const from = { ...c.pos };
      c.pos = { ...point! };
      combat.emit({ type: 'teleport', id: c.id, from, to: { ...c.pos } });
      combat.revealCheck();
      return;
    }
    case 'spiritualWeapon': {
      const t = targets[0];
      const spot = weaponSpot(combat, c, t)!;
      const s: Summon = { id: combat.nextSummonId(), kind: 'spiritualWeapon', owner: c.id, pos: spot, slot };
      combat.summons.push(s);
      combat.emit({ type: 'summon', summon: { ...s, pos: { ...s.pos } } });
      combat.resolveAttack(c, spellAttackProfile(c, spell, slot, t), t, { from: s.pos, summon: s.id });
      return;
    }
    case 'preserveLife': {
      // 5 × Cleric level HP divided among Bloodied allies (≤ half HP), none above half its maximum.
      // Ruling: the pool goes to the most badly hurt first, one point at a time.
      let pool = 5 * (c.level ?? 1);
      const allies = areaVictims(combat, c, spell, area!).filter((t) => t.hp <= t.maxHp / 2);
      const gain = new Map<Creature, number>();
      while (pool > 0) {
        const open = allies.filter((t) => t.hp + (gain.get(t) ?? 0) < Math.floor(t.maxHp / 2));
        if (!open.length) break;
        open.sort((a, b) => (a.hp + (gain.get(a) ?? 0)) / a.maxHp - (b.hp + (gain.get(b) ?? 0)) / b.maxHp);
        gain.set(open[0], (gain.get(open[0]) ?? 0) + 1); pool--;
      }
      for (const [t, n] of gain) { combat.emit({ type: 'spellHit', actor: c.id, target: t.id, spell: spell.id }); combat.heal(t, n); }
      if (!gain.size) combat.log('Nobody nearby is Bloodied.');
      return;
    }
    default: break;
  }

  // generic: healing (or Divine Spark on an ally)
  if (spell.heal && (!spell.damage || (targets[0] && targets[0].side === c.side))) {
    for (const t of targets) {
      combat.emit({ type: 'spellHit', actor: c.id, target: t.id, spell: spell.id });
      combat.heal(t, Math.max(0, rollDice(combat.rng, spellHealing(c, spell, slot)).total));
    }
    return;
  }
  if (!spell.damage) return;

  // generic: spell attacks, one roll per target (Scorching Ray rays may repeat a target)
  if (spell.attack) {
    for (const t of targets) {
      if (!combat.isAlive(t)) continue;
      combat.resolveAttack(c, spellAttackProfile(c, spell, slot, t), t);
    }
    return;
  }

  // generic: saving throws. An area rolls its damage once for everyone (saves first, in order).
  const victims = area ? areaVictims(combat, c, spell, area) : targets;
  const results = victims.filter((t) => combat.isAlive(t)).map((t) => ({ t, ok: combat.savingThrow(t, spell.save!, dc) }));
  const potent = spell.level === 0 && !spell.uses && combat.has(c, 'potentCantrip');
  const shared = area ? rollDice(combat.rng, spellDamage(c, spell, slot)).total : 0;
  for (const { t, ok } of results) {
    const full = area ? shared : rollDice(combat.rng, spellDamage(c, spell, slot, t)).total;
    const amount = ok ? (spell.half || potent ? Math.floor(full / 2) : 0) : full;
    if (!ok || amount > 0) combat.emit({ type: 'spellHit', actor: c.id, target: t.id, spell: spell.id });
    if (amount > 0) combat.applyDamage(t, amount, spell.damage.type, ok ? ['half'] : [], c);
  }
}

/** On-hit riders of spell attacks. */
export function spellAttackRider(combat: Combat, caster: Creature, spellId: string, target: Creature) {
  const next = (when: 'start' | 'end') => ({ creature: caster.id, when, turn: caster.turnsStarted + 1 });
  switch (spellId) {
    case 'guidingBolt':
      combat.addCondition(target, { id: 'guided', source: caster.id, expires: next('end') });
      combat.log(`${target.name} glimmers: the next attack against it has Advantage.`);
      break;
    case 'rayOfFrost':
      if (!combat.cond(target, 'chilled')) {
        combat.addCondition(target, { id: 'chilled', source: caster.id, expires: next('start') });
        if (combat.active?.id === target.id) target.turn.movement = Math.max(0, target.turn.movement - 10);
      }
      break;
    case 'shockingGrasp':
      // "can't take Reactions until the start of its next turn" — exactly what its turn reset restores
      target.turn.reaction = false;
      combat.log(`${target.name} can't take Reactions until its next turn.`);
      break;
    default: break;
  }
}

// ---------------------------------------------------------------- Shield

export function canCastShield(combat: Combat, c: Creature): boolean {
  if (!knows(c, 'shield') || !combat.canReact(c)) return false;
  if (combat.usedThisTurn(c, 'spellSlot')) return false;
  return c.slotsLeft.some((n, l) => l >= 1 && n > 0);
}

export function castShield(combat: Combat, c: Creature) {
  const slot = c.slotsLeft.findIndex((n, l) => l >= 1 && n > 0);
  c.turn.reaction = false;
  spendSlot(combat, c, slot);
  combat.emit({ type: 'cast', actor: c.id, spell: 'shield', slot, targets: [c.id], reaction: true });
  combat.addCondition(c, { id: 'shielded', source: c.id, expires: { creature: c.id, when: 'start', turn: c.turnsStarted + 1 } });
  combat.log(`${c.name} casts Shield! (+5 AC)`, c.side === 'party' ? 'good' : 'bad');
}

// ---------------------------------------------------------------- Spiritual Weapon

export function summonsOf(combat: Combat, c: Creature): Summon[] { return combat.summons.filter((s) => s.owner === c.id); }

/** Bonus Action: move the weapon up to 20 ft and attack a creature within 5 ft of it. */
export function attackWithSummon(combat: Combat, c: Creature, summonId: string, target: Creature) {
  const s = combat.summons.find((x) => x.id === summonId && x.owner === c.id);
  if (!s) throw new RuleError('No such spiritual weapon');
  if (target.side === c.side) throw new RuleError('Pick an enemy');
  if (combat.cond(target, 'hidden')) throw new RuleError(`You can't see ${target.name}`);
  const dest = weaponSpot(combat, c, target, c.pos, s.pos, 20);
  if (!dest) throw new RuleError(`The weapon can't reach ${target.name} (20 ft)`);
  combat.useBonus(c, 'Spiritual Weapon');
  if (!samePos(dest, s.pos)) { const from = s.pos; s.pos = { ...dest }; combat.emit({ type: 'summonMove', id: s.id, from, to: { ...dest } }); }
  combat.resolveAttack(c, spellAttackProfile(c, spellOf(c, 'spiritualWeapon'), s.slot, target), target, { from: s.pos, summon: s.id });
}

/** Can the weapon reach `t` this turn? */
export function summonCanReach(combat: Combat, c: Creature, s: Summon, t: Creature): boolean {
  return !!weaponSpot(combat, c, t, c.pos, s.pos, 20);
}

// ---------------------------------------------------------------- Sleep

/** At the end of its next turn a drowsy creature repeats the save: success shakes it off, failure puts it to sleep. */
export function sleepEndOfTurn(combat: Combat, c: Creature) {
  const k = c.conditions.find((x) => x.id === 'incapacitated' && x.spell === 'sleep');
  if (!k || !combat.isConscious(c)) return;
  const caster = combat.creatures.find((x) => x.id === k.conc);
  const dc = caster?.spellcasting?.dc ?? 10;
  if (combat.savingThrow(c, 'wis', dc)) {
    combat.removeCondition(c, 'incapacitated');
    combat.log(`${c.name} shakes off the drowsiness.`, c.side === 'party' ? 'good' : 'bad');
    return;
  }
  c.conditions = c.conditions.filter((x) => x !== k);
  combat.emit({ type: 'condition', target: c.id, condition: 'incapacitated', added: false });
  combat.addCondition(c, { id: 'unconscious', spell: 'sleep', conc: k.conc, source: k.source });
  if (!combat.cond(c, 'prone')) combat.addCondition(c, { id: 'prone' });
  combat.log(`${c.name} falls into a magical sleep.`, c.side === 'party' ? 'bad' : 'good');
}
