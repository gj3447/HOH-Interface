/** Host-inserted compatibility SDK. App templates remain byte-for-byte unchanged. */
export function appContentKitSource(options = {}) {
  // JSON is embedded in a script element; escaping '<' also prevents a closing-script delimiter.
  const config = JSON.stringify(options).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `(${installAppContentKit.toString()})(${config});`;
}

function installAppContentKit(options) {
  'use strict';
  const channel = options.channel || null, expected = options.content || null;
  const pending = new Map(), events = new Map(), completed = new Map();
  let counter = 0, context = {}, input = null, inputResolve, connection, connected = false, closed = false;
  let content = null, revision = 0, stateKey = null, sent = null, stateTimer = null, resume = null, queue = Promise.resolve();
  const error = (code, message = code) => Object.assign(new Error(message), { code });
  const copy = (value, max = 12000) => {
    const text = JSON.stringify(value);
    if (text === undefined || text.length > max) throw error('INVALID_JSON');
    return JSON.parse(text);
  };
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
  const send = message => { if (!closed) parent.postMessage({ jsonrpc: '2.0', ...(channel ? { channel } : {}), ...message }, '*'); };
  const notify = (method, params = {}) => send({ method, params });
  const emit = (name, data) => { for (const fn of events.get(name) || []) { try { fn(data); } catch { /* One subscriber cannot prevent teardown. */ } } };
  function request(method, params, timeout = 8000) {
    if (closed) return Promise.reject(error('CLOSED'));
    if (pending.size >= 32) return Promise.reject(error('BUSY'));
    const id = `app-${++counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(error('TIMEOUT')); }, Math.min(30000, Math.max(100, Number(timeout) || 8000)));
      pending.set(id, { resolve, reject, timer }); send({ id, method, params });
    });
  }
  function publish() {
    clearTimeout(stateTimer); stateTimer = null;
    if (!content || closed) return null;
    const state = copy(content.state()), key = canonical(copy(content.key ? content.key(state) : state));
    if (key !== stateKey) { stateKey = key; revision += 1; }
    const result = { contentId: content.id, descriptorRevision: content.revision, stateRevision: revision, state };
    const text = JSON.stringify(result);
    if (text.length > 12000) throw error('INVALID_SNAPSHOT');
    if (connected && text !== sent) { sent = text; notify('ailab/notifications/content-state', result); }
    return result;
  }
  function applyContext(next) {
    context = { ...context, ...(next || {}) };
    for (const [name, value] of Object.entries(context.styles?.variables || {})) if (/^--[\w-]+$/.test(name) && typeof value === 'string') document.documentElement.style.setProperty(name, value);
    if (typeof context.theme === 'string') document.documentElement.dataset.theme = context.theme;
    if (typeof context.locale === 'string') document.documentElement.lang = context.locale.split('-')[0];
    if (typeof context.displayMode === 'string') document.documentElement.dataset.displayMode = context.displayMode;
    if (Number.isFinite(context.safeAreaInsets?.bottom)) document.documentElement.style.setProperty('--safe-bottom', `${Math.max(0, context.safeAreaInsets.bottom)}px`);
  }
  const sequential = run => { const result = queue.catch(() => {}).then(run); queue = result.catch(() => {}); return result; };
  async function runAction(actionId, args, actor) {
    if (!content || !Object.hasOwn(content.actions, actionId)) throw error('UNKNOWN_ACTION');
    const action = content.actions[actionId];
    if (action.gesture && (actor !== 'person' || !navigator.userActivation?.isActive)) throw error('GESTURE_REQUIRED');
    const result = await action.run(copy(args), { actor });
    if (closed) throw error('CLOSED');
    // Flush the app's own rendering microtasks before reporting its observable view.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (closed) throw error('CLOSED');
    return { ok: true, snapshot: publish(), output: copy(result ?? {}) };
  }
  async function invoke(message) {
    const p = message.params || {};
    const respondError = e => send({ id: message.id, error: { code: -32000, message: e.code || 'HANDLER_FAILED', data: { reason: e.code || 'App action failed.', snapshot: content && !closed ? publish() : null } } });
    try {
      if (!content || p.contentId !== content.id || p.descriptorRevision !== content.revision) throw error('INVALID_REQUEST');
      if (p.actor !== 'agent' || p.confirmation !== undefined) throw error('FORGED_AUTHORITY');
      if (typeof p.idempotencyKey !== 'string' || !p.idempotencyKey || p.idempotencyKey.length > 128) throw error('INVALID_REQUEST');
      const fingerprint = canonical(copy({ contentId: p.contentId, descriptorRevision: p.descriptorRevision, actionId: p.actionId, input: p.input ?? {}, expectedStateRevision: p.expectedStateRevision }));
      const saved = completed.get(p.idempotencyKey);
      if (saved) { if (saved.fingerprint !== fingerprint) throw error('IDEMPOTENCY_MISMATCH'); send({ id: message.id, result: saved.result }); return; }
      const current = publish();
      if (!Number.isSafeInteger(p.expectedStateRevision) || p.expectedStateRevision !== current.stateRevision) throw error('STALE_REVISION');
      const declared = expected?.actions?.find(a => a.id === p.actionId);
      if (declared?.gestureRequired) throw error('GESTURE_REQUIRED');
      if (declared?.requiresConfirmation) throw error('CONFIRMATION_REQUIRED');
      const result = await runAction(p.actionId, p.input ?? {}, 'agent');
      completed.set(p.idempotencyKey, { fingerprint, result });
      while (completed.size > 128) completed.delete(completed.keys().next().value);
      send({ id: message.id, result });
    } catch (e) { respondError(e); }
  }
  function close(message) {
    if (closed) return;
    emit('teardown');
    if (message?.id != null) send({ id: message.id, result: {} });
    closed = true; clearTimeout(stateTimer); removeEventListener('message', receive);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error('CLOSED')); }
    pending.clear(); events.clear(); completed.clear();
  }
  function receive(event) {
    if (closed || event.source !== parent) return;
    const m = event.data;
    if (!m || m.jsonrpc !== '2.0' || channel && m.channel !== channel) return;
    if (m.id != null && m.method === undefined) {
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(error(typeof m.error.message === 'string' ? m.error.message : 'HOST_ERROR'));
      else p.resolve(m.result);
      return;
    }
    switch (m.method) {
      case 'ui/notifications/tool-input': input = copy(m.params?.arguments || {}, 2048); inputResolve?.(input); emit('input', input); break;
      case 'ui/notifications/host-context-changed': applyContext(m.params); emit('context', context); break;
      case 'ailab/notifications/event': emit(m.params?.type, m.params?.data); break;
      case 'ailab/content/read': if (m.id != null) send(content ? { id: m.id, result: publish() } : { id: m.id, error: { code: -32000, message: 'UNKNOWN_CONTENT' } }); break;
      case 'ailab/content/invoke': if (m.id != null) void sequential(() => invoke(m)); break;
      case 'ailab/hot-check': if (m.id != null) { const state = content ? publish().state : {}; send({ id: m.id, result: { ok: !state.unsaved && !(state.unsavedItems > 0) && !state.draft && !pending.size } }); } break;
      case 'ui/resource-teardown': close(m); break;
      default: if (m.id != null) send({ id: m.id, error: { code: -32601, message: 'UNSUPPORTED_METHOD' } });
    }
  }
  addEventListener('message', receive);
  const kit = {
    connect(appInfo) {
      if (!connection) connection = (async () => {
        const arriving = new Promise(resolve => { inputResolve = resolve; if (input) resolve(input); });
        const result = await request('ui/initialize', { protocolVersion: 'ailab-apps/1', appInfo: appInfo || {}, appCapabilities: {} });
        if (result?.protocolVersion !== 'ailab-apps/1') throw error('UNSUPPORTED_PROFILE');
        applyContext(result.hostContext); connected = true;
        notify('ui/notifications/initialized'); publish();
        if (resume) notify('ailab/notifications/resume-input', { arguments: JSON.parse(resume) });
        let timer;
        try { const args = await Promise.race([arriving, new Promise((_, reject) => { timer = setTimeout(() => reject(error('INPUT_TIMEOUT')), 1500); })]); return { context, input: args, host: result.hostInfo }; }
        finally { clearTimeout(timer); }
      })();
      return connection;
    },
    async call(name, args = {}, opts = {}) {
      const result = await request('tools/call', { name, arguments: copy(args) }, opts.timeoutMs);
      if (result?.isError) throw error('PROVIDER_FAILED', (result.content || []).map(x => x.text || '').join('\n') || 'Provider failed.');
      return result?.structuredContent ?? result;
    },
    open: content => request('ailab/open', { content }),
    openLink: url => request('ui/open-link', { url }),
    say: text => request('ui/message', { role: 'user', content: [{ type: 'text', text }] }),
    displayMode: mode => request('ui/request-display-mode', { mode }),
    on(type, fn) { if (typeof fn !== 'function') throw error('INVALID_LISTENER'); const listeners = events.get(type) || new Set(); listeners.add(fn); events.set(type, listeners); return () => listeners.delete(fn); },
    content(definition) {
      if (content) throw error('CONTENT_ALREADY_REGISTERED');
      if (!definition || typeof definition.state !== 'function' || !definition.actions || expected && (definition.id !== expected.id || definition.revision !== expected.revision)) throw error('CONTENT_MISMATCH');
      if (expected) {
        const wanted = expected.actions.map(a => a.id);
        if (wanted.length !== Object.keys(definition.actions).length || wanted.some(id => typeof definition.actions[id]?.run !== 'function') || expected.actions.some(a => (definition.actions[a.id].gesture === true) !== a.gestureRequired)) throw error('ACTION_REGISTRY_MISMATCH');
      }
      content = definition; revision = 0; stateKey = null; sent = null; publish();
    },
    changed() { if (!closed && content && !stateTimer) stateTimer = setTimeout(publish, 100); },
    remember(args = {}) { const next = JSON.stringify(copy(args, 2048)); if (next !== resume) { resume = next; if (connected) notify('ailab/notifications/resume-input', { arguments: args }); } },
    act(name, args = {}) {
      if (!content || !Object.hasOwn(content.actions, name)) throw error('UNKNOWN_ACTION');
      const action = content.actions[name];
      if (action.gesture && !navigator.userActivation?.isActive) throw error('GESTURE_REQUIRED');
      // MM returns a synchronous handler's value synchronously; do not turn its API into Promise-only.
      const output = action.run(args, { actor: 'person' });
      if (output && typeof output.then === 'function') return output.then(value => { publish(); return value; });
      publish(); return output;
    },
    get context() { return context; },
    h(tag, attrs = {}, ...children) {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k === 'class' ? 'class' : k, v === true ? '' : String(v));
      }
      for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child));
      return node;
    },
    ago(iso) { const age = (Date.now() - new Date(iso).getTime()) / 1000; return !iso ? '' : age < 60 ? '방금' : age < 3600 ? `${Math.floor(age / 60)}분 전` : age < 86400 ? `${Math.floor(age / 3600)}시간 전` : new Date(iso).toLocaleDateString('ko-KR'); },
  };
  Object.freeze(kit);
  // Existing MM templates use this alias. The portable name has the same semantics.
  window.hohContentKit = kit;
  window.ailab = kit;
}
