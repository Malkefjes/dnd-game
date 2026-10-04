import { GameController } from './game/controller';
import { GOBLIN_DEN, goblinDen } from './game/encounters';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
// loading screen while the 3D assets stream in
const loading = document.createElement('div');
loading.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#050407;color:#e8c26a;font:600 18px Cinzel,serif;letter-spacing:.12em;z-index:20';
loading.innerHTML = '<div style="text-align:center">THE GOBLIN DEN<div style="margin-top:14px;width:240px;height:4px;background:#2a221b;border-radius:2px;overflow:hidden"><div id="lbar" style="height:100%;width:0;background:#e8c26a;transition:width .2s"></div></div></div>';
document.body.appendChild(loading);
const game = await GameController.create(document.getElementById('app')!, GOBLIN_DEN, goblinDen(seed), () => {
  const url = new URL(location.href); url.searchParams.delete('seed'); url.searchParams.set('play', '1'); location.href = url.toString();
}, (done, total) => { (document.getElementById('lbar') as HTMLElement).style.width = `${(done / total) * 100}%`; });
loading.remove();
(window as unknown as { game: GameController }).game = game;

const intro = `
  <h2>Milestone 1 · D&amp;D 2024 rules</h2>
  <h1>The Goblin Den</h1>
  <p>Torvald the dwarf fighter and Nyx the halfling rogue have tracked the raiders to their lair. Grukk the goblin boss
  and his band are waiting in the torchlight.</p>
  <div class="controls">
    <b>Left click</b><span>move to a square, or attack an enemy (you'll walk into range first)</span>
    <b>1 – 0</b><span>pick an action from the hotbar · <b>right click / Esc</b> cancels</span>
    <b>Space</b><span>end turn</span>
    <b>WASD · wheel</b><span>pan (or right-drag) · zoom</span>
    <b>Tips</b><span>Sneak Attack needs Advantage or an ally next to the target. Leaving an enemy's reach provokes an
    Opportunity Attack unless you Disengage. Hide behind pillars. Feed a potion to a fallen friend.</span>
  </div>`;

if (params.has('play') || params.has('seed')) game.begin();
else game.hud.modal(intro, [
  { label: 'Begin', onClick: () => game.begin() },
]);
