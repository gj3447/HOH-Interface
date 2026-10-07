import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const modulePath = option('--playwright-module'), executablePath = option('--browser-executable');
const base = option('--url') ?? 'http://127.0.0.1:8021';
const output = option('--output') ?? '/tmp/hoh-gui-qa';
if (!modulePath || !executablePath) throw new Error('Usage: node browser-gui.mjs --playwright-module PATH --browser-executable PATH [--url URL] [--output DIR]');
const root = new URL(base);
if (root.protocol !== 'http:' || root.hostname !== '127.0.0.1' || root.username || root.password) throw new Error('Use an explicit loopback preview URL');
const chromium = createRequire(import.meta.url)(resolve(modulePath)).chromium;
const report = { checks: [], screenshots: [] };
const check = (value, name) => { if (!value) throw new Error(name); report.checks.push(name); };
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
  const page = await context.newPage();
  const feed = new URL('/feed/', root).href;
  await page.goto(feed, { waitUntil: 'networkidle' });
  await page.locator('.app-shell').waitFor();
  check(await page.locator('.brand').textContent() === 'HOH Interface', 'HOH Interface label renders');
  check(await page.locator('.content-stage').isVisible() && await page.locator('.chat').isVisible(), 'desktop has content and AI chat');
  if (await page.locator('.action-rail').isHidden()) {
    await page.locator('[data-dashboard-action="feed"]').click();
    await page.locator('.action-rail').waitFor();
  }
  for (const selector of ['.action-rail button', '[data-save]', '.home-button']) {
    const boxes = await page.locator(selector).evaluateAll(nodes => nodes.map(node => { const b = node.getBoundingClientRect(); return [b.width,b.height]; }));
    check(boxes.every(([width,height]) => width >= 44 && height >= 44), selector + ' meets 44px touch target');
  }
  await page.screenshot({ path: output + '/dark-1440.png', fullPage: true }); report.screenshots.push('dark-1440.png');
  await page.setViewportSize({ width: 900, height: 900 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '900px has no horizontal page overflow');
  await page.screenshot({ path: output + '/dark-900.png', fullPage: true }); report.screenshots.push('dark-900.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sheetHandle').click();
  await page.waitForTimeout(120);
  check(await page.locator('.chat').boundingBox().then(box => box.height > 44), 'mobile handle opens a non-collapsed chat sheet');
  const handle = page.locator('#sheetHandle');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, Math.max(70, box.y - 150), { steps: 7 }); await page.mouse.up();
  check(await page.locator('.chat').boundingBox().then(current => current.height > 120), 'mobile drag keeps chat sheet continuous and open');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '390px has no horizontal page overflow');
  await page.screenshot({ path: output + '/dark-390-split.png', fullPage: true }); report.screenshots.push('dark-390-split.png');
  await page.setViewportSize({ width: 320, height: 640 });
  check(await page.locator('.brand').isVisible() && await page.locator('.content-stage').isVisible(), '320px keeps brand and content stage visible');
  await page.screenshot({ path: output + '/dark-320.png', fullPage: true }); report.screenshots.push('dark-320.png');
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(feed, { waitUntil: 'networkidle' });
  const glass = await page.locator('.action-rail').evaluate(node => getComputedStyle(node).backdropFilter);
  check(glass !== 'none', 'light mode retains glass rail blur');
  await page.keyboard.press('Tab'); check(await page.evaluate(() => document.activeElement?.matches('a,button,input,textarea')), 'keyboard reaches a named interactive control');
  await page.screenshot({ path: output + '/light-1440.png', fullPage: true }); report.screenshots.push('light-1440.png');
  const live = new URL('/realtime/?content=video', root).href;
  await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(live, { waitUntil: 'networkidle' });
  await page.locator('.realtime-card').waitFor({ timeout: 8000 });
  const rail = await page.locator('.action-rail').boundingBox(), stage = await page.locator('#contentStage').boundingBox();
  check(Boolean(rail && stage && rail.x >= stage.x && rail.x + rail.width <= stage.x + stage.width && rail.y + rail.height <= stage.y + stage.height), 'live content rail stays clipped within the stage');
  check(await page.locator('.realtime-controls button').evaluateAll(nodes => nodes.filter(node => !node.hidden).every(node => { const b=node.getBoundingClientRect(); return b.width >= 44 && b.height >= 44; })), 'visible live controls meet 44px touch targets');
  await page.screenshot({ path: output + '/realtime-390.png', fullPage: true }); report.screenshots.push('realtime-390.png');
  await context.close();
  console.log(JSON.stringify({ status:'PASS', ...report }));
} finally { await browser.close(); }
