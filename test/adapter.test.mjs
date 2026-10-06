import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProgramFeedAdapter } from '../adapters/program-feed.js';

test('adapter keeps session credentials private and maps durable mutations to the host contract', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, ...init });
    const value = url.endsWith('/session') ? { csrfToken: 'fixture-csrf', profile: { viewRevision: 8 } } : { ok: true };
    return new Response(JSON.stringify(value), { status: 200 });
  });
  const adapter = createProgramFeedAdapter({ base: '/chosen-host' });
  const boot = await adapter.bootstrap();
  assert.equal(boot.csrfToken, undefined);
  assert.equal(boot.profile.viewRevision, 8);
  await adapter.open({ contentId: 'app', expectedViewRevision: 8 });
  await adapter.favorite({ contentId: 'app', favorite: true, viewRevision: 9, principalId: 'ignored' });
  await adapter.saveState({ contentId: 'app', state: { score: 4 }, viewRevision: 9 });
  assert.equal(calls[0].headers['X-CSRF-Token'], undefined);
  assert.equal(calls[1].headers['X-CSRF-Token'], 'fixture-csrf');
  assert.deepEqual(JSON.parse(calls[1].body), { contentId: 'app', expectedViewRevision: 8 });
  const favorite = JSON.parse(calls[2].body), state = JSON.parse(calls[3].body);
  assert.equal(favorite.principalId, undefined);
  assert.equal(favorite.favorite, true);
  assert.equal(favorite.viewRevision, 9);
  assert.match(favorite.requestId, /^[0-9a-f-]{36}$/);
  assert.notEqual(favorite.requestId, state.requestId);
  assert.equal(calls[3].method, 'PUT');
  assert.deepEqual(state.state, { score: 4 });
  assert.ok(calls.every(call => call.credentials === 'same-origin'));
});

test('profile and feed mapping remain host-owned; unavailable AI rejects without fabricating an answer', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/chat')) return new Response(JSON.stringify({ reason: 'hswm_not_ready' }), { status: 503 });
    if (url.endsWith('/profile')) return new Response(JSON.stringify({ favorites: [{ id: 'article' }] }));
    return new Response(JSON.stringify({ items: [{ content: { id: 'account-home' } }, { content: { id: 'article' } }], cursor: 'next' }));
  });
  const adapter = createProgramFeedAdapter();
  const feed = await adapter.list();
  assert.deepEqual(feed.items.map(item => item.content.id), ['article']);
  assert.equal(feed.cursor, 'next');
  assert.deepEqual(await adapter.profile(), { profile: { favorites: [{ id: 'article' }] } });
  await assert.rejects(adapter.chat({ contentId: 'article', message: 'fixture', viewRevision: 1 }), error => error.status === 503 && error.message === 'hswm_not_ready');
});
