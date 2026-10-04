// Screenshot the game after running some JS against window.game.
//   node tools/view.mjs <url> <out.png> "<js using g>" [waitMs]
import { chromium } from 'playwright';
const [url, out, js = '', wait = '4000'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 400)); });
await page.goto(url);
await page.waitForFunction(() => window.game, null, { timeout: 90000 });
if (js) await page.evaluate((code) => { const g = window.game; new Function('g', code)(g); }, js);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
