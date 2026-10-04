// Aim a spell at a creature in the real game and screenshot aim / cast / result.
//   CLICKS=3 node tools/spellshot.mjs "http://127.0.0.1:5173/?den=1&seed=5&speed=3" outdir magicMissile gob1
import { chromium } from 'playwright';
const [url, outdir, spell, targetId] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 400)); });
await page.goto(url);
await page.waitForFunction(() => window.game && !window.game.busy && window.game.combat.active?.controller === 'player', null, { timeout: 120000 });
const pos = await page.evaluate(([spell, t]) => { const g = window.game; g.r.setZoom(4.5); const tp = g.combat.get(t).pos; g.r.lookAt(tp.x - 2, tp.y + 1, true); g.view.handleSlot('spell:' + spell); return true; }, [spell, targetId]);
await page.waitForTimeout(1500);
const xy = await page.evaluate((t) => window.game.r.projectHead(t, -0.3), targetId);
await page.mouse.move(xy.x, xy.y);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outdir}/aim.png` });
for (let i = 1; i < Number(process.env.CLICKS ?? 1); i++) { await page.mouse.click(xy.x, xy.y); await page.waitForTimeout(1200); }
await page.screenshot({ path: `${outdir}/aim2.png` });
await page.mouse.click(xy.x, xy.y);
await page.waitForTimeout(Number(process.env.CASTWAIT ?? 2200));
await page.screenshot({ path: `${outdir}/cast.png` });
await page.waitForFunction(() => !window.game.busy, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outdir}/after.png` });
const log = await page.evaluate(() => [...document.querySelectorAll('.log-line')].slice(-12).map((d) => d.textContent).join('\n'));
console.log(log);
await browser.close();
