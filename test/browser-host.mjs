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

  // 0.4.0 — the feed continues, comments carry authors and removal, reactions carry counts, answers stream and render as the host draws them
  await page.locator('[data-home]').click(); await page.locator('.dashboard-card').waitFor();
  await page.locator('[data-dashboard-content-id="tool"]').first().click(); await page.locator('#viewerTitle', { hasText: '도구 앱' }).waitFor();
  await page.locator('[data-next]').click();
  await page.locator('#viewerTitle', { hasText: '더 받은 콘텐츠' }).waitFor({ timeout: 5000 });
  check((await page.locator('#position').textContent()) === '3 / 3', 'the feed asks for the next page at its end');
  await page.locator('[data-next]').click(); await page.locator('#viewerTitle', { hasText: '메모' }).waitFor({ timeout: 5000 });
  check((await page.locator('#position').textContent()) === '1 / 3', 'with nothing more it wraps to the start');

  const like = page.locator('[data-reaction="like"]');
  check(await like.locator('.reaction-count').textContent() === '2' && await like.getAttribute('aria-label') === '좋아요 2' && (await like.getAttribute('title')).includes('김연구'), 'reaction counts and who pressed show on the button');
  await like.click(); await page.waitForFunction(() => document.querySelector('[data-reaction="like"] .reaction-count')?.textContent === '3');
  check(await like.getAttribute('aria-pressed') === 'true', 'a reaction updates the count the host returns');
  await page.locator('[data-comment]').click();
  check((await page.locator('#comments li').first().locator('.comment-meta').textContent()).startsWith('김연구 · '), 'comments carry author and time');
  check(await page.locator('#commentScope').textContent() === '이 예제의 모든 사람', 'the host says who sees the comments');
  check(await page.locator('#comments [data-delete-comment]').count() === 1, 'only comments the person may delete offer «지우기»');
  await page.locator('#comments [data-delete-comment]').click();
  await page.waitForFunction(() => document.querySelectorAll('#comments li').length === 1);
  check(!(await page.locator('#comments').textContent()).includes('제가 단 댓글'), 'a comment can be removed');
  await page.keyboard.press('Escape');

  await page.locator('#chatInput').fill('자세히 알려줘'); await page.locator('#chatInput').press('Enter');
  await page.locator('#messages li.answer.pending .answer-steps li', { hasText: '콘텐츠를 살펴보는 중' }).waitFor({ timeout: 3000 });
  check(await page.locator('#messages li.answer.pending .answer-stop').isVisible(), 'while the answer comes: the steps and «멈추기»');
  await page.locator('#messages li.answer:not(.pending) strong', { hasText: '굵게' }).waitFor({ timeout: 5000 });
  check(await page.locator('#messages li.answer.pending').count() === 0, 'the finished answer is drawn by the host renderer');

  await page.locator('#chatInput').fill('길게 설명해줘'); await page.locator('#chatInput').press('Enter');
  await page.locator('#messages li.answer.pending .answer-text').filter({ hasText: '답:' }).waitFor({ timeout: 3000 });
  await page.locator('#messages li.answer.pending .answer-stop').click();
  await page.locator('#messages li.answer', { hasText: '(응답을 멈췄습니다)' }).waitFor({ timeout: 3000 });
  check(true, '«멈추기» keeps what came and says it stopped');

  await page.locator('#chatInput').fill('도구 열어줘'); await page.locator('#chatInput').press('Enter');
  await page.locator('#viewerTitle', { hasText: '도구 앱' }).waitFor({ timeout: 5000 });
  check((await page.locator('#messages li').allTextContents()).includes('답: 도구 열어줘'), 'an answer can open a content after it is shown');

  await page.locator('#chatInput').fill('넘겨도 남아'); await page.locator('#chatInput').press('Enter');
  await page.locator('[data-next]').click();
  await page.locator('#messages li.answer', { hasText: '답: 넘겨도 남아' }).waitFor({ timeout: 5000 });
  check(true, 'an answer stays in the conversation when the person moves on');

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
