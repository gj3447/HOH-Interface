import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContentRuntimeError, createContentRuntime } from '../protocol/runtime.js';

const actor = Object.freeze({ principalId: 'human-1', role: 'editor' });
const agent = Object.freeze({ principalId: 'agent-1', role: 'agent' });
const descriptor = {
  '@context': { id: '@id', type: '@type' }, id: 'urn:hoh:content:board', title: 'Board', description: 'A test board.', protocolVersion: '0.1', descriptorRevision: 1,
  stateSchema: { $id: 'state' }, events: ['stateChanged'], actions: [
    { id: 'setTitle', title: 'Set title', description: 'Sets the board title.', inputSchema: { $id: 'titleInput' }, outputSchema: { $id: 'titleOutput' }, effect: 'write', requiresConfirmation: false, gestureRequired: false },
    { id: 'publish', title: 'Publish', description: 'Publishes after a human gesture.', inputSchema: { $id: 'empty' }, outputSchema: { $id: 'ok' }, effect: 'write', requiresConfirmation: true, gestureRequired: true },
    { id: 'inspect', title: 'Inspect', description: 'Reads without mutation.', inputSchema: { $id: 'empty' }, outputSchema: { $id: 'titleOutput' }, effect: 'read', requiresConfirmation: false, gestureRequired: false },
    { id: 'openLink', title: 'Open link', description: 'Host adapter boundary.', inputSchema: { $id: 'empty' }, outputSchema: { $id: 'ok' }, effect: 'external', requiresConfirmation: true, gestureRequired: true }
  ]
};
function valid(schema, value) {
  if (schema.$id === 'state') return value && typeof value.title === 'string' && typeof value.count === 'number';
  if (schema.$id === 'titleInput') return value && typeof value.title === 'string';
  if (schema.$id === 'titleOutput') return value && typeof value.title === 'string';
  if (schema.$id === 'empty') return value && Object.keys(value).length === 0;
  if (schema.$id === 'ok') return value && value.ok === true;
  return false;
}
function makeHost(extra = {}) {
  return {
    description: descriptor, initialState: { title: 'start', count: 0 }, validate: valid,
    authorize: async ({ actor: trusted, request }) => trusted.principalId !== 'denied' && !request.forceDeny,
    handlers: {
      setTitle: ({ input, state }) => ({ state: { ...state, title: input.title, count: state.count + 1 }, output: { title: input.title } }),
      publish: ({ state }) => ({ state: { ...state, count: state.count + 1 }, output: { ok: true } })
      , inspect: ({ state }) => ({ state, output: { title: state.title } })
    },
    ...extra
  };
}
function request(actionId = 'setTitle', input = { title: 'next' }, revision = 0, key = 'k1') {
  return { contentId: descriptor.id, descriptorRevision: 1, actionId, input, expectedStateRevision: revision, idempotencyKey: key };
}
async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof ContentRuntimeError && error.code === code);
}

test('human GUI and agent use exactly the same invoke contract', async () => {
  const runtime = createContentRuntime(makeHost());
  const gui = await runtime.invoke(request('setTitle', { title: 'GUI' }, 0, 'human'), { actor });
  const ai = await runtime.invoke(request('setTitle', { title: 'Agent' }, 1, 'agent'), { actor: agent });
  assert.equal(gui.snapshot.state.title, 'GUI');
  assert.equal(ai.snapshot.state.title, 'Agent');
  assert.equal(ai.receipt.actor.principalId, 'agent-1');
});

test('stale GUI/agent race serializes and preserves revision CAS', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const runtime = createContentRuntime(makeHost({ handlers: { setTitle: async ({ input, state }) => { await wait; return { state: { ...state, title: input.title, count: 1 }, output: { title: input.title } }; } } }));
  const gui = runtime.invoke(request('setTitle', { title: 'GUI' }, 0, 'gui'), { actor });
  const ai = runtime.invoke(request('setTitle', { title: 'AI' }, 0, 'ai'), { actor: agent });
  release();
  assert.equal((await gui).snapshot.stateRevision, 1);
  await rejectsCode(ai, 'STALE_REVISION');
  assert.equal((await runtime.read({ actor })).state.title, 'GUI');
});

test('forged request actor is rejected and host actor is authoritative', async () => {
  const runtime = createContentRuntime(makeHost());
  await rejectsCode(runtime.invoke({ ...request(), actor: { principalId: 'admin' } }, { actor }), 'FORGED_ACTOR');
  const result = await runtime.invoke(request(), { actor });
  assert.equal(result.receipt.actor.principalId, 'human-1');
});

test('host denial, invalid schemas, handler failure and external effect do not commit', async () => {
  const denied = createContentRuntime(makeHost());
  await rejectsCode(denied.invoke(request(), { actor: { principalId: 'denied' } }), 'DENIED');
  const invalid = createContentRuntime(makeHost());
  await rejectsCode(invalid.invoke(request('setTitle', { nope: true }), { actor }), 'INVALID_INPUT');
  const badOutput = createContentRuntime(makeHost({ handlers: { setTitle: ({ state }) => ({ state, output: { wrong: true } }) } }));
  await rejectsCode(badOutput.invoke(request(), { actor }), 'INVALID_OUTPUT');
  const crash = createContentRuntime(makeHost({ handlers: { setTitle: () => { throw new Error('boom'); } } }));
  await rejectsCode(crash.invoke(request(), { actor }), 'HANDLER_FAILED');
  const external = createContentRuntime(makeHost());
  await rejectsCode(external.invoke(request('openLink', {}, 0, 'external'), { actor, confirmed: true, userGesture: true }), 'EXTERNAL_UNSUPPORTED');
  assert.equal((await invalid.read({ actor })).stateRevision, 0);
});

test('confirmation and gesture gates precede host handler execution', async () => {
  const runtime = createContentRuntime(makeHost());
  await rejectsCode(runtime.invoke(request('publish', {}, 0, 'confirm'), { actor }), 'CONFIRMATION_REQUIRED');
  await rejectsCode(runtime.invoke(request('publish', {}, 0, 'gesture'), { actor, confirmed: true }), 'GESTURE_REQUIRED');
  const result = await runtime.invoke(request('publish', {}, 0, 'ok'), { actor, confirmed: true, userGesture: true });
  assert.equal(result.output.ok, true);
});

test('idempotency replays success and error only for same principal and fingerprint', async () => {
  let calls = 0;
  const runtime = createContentRuntime(makeHost({ handlers: { setTitle: ({ input, state }) => { calls += 1; return { state: { ...state, title: input.title, count: calls }, output: { title: input.title } }; } } }));
  const one = await runtime.invoke(request('setTitle', { title: 'same' }, 0, 'same'), { actor });
  const two = await runtime.invoke(request('setTitle', { title: 'same' }, 0, 'same'), { actor });
  assert.equal(calls, 1); assert.deepEqual(one, two);
  await rejectsCode(runtime.invoke(request('setTitle', { title: 'other' }, 0, 'same'), { actor }), 'IDEMPOTENCY_MISMATCH');
  assert.equal((await runtime.invoke(request('setTitle', { title: 'same' }, 0, 'same'), { actor })).snapshot.stateRevision, 1);
  const fail = createContentRuntime(makeHost());
  await rejectsCode(fail.invoke(request('setTitle', { bad: 1 }, 0, 'bad'), { actor }), 'INVALID_INPUT');
  await rejectsCode(fail.invoke(request('setTitle', { bad: 1 }, 0, 'bad'), { actor }), 'INVALID_INPUT');
  const otherPrincipal = await runtime.invoke(request('setTitle', { title: 'same' }, 1, 'same'), { actor: agent });
  assert.equal(otherPrincipal.snapshot.stateRevision, 2);
});

test('requests and actors are captured synchronously, and read effects cannot mutate', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const runtime = createContentRuntime(makeHost({ handlers: {
    setTitle: async ({ input, state }) => { await wait; return { state: { ...state, title: input.title, count: 1 }, output: { title: input.title } }; },
    inspect: ({ state }) => ({ state: { ...state, count: state.count + 1 }, output: { title: state.title } })
  } }));
  const mutableRequest = request('setTitle', { title: 'captured' }, 0, 'captured');
  const mutableActor = { principalId: 'human-1', role: 'editor' };
  const pending = runtime.invoke(mutableRequest, { actor: mutableActor });
  mutableRequest.input.title = 'forged-later'; mutableActor.principalId = 'agent-1'; release();
  assert.equal((await pending).output.title, 'captured');
  await rejectsCode(runtime.invoke(request('inspect', {}, 1, 'read'), { actor }), 'READ_MUTATED');
  assert.equal((await runtime.read({ actor })).stateRevision, 1);
});

test('revoked policy blocks cached replay and projected snapshot is returned', async () => {
  let allowed = true;
  const runtime = createContentRuntime(makeHost({
    authorize: async ({ actor: trusted }) => allowed && trusted.principalId === 'human-1',
    projectSnapshot: ({ value }) => ({ ...value, state: { title: value.state.title } })
  }));
  const first = await runtime.invoke(request('setTitle', { title: 'private', secret: 'x' }, 0, 'replay'), { actor });
  assert.deepEqual(first.snapshot.state, { title: 'private' });
  allowed = false;
  await rejectsCode(runtime.invoke(request('setTitle', { title: 'private', secret: 'x' }, 0, 'replay'), { actor }), 'DENIED');
});

test('confirmation retries remain possible and subscriber actions do not deadlock mutation delivery', async () => {
  const runtime = createContentRuntime(makeHost());
  await rejectsCode(runtime.invoke(request('publish', {}, 0, 'retry'), { actor }), 'CONFIRMATION_REQUIRED');
  assert.equal((await runtime.invoke(request('publish', {}, 0, 'retry'), { actor, confirmed: true, userGesture: true })).snapshot.stateRevision, 1);
  let nested;
  await runtime.subscribe(snapshot => {
    if (snapshot.stateRevision === 2) { nested = runtime.invoke(request('setTitle', { title: 'from-listener' }, 2, 'listener'), { actor }); }
  }, { actor });
  await runtime.invoke(request('setTitle', { title: 'outer' }, 1, 'outer'), { actor });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await nested).snapshot.state.title, 'from-listener');
});

test('malformed JSON-compatible boundaries are rejected before a queued handler sees them', async () => {
  const runtime = createContentRuntime(makeHost());
  await rejectsCode(runtime.invoke(request('setTitle', { title: Number.NaN }, 0, 'nan'), { actor }), 'INVALID_JSON');
  const cyclic = { title: 'cycle' }; cyclic.self = cyclic;
  await rejectsCode(runtime.invoke(request('setTitle', cyclic, 0, 'cycle'), { actor }), 'INVALID_JSON');
  const polluted = JSON.parse('{"title":"x","__proto__":{"bad":true}}');
  await rejectsCode(runtime.invoke(request('setTitle', polluted, 0, 'proto'), { actor }), 'INVALID_JSON');
});

test('failed result projection leaves state untouched, and handler result is captured before policy awaits', async () => {
  const projectionFailure = createContentRuntime(makeHost({ projectSnapshot: ({ value }) => { if (value.state.title === 'next') throw new Error('private host detail'); return value; } }));
  await rejectsCode(projectionFailure.invoke(request(), { actor }), 'HANDLER_FAILED');
  assert.equal((await projectionFailure.read({ actor })).stateRevision, 0);
  const retained = { state: { title: 'captured', count: 1 }, output: { title: 'captured' } };
  const runtime = createContentRuntime(makeHost({
    handlers: { setTitle: () => retained },
    authorize: async ({ actor: trusted, request: authRequest }) => {
      if (authRequest.phase === 'prepare-result') retained.state.title = 'mutated-after-handler';
      return trusted.principalId === 'human-1';
    }
  }));
  const result = await runtime.invoke(request('setTitle', { title: 'ignored' }, 0, 'capture'), { actor });
  assert.equal(result.snapshot.state.title, 'captured');
  assert.equal((await runtime.read({ actor })).state.title, 'captured');
});

test('read-only descriptors may use a primitive JSON state and no actions', async () => {
  const runtime = createContentRuntime({
    description: { '@context': { id: '@id' }, id: 'urn:hoh:content:status', title: 'Status', description: 'Primitive state.', protocolVersion: '0.1', descriptorRevision: 1, stateSchema: true, actions: [] },
    initialState: 'ready', handlers: {}, validate: () => true, authorize: () => true
  });
  assert.equal((await runtime.read({ actor })).state, 'ready');
});

test('a result too large for the idempotency cache is rejected before committing state', async () => {
  const values = Array(3500).fill(0);
  const runtime = createContentRuntime({
    description: { ...descriptor, stateSchema: true, actions: [{ ...descriptor.actions[0], inputSchema: true, outputSchema: true }] },
    initialState: { values }, validate: () => true, authorize: () => true,
    handlers: { setTitle: ({ input }) => ({ state: { values: input.values }, output: { values: input.values } }) }
  });
  await rejectsCode(runtime.invoke(request('setTitle', { values }, 0, 'large'), { actor }), 'INVALID_JSON');
  assert.equal((await runtime.read({ actor })).stateRevision, 0);
});

test('snapshots are isolated and a failed subscriber cannot block committed state', async () => {
  const runtime = createContentRuntime(makeHost());
  const initial = await runtime.read({ actor }); initial.state.title = 'mutated';
  assert.equal((await runtime.read({ actor })).state.title, 'start');
  let observed = 0;
  await runtime.subscribe(() => { throw new Error('observer failed'); }, { actor });
  await runtime.subscribe(snapshot => { observed += snapshot.state.count; }, { actor });
  await runtime.invoke(request(), { actor });
  assert.equal((await runtime.read({ actor })).state.title, 'next');
  assert.ok(observed >= 1);
});

test('close and abort prevent an in-flight handler from committing', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const runtime = createContentRuntime(makeHost({ handlers: { setTitle: async ({ input, state }) => { await wait; return { state: { ...state, title: input.title, count: 1 }, output: { title: input.title } }; } } }));
  const pending = runtime.invoke(request(), { actor });
  await Promise.resolve();
  const closing = runtime.close(); release();
  await rejectsCode(pending, 'CLOSED'); await closing;
  await rejectsCode(runtime.read({ actor }), 'CLOSED');
  const abort = new AbortController(), second = createContentRuntime(makeHost()); abort.abort();
  await rejectsCode(second.invoke(request(), { actor, signal: abort.signal }), 'ABORTED');
});
