// Pan-stability check: freeze time, move the camera by exactly one screen pixel, and compare the
// two frames shifted by that pixel. A stable picture differs only at the screen edge (score ≈ 0);
// any pattern fixed to the screen (dither, banding) shows up as a high score — that's "shaking".
//   node tools/pancheck.mjs [url]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5173/?den=1&seed=5';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.game && !window.game.busy && window.game.combat.active?.controller === 'player', null, { timeout: 180000 });
await page.waitForTimeout(3000);
const result = await page.evaluate(async () => {
  const r = window.game.r;
  r.timeScale = 0; // freeze animation, flicker and dust
  const grab = () => { r.frame(0); return r.renderer.domElement.toDataURL(); };
  const px = async (url) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, c.width, c.height);
  };
  const texel = (2 * r.zoom) / r.lowH;
  const right = r.camRight.clone();
  const step = async (dx, dy) => {
    const f0 = r.focus.clone();
    const a = await px(grab());
    const p = f0.clone().addScaledVector(right, dx * texel).addScaledVector(r.camUp, dy * texel);
    r.focus.copy(p); r.focusGoal.copy(p);
    const b = await px(grab());
    r.focus.copy(f0); r.focusGoal.copy(f0);
    // camera moved dx px right / dy px up → b(x, y) ≈ a(x - dx, y + dy) in image rows (y down).
    // Score every candidate shift; a pixel-stable picture matches best at exactly (-dx, dy) with ≈ 0.
    const score = (sx, sy) => {
      let sum = 0, n = 0;
      for (let y = 20; y < a.height - 20; y++) for (let x = 20; x < a.width - 20; x++) {
        const i = (y * a.width + x) * 4, j = ((y + sy) * a.width + x + sx) * 4;
        sum += Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2]);
        n++;
      }
      return sum / n;
    };
    let best = { sx: 0, sy: 0, s: Infinity };
    for (let sy = -3; sy <= 3; sy++) for (let sx = -3; sx <= 3; sx++) { const v = score(sx, sy); if (v < best.s) best = { sx, sy, s: v }; }
    return `expected (${-dx},${dy}) ${score(-dx, dy).toFixed(1)} · best (${best.sx},${best.sy}) ${best.s.toFixed(1)}`;
  };
  return { right1: await step(1, 0), right2: await step(2, 0), up1: await step(0, 1), none: await step(0, 0) };
});
console.log(JSON.stringify(result));
await browser.close();
