import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const playwrightModule = option('--playwright-module');
const browserExecutable = option('--browser-executable');
const url = option('--url') ?? 'http://127.0.0.1:8020/feed/';
if (!playwrightModule || !browserExecutable || args.some((value, index) => value.startsWith('--') && !['--playwright-module', '--browser-executable', '--url'].includes(value)) || args.length !== (option('--url') ? 6 : 4)) {
  throw new Error('Usage: node test/browser-context.mjs --playwright-module PATH --browser-executable PATH [--url http://127.0.0.1:8020/feed/]');
}
const parsedUrl = new URL(url);
if (parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1' || !/^\/feed\/?$/.test(parsedUrl.pathname) || parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
  throw new Error('--url must be an explicit local http://127.0.0.1:PORT/feed/ preview URL');
}
const module = createRequire(import.meta.url)(resolve(playwrightModule));
const chromium = module.chromium ?? module.default?.chromium;
if (!chromium) throw new Error('The supplied module does not export Playwright chromium');
const result = { checks: [] };
const check = (condition, name) => { if (!condition) throw new Error(name); result.checks.push(name); };
const browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.route('**/feed/app.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
import { mountHohUI } from '/feed/hoh-ui.js';
const listed = {
  a: { id: 'a', title: 'Renderer A', payload: { label: 'listed-A' } },
  b: { id: 'b', title: 'Renderer B', payload: { label: 'listed-B' } }
};
const opened = {
  a: { id: 'a', title: 'Renderer A', payload: { label: 'fresh-A' } },
  b: { id: 'b', title: 'Renderer B', payload: { label: 'fresh-B' } }
};
let revision = 0;
const calls = { open: [], save: [] }, captures = { a: [], b: [] };
const adapter = {
  bootstrap: async () => ({ profile: {} }),
  list: async () => ({ items: Object.values(listed).map(content => ({ content, manifest: { kind: 'CUSTOM' }, reasons: [] })) }),
  open: async ({ contentId }) => { calls.open.push(contentId); const content = opened[contentId]; return { content, manifest: { kind: 'CUSTOM' }, viewRevision: ++revision, appState: {}, comments: [], favorite: false }; },
  favorite: async () => ({ viewRevision: ++revision }), react: async () => ({ viewRevision: ++revision }), comment: async () => ({ comments: [], viewRevision: ++revision }),
  saveState: async ({ contentId, state }) => { calls.save.push({ contentId, state }); return { appState: state, viewRevision: ++revision }; },
  chat: async () => { throw new Error('fixture offline'); }, profile: async () => ({ profile: { favorites: [] } }), status: async () => ({})
};
const renderer = ({ item, context, open, saveState, signal, isCurrent }) => {
  const capture = { context, open, saveState, signal, isCurrent };
  captures[item.content.id].push(capture);
  const button = document.createElement('button'); button.id = 'fixture-' + item.content.id; button.textContent = item.content.payload.label; return button;
};
window.__fixture = { calls, captures };
window.__hoh = mountHohUI({ root: document.querySelector('#hoh-root'), adapter, renderers: { CUSTOM: renderer }, homeContentId: 'fixture-home', workspaceName: 'Fixture' });
` }));
  const fixtureUrl = new URL(parsedUrl); fixtureUrl.searchParams.set('content', 'a');
  await page.goto(fixtureUrl.href, { waitUntil: 'networkidle' });
  await page.locator('#fixture-a').waitFor();
  check(await page.locator('#fixture-a').textContent() === 'fresh-A', 'open response replaces stale ranked item payload');
  check(await page.locator('.brand').textContent() === 'HOH Interface', 'HOH Interface brand is visible');
  check(await page.evaluate(() => { const context = window.__fixture.captures.a[0]?.context; return window.__fixture.captures.a.length === 1 && Object.isFrozen(context) && context.contentId === 'a' && Number.isInteger(context.viewRevision) && context.viewRevision > 0; }), 'renderer A receives an immutable captured context');
  await page.evaluate(() => window.__hoh.open('b', 1)); await page.locator('#fixture-b').waitFor();
  const staleA = await page.evaluate(async () => {
    const action = window.__fixture.captures.a[0];
    return { save: await action.saveState({ from: 'stale-a' }), open: await action.open('a') };
  });
  check(staleA.save?.applies === false && staleA.save?.reason === 'stale_context', 'A stale save is rejected without an adapter write');
  check(staleA.open?.applies === false && staleA.open?.reason === 'stale_context', 'A stale open is rejected without navigation');
  check(await page.evaluate(() => window.__fixture.calls.save.length === 0 && window.__fixture.calls.open.join(',') === 'a,b'), 'stale A produced no adapter calls');
  check(await page.locator('#viewerTitle').textContent() === 'Renderer B', 'stale A leaves B current');
  check(await page.evaluate(() => window.__fixture.captures.a[0].signal.aborted && !window.__fixture.captures.b[0].signal.aborted), 'navigation aborts A render signal only');
  const currentB = await page.evaluate(() => window.__fixture.captures.b[0].saveState({ from: 'current-b' }));
  check(currentB?.applies === true, 'current B save applies');
  check(await page.evaluate(() => window.__fixture.calls.save.length === 1 && window.__fixture.calls.save[0].contentId === 'b'), 'current B writes only B state');
  const staleB = await page.evaluate(async () => window.__fixture.captures.b[0].saveState({ from: 'rerendered-b' }));
  check(staleB?.applies === false && staleB?.reason === 'stale_context', 'B capability expires after its own rerender');
  await page.evaluate(() => window.__hoh.open('a', 0)); await page.locator('#fixture-a').waitFor();
  const oldA = await page.evaluate(() => window.__fixture.captures.a[0].saveState({ from: 'old-a-after-return' }));
  check(oldA?.applies === false && oldA?.reason === 'stale_context', 'A to B to A does not revive the original A capability');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.locator('.brand').isVisible() && await page.locator('#fixture-a').isVisible(), '390px fixture keeps HOH Interface and app visible before destroy');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '390px mounted fixture has no document horizontal overflow');
  const destroyResult = await page.evaluate(async () => { const action = window.__fixture.captures.a.at(-1); window.__hoh.destroy(); return { save: await action.saveState({ from: 'destroyed' }), open: await action.open('b') }; });
  check(destroyResult.save?.applies === false && destroyResult.open?.applies === false, 'destroy invalidates retained renderer actions');
  check(await page.evaluate(() => window.__fixture.calls.save.length === 1 && window.__fixture.calls.open.join(',') === 'a,b,a'), 'destroyed actions do not reach adapter');
  await context.close();
  console.log(JSON.stringify({ status: 'PASS', ...result }));
} finally { await browser.close(); }
