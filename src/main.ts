import { Game } from './game/game';
import { World } from './world/world';
import { ABBEY } from './data/maps/abbey';
import { DEN } from './data/maps/den';
import type { Level } from './data/heroes';

// URL options: ?seed=N (new game dice), ?level=1|2|3 (party level for a new game), ?new=1 (skip the
// title, start fresh), ?continue=1 (skip the title, load the save), ?den=1 (the dev goblin den fight).
const params = new URLSearchParams(location.search);
const SAVE_KEY = 'hollow-abbey-save-v1';
const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);

function readSave(): string | null { try { return localStorage.getItem(SAVE_KEY); } catch { return null; } }
function writeSave(json: string) { try { localStorage.setItem(SAVE_KEY, json); } catch { /* private mode: no saves */ } }
const go = (flag: 'new' | 'continue') => { const u = new URL(location.href); u.search = ''; u.searchParams.set(flag, '1'); location.href = u.toString(); };

function party(level: Level) {
  return ['torvald', 'nyx', 'maren', 'elowen'].map((preset) => ({ preset, level }));
}

function newWorld(): World {
  if (params.has('den')) {
    return World.newGame({ den: DEN }, { seed, mapId: 'den', party: party((Number(params.get('level')) || 3) as Level) });
  }
  // Phase 1 replaces this with the character creator; until then the four premade heroes start at level 1
  return World.newGame(ABBEY, { seed, mapId: 'abbey-1', party: party(Math.min(3, Math.max(1, Number(params.get('level')) || 1)) as Level) });
}

async function boot(world: World) {
  const loading = document.createElement('div');
  loading.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#050407;color:#e8c26a;font:600 18px Cinzel,serif;letter-spacing:.12em;z-index:20';
  loading.innerHTML = `<div style="text-align:center">${world.map.name.toUpperCase()}<div style="margin-top:14px;width:240px;height:4px;background:#2a221b;border-radius:2px;overflow:hidden"><div id="lbar" style="height:100%;width:0;background:#e8c26a;transition:width .2s"></div></div></div>`;
  document.body.appendChild(loading);
  const den = params.has('den');
  const game = await Game.create(document.getElementById('app')!, world, {
    save: (json) => { if (!den) writeSave(json); },
    loadLast: () => (den ? location.reload() : go('continue')),
    newGame: () => (den ? location.reload() : go('new')),
  }, (done, total) => { (document.getElementById('lbar') as HTMLElement).style.width = `${(done / total) * 100}%`; });
  loading.remove();
  (window as unknown as { game: Game }).game = game;
  await game.checkAmbush();
}

function title() {
  const save = readSave();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal panel">
    <h2>A D&amp;D 2024 adventure</h2>
    <h1>The Hollow Abbey</h1>
    <p>The Abbey of Saint Aldric sealed its crypts a century ago. Now the dead walk out of them at night, and
    something older than the dead is giving the orders.</p>
    <div class="controls">
      <b>Left click</b><span>walk (the party follows) · doors, notes and stairs: click them</span>
      <b>Tab</b><span>change who leads · <b>WASD · wheel</b> pan · zoom</span>
      <b>In a fight</b><span>1–0 actions · Shift + 1–0 spells · Space ends the turn · Y / N reactions</span>
      <b>Note</b><span>Milestone 3, Phase 0: a test version of the first two floors with the premade party. The
      character creator comes next.</span>
    </div>
    <div class="title-buttons"></div>
  </div>`;
  const row = back.querySelector('.title-buttons')!;
  const button = (label: string, secondary: boolean, onClick: () => void) => {
    const b = document.createElement('button'); b.className = `btn ${secondary ? 'secondary' : ''}`; b.textContent = label;
    b.addEventListener('click', () => { back.remove(); onClick(); }); row.appendChild(b);
  };
  if (save) button('Continue', false, () => boot(World.load(ABBEY, save)));
  button('New Game', !!save, () => boot(newWorld()));
  document.body.appendChild(back);
}

if (params.has('den') || params.has('new')) boot(newWorld());
else if (params.has('continue') && readSave()) boot(World.load(ABBEY, readSave()!));
else title();
