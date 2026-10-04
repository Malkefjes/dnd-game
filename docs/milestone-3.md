# Milestone 3: The Hollow Abbey

A single, hand-built dungeon explored BG3-style: walk the party freely, see what's ahead, and choose how every
fight starts. One hero made in a character creator, three companions, levels 1 → 4. The enemies are undead and
fiends only. The goblin den leaves the main game (it stays as a test fixture).

This is the working plan. Phases are in build order. Each phase ends playable and deployed to Pages, so the owner can
test as it grows. Tick boxes as work lands and keep "Status" at the bottom current.

## The premise (flavour, kept light: no dialogue trees)

The Abbey of Saint Aldric sealed its crypts a century ago. Now the dead walk out of them at night, and something
older than the dead is giving the orders. The party goes down to find out what, and to end it.

Story is told through short text beats: room descriptions, journals, inscriptions and a few lines from the boss.

## Decisions (agreed with the owner)

| Topic | Decision |
|---|---|
| Structure | One dungeon, explored freely. No world map, towns, quests or dialogue trees. |
| Enemies | Undead and fiends only (SRD 5.2 / 2025 Monster Manual). No goblins in the campaign. |
| Start | Level 1, made in a BG3-style character creator. |
| Party | Your hero plus three companions, met early in the abbey. Every companion can be swapped for a custom character in the creator. *(Default; confirm with the owner.)* |
| Level cap | 4 for this milestone (level 4 brings the first feat). Level 5 (Extra Attack, 3rd-level spells) is the next milestone. *(Default; confirm.)* |
| Classes | Fighter, Rogue, Cleric, Wizard (already built). Paladin (Oath of Devotion) is an optional phase, because it fits the theme. *(Ask.)* |

## Phase 0: Groundwork

The plumbing everything else needs.

- [ ] **Campaign state.** Separate what lasts (the party, HP, slots, inventory, XP, the map, the state of every
      enemy group and door) from one combat. `Combat` becomes something that runs *inside* the world, not the world.
- [ ] **Save and load** to `localStorage`: an autosave on entering each area and a manual save. Seeded RNG state is
      included, so a reload replays the same rolls.
- [ ] **Map format v2:** rows for terrain, plus a JSON sidecar for doors (locked or not), levers, chests, traps,
      light sources, enemy groups with patrol routes, story text, rest spots and area triggers.
- [ ] **Big maps that still run fast:** one figure per creature costs a lot, so far-away torches stop casting
      shadows, out-of-view figures skip their animation update, and the dungeon mesh is built in chunks.
- [ ] **Two floors** (the ruined abbey above, the crypts below), each its own map, joined by stairs. There's a
      short load and the party arrives at the matching stair.
- [ ] Remove the goblin den from the main flow. It stays in `encounters.ts` as a fixture for the tests and sims.

**Done when:** a test map loads from the new format, saves, reloads to the same state, and runs smoothly at its full
size on a real GPU (the owner checks on Pages).

## Phase 1: Character creator

**The engine side:** a real character builder replaces the hand-written heroes.

- [ ] `buildCharacter(choices, level)`: species + class + subclass + background + ability scores + skill picks +
      equipment + spells → a `CreatureDef`. Torvald, Nyx, Maren and Elowen become saved sets of choices, so the old
      tests keep passing.
- [ ] **Species (2024 PHB):** Aasimar, Dragonborn, Dwarf, Elf (Drow, High, Wood), Gnome, Goliath, Halfling, Human,
      Orc, Tiefling (Abyssal, Chthonic, Infernal). Every trait that matters in a fight: Darkvision, resistances,
      breath weapons, Healing Hands, Relentless Endurance, Adrenaline Rush, Stone's Endurance, Large Form, the
      lineage spells.
- [ ] **All 16 backgrounds:** ability increases (+2 / +1, or +1 / +1 / +1, among the background's three), skill
      proficiencies and origin feat.
- [ ] **Origin feats:** Alert, Healer, Lucky, Magic Initiate (cleric / wizard lists), Savage Attacker, Skilled,
      Tavern Brawler and Tough are implemented. Crafter and Musician only work out of combat, so they're
      listed but do nothing yet.
- [ ] **Ability scores:** standard array, point buy (27 points) and 4d6-drop-lowest.
- [ ] **Class choices:** skills, Fighting Style, Weapon Mastery picks, Expertise, cantrips and prepared spells, and
      Divine Order (Protector or Thaumaturge).

**The UI side**, in the painted-miniatures style:

- [ ] Steps: Species → Class → Background → Abilities → Skills & options → Spells → Appearance & name → Review.
- [ ] A live preview of the 3D model, turning, with the pixel filter applied. Appearance is a KayKit body, an
      accessory set and skin / hair / armour tints (the same re-tint tech as the goblins); horns and a tail for
      tieflings.
- [ ] A side panel with the resulting sheet (HP, AC, attacks, saves, spell DC), updating as you choose. Tooltips
      quote what each choice does.
- [ ] Companion editing: open any companion in the creator to swap them for a custom character.

**Done when:** you can make a legal level 1 character of any species and background in one of the four classes, see
them in 3D, and the sheet matches a hand check against the PHB.

## Phase 2: Exploration mode

The heart of the milestone.

- [ ] **Real-time movement on the grid:** click to walk. The party follows the selected hero in formation. Ctrl-click
      (or the portraits) selects heroes one at a time, so you can split the party and move each one alone.
- [ ] **Sneaking:** a stance per hero that uses Stealth (Hide rules) while moving. Hidden heroes show as ghosted.
- [ ] **Enemy awareness:** every enemy group has sight lines (the existing cover and line-of-sight code) and a facing.
      What a group can see is drawn on the floor when you hover over it. Some groups stand guard, some patrol, some
      sleep (undead "dormant" until disturbed).
- [ ] **Starting a fight:** combat begins when a group sees you, or when you attack. Initiative is rolled on the spot.
      Heroes the enemy hasn't noticed get Surprise on them (2024 rules: Disadvantage on their Initiative). Heroes
      out of the fight's reach can join at the end of a round.
- [ ] **Bringing in more enemies:** when a fight is noisy, nearby groups in earshot join at the end of a round
      (deterministic radius rules, documented).
- [ ] **Fleeing and ending a fight:** combat ends when no enemy is aware and within reach. Then you're back to free
      movement, with HP, slots and conditions kept.
- [ ] **Interactables:** doors (open / locked / Thieves' Tools / Athletics to force), levers, chests, searchable
      spots (Investigation / Perception DCs with passive scores), traps (spot, disarm, trigger), readable text.
- [ ] **Ledges and drops:** falling damage (1d6 per 10 ft, 2024 rules), and shoving an enemy off a drop.
- [ ] Camera: follows the selected hero gently. Fog of war hides rooms you haven't seen.

**Done when:** on a test floor you can sneak up on a group, pick off a sentry, start the fight with Surprise, finish
it, and walk on with the damage you took.

## Phase 3: The bestiary and its rules

**Engine rules undead and fiends need (with tests):**

- [ ] Damage resistances, immunities and vulnerabilities (including "nonmagical bludgeoning, piercing, slashing").
- [ ] Conditions: Frightened, Grappled, Paralyzed, Poisoned, Restrained, Charmed, Invisible (fiends), plus the
      existing Prone, Incapacitated and Unconscious.
- [ ] Grappling, from the 2024 Unarmed Strike: also a gap from Milestone 1.
- [ ] Hit Point maximum reduction (Life Drain), healed by a Long Rest. Temporary HP.
- [ ] Flying and hovering; incorporeal movement (passes through creatures and objects, takes force damage ending a
      turn inside one).
- [ ] Turn Undead (Channel Divinity), finally with targets; Sear Undead on the cleric later.
- [ ] Undead Fortitude (zombie); regeneration; Sunlight Sensitivity where it matters; magic resistance (Advantage on
      saves against spells).
- [ ] AI personalities: mindless (zombies walk straight in), cunning (ghouls go for the paralysed), cowardly (imps
      turn invisible and harry), and leaders that buff.

**Monsters** (verify every stat block against SRD 5.2 / the 2025 Monster Manual before implementing; no inventing):

| Band | Undead | Fiends |
|---|---|---|
| Levels 1–2 | Skeleton, Zombie, Shadow | Lemure, Dretch, Manes |
| Levels 2–3 | Ghoul, Specter, Will-o'-Wisp | Imp, Quasit |
| Levels 3–4 | Ghast, Wight | Bearded Devil, Hell Hound* |
| Boss | a Wight leading its dead (stat block as written, no scaling) | a Bearded Devil as the power behind it |

\*Hell Hound only if a usable four-legged CC0 model turns up; otherwise it's dropped.

**Art:** the KayKit Skeletons pack (CC0) for skeletons, skeletal mages and minions, imported with the existing tool.
Zombies, ghouls, ghasts and wights are re-tinted humans and skeletons. Shadows and specters are translucent dark
figures with a glow, drawn by the pixel filter. Fiends are re-tinted humanoids with horns, tails and wings built
from primitives, the way the goblin ears are. A wisp is a light with a particle core.

**Done when:** every monster in the table plays correctly in AI-vs-AI sims against level-appropriate parties, and has
a tested rule for each of its special traits.

## Phase 4: Rests, levelling, loot

- [ ] **Short rests:** spend Hit Dice to heal. Short-rest resources come back (Second Wind, Action Surge, Channel
      Divinity, Arcane Recovery). Only at safe spots, or anywhere no enemy is aware.
- [ ] **Long rests** at two camp sites, once each. Everything comes back, including HP maximum reduced by Life
      Drain. The rest happens only if no enemy group is aware of you.
- [ ] **XP:** each defeated monster's XP, shared by the party (2024 tables). Level 1→2 after the first area,
      2→3 midway, 3→4 before the crypt boss.
- [ ] **Level-up screen:** HP (fixed or rolled), new features, a subclass at 3, new spells, and at 4 an Ability Score
      Improvement or feat (Great Weapon Master, Sentinel, War Caster, Resilient and a few more that matter in a fight).
- [ ] **Inventory, kept small:** weapons and armour per hero, potions, scrolls, keys, gold. Swap gear between heroes
      outside combat.
- [ ] **Loot:** placed by hand, not random. A few magic items: +1 weapons, Potion of Greater Healing, a Holy Water
      flask, a Wand of Magic Missiles, a Cloak of Protection.

**Done when:** a level 1 party can rest, level to 4 and be kitted out by the end of the dungeon, with everything kept
across save and load.

## Phase 5: The Hollow Abbey

**Content, about 6–8 encounters across two floors:**

- [ ] **Floor 1, the ruined abbey:**
  - the graveyard (skeletons rising, a gentle tutorial fight)
  - the chapel (shadows, a hidden lever)
  - the cloister (zombies, which you can sneak past)
  - the scriptorium (journals, an imp spy that flees to warn the crypt)
  - the first camp
- [ ] **Floor 2, the crypts:**
  - the ossuary (a trapped corridor)
  - the flooded vault (ghouls, difficult terrain)
  - the reliquary (specters, a puzzle door)
  - the second camp
  - the sanctum: the boss, a wight bound to a bearded devil, in an arena with ledges and braziers to use
- [ ] Companions are met on floor 1: a captured paladin-squire, a grave-robbing rogue and so on, reusing the
      existing four as bases.
- [ ] Every fight can be approached at least two ways (a stealth route, a high ground, a lever, an alternate door).
- [ ] Intro and ending screens and a short epilogue based on who lived.

## Phase 6: Balance and polish

- [ ] A sim harness for each encounter, at the level the party should be when it gets there. Target: the AI party
      wins 70–85% with resources carried over from earlier fights.
- [ ] Pace and readability: show who can see you, show the threat level on enemy groups, explain Surprise.
- [ ] Performance check on a real GPU with the full floor; an option to raise the pixel size on slow machines.
- [ ] README and CLAUDE.md updated.

## Optional: Paladin (Oath of Devotion), levels 1–4

Lay on Hands, Weapon Mastery, Fighting Style, spellcasting with Divine Smite (a spell in 2024: a Bonus Action after
a hit, radiant damage, an extra d8 against fiends and undead), Channel Divinity and Sacred Weapon at 3. Aura of
Protection arrives at level 6, outside this milestone. It fits the theme best of any class; add it after Phase 2 if
the owner wants it.

## Risks

- **Performance:** big maps with real lights in a slow software renderer can't be tested here; only the owner's
  GPU can tell. Mitigation: light and animation culling (Phase 0), checked early.
- **Art for fiends:** re-tints and hand-made horns may look cheap next to KayKit models. Decide after the first
  imp; the fallback is to lean on skeletal and spectral undead.
- **Exploration feel:** real-time movement on a turn-based grid can feel stiff. Build Phase 2 early and get the
  owner's verdict before the content phase.
- **Scope:** if it runs long, cut the second floor to three rooms. Don't cut the stealth approach, which is the point.

## Status

- Phase 0: not started
