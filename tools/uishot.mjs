// Screenshot the HUD at several viewport sizes on a given hero's turn (for UI review).
//   node tools/uishot.mjs <url> <outdir> [heroId] [hoverEnemyId]
import { chromium } from 'playwright';
import fs from 'node:fs';
const [url, out, hero = 'maren', hover = 'gob1'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.game && !window.game.busy && window.game.combat.active?.controller === 'player', null, { timeout: 180000 });
  await page.evaluate((id) => { const g = window.game; const c = g.combat; c.turnIndex = c.order.indexOf(id); g.view.activeId = id; g.view.refreshHud(); const p = c.get(id).pos; g.r.lookAt(p.x + 2, p.y - 2, true); }, hero);
  await page.waitForTimeout(1500);
  const xy = await page.evaluate((t) => window.game.r.projectHead(t, -0.3), hover);
  await page.mouse.move(xy.x, xy.y);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${w}-hover.png` });
  await page.mouse.move(w / 2 + 10, h - 40);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${w}-bar.png` });
  await page.close();
}
await browser.close();
