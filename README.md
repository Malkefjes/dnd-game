# DnD Game

A turn-based, single-player, isometric D&D combat game for the browser, built on the
**D&D 2024 rules** (2024 Player's Handbook, 2025 Monster Manual). Private hobby project.

**MVP:** a combat-focused dungeon crawl with a party of up to 4. You control every party member.

**▶ Play it: https://malkefjes.github.io/dnd-game/** · [style mockups](https://malkefjes.github.io/dnd-game/mockups/)

## Status: Milestone 1 (playable)

Milestone 1 is a single encounter that should be genuinely fun: **Torvald** (Dwarf Fighter 2)
and **Nyx** (Halfling Rogue 2) against a goblin war band in their den.

| Part | State |
|---|---|
| Visual style: pixel art with real dynamic lighting, UI from mockup A | ✅ |
| Rules engine (pure TypeScript, tested) | ✅ |
| Tactical enemy AI | ✅ |
| Playable game: renderer, input, animation, HUD | ✅ |
| Deploy: GitHub Pages via Actions on every push | ✅ |

### How it looks the way it does

The dungeon and characters are real 3D: low-poly, rigged and animated models from **KayKit** (CC0, see
below). The goblins are KayKit rigs with the skin re-tinted green and pointed ears added on the head bone. Everything is lit
by flickering, shadow-casting torches. Each frame is rendered at 1/3 resolution in HDR, plus a normals pass. One
post-process pass then applies:

- filmic tone mapping
- banded light falloff
- cooler shadows
- silhouette outlines from depth
- highlights on light-facing creases from normals
- a limited palette with ordered dithering

Characters are snapped to whole pixels so they don't shimmer while moving. The result is upscaled with hard pixels, so
it reads as pixel art while the lighting stays fully dynamic. The HUD is crisp DOM on top.

### Assets

`public/assets/` comes from the KayKit packs by Kay Lousberg
([Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0),
[Dungeon Remastered](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0)), CC0 1.0.
To re-import, clone those repos into a folder and run `node tools/import-assets.mjs <folder>`. It copies the pieces
the game uses, keeps the shared animations in one file, and quantises the meshes (about 4 MB total).

### Controls

Left click: move, or attack an enemy (auto-walks into range, warns about opportunity attacks) ·
1–0: hotbar · right click / Esc: cancel · Space: end turn · WASD / right-drag: pan · wheel: zoom.
URL options: `?seed=123` replays a specific fight, `?speed=3` speeds up animations.

## Running

```bash
npm install
npm run dev          # game at http://127.0.0.1:5173/, mockups at /mockups/
npm test             # rules + AI tests
npx tsx tools/sim.ts      # 300 AI-vs-AI fights: win rate, length
npx tsx tools/sim.ts 3    # play-by-play log of seed 3
```

## Layout

```
src/engine/   rules engine: dice (seeded), grid + cover, combat state machine, AI
src/data/     2024 content: weapons, heroes, monsters
src/game/     encounters + the game controller (input, turn flow, event animation)
src/render/   pixel renderer, KayKit asset loading + characters, dungeon builder, overlays
src/ui/       HUD (DOM)
mockups/      the four visual-style mockups (Three.js / Canvas 2D)
tests/        vitest suites
tools/        screenshot, simulation and headless playtest scripts
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
