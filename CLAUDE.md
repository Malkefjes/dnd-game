# CLAUDE.md: project handover

Read this first in any new session. It holds the decisions, architecture, conventions and next steps. `README.md`
covers running and controls. Play it live at https://malkefjes.github.io/dnd-game/

## What this is

A turn-based, single-player, isometric D&D combat game for the browser, built on the **D&D 2024 rules** (2024 PHB,
2025 Monster Manual / SRD 5.2). It's a private hobby project for the owner only and will never be distributed, so using
non-SRD 2024 content (all subclasses, etc.) is fine. Inspiration: Baldur's Gate 3, at a much smaller scale.

## Decisions already made (don't re-ask)

- **Scope:** single player. Party of up to 4, and the player controls every member. MVP is a combat-focused dungeon crawl.
- **Rules:** use the official 2024 material as written. Don't invent mechanics; where the computer needs a ruling the
  tabletop leaves to the DM, keep it close to the rules and document it in code comments.
- **Visual style:** pixel art with real dynamic lighting (3D rendered as pixels; see Rendering) plus the HUD from
  mockup "A · Painted Miniatures" (Cinzel / EB Garamond, gold on dark). The owner picked this after seeing 4 mockups
  (`mockups/`, gallery at `/mockups/`). The approach (3D → pixel filter, rather than hand-drawn sprites) was discussed
  and agreed, because it scales to hundreds of monsters with animation and lighting for free.
- **Art assets:** KayKit packs (CC0) for characters and dungeon. Goblins are KayKit rigs re-tinted green, with ears added.
- **Deploy:** GitHub Pages via Actions on every push to `claude/dnd-browser-game-feasibility-0ajc1q`
  (that branch is also the repo's default branch).

## Status

**Milestone 1 is done and playable:** "The Goblin Den". Torvald (Dwarf Fighter 2) and Nyx (Halfling Rogue 2) face
Goblin Warrior, Goblin Archer, Goblin Minion and Grukk the Goblin Boss. All of the following work:
- click-to-move and click-to-attack (auto-approach into range, with opportunity attack warnings)
- the full hotbar
- AI turns
- animations
- death saves
- victory and defeat screens

AI-vs-AI sims give the party a ~63% win rate over ~8 rounds; a human playing well should win more often.

### Roadmap (agreed order)

1. **Milestone 2:** party of 4. Add a Cleric (Life Domain) and a Wizard (Evoker), so the **spellcasting system** is needed:
   - spell slots, concentration, saving-throw spells, attack spells, AoE templates on the grid
   - upcasting, cantrips, ritual-free
   - enough spells for levels 1–3 (Fire Bolt, Magic Missile, Shield, Burning Hands, Sleep, Cure Wounds, Healing Word,
     Bless, Guiding Bolt, Sacred Flame, Spiritual Weapon…)
   - reactions that need a player choice (Shield, Counterspell later), which means a reaction prompt UI
   - levels 1–3 including subclass at 3
2. **Milestone 3:** a short dungeon of 5–6 encounters with exploration between fights:
   - short/long rests, levelling, loot
   - terrain interaction (shove off ledges, elevation, surfaces)
3. Then expand: more classes/subclasses, monsters, levels up to ~10, more maps.

### Known gaps / rough edges

- **Rules not implemented:** Cleave mastery, grappling, Tactical Mind, Naturally Stealthy (halfling), spellcasting.
- **Reactions:** player opportunity attacks are always taken automatically (`combat.autoReactions`); there's no prompt UI.
- **Visual stand-ins:** KayKit has no bow, so shortbow users show a crossbow (rules still say Shortbow). All goblins share
  one body type. The brazier is procedural.
- **Testing limits:** only tested in headless Chromium with software WebGL, which is very slow. Real-GPU performance
  hasn't been verified by Claude. If it's slow: reduce shadow-casting lights (`shadowBudget` in `pixel-renderer.ts`),
  drop the normals pass, or raise `pixel`.

## Architecture

```
src/engine/   rules: pure TypeScript, no DOM/three. Seeded RNG. Fully unit-tested.
  dice.ts       Rng (mulberry32), RiggedRng for tests, dice parsing, advantage, hitChance
  grid.ts       Grid from map rows, step costs (5 ft diagonals, difficult terrain, ledges), cover (memoised)
  types.ts      CreatureDef / Creature / AttackProfile / conditions / turn economy
  combat.ts     Combat state machine: execute(Command) → GameEvent[]; all action rules live here
  ai.ts         TacticalAI: one-turn utility planner (expected damage, OA risk, exposure, Nimble Escape)
src/data/     2024 content: weapons.ts (table + weaponAttacks()), heroes.ts, monsters.ts
src/game/     encounters.ts (map rows + placements), controller.ts (input → commands, events → animation)
src/render/   pixel-renderer.ts (scene, passes, camera, picking, tweens), assets.ts (KayKit loading,
              Character animation wrapper, goblin retint/ears), dungeon.ts (map → KayKit pieces),
              overlays.ts (move range, path, rings), models.ts (DungeonMap, shared types)
src/ui/       hud.ts/.css (DOM HUD), icons.ts
mockups/      the 4 original style mockups (frozen reference, not used by the game)
tools/        sim.ts, playtest.mjs, view.mjs, shot.mjs, import-assets.mjs
public/assets KayKit models (generated by tools/import-assets.mjs; don't hand-edit)
```

**Key contract:** the engine is authoritative. `combat.execute(cmd)` mutates state and returns events (`move`,
`attack`, `damage`, `condition`, `death`, `action`, `turnStart`, `log`, …). The controller keeps a view model and
animates the events in order; it never re-derives rules. New mechanics go in the engine, with tests, plus a new event
type if the renderer needs to show something.

Movement emits `move` events **split into segments** around opportunity attacks, so the animation can play walk → get
hit → keep walking.

### Rendering pipeline (`pixel-renderer.ts`)

1. **Main pass:** the scene renders to a 1/3-resolution HalfFloat target with a depth texture. Shadow maps update once
   per frame (`shadowMap.autoUpdate = false`).
2. **Normals pass:** `MeshNormalMaterial` override. Overlays, flames and particles are hidden via `noNormals`.
3. **Post pass:** a RawShaderMaterial (GLSL3) applies:
   - ACES tone mapping
   - banded luminance
   - cool shadows
   - depth silhouette outlines
   - normal-based crease highlights
   - posterise with 4×4 Bayer dither
4. **Upscale:** the canvas is CSS-upscaled with `image-rendering: pixelated`.

Camera focus and figure positions are snapped to the texel grid to stop shimmer.

KayKit scale: models are scaled by ~0.5, so one small floor tile (2 KayKit units) is one 5-ft square. Characters face
local **+z**; facing uses `rotation.y = atan2(dx, dz)`. One square = 1 world unit; a platform level is 0.6 units
(`LEVEL`).

### Assets

- **Source:** KayKit packs, from GitHub. Clone them with `git clone --depth 1`, because the itch.io, kenney.nl and
  quaternius.com sites are blocked by the cloud sandbox's network policy:
  - `KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0` (Knight, Rogue, Rogue_Hooded, Barbarian, Mage, 76 anims)
  - `KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0` (200+ pieces)
  - `KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0` (not used yet; good for undead encounters)
- **Import:** `node tools/import-assets.mjs <dir with the clones>`.
  - Animations are kept only in `characters/animations.glb` (all KayKit characters share one rig) and stripped from the
    other models. Meshes are quantised.
  - Gotcha: when deleting glTF animations, dispose the samplers too, but never the accessors directly (time inputs are
    shared). Let `prune()` remove them.
- **Characters:** archetype → model/loadout/animation mapping is `MODEL_SPECS` in `assets.ts`. Accessory meshes (weapons,
  shields, hats) are toggled by node name. Creature defs pick a model via `model:` in `src/data/*`.

## Verifying changes (do this before every push)

```bash
npx tsc --noEmit -p .          # typecheck (strict, noUnusedLocals)
npm test                       # vitest: dice, grid/cover, combat rules, 150 AI-vs-AI fights
npm run build                  # vite multi-page build (game + mockups)
npx tsx tools/sim.ts           # 300 AI-vs-AI fights: win rate / fight length (balance check)
npx tsx tools/sim.ts 3         # full play-by-play log for seed 3
```

Visual checks (start `npx vite` first; it serves on 127.0.0.1:5173):

```bash
node tools/view.mjs "http://127.0.0.1:5173/?seed=5" out.png "g.r.setZoom(2.5); g.r.lookAt(7,4,true)" 5000
node tools/playtest.mjs "http://127.0.0.1:5173/?seed=11&speed=4" outdir 80   # bot plays real turns, screenshots
```

- **Headless browser:** Playwright with Chromium at `/opt/pw-browsers`, launched with `--use-angle=swiftshader`. It's slow,
  so use `?speed=4` to speed up animations.
- **Debug handle:** `window.game` is the GameController (`.combat`, `.r` renderer, `.hud`).
- **URL params:** `?seed=N` gives a deterministic fight, and `?play=1` skips the intro.
- **After deploy:** check the Actions run; Pages serves from `/dnd-game/`, so the Vite `base` is `'./'`.

## Conventions and gotchas

- **Engine tests:** use `RiggedRng`. Each test pushes exact die results in the order the engine consumes them:
  initiative d20s in add order, then attack d20(s), damage dice, Savage Attacker reroll, rider dice, Sneak Attack.
  Remember that advantage consumes two d20s (e.g. from Vex).
- **"Once per turn" features** (Sneak Attack, Savage Attacker) key off `combat.turnSerial`, not the creature's own turn,
  so Sneak Attack can trigger on an opportunity attack during an enemy's turn.
- **Effect expiry:** `{ creature, when: 'start'|'end', turn: turnsStarted+1 }` covers both "until the start of your next
  turn" and "until the end of your next turn".
- **Cover:** a sampled LOS method (5 attacker points × 9 target points), deliberately not the DMG corner method. The DMG
  method gives bad results on a grid: edge-grazing lines count as blocked. Hide requires ≥ three-quarters cover from
  every conscious enemy; a hidden creature is revealed the moment any enemy has less than that.
- **AI:** don't let it stall. If nothing is visible it advances on the enemies' real positions, then Searches.
- **Animation loop:** clamp dt to ≥ 0. rAF timestamps can precede `performance.now()`, and a negative dt once blew the
  camera off to infinity.
- **Repo:** commit messages are descriptive. Don't put model identifiers in commits or code.
