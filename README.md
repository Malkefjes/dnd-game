# DnD Game

A turn-based, single-player, isometric D&D combat game for the browser, built on the
**D&D 2024 rules** (2024 Player's Handbook, 2025 Monster Manual). Private hobby project.

**MVP:** a combat-focused dungeon crawl with a party of up to 4. You control every party member.

## Status: Milestone 1 (in progress)

Milestone 1 is a single encounter that should be genuinely fun: **Torvald** (Dwarf Fighter 2)
and **Nyx** (Halfling Rogue 2) against a goblin war band in their den.

| Part | State |
|---|---|
| Visual style mockups (4 options) | ✅ done, waiting for a style decision |
| Rules engine (pure TypeScript, tested) | ✅ done |
| Tactical enemy AI | ✅ done |
| Playable game: renderer, input, animation, HUD | ⏳ next, once a style is picked |

## Running

```bash
npm install
npm run dev          # then open http://127.0.0.1:5173/ for the mockup gallery
npm test             # rules + AI tests
npx tsx tools/sim.ts      # 300 AI-vs-AI fights: win rate, length
npx tsx tools/sim.ts 3    # play-by-play log of seed 3
```

## Layout

```
src/engine/   rules engine: dice (seeded), grid + cover, combat state machine, AI
src/data/     2024 content: weapons, heroes, monsters
src/game/     encounters (maps + who stands where)
mockups/      the four visual-style mockups (Three.js / Canvas 2D)
tests/        vitest suites
tools/        screenshot + simulation scripts
```

The engine knows nothing about rendering. Every command (`move`, `attack`, `hide`, …) returns
a list of events (`attack`, `damage`, `move`, `condition`, …) that a renderer animates in order.
All randomness comes from a seeded RNG, so any fight can be replayed exactly.

## Rules implemented (2024)

- Initiative (DEX, Alert), turn economy: action, bonus action, reaction, movement split around actions
- Attack rolls with Advantage/Disadvantage cancellation, nat 1/20, crits doubling dice
- Cover (half / three-quarters / total) from terrain and creatures, line of sight
- Grid movement: 5 ft diagonals, difficult terrain, climbing ledges, moving through allies (difficult terrain), no corner-squeezing
- Opportunity Attacks; Dash, Disengage, Dodge, Hide (DC 15 Stealth, needs cover), Search, Help (first aid), Shove (push / prone)
- Ranged attacks: long range and adjacent-enemy Disadvantage; ammunition and thrown weapons are used up
- Weapon Mastery: Sap, Vex, Slow, Nick, Push, Topple, Graze
- Two-weapon fighting (Light property) with a different Light weapon
- Conditions: Prone, Unconscious, Hidden, Dodging, Disengaged, Slowed, Sapped
- Dropping to 0 HP, death saves, damage at 0 HP, massive damage, crits on unconscious targets, Potion of Healing (bonus action, can be fed to an ally)
- **Fighter 2:** Defense style, Second Wind, Action Surge, Weapon Mastery, Savage Attacker
- **Rogue 2:** Sneak Attack, Cunning Action, Expertise, Weapon Mastery, Alert, halfling Luck & Nimbleness
- **Goblins** (Warrior, Minion, Boss): +1d4 on Advantage, Nimble Escape, Multiattack, Redirect Attack

Not yet: Cleave, grappling, Tactical Mind, Naturally Stealthy, spellcasting (Milestone 2).
