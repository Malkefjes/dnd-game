// Drive the real game in a headless browser: hover + click enemies, end turns,
// screenshot along the way. node tools/playtest.mjs <url> <outDir> [maxSteps]
import { chromium } from 'playwright';
import fs from 'node:fs';
const [url, out, maxSteps = '60'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/00-start.png` });
let shot = 1;
for (let step = 0; step < +maxSteps; step++) {
  const st = await page.evaluate(() => {
    const g = window.game; const c = g.combat; const a = c.active;
    return { over: c.over, busy: g.busy, player: !!a && a.controller === 'player', id: a?.id, round: c.round,
      actions: a?.turn.actions, attacksLeft: a?.turn.attacksLeft, moved: a ? a.speed - a.turn.movement : 0 };
  });
  if (st.over) break;
  // reaction prompts (Shield, Opportunity Attacks): always say yes
  if (await page.$('.ask')) { if (shot < 14) await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-reaction.png` }); await page.keyboard.press('y'); await page.waitForTimeout(500); continue; }
  if (!st.player || st.busy) { await page.waitForTimeout(700); continue; }
  await page.waitForTimeout(1200); // let the camera settle on the active hero
  // choose the nearest visible enemy and hover it
  const target = await page.evaluate(() => {
    const g = window.game; const c = g.combat; const a = c.active;
    const es = c.enemiesOf(a).filter((e) => c.isConscious(e) && !c.cond(e, 'hidden'));
    es.sort((x, y) => Math.max(Math.abs(x.pos.x - a.pos.x), Math.abs(x.pos.y - a.pos.y)) - Math.max(Math.abs(y.pos.x - a.pos.x), Math.abs(y.pos.y - a.pos.y)));
    const e = es[0]; if (!e) return null;
    const p = g.r.project(g.r.worldOf(e.pos.x, e.pos.y)); return { ...p, id: e.id };
  });
  if (target && (st.actions > 0 || st.attacksLeft > 0)) {
    await page.mouse.move(target.x, target.y - 12);
    await page.waitForTimeout(250);
    if (shot < 6) await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-hover.png` });
    const before = await page.evaluate(() => window.game.combat.active.turn.actions + window.game.combat.active.turn.movement);
    await page.mouse.click(target.x, target.y - 12);
    await page.waitForTimeout(400);
    await page.waitForFunction(() => !window.game.busy || window.game.combat.over, null, { timeout: 30000 }).catch(() => {});
    const after = await page.evaluate(() => window.game.combat.active ? window.game.combat.active.turn.actions + window.game.combat.active.turn.movement : -1);
    if (after === before) { await page.keyboard.press('Space'); await page.waitForTimeout(600); }
  } else {
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
  }
  if (step % 6 === 5 && shot < 14) await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-step${step}.png` });
}
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/99-end.png` });
const result = await page.evaluate(() => ({ over: window.game.combat.over, round: window.game.combat.round }));
console.log(JSON.stringify({ result, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
