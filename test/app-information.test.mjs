import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appSha256, readMmBundle } from '../protocol/app-package.js';
import { mountAppContent } from '../ui/app-content-host.js';

const pkg = JSON.parse(await readFile(new URL('./fixtures/packaged-app/content.json', import.meta.url), 'utf8'));
const template = await readFile(new URL('./fixtures/packaged-app/app.html', import.meta.url), 'utf8');
async function mounted(t, { allow = true, supports = true } = {}) {
  const raw = JSON.stringify({ schema: 'mm.content-bundle/v1', source: { repository: 'fixture', revision: '1'.repeat(40), dir: 'fixture', fixture: true },
    package: { ...pkg, tools: [] }, template, templateSha256: await appSha256(template) });
  const bundle = await readMmBundle(raw, { expectedDigest: await appSha256(raw), allowFixture: true });
  const listeners = new Set(), sent = [], shown = [], operations = [];
  const frame = { contentWindow: { postMessage: message => sent.push(message) }, setAttribute() {}, remove() {},
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }) };
  const globals = { document: { createElement: () => frame }, addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn), matchMedia: () => ({ matches: false }),
    location: { href: 'https://host.example/', origin: 'https://host.example' } };
  const prior = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  let sequence = 0;
  const app = await mountAppContent({ bundle, timeoutMs: 2000, host: { id: 'fixture-host', principalId: 'viewer',
    authorize: request => { operations.push(request.operation); return request.operation !== 'information' || allow; },
    draftMessage() { assert.fail('information must not create a user command'); },
    ...(supports ? { information: value => { shown.push(value); return true; } } : {}) } });
  t.after(() => { app.close(); for (const [key, descriptor] of Object.entries(prior)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const channel = /"([0-9a-f-]{36})"/.exec(frame.srcdoc)[1];
  const post = (data, source = frame.contentWindow) => {
    for (const fn of listeners) void fn({ source, origin: 'null', data: { jsonrpc: '2.0', channel, ...data } });
  };
  const request = async (method, params) => {
    const id = `fixture-${++sequence}`; post({ id, method, params });
    for (let i = 0; i < 100; i++) {
      const reply = sent.find(row => row.id === id && row.method === undefined);
      if (reply) return reply;
      await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error('Missing bounded host reply');
  };
  await request('ui/initialize', { protocolVersion: 'ailab-apps/1' });
  post({ method: 'ui/notifications/initialized' });
  await new Promise(resolve => setImmediate(resolve));
  return { request, post, shown, operations, channel };
}

test('informational text uses its authorized host callback and bounded coordinates', async t => {
  const view = await mounted(t);
  assert.deepEqual((await view.request('ailab/notifications/log', { text: 'x'.repeat(13000), about: 'a'.repeat(200), kind: 'not-a-command', from: { x: -1, y: 900 } })).result, { accepted: true });
  assert.equal(view.shown[0].text.length, 12000); assert.equal(view.shown[0].about.length, 160);
  assert.equal(view.shown[0].kind, 'explain'); assert.deepEqual(view.shown[0].origin, { x: 10, y: 620 });
  assert.ok(view.operations.includes('information'));
});
test('denial and missing capability cannot display app-provided information', async t => {
  const view = await mounted(t, { allow: false });
  assert.equal((await view.request('ailab/notifications/log', { text: 'hello' })).error.message, 'DENIED');
  assert.equal(view.shown.length, 0);
});
test('a host without the optional callback refuses the new message', async t => {
  const view = await mounted(t, { supports: false });
  assert.equal((await view.request('ailab/notifications/log', { text: 'hello' })).error.message, 'UNSUPPORTED_INFORMATION');
});
test('foreign frames and channels cannot inject informational text', async t => {
  const view = await mounted(t);
  view.post({ method: 'ailab/notifications/log', params: { text: 'foreign' } }, {});
  view.post({ channel: 'foreign-channel', method: 'ailab/notifications/log', params: { text: 'foreign' } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(view.shown.length, 0);
});
test('information has a bounded ten-second budget', async t => {
  t.mock.method(Date, 'now', () => 1000);
  const view = await mounted(t);
  for (let i = 0; i < 20; i++) assert.deepEqual((await view.request('ailab/notifications/log', { text: 'ok' })).result, { accepted: true });
  assert.equal((await view.request('ailab/notifications/log', { text: 'excess' })).error.message, 'BUSY');
  assert.equal(view.shown.length, 20);
});
