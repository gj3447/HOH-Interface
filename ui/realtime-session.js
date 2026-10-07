/**
 * Lifecycle owner for a real-time content session.
 *
 * The provider owns WebRTC peers and media tracks. This controller owns the
 * selected connection, cancellation, and an immutable UI-facing snapshot so a
 * renderer can be replaced without leaking a call into a later content view.
 */
const STATUSES = new Set(['idle', 'joining', 'waiting', 'connected', 'reconnecting', 'error', 'closed']);

const empty = (capabilities = {}) => Object.freeze({
  status: 'idle', localStream: null, peers: Object.freeze([]),
  microphoneEnabled: false, cameraEnabled: false, screenSharing: false,
  error: null, capabilities: Object.freeze({ ...capabilities }),
});

function freezeSnapshot(value) {
  return Object.freeze({
    ...value,
    peers: Object.freeze((value.peers || []).map(peer => Object.freeze({ ...peer }))),
    error: value.error ? Object.freeze({ ...value.error }) : null,
    capabilities: Object.freeze({ ...value.capabilities }),
  });
}

function asError(error, fallback = 'Real-time connection failed') {
  if (error && typeof error === 'object') return { code: error.code, message: error.message || fallback };
  return { message: String(error || fallback) };
}

function validRequest(request) {
  // A host authorizer may resolve a durable room ID from the selected content.
  // The provider still rejects a missing resolved room ID at its trust boundary.
  if (!request || !(typeof request.roomId === 'string' && request.roomId.trim()) && !(typeof request.context?.contentId === 'string' && request.context.contentId)) throw new TypeError('roomId or context.contentId is required');
  if (!['audio', 'video', 'broadcast'].includes(request.mode)) throw new TypeError('mode must be audio, video, or broadcast');
  if (!['participant', 'publisher', 'viewer'].includes(request.role)) throw new TypeError('Invalid real-time role');
  if (request.mode === 'broadcast' && !['publisher', 'viewer'].includes(request.role)) throw new TypeError('Broadcast roles are publisher or viewer');
  if (request.mode !== 'broadcast' && request.role !== 'participant') throw new TypeError('Calls use the participant role');
}

export function createRealtimeSession({ provider, onUpdate } = {}) {
  if (!provider || typeof provider.connect !== 'function') throw new TypeError('A real-time provider with connect() is required');
  const capabilities = provider.capabilities || {};
  const listeners = new Set();
  let snapshot = empty(capabilities), connection = null, controller = null, generation = 0, terminal = false;

  const emit = () => {
    for (const listener of [...listeners]) {
      try { listener(snapshot); } catch { /* A UI subscriber must not break call cleanup. */ }
    }
    try { onUpdate?.(snapshot); } catch { /* host callbacks are observational */ }
  };
  const publish = (patch) => { snapshot = freezeSnapshot({ ...snapshot, ...patch, capabilities }); emit(); return snapshot; };
  const isLive = () => ['joining', 'waiting', 'connected', 'reconnecting'].includes(snapshot.status);
  const closeDetached = async current => {
    if (current?.close) { try { await current.close(); } catch { /* provider cleanup is best effort */ } }
  };
  const receive = (event, token) => {
    if (token !== generation || !isLive()) return;
    const update = event && typeof event === 'object' ? event : {};
    if (update.fatal || update.status === 'error') {
      const failure = asError(update.error, 'Real-time connection failed');
      // Invalidate in-flight operations before closing their provider object.
      // A close is asynchronous; its completion must never publish over a new join.
      generation += 1;
      const current = connection; connection = null; controller?.abort(); controller = null;
      publish({ status: 'error', error: failure, localStream: null, peers: [], microphoneEnabled: false, cameraEnabled: false, screenSharing: false });
      void closeDetached(current);
      return;
    }
    const status = STATUSES.has(update.status) ? update.status : snapshot.status;
    publish({ ...update, status, error: update.error === undefined ? snapshot.error : (update.error ? asError(update.error) : null) });
  };

  async function join(request) {
    if (terminal) return getSnapshot();
    validRequest(request);
    const token = ++generation;
    // Capture the intent before awaiting cleanup. A caller may leave while an
    // older connection is closing; that leave must win over this join.
    const previous = connection; connection = null; controller?.abort(); controller = null;
    // Navigation observes this synchronously. Cleanup may take arbitrarily
    // long, but it must not leave a window where the UI thinks no call exists.
    publish({ status: 'joining', error: null, localStream: null, peers: [], microphoneEnabled: false, cameraEnabled: false, screenSharing: false });
    await closeDetached(previous);
    if (token !== generation) return getSnapshot();
    const joinController = new AbortController(); controller = joinController;
    publish({ status: 'joining', error: null, localStream: null, peers: [], microphoneEnabled: false, cameraEnabled: false, screenSharing: false });
    try {
      const result = await provider.connect({ ...request, signal: joinController.signal, onUpdate: event => receive(event, token) });
      if (token !== generation || joinController.signal.aborted) { try { await result?.close?.(); } catch {} return getSnapshot(); }
      if (!result || typeof result.close !== 'function') throw new TypeError('Real-time provider returned an invalid connection');
      connection = result;
      const next = typeof result.snapshot === 'function' ? result.snapshot() : {};
      receive({ status: next.status || 'waiting', ...next }, token);
      return getSnapshot();
    } catch (error) {
      if (token !== generation || joinController.signal.aborted) return getSnapshot();
      generation += 1; if (controller === joinController) controller = null;
      publish({ status: 'error', error: asError(error), localStream: null, peers: [], microphoneEnabled: false, cameraEnabled: false, screenSharing: false });
      return getSnapshot();
    }
  }
  async function call(method, ...args) {
    const current = connection, token = generation;
    if (!current || !isLive()) return { applies: false, reason: 'inactive_session' };
    if (typeof current[method] !== 'function') return { applies: false, reason: 'unsupported_operation' };
    try {
      const result = await current[method]?.(...args);
      if (current !== connection || token !== generation) return { applies: false, reason: 'stale_session' };
      if (typeof current.snapshot === 'function') receive(current.snapshot(), token);
      return { applies: true, result, snapshot: getSnapshot() };
    } catch (error) {
      if (error?.fatal === true && current === connection && token === generation) receive({ status: 'error', fatal: true, error }, token);
      return { applies: false, reason: 'operation_failed', error: asError(error) };
    }
  }
  async function leave() {
    if (terminal) return generation;
    const token = ++generation, current = connection; connection = null;
    controller?.abort(); controller = null;
    // Publish synchronously while cleanup remains detached from future joins.
    publish({ status: 'idle', error: null, localStream: null, peers: [], microphoneEnabled: false, cameraEnabled: false, screenSharing: false });
    await closeDetached(current); return token;
  }
  function getSnapshot() { return snapshot; }
  function subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('listener must be a function'); listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); }
  return Object.freeze({ join, leave, close: async () => { const leaving = leave(); terminal = true; const token = await leaving; return token === generation ? publish({ status: 'closed' }) : getSnapshot(); }, getSnapshot, subscribe, isActive: isLive,
    setMicrophone: enabled => call('setMicrophone', Boolean(enabled)), setCamera: enabled => call('setCamera', Boolean(enabled)), shareScreen: () => call('shareScreen'), stopScreenShare: () => call('stopScreenShare') });
}
