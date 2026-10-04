// Import the KayKit (CC0) packs used by the game into public/assets.
//
//   node tools/import-assets.mjs <dir containing the cloned KayKit repos>
//
// Repos (github.com/KayKit-Game-Assets): KayKit-Character-Pack-Adventures-1.0,
// KayKit-Dungeon-Remastered-1.0. All characters share one rig, so animations
// are kept only in `animations.glb` and stripped from every character model.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, weld, quantize } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const src = process.argv[2];
if (!src) { console.error('usage: node tools/import-assets.mjs <kaykit dir>'); process.exit(1); }
const out = path.resolve('public/assets');
const chars = path.join(src, 'KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures/Characters/gltf');
const dungeon = path.join(src, 'KayKit-Dungeon-Remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf');
fs.mkdirSync(path.join(out, 'characters'), { recursive: true });
fs.mkdirSync(path.join(out, 'dungeon'), { recursive: true });

const KEEP_ANIMS = new Set([
  'Idle', 'Unarmed_Idle', '2H_Melee_Idle', 'Walking_A', 'Running_A', 'Jump_Full_Short',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab',
  'Dualwield_Melee_Attack_Stab', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Chop',
  '2H_Ranged_Shoot', '1H_Ranged_Shoot', '2H_Ranged_Aiming', 'Throw',
  'Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Kick',
  'Hit_A', 'Hit_B', 'Block', 'Block_Hit', 'Dodge_Left', 'Dodge_Right', 'Dodge_Backward',
  'Death_A', 'Death_A_Pose', 'Death_B', 'Death_B_Pose', 'Lie_Down', 'Lie_Idle', 'Lie_StandUp',
  'Cheer', 'Use_Item', 'Interact', 'Spellcast_Raise', 'Spellcast_Shoot', 'Spellcasting',
]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function character(name, keepAnimations) {
  const doc = await io.read(path.join(chars, `${name}.glb`));
  for (const a of doc.getRoot().listAnimations()) {
    if (keepAnimations && KEEP_ANIMS.has(a.getName())) continue;
    // disposing an animation leaves its samplers behind; drop them so prune() can
    // remove keyframe accessors nothing else uses (time inputs are often shared)
    for (const s of a.listSamplers()) s.dispose();
    for (const c of a.listChannels()) c.dispose();
    a.dispose();
  }
  await doc.transform(prune(), dedup(), weld(), quantize());
  const file = keepAnimations ? 'animations.glb' : `${name}.glb`;
  await io.write(path.join(out, 'characters', file), doc);
  console.log('characters/' + file, (fs.statSync(path.join(out, 'characters', file)).size / 1024).toFixed(0) + ' KB');
}

// one file carries the shared animation clips (the knight's mesh comes along; it is tiny)
await character('Knight', true);
for (const c of ['Knight', 'Rogue', 'Rogue_Hooded', 'Barbarian', 'Mage']) await character(c, false);

const PIECES = [
  'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small_decorated', 'floor_tile_small_weeds_A', 'floor_tile_small_weeds_B',
  'floor_tile_large_rocks', 'floor_dirt_large_rocky', 'floor_foundation_allsides',
  'wall_half', 'wall', 'wall_arched', 'wall_cracked', 'wall_corner', 'wall_pillar',
  'pillar', 'pillar_decorated', 'column', 'stairs', 'stairs_narrow',
  'barrel_large', 'barrel_small', 'barrel_small_stack', 'keg', 'crates_stacked', 'box_small', 'box_stacked',
  'torch_mounted', 'torch_lit', 'banner_red', 'banner_patternA_red', 'banner_shield_brown', 'candle_triple', 'candle_lit',
  'sword_shield_broken', 'trunk_small_A', 'rubble_half', 'coin_stack_small', 'bottle_A_green', 'plate_food_A', 'table_small', 'stool',
];
for (const p of PIECES) {
  const f = path.join(dungeon, `${p}.gltf.glb`);
  if (!fs.existsSync(f)) { console.warn('missing', p); continue; }
  const doc = await io.read(f);
  await doc.transform(prune(), dedup(), weld(), quantize());
  await io.write(path.join(out, 'dungeon', `${p}.glb`), doc);
}
fs.copyFileSync(path.join(src, 'KayKit-Character-Pack-Adventures-1.0/LICENSE.txt'), path.join(out, 'LICENSE-KayKit.txt'));
console.log(`copied ${PIECES.length} dungeon pieces`);
