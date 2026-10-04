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

**Milestone 1 is done:** "The Goblin Den", playable with click-to-move / click-to-attack, the hotbar, AI turns,
animations, death saves, victory and defeat screens.

**Milestone 2 is mostly done:** a party of four at level 3 with spellcasting. Torvald (Dwarf Fighter 3, Champion),
Nyx (Halfling Rogue 3, Assassin), Maren (Human Cleric 3, Life) and Elowen (Elf Wizard 3, Evoker) take on a bigger den:
Grukk the Goblin Boss, 4 Goblin Warriors (2 with bows), 2 Goblin Minions and 3 Hobgoblin Warriors. Working:
- spell slots, upcasting (slot picker above the hotbar), cantrip scaling, the 2024 one-slot-per-turn rule
- concentration (CON saves on damage, ends on Incapacitated, a new concentration spell replaces the old)
- spell attacks, saving-throw spells, Magic Missile darts, cones and spheres on the grid (template overlay, damage
  rolled once for the area), Sleep's two stages, Spiritual Weapon as a summon, Misty Step, Aid, Bless, Shield of Faith
- Channel Divinity: Divine Spark, Preserve Life; Disciple of Life; Potent Cantrip
- reaction prompts: Shield when hit, and the player's Opportunity Attacks (Y / N)
- Champion (Improved Critical, Advantage on Initiative), Assassin (Assassinate), Steady Aim
- heroes build at levels 1–3 (`torvald(level)` etc.; `?level=2` in the URL)
- the AI casts spells too (it drives both sides in the sims)
- spell effects (bolts, beams, area flashes, sparkles, a floating spectral mace) are real lights

AI-vs-AI sims give the party ~79% wins over ~9 rounds. A human controlling four characters should find it a fair fight.

### Roadmap (agreed order)

1. **Milestone 2 (mostly done):** party of 4 with spellcasting, levels 1–3 with subclasses at 3. Left over:
   - playtesting with a human on a real GPU (performance with 13 figures; the effect light pool)
   - Counterspell and other reaction spells (the prompt mechanism is ready for them)
   - a way to choose the party's level / prepared spells before a fight (data supports it; there's no UI)
2. **Milestone 3:** a short dungeon of 5–6 encounters with exploration between fights:
   - short/long rests, levelling, loot
   - terrain interaction (shove off ledges, elevation, surfaces)
3. Then expand: more classes/subclasses, monsters, levels up to ~10, more maps.

### Known gaps / rough edges

- **Rules not implemented:** Cleave mastery, grappling, Tactical Mind, Naturally Stealthy (halfling), Remarkable
  Athlete's free move after a crit, Human Heroic Inspiration, Turn Undead (no undead yet), Lesser Restoration (nothing to
  cure yet, so it isn't on the bar). Spell durations in rounds aren't tracked (fights end well inside 1 minute).
- **Rulings (documented in code):** spheres are centred on a square and use grid distance (Sleep covers 3×3); cones
  start at the caster's square with a half-angle of atan(½); Sleep, Bless and Preserve Life pick only allies or only
  enemies automatically; Spiritual Weapon picks its own square next to the target; Preserve Life heals the most hurt
  first; Champion's 19 counts as a hit. Elowen's Mage Armor is always up (cast each morning with Magic Initiate).
- **AI choices:** drowsy creatures (Sleep stage 1) stay put; the AI never casts Aid or Shield of Faith, and only
  Blesses in the first three rounds.
- **Visual stand-ins:** KayKit has no bow, so shortbow users show a crossbow (rules still say Shortbow); hobgoblins
  (re-tinted knights) have no bow prop at all. All goblins share one body type. Maren's mace and the brazier are procedural.
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
  spells.ts     spellcasting: slots, targeting/areas, resolution, concentration, Shield, Sleep, Spiritual Weapon
  ai.ts         TacticalAI: one-turn utility planner over attacks and spells; turn() is a command generator
src/data/     2024 content: weapons.ts, spells.ts (SPELLS table), heroes.ts (levels 1–3), monsters.ts
src/game/     encounters.ts (map rows + placements), controller.ts (input → commands, events → animation)
src/render/   pixel-renderer.ts (scene, passes, camera, picking, tweens), assets.ts (KayKit loading,
              Character animation wrapper, goblin retint/ears, cleric mace), dungeon.ts (map → KayKit pieces),
              overlays.ts (move range, path, rings, area templates), effects.ts (spell VFX, light pool),
              models.ts (DungeonMap, shared types)
src/ui/       hud.ts/.css (DOM HUD), icons.ts
mockups/      the 4 original style mockups (frozen reference, not used by the game)
tools/        sim.ts, playtest.mjs, spellshot.mjs, view.mjs, shot.mjs, import-assets.mjs
public/assets KayKit models (generated by tools/import-assets.mjs; don't hand-edit)
```

**Key contract:** the engine is authoritative. `combat.execute(cmd)` mutates state and returns events (`move`,
`attack`, `damage`, `condition`, `death`, `action`, `turnStart`, `log`, …). The controller keeps a view model and
animates the events in order; it never re-derives rules. New mechanics go in the engine, with tests, plus a new event
type if the renderer needs to show something.

Movement emits `move` events **split into segments** around opportunity attacks, so the animation can play walk → get
hit → keep walking.

**Reactions:** the engine asks `combat.decide(prompt)` (Opportunity Attack, Shield). The default policy decides for
the AI. The controller returns `undefined` for a player's creature, which throws `NeedsDecision` mid-command; the
controller then restores `combat.snapshot()`, animates the events emitted so far, asks the player, and replays the
command with the answer. The seeded RNG makes the replay identical, so already-shown events are skipped. Anything
added to combat state must be covered by `snapshot()` / `restore()`.

**AI turns** are generators (`ai.turn(id)` yields one command at a time and receives whether it worked), so the
controller animates between steps and can pause for prompts. `ai.takeTurn(id)` runs one synchronously (tests, sims).

**Spells** are data (`SpellDef` in `src/data/spells.ts`: range, shape, attack/save, damage/heal dice, upcast dice).
Creatures carry them in `spellcasting.spells`; generic attack/save/heal paths cover most spells, and anything special
(riders, Sleep, Bless, Spiritual Weapon…) is handled by id in `engine/spells.ts`. Spell attacks become
`AttackProfile`s (`spell` set, `weapon: false`) and go through the normal attack pipeline.

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
node tools/playtest.mjs "http://127.0.0.1:5173/?seed=11&speed=8" outdir 300  # bot plays real turns, screenshots
CLICKS=3 node tools/spellshot.mjs "http://127.0.0.1:5173/?seed=5&play=1&speed=3" outdir magicMissile gob1
```

- **Headless browser:** Playwright with Chromium at `/opt/pw-browsers`, launched with `--use-angle=swiftshader`. It's very
  slow (≈1.5 fps with the 13-figure den, and animation time is clamped per frame), so use `?speed=8` and generous waits.
  The playtest bot answers reaction prompts with Y.
- **Debug handle:** `window.game` is the GameController (`.combat`, `.r` renderer, `.hud`).
- **URL params:** `?seed=N` gives a deterministic fight, `?play=1` skips the intro, `?level=1|2|3` sets the party level.
- **After deploy:** check the Actions run; Pages serves from `/dnd-game/`, so the Vite `base` is `'./'`.

## Conventions and gotchas

- **Engine tests:** use `RiggedRng`. Each test pushes exact die results in the order the engine consumes them:
  initiative d20s in add order, then attack d20(s), Bless d4, damage dice, Savage Attacker reroll, rider dice, Sneak
  Attack, extra damage of another type (Hobgoblin poison). Saving throws: d20(s) then Bless d4. Area spells roll every
  save first (creatures in add order), then the damage once. Advantage consumes two d20s (Vex, Steady Aim, and
  initiative for the level 3 Champion and Assassin; tests mostly use `torvald(2)` / `nyx(2)` to avoid that).
- **Lights:** never add or remove lights during play. three.js recompiles every shader when the light count changes,
  which is a hitch on a GPU and a long freeze in SwiftShader. Effects borrow lights from the pool in `effects.ts`.
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
