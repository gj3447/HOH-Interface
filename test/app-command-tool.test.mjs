import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AppPackageError, appSha256, readMmBundle } from '../protocol/app-package.js';
import { mountAppContent } from '../ui/app-content-host.js';

const pkg = JSON.parse(await readFile(new URL('./fixtures/packaged-app/content.json', import.meta.url), 'utf8'));
const template = await readFile(new URL('./fixtures/packaged-app/app.html', import.meta.url), 'utf8');
async function bundle(tools) {
  const bytes = JSON.stringify({ schema: 'mm.content-bundle/v1', source: { repository: 'fixture', revision: '1'.repeat(40), dir: 'test/fixtures/packaged-app', fixture: true },
    package: { ...structuredClone(pkg), tools }, template, templateSha256: await appSha256(template) });
  return readMmBundle(bytes, { expectedDigest: await appSha256(bytes), allowFixture: true });
}

/** The smallest page surface the host touches; the "app" is driven by posting its messages. */
function page() {
  const listeners = new Set(), sent = [], waiting = [];
  const frame = { contentWindow: { postMessage(message) { sent.push(message); for (const w of waiting.splice(0)) w(); } }, setAttribute() {}, remove() {}, getBoundingClientRect: () => ({ width: 800, height: 600 }) };
  Object.assign(globalThis, { document: { createElement: () => frame }, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    matchMedia: () => ({ matches: false }), location: { href: 'https://host.example/', origin: 'https://host.example' } });
  let id = 0;
  const post = data => { for (const fn of [...listeners]) void fn({ source: frame.contentWindow, origin: 'null', data: { jsonrpc: '2.0', channel: /"([0-9a-f-]{36})"/.exec(frame.srcdoc)[1], ...data } }); };
  const reply = async key => { const deadline = Date.now() + 3000; for (;;) { const found = sent.find(m => m.id === key && m.method === undefined); if (found) return found;
    if (Date.now() > deadline) throw new Error('no reply to ' + key); await new Promise(resolve => { waiting.push(resolve); setTimeout(resolve, 50).unref(); }); } };
  return { frame, sent, post, async request(method, params) { const key = `app-${++id}`; post({ id: key, method, params }); return reply(key); } };
}
async function mounted(tools, authorize = () => true) {
  const view = page(), requests = [];
  const app = await mountAppContent({ bundle: await bundle(Object.keys(tools)), timeoutMs: 2000,
    host: { id: 'test-host', principalId: 'p1', tools, authorize: request => { requests.push(request); return authorize(request); } } });
  const init = await view.request('ui/initialize', { protocolVersion: 'ailab-apps/1' });
  view.post({ method: 'ui/notifications/initialized' });
  await new Promise(resolve => setImmediate(resolve));
  return { ...view, app, requests, init };
}
const text = message => message.result.content[0].text;

test('a command provider receives one host-minted request identity and its own authorization', async () => {
  const calls = [];
  const m = await mounted({ ext: { effect: 'command', call: (input, context) => { calls.push({ input, requestId: context.requestId }); return { revision: 2 }; } },
    look: { effect: 'read', call: (_, context) => ({ requestId: context.requestId ?? null }) } });
  assert.deepEqual(m.init.result.hostCapabilities.serverTools.effects, { ext: 'command', look: 'read' });
  const done = await m.request('tools/call', { name: 'ext', arguments: { actionId: 'play', requestId: 'app-chosen' } });
  assert.deepEqual(done.result.structuredContent, { revision: 2 });
  assert.match(calls[0].requestId, /^[0-9a-f-]{36}$/);
  assert.equal(calls[0].input.requestId, 'app-chosen', 'app input stays input; it is not the request identity');
  const gate = m.requests.find(r => r.operation === 'command');
  assert.equal(gate.tool, 'ext'); assert.equal(gate.requestId, calls[0].requestId);
  assert.equal((await m.request('tools/call', { name: 'look', arguments: {} })).result.structuredContent.requestId, null);
  assert.ok(m.requests.some(r => r.operation === 'tool' && r.tool === 'look'));
  m.app.close();
});

test('a denied command never reaches its provider', async () => {
  let called = 0;
  const m = await mounted({ ext: { effect: 'command', call: () => { called += 1; return {}; } } }, request => request.operation !== 'command');
  const denied = await m.request('tools/call', { name: 'ext', arguments: {} });
  assert.equal(denied.result.isError, true); assert.equal(text(denied), 'DENIED'); assert.equal(called, 0);
  m.app.close();
});

test('an unknown command failure is reported as uncertain; a definite refusal keeps its code', async () => {
  let mode = 'lost';
  const m = await mounted({ ext: { effect: 'command', call: () => { if (mode === 'lost') throw new Error('socket closed'); throw new AppPackageError('STALE_REVISION', 'changed'); } },
    look: { effect: 'read', call: () => { throw new Error('boom'); } } });
  assert.equal(text(await m.request('tools/call', { name: 'ext', arguments: {} })), 'EXECUTION_UNCERTAIN');
  mode = 'refused';
  assert.equal(text(await m.request('tools/call', { name: 'ext', arguments: {} })), 'STALE_REVISION');
  assert.equal(text(await m.request('tools/call', { name: 'look', arguments: {} })), 'HANDLER_FAILED', 'a failed read is not an uncertain write');
  m.app.close();
});

test('commands run one at a time while reads stay available', async () => {
  let release;
  const m = await mounted({ ext: { effect: 'command', call: () => new Promise(resolve => { release = () => resolve({ ok: true }); }) }, look: { effect: 'read', call: () => ({ seen: true }) } });
  const first = m.request('tools/call', { name: 'ext', arguments: {} });
  await new Promise(resolve => setImmediate(resolve));
  const second = await m.request('tools/call', { name: 'ext', arguments: {} });
  assert.equal(second.error.message, 'BUSY');
  assert.deepEqual((await m.request('tools/call', { name: 'look', arguments: {} })).result.structuredContent, { seen: true });
  release(); assert.deepEqual((await first).result.structuredContent, { ok: true });
  const third = m.request('tools/call', { name: 'ext', arguments: {} });
  await new Promise(resolve => setImmediate(resolve)); release();
  assert.deepEqual((await third).result.structuredContent, { ok: true }, 'the slot is free again after the first command settles');
  m.app.close();
});

test('undeclared, unregistered and unsupported providers are refused before any call', async () => {
  const b = await bundle(['ext']), host = tools => ({ id: 'h', principalId: 'p', authorize: () => true, tools });
  page();
  await assert.rejects(mountAppContent({ bundle: b, host: host({}) }), { code: 'PROVIDER_UNAVAILABLE' });
  await assert.rejects(mountAppContent({ bundle: b, host: host({ ext: { effect: 'write', call: () => ({}) } }) }), { code: 'PROVIDER_UNAVAILABLE' });
  const m = await mounted({ ext: { effect: 'command', call: () => ({}) } });
  assert.equal((await m.request('tools/call', { name: 'other', arguments: {} })).error.message, 'UNDECLARED_TOOL');
  m.app.close();
});
