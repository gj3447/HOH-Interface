/** HOH Content Contract 0.1 local reference runtime. It never executes external effects. */
const ACTION_ID = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$/;
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:.+$/;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_NODES = 10_000, MAX_DEPTH = 40, MAX_STRING = 100_000;

export class ContentRuntimeError extends Error {
  constructor(code, message, details) { super(message); this.name = 'ContentRuntimeError'; this.code = code; if (details !== undefined) this.details = details; }
}
const fail = (code, message, details) => { throw new ContentRuntimeError(code, message, details); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSchema = value => value === true || value === false || isObject(value);
const frozen = value => Object.freeze(value);

/** Clone only bounded JSON values. Rejects prototype objects, cycles and non-JSON primitives. */
function json(value, label = 'value') {
  let nodes = 0; const seen = new Set();
  const visit = (entry, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) fail('INVALID_JSON', `${label} is too large or deeply nested.`);
    if (entry === null || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) fail('INVALID_JSON', `${label} contains a non-finite number.`); return entry; }
    if (typeof entry === 'string') { if (entry.length > MAX_STRING) fail('INVALID_JSON', `${label} contains an oversized string.`); return entry; }
    if (typeof entry !== 'object' || seen.has(entry)) fail('INVALID_JSON', `${label} is not JSON-compatible.`);
    seen.add(entry);
    if (Array.isArray(entry)) { const result = entry.map(item => visit(item, depth + 1)); seen.delete(entry); return result; }
    if (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) fail('INVALID_JSON', `${label} must use plain JSON objects.`);
    const result = {};
    for (const key of Object.keys(entry)) { if (BLOCKED_KEYS.has(key)) fail('INVALID_JSON', `${label} contains a prohibited key.`); result[key] = visit(entry[key], depth + 1); }
    seen.delete(entry); return result;
  };
  return visit(value, 0);
}
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function snapshotOf(descriptor, revision, state) { return frozen({ contentId: descriptor.id, descriptorRevision: descriptor.descriptorRevision, stateRevision: revision, state: frozen(json(state, 'state')) }); }
function publicError(error) {
  if (!(error instanceof ContentRuntimeError)) return { code: 'HANDLER_FAILED', message: 'A host handler failed.' };
  const result = { code: error.code, message: error.message };
  if (error.details !== undefined) result.details = json(error.details, 'error details');
  return result;
}
const restoreError = value => new ContentRuntimeError(value.code, value.message, value.details === undefined ? undefined : json(value.details));
function trustedActor(actor) { const result = json(actor, 'actor'); if (!isObject(result) || typeof result.principalId !== 'string' || !result.principalId) fail('UNTRUSTED_ACTOR', 'A trusted actor with principalId is required.'); return frozen(result); }
const throwIfAborted = signal => { if (signal?.aborted) fail('ABORTED', 'The content operation was cancelled.'); };
const requestFingerprint = request => stable({ contentId: request.contentId, descriptorRevision: request.descriptorRevision, actionId: request.actionId, input: request.input, expectedStateRevision: request.expectedStateRevision });
const cacheableError = code => !['ABORTED', 'CLOSED', 'DENIED', 'CONFIRMATION_REQUIRED', 'GESTURE_REQUIRED', 'STALE_REVISION', 'IDEMPOTENCY_MISMATCH'].includes(code);

/** @param {object} host Host-owned descriptor, policy, JSON-schema validator and pure local handlers. */
export function createContentRuntime(host) {
  if (!isObject(host) || !isObject(host.description) || !Object.hasOwn(host, 'initialState') || !isObject(host.handlers) || typeof host.validate !== 'function' || typeof host.authorize !== 'function') throw new TypeError('Content runtime requires description, initialState, handlers, validate, and authorize.');
  const descriptor = json(host.description, 'description');
  const descriptorKeys = new Set(['@context', '@type', 'id', 'title', 'description', 'protocolVersion', 'descriptorRevision', 'stateSchema', 'actions', 'profiles', 'events', 'links']);
  const unique = values => new Set(values).size === values.length;
  if (!isObject(descriptor) || Object.keys(descriptor).some(key => !descriptorKeys.has(key)) || !isObject(descriptor['@context']) || (descriptor['@type'] !== undefined && descriptor['@type'] !== 'h:Content') || !URI.test(descriptor.id || '') || typeof descriptor.title !== 'string' || !descriptor.title || typeof descriptor.description !== 'string' || !descriptor.description || descriptor.protocolVersion !== '0.1' || !Number.isInteger(descriptor.descriptorRevision) || descriptor.descriptorRevision < 1 || !isSchema(descriptor.stateSchema) || !Array.isArray(descriptor.actions) || (descriptor.profiles && (!Array.isArray(descriptor.profiles) || !unique(descriptor.profiles) || !descriptor.profiles.every(value => typeof value === 'string' && URI.test(value)))) || (descriptor.events && (!Array.isArray(descriptor.events) || !unique(descriptor.events) || !descriptor.events.every(value => value === 'stateChanged'))) || (descriptor.links && (!Array.isArray(descriptor.links) || !unique(descriptor.links) || !descriptor.links.every(value => typeof value === 'string' && URI.test(value)))) ) throw new TypeError('Invalid HOH Content Contract 0.1 descriptor.');
  const actions = new Map();
  for (const action of descriptor.actions) {
    const actionKeys = new Set(['@id', 'id', 'title', 'description', 'inputSchema', 'outputSchema', 'effect', 'requiresConfirmation', 'gestureRequired']);
    if (!isObject(action) || Object.keys(action).some(key => !actionKeys.has(key)) || !ACTION_ID.test(action.id || '') || actions.has(action.id) || !['read', 'write', 'external'].includes(action.effect) || typeof action.title !== 'string' || !action.title || typeof action.description !== 'string' || !action.description || !isSchema(action.inputSchema) || !isSchema(action.outputSchema) || typeof action.requiresConfirmation !== 'boolean' || typeof action.gestureRequired !== 'boolean' || (action['@id'] !== undefined && (typeof action['@id'] !== 'string' || !URI.test(action['@id'])))) throw new TypeError('Invalid or duplicate content action descriptor.');
    actions.set(action.id, frozen(json(action, `action ${action.id}`)));
  }
  function validate(schema, value, code, message) { let valid; try { valid = host.validate(schema, json(value, 'validated value')); } catch { fail(code, message); } if (valid !== true) fail(code, message); }
  validate(descriptor.stateSchema, host.initialState, 'INVALID_INITIAL_STATE', 'Initial state does not match stateSchema.');

  let state = json(host.initialState, 'initialState'), stateRevision = 0, closed = false, generation = 0, queue = Promise.resolve();
  const subscribers = new Map(), idempotency = new Map();
  const idempotencyLimit = Math.max(1, Math.min(1024, Number(host.idempotencyLimit) || 128));
  const current = () => snapshotOf(descriptor, stateRevision, state);
  const run = task => { const next = queue.catch(() => {}).then(task); queue = next.catch(() => {}); return next; };
  const cacheKey = (actor, key) => `${actor.principalId}\u0000${stable(actor)}\u0000${key}`;
  function remember(key, fingerprint, outcome, prepared = false) { if (idempotency.has(key)) return; idempotency.set(key, frozen({ fingerprint, outcome: prepared ? outcome : json(outcome, 'idempotency outcome') })); while (idempotency.size > idempotencyLimit) idempotency.delete(idempotency.keys().next().value); }
  async function gate(actor, request, action, signal) {
    throwIfAborted(signal); if (closed) fail('CLOSED', 'The content runtime is closed.');
    const decision = await host.authorize({ actor: json(actor), action: action ? json(action) : null, request: json(request), snapshot: current(), signal });
    throwIfAborted(signal); if (closed) fail('CLOSED', 'The content runtime is closed.');
    if (decision !== true && decision?.allowed !== true) fail('DENIED', 'The host denied this content operation.'); return decision;
  }
  async function project(kind, actor, signal, full = undefined) {
    const decision = await gate(actor, { kind, contentId: descriptor.id, descriptorRevision: descriptor.descriptorRevision }, null, signal);
    const value = full === undefined ? (kind === 'describe' ? descriptor : current()) : full, projection = kind === 'describe' ? host.projectDescription : host.projectSnapshot;
    if (typeof projection !== 'function') return json(value, kind);
    const result = await projection({ actor: json(actor), kind, decision, value: json(value), snapshot: full === undefined ? current() : json(full), signal });
    throwIfAborted(signal); if (closed) fail('CLOSED', 'The content runtime is closed.'); if (result === undefined) fail('DENIED', 'The host did not expose this content projection.'); return json(result, `${kind} projection`);
  }
  function enqueueNotifications(snapshot) {
    for (const entry of subscribers.values()) {
      entry.pending = snapshot; // Coalesce slow consumers to the newest state, not an event log.
      if (entry.scheduled) continue;
      entry.scheduled = true;
      entry.chain = entry.chain.catch(() => {}).then(async () => {
        while (entry.pending && !closed && subscribers.has(entry.listener)) {
          const next = entry.pending; entry.pending = null;
          try { await entry.listener(await project('read', entry.actor, entry.signal, next)); } catch { subscribers.delete(entry.listener); break; }
        }
        entry.scheduled = false;
        if (entry.pending && !closed && subscribers.has(entry.listener)) enqueueNotifications(entry.pending);
      });
    }
  }
  async function visibleResult(value, actor, request, action, confirmed, userGesture, signal, phase) {
    await gate(actor, { ...request, confirmed, userGesture, phase }, action, signal);
    const visibleSnapshot = await project('read', actor, signal, value.snapshot);
    let output = value.output;
    if (typeof host.projectResult === 'function') { output = await host.projectResult({ actor: json(actor), action: json(action), output: json(value.output), snapshot: current(), signal }); throwIfAborted(signal); if (closed) fail('CLOSED', 'The content runtime is closed.'); if (output === undefined) fail('DENIED', 'The host did not expose this action result.'); output = json(output, 'result projection'); }
    return { ok: true, snapshot: visibleSnapshot, output: json(output), receipt: json(value.receipt) };
  }

  return frozen({
    async describe({ actor, signal } = {}) { return project('describe', trustedActor(actor), signal); },
    async read({ actor, signal } = {}) { return project('read', trustedActor(actor), signal); },
    async subscribe(listener, { actor, signal } = {}) {
      if (typeof listener !== 'function') throw new TypeError('subscribe requires a listener.'); actor = trustedActor(actor); const first = await project('read', actor, signal); if (closed) fail('CLOSED', 'The content runtime is closed.');
      const entry = { listener, actor, signal, chain: Promise.resolve(), pending: null, scheduled: false }; subscribers.set(listener, entry); try { await listener(first); } catch { subscribers.delete(listener); } return () => subscribers.delete(listener);
    },
    invoke(rawRequest, rawOptions = {}) {
      const actor = trustedActor(rawOptions.actor); // synchronous clone: queued work cannot observe caller mutation
      if (isObject(rawRequest) && Object.hasOwn(rawRequest, 'actor')) return Promise.reject(new ContentRuntimeError('FORGED_ACTOR', 'Actor must be supplied by trusted host context.'));
      let request; try { request = json(rawRequest, 'request'); } catch (error) { return Promise.reject(error); }
      const confirmed = rawOptions.confirmed === true, userGesture = rawOptions.userGesture === true, signal = rawOptions.signal;
      return run(async () => {
        let key, fingerprint, action;
        try {
          throwIfAborted(signal); if (closed) fail('CLOSED', 'The content runtime is closed.');
          const allowed = ['contentId', 'descriptorRevision', 'actionId', 'input', 'expectedStateRevision', 'idempotencyKey'];
          if (!isObject(request) || Object.keys(request).some(name => !allowed.includes(name)) || allowed.some(name => !Object.hasOwn(request, name)) || request.contentId !== descriptor.id || request.descriptorRevision !== descriptor.descriptorRevision || !ACTION_ID.test(request.actionId || '') || !Number.isInteger(request.expectedStateRevision) || request.expectedStateRevision < 0 || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey || request.idempotencyKey.length > 128) fail('INVALID_REQUEST', 'The content request does not match this descriptor.');
          action = actions.get(request.actionId); if (!action) fail('UNKNOWN_ACTION', 'The requested action is not declared by this content.'); fingerprint = requestFingerprint(request); key = cacheKey(actor, request.idempotencyKey);
          const prior = idempotency.get(key);
          if (prior) {
            if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH', 'This idempotency key was used for a different request.');
            if (action.requiresConfirmation && !confirmed) fail('CONFIRMATION_REQUIRED', 'This action requires explicit confirmation.'); if (action.gestureRequired && !userGesture) fail('GESTURE_REQUIRED', 'This action requires a user gesture.');
            await gate(actor, { ...request, confirmed, userGesture, phase: 'replay' }, action, signal);
            if (prior.outcome.ok) return visibleResult(prior.outcome.value, actor, request, action, confirmed, userGesture, signal, 'replay-result'); throw restoreError(prior.outcome.error);
          }
          if (action.effect === 'external') fail('EXTERNAL_UNSUPPORTED', 'External effects require a host adapter and are not executed by this reference runtime.'); if (action.requiresConfirmation && !confirmed) fail('CONFIRMATION_REQUIRED', 'This action requires explicit confirmation.'); if (action.gestureRequired && !userGesture) fail('GESTURE_REQUIRED', 'This action requires a user gesture.');
          validate(action.inputSchema, request.input, 'INVALID_INPUT', 'Action input does not match inputSchema.');
          const before = current(), startGeneration = generation; await gate(actor, { ...request, confirmed, userGesture, phase: 'start' }, action, signal);
          if (stateRevision !== request.expectedStateRevision || generation !== startGeneration || closed) fail(stateRevision !== request.expectedStateRevision ? 'STALE_REVISION' : 'CLOSED', 'The content state is no longer current.', { stateRevision, expectedStateRevision: request.expectedStateRevision });
          const handler = host.handlers[action.id]; if (typeof handler !== 'function') fail('MISSING_HANDLER', 'No local handler is registered for this action.');
          const handlerResult = await handler({ input: json(request.input), state: json(before.state), actor: json(actor), action: json(action), signal });
          // Snapshot before any later await: handlers do not retain a mutable route to commit data.
          const result = json(handlerResult, 'handler result');
          throwIfAborted(signal); if (!isObject(result) || !Object.hasOwn(result, 'state') || !Object.hasOwn(result, 'output')) fail('INVALID_HANDLER_RESULT', 'A handler must return { state, output }.');
          validate(descriptor.stateSchema, result.state, 'INVALID_NEXT_STATE', 'Handler state does not match stateSchema.'); validate(action.outputSchema, result.output, 'INVALID_OUTPUT', 'Handler output does not match outputSchema.');
          if (action.effect === 'read' && stable(result.state) !== stable(before.state)) fail('READ_MUTATED', 'Read actions may not change content state.');
          const candidateState = action.effect === 'write' ? json(result.state, 'next state') : json(before.state), candidateRevision = action.effect === 'write' ? before.stateRevision + 1 : before.stateRevision;
          const candidateSnapshot = snapshotOf(descriptor, candidateRevision, candidateState);
          const recordedAt = new Date(typeof host.now === 'function' ? host.now() : Date.now()).toISOString();
          const raw = frozen({ ok: true, snapshot: candidateSnapshot, output: json(result.output, 'output'), receipt: frozen({ contentId: descriptor.id, descriptorRevision: descriptor.descriptorRevision, beforeStateRevision: before.stateRevision, stateRevision: candidateRevision, actor: json(actor), actionId: action.id, input: json(request.input), idempotencyKey: request.idempotencyKey, confirmed, userGesture, recordedAt, provenance: { protocolVersion: descriptor.protocolVersion, effect: action.effect } }) });
          // All caller-visible projection work can fail here, while state remains unchanged.
          const delivered = await visibleResult(raw, actor, request, action, confirmed, userGesture, signal, 'prepare-result');
          const cachedOutcome = json({ ok: true, value: raw }, 'idempotency outcome');
          await gate(actor, { ...request, confirmed, userGesture, phase: 'commit' }, action, signal);
          if (stateRevision !== before.stateRevision) fail('STALE_REVISION', 'The content state changed before commit.'); if (generation !== startGeneration || closed) fail('CLOSED', 'The content runtime was closed before commit.');
          // No await or host call after this point: commit and cache are local JSON assignments.
          if (action.effect === 'write') { state = candidateState; stateRevision = candidateRevision; }
          remember(key, fingerprint, cachedOutcome, true); if (action.effect === 'write') enqueueNotifications(candidateSnapshot);
          return delivered;
        } catch (error) {
          const normalized = publicError(error); if (key && fingerprint && cacheableError(normalized.code)) remember(key, fingerprint, { ok: false, error: normalized }); throw restoreError(normalized);
        }
      });
    },
    // Synchronous invalidation: non-cooperative handlers may continue but cannot commit.
    close() { closed = true; generation += 1; subscribers.clear(); return Promise.resolve(); }
  });
}
