# DnD Game

A turn-based, single-player, isometric D&D combat game for the browser, built on the
**D&D 2024 rules** (2024 Player's Handbook, 2025 Monster Manual). Private hobby project.

**MVP:** a combat-focused dungeon crawl with a party of up to 4. You control every party member.

**▶ Play it: https://malkefjes.github.io/dnd-game/** · Working on it with Claude? Start with [`CLAUDE.md`](CLAUDE.md). · [style mockups](https://malkefjes.github.io/dnd-game/mockups/)

## Status: Milestone 3 in progress — The Hollow Abbey

A sealed abbey whose dead have started walking. Milestone 3 turns the game into a single dungeon explored BG3-style,
with a character creator and undead and fiend enemies ([plan](docs/milestone-3.md)). Phase 0 (the groundwork) is
playable: the four premade heroes at level 1 explore test versions of the abbey and the crypt, open doors, read notes,
and fight skeletons and zombies. The game saves as you go. Milestone 2's goblin den is still there as a dev fight
(`?den=1`).

| Part | State |
|---|---|
| Visual style: pixel art with real dynamic lighting, UI from mockup A | ✅ |
| Rules engine (pure TypeScript, tested) | ✅ |
| Tactical enemy AI | ✅ |
| Playable game: renderer, input, animation, HUD | ✅ |
| Spellcasting: slots, upcasting, concentration, areas, reaction prompts, spell effects | ✅ |
| Party of 4, levels 1–3 with subclasses at 3 | ✅ |
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
1–0: hotbar · Shift + 1–0: spells (pick the slot level above the hotbar to upcast) · right click / Esc: cancel ·
Space: end turn (or cast a multi-target spell early) · Y / N: answer reaction prompts (Divine Smite offers its slot levels) ·
WASD / right-drag: pan · wheel: zoom. Hotbar buttons show names; the bottom edge is the kind (red attack, tan
action, gold class feature, teal item, blue cantrip, purple spell) and the corner dot the cost (green action,
orange bonus action, purple reaction).
New Game opens the party screen: create your hero (8 steps, live 3D preview and sheet), pick three companions
from the ready-made heroes, edit any of them. `?new=1` skips straight in with the four ready-made heroes,
`?create=1` opens the party screen.
URL options: `?seed=123` replays a specific fight, `?speed=3` speeds up animations, `?level=2` plays the party at level 2.

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
src/data/     2024 content: weapons, spells, heroes (levels 1–3), monsters
src/game/     encounters + the game controller (input, turn flow, event animation)
src/render/   pixel renderer, KayKit asset loading + characters, dungeon builder, overlays, spell effects
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
- Spellcasting: slots by level, upcasting, cantrip scaling, one slot per turn, concentration (CON saves, ends when
  incapacitated), spell attacks, saving throws (half on success), areas on the grid (cone, sphere; damage rolled once)
- Spells: Fire Bolt, Ray of Frost, Shocking Grasp, Sacred Flame, Toll the Dead, Magic Missile, Shield (reaction),
  Burning Hands, Sleep, Guiding Bolt, Healing Word, Cure Wounds, Bless, Shield of Faith, Inflict Wounds, Scorching Ray,
  Misty Step, Spiritual Weapon, Aid
- Reactions you decide: Shield when hit, Opportunity Attacks
- **Fighter 1–3:** Defense style, Second Wind, Action Surge, Weapon Mastery, Savage Attacker; Champion: Improved Critical, Remarkable Athlete (initiative)
- **Rogue 1–3:** Sneak Attack, Cunning Action, Expertise, Weapon Mastery, Alert, halfling Luck & Nimbleness; Steady Aim; Assassin: Assassinate
- **Cleric 1–3:** Protector, Channel Divinity (Divine Spark, Preserve Life), Life Domain spells, Disciple of Life, Tough, Alert
- **Wizard 1–3:** Mage Armor (Magic Initiate), elven Trance (immune to Sleep); Evoker: Potent Cantrip
- **Goblins** (Warrior, Minion, Boss): +1d4 on Advantage, Nimble Escape, Multiattack, Redirect Attack; they wake sleeping friends
- **Hobgoblin Warrior:** Pack Tactics, Longbow with 3d4 poison

Not yet: Cleave, grappling, Tactical Mind, Naturally Stealthy, Heroic Inspiration, Counterspell.
