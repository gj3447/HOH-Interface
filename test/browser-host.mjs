import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Host-facing shell behaviour in a real browser against examples/host-contract (no backend): host dashboard icons,
// host-declared resources per content, a host-initiated open that keeps a pending AI answer, light-theme contrast.
const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const modulePath = option('--playwright-module'), executablePath = option('--browser-executable');
const base = option('--url') ?? 'http://127.0.0.1:8021';
if (!modulePath || !executablePath) throw new Error('Usage: node test/browser-host.mjs --playwright-module PATH --browser-executable PATH [--url URL]');
const root = new URL(base);
if (root.protocol !== 'http:' || root.hostname !== '127.0.0.1' || root.username || root.password) throw new Error('Use an explicit loopback preview URL');
const chromium = createRequire(import.meta.url)(resolve(modulePath)).chromium;
const report = { checks: [] };
const check = (value, name) => { if (!value) throw new Error(name); report.checks.push(name); };
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(new URL('/host/', root).href, { waitUntil: 'networkidle' });
  await page.locator('.dashboard-card').waitFor();
  const icons = await page.locator('.app-grid button .app-icon').evaluateAll(nodes => nodes.map(node => node.firstChild?.textContent || ''));
  check(icons[0] === '✎' && icons[1] === '⚒', 'host-supplied dashboard icons render');
  check(icons[2] === '◈' && icons[3] === '✓', 'missing or over-long host icons fall back to the kind icon');
  const badges = await page.locator('.app-grid button .app-badge').allTextContents();
  check(badges.join(',') === '3,99+', 'host counts show on the icon, capped at 99+');
  const named = await page.locator('[data-dashboard-content-id="note"]').first().evaluate(node => node.textContent.replace(/\s+/g, ' '));
  check(named.includes('새 항목 3개'), 'a count is also read out in words with the app name');

  await page.locator('[data-dashboard-content-id="tool"]').first().click();
  await page.locator('#viewerTitle', { hasText: '도구 앱' }).waitFor();
  const visible = selector => page.locator(selector).first().isVisible();
  check(!await visible('[data-reaction="like"]') && !await visible('[data-reaction="dislike"]') && !await visible('[data-comment]'), 'reactions and comments hidden where the host does not accept them');
  check(await visible('[data-share]') && await visible('[data-save]'), 'share and save stay where the host accepts them');
  await page.locator('[data-home]').click(); await page.locator('.dashboard-card').waitFor();
  await page.locator('[data-dashboard-content-id="note"]').first().click();
  await page.locator('#viewerTitle', { hasText: '메모' }).waitFor();
  check(await visible('[data-reaction="like"]') && await visible('[data-comment]') && await visible('[data-share]') && await visible('[data-save]'), 'every resource shows when the host says nothing');

  await page.locator('#chatInput').fill('저장해 줘');
  await page.locator('#chatInput').press('Enter');
  const opened = page.evaluate(() => window.hohExample.open('tool', { initiator: 'host' }));
  await page.locator('#viewerTitle', { hasText: '도구 앱' }).waitFor({ timeout: 5000 });
  check((await page.locator('#messages li').allTextContents()).includes('답: 저장해 줘'), 'a host-initiated open keeps the AI answer the person was waiting for');
  check(JSON.stringify(await opened) === JSON.stringify({ applies: true, contentId: 'tool' }), 'ui.open says the content is on screen');
  const missing = await page.evaluate(() => window.hohExample.open('missing'));
  check(missing.applies === false && missing.reason === 'failed' && Boolean(missing.message), 'ui.open says when a content could not open');
  check(await page.locator('#messages').getAttribute('tabindex') === '0' && await page.locator('#messages').getAttribute('aria-label') === '대화', 'the scrolling chat list is reachable by keyboard and named');

  const ratios = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement), hex = name => css.getPropertyValue(name).trim();
    const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    return { tealOnSurface2: ratio(hex('--teal'), hex('--surface-2')), tealOnBg: ratio(hex('--teal'), hex('--bg')), whiteOnTealDark: ratio('#ffffff', hex('--teal-dark')) };
  });
  check(ratios.tealOnSurface2 >= 4.5 && ratios.tealOnBg >= 4.5 && ratios.whiteOnTealDark >= 4.5, 'light theme teal text and white-on-teal buttons meet 4.5:1');
  check(!errors.length, 'no page errors');
  await context.close();
  console.log(JSON.stringify({ status: 'PASS', ratios: Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, Math.round(v * 100) / 100])), ...report }));
} finally { await browser.close(); }
