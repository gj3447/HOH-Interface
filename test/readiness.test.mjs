import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatReadiness } from '../ui/hoh-ui.js';

test('chat readiness reads the general chat provider first, HSWM chat as the fallback, the live status before bootstrap', () => {
  assert.deepEqual(chatReadiness({ chat: { status: 'READY', reason: 'host-ai' }, hswm: { status: 'NOT_READY' } }), { status: 'READY', reason: 'host-ai' });
  assert.deepEqual(chatReadiness({ hswm: { status: 'NOT_READY', reason: 'hswm_not_ready' } }), { status: 'NOT_READY', reason: 'hswm_not_ready' });
  assert.deepEqual(chatReadiness(null, { chat: { status: 'READY' } }), { status: 'READY' });
  assert.deepEqual(chatReadiness({ chat: { status: 'NOT_READY', reason: 'off' } }, { chat: { status: 'READY' } }), { status: 'NOT_READY', reason: 'off' });
  assert.equal(chatReadiness(undefined, {}), null);
});
