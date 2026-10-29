import { APP_LIMITS, AppPackageError, MM_KIT_SLOT, appFail, appJson, decodeMmShape, freezeAppJson, isVerifiedAppBundle, mmResumeInput, mmViewSnapshot, stableAppJson } from '../protocol/app-package.js';
import { appContentKitSource } from './app-content-kit.js';

export const APP_DOCUMENT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const assert = (ok, code, message = code) => { if (!ok) appFail(code, message); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
const failure = error => ({ ok: false, code: error instanceof AppPackageError ? error.code : 'HANDLER_FAILED', reason: error instanceof AppPackageError ? error.message : 'The host operation failed.' });

/** The original template remains pinned. Kit insertion and CSP are host-owned rendering steps. */
export function createAppDocument(bundle, { channel, styles = '' } = {}) {
  assert(isVerifiedAppBundle(bundle), 'UNVERIFIED_BUNDLE');
  assert(validId(channel), 'INVALID_CHANNEL');
  const kit = appContentKitSource({ channel, content: bundle.package.content || null });
  // CSP must precede app script execution, including templates which put scripts before <head>.
  const prefix = `<meta http-equiv="Content-Security-Policy" content="${APP_DOCUMENT_CSP}"><meta name="referrer" content="no-referrer">`;
  const insertion = `<script>${kit}</script>${styles ? `<style>${styles.replace(/<\/style/gi, '<\\/style')}</style>` : ''}`;
  const html = bundle.template.replace(MM_KIT_SLOT, insertion);
  // Keep the doctype first (standards mode), while installing the policy before app markup.
  return html.replace(/^(\s*(?:<!doctype[^>]*>\s*)?)/i, `$1${prefix}`);
}

/**
 * Mount an explicitly authorized, verified package. No API endpoints, credentials or roles
 * are inferred from package metadata. Returned snapshots have app-view authority only.
 */
export async function mountAppContent({ bundle, host, params = {}, signal, stage, documentUrl, timeoutMs = 8000 }) {
  assert(isVerifiedAppBundle(bundle), 'UNVERIFIED_BUNDLE');
  assert(host && validId(host.id) && validId(host.principalId) && typeof host.authorize === 'function', 'HOST_REQUIRED');
  const pkg = bundle.package, input = mmResumeInput(pkg, params);
  const scope = freezeAppJson({ hostId: host.id, principalId: host.principalId, instanceId: crypto.randomUUID(), bundleDigest: bundle.digest,
    contentId: pkg.content?.id || `app:${pkg.name}`, descriptorRevision: pkg.content?.revision || pkg.version, parameters: input });
  let closed = false, started = false, initialized = false, readySettled = false, snapshot = null, lastError = null;
  let counter = 0, queue = Promise.resolve(), pendingOpen = null, resumeQueue = Promise.resolve(), pendingTools = 0;
  const controller = new AbortController(), pending = new Map(), subscribers = new Set(), invocations = new Map();
  const channel = crypto.randomUUID(), duration = Math.min(30000, Math.max(100, timeoutMs));
  const frame = document.createElement('iframe');
  frame.className = 'hoh-packaged-app'; frame.title = pkg.title;
  frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer'); frame.setAttribute('allow', '');
  const active = () => assert(!closed && !signal?.aborted, 'CLOSED');
  async function gate(operation, detail = {}) {
    active();
    const decision = await host.authorize({ operation, scope, requirements: { admin: pkg.admin === true }, ...detail, signal: controller.signal });
    active();
    assert(decision === true || decision?.allowed === true, 'DENIED', 'The host denied this app operation.');
    return decision;
  }
  await gate('mount');
  for (const name of pkg.tools) assert(Object.hasOwn(host.tools || {}, name) && host.tools[name]?.effect === 'read' && typeof host.tools[name].call === 'function', 'PROVIDER_UNAVAILABLE', `A declared read provider is unavailable: ${name}`);
  let settleReady;
  const ready = new Promise(resolve => { settleReady = value => { if (!readySettled) { readySettled = true; clearTimeout(readyTimer); resolve(value); } }; });
  const readyTimer = setTimeout(() => fatal(new AppPackageError('READY_TIMEOUT', 'The app did not become ready.')), duration);
  function send(message) { if (!closed) frame.contentWindow?.postMessage({ jsonrpc: '2.0', channel, ...message }, '*'); }
  function context() {
    const rect = (stage || frame).getBoundingClientRect();
    return { theme: host.theme || 'dark', displayMode: 'inline', availableDisplayModes: ['inline'], locale: navigator.language || 'ko-KR',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, platform: matchMedia('(pointer: coarse)').matches ? 'mobile' : 'web',
      containerDimensions: { width: Math.round(rect.width), height: Math.round(rect.height) }, safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, styles: { variables: host.styles || {} }, shellGestures: false };
  }
  function observed(value = snapshot) {
    return value ? freezeAppJson({ scope, snapshot: appJson(value), authority: 'FRAME_REPORTED', stateScope: 'app-view', revisionScope: 'app-defined-key' }) : null;
  }
  function accept(raw) {
    const next = mmViewSnapshot(pkg, raw);
    // Authorization and RPC replies may complete out of order. A valid older observation
    // remains an observation of that action, but cannot replace the current view.
    if (snapshot && next.stateRevision < snapshot.stateRevision) return next;
    snapshot = next;
    if (initialized) settleReady(true);
    for (const listener of subscribers) {
      void gate('read').then(() => { if (!closed && subscribers.has(listener)) return listener(observed(next)); }).catch(() => subscribers.delete(listener));
    }
    return next;
  }
  function rpc(method, params) {
    active(); assert(pending.size < 32, 'BUSY');
    const id = `host-${++counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id); pendingOpen = null;
        reject(new AppPackageError(method === 'ailab/content/invoke' ? 'EXECUTION_UNCERTAIN' : 'TIMEOUT', 'The app did not acknowledge the request; no automatic retry was made.'));
      }, duration);
      pending.set(id, { resolve, reject, timer, method }); send({ id, method, params });
    });
  }
  function close() {
    if (closed) return;
    send({ method: 'ui/resource-teardown' }); closed = true; pendingOpen = null;
    controller.abort(); clearTimeout(readyTimer); settleReady(false); removeEventListener('message', receive); signal?.removeEventListener('abort', close);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new AppPackageError(p.method === 'ailab/content/invoke' ? 'EXECUTION_UNCERTAIN' : 'CLOSED', 'The mounted app closed before the result was observed.')); }
    pending.clear(); subscribers.clear(); invocations.clear(); frame.remove();
  }
  function fatal(error) { lastError = failure(error); host.onError?.(lastError); close(); }
  async function receive(event) {
    if (closed || event.source !== frame.contentWindow || event.origin !== 'null') return;
    const raw = event.data;
    if (!raw || raw.jsonrpc !== '2.0' || raw.channel !== channel) return;
    let m;
    try { m = appJson(raw, 65536); } catch { return; }
    if (m.id != null && m.method === undefined) {
      const waiting = pending.get(m.id); if (!waiting) return;
      pending.delete(m.id); clearTimeout(waiting.timer);
      if (m.error) waiting.reject(new AppPackageError(/^[A-Z_]{3,50}$/.test(m.error.message || '') ? m.error.message : 'APP_FAILED', 'The app rejected the action.'));
      else waiting.resolve(m.result);
      return;
    }
    if (typeof m.method !== 'string') return;
    const reply = result => { if (m.id != null) send({ id: m.id, result }); };
    const reject = error => { if (m.id != null) send({ id: m.id, error: { code: -32000, message: failure(error).code } }); };
    try {
      if (m.method === 'ui/initialize') {
        assert(!started && m.params?.protocolVersion === 'ailab-apps/1', 'UNSUPPORTED_PROFILE'); await gate('initialize'); started = true;
        reply({ protocolVersion: 'ailab-apps/1', hostInfo: { name: host.id, version: '1' }, hostCapabilities: { serverTools: {}, message: {}, displayModes: ['inline'] }, hostContext: context() });
        send({ method: 'ui/notifications/tool-input', params: { arguments: input, hotResume: pkg.hotReload === true } }); return;
      }
      assert(started, 'NOT_INITIALIZED');
      switch (m.method) {
        case 'ui/notifications/initialized': initialized = true; if (!pkg.content || snapshot) settleReady(true); return;
        case 'ailab/notifications/content-state': await gate('read'); accept(m.params); return;
        case 'tools/call': {
          const name = m.params?.name, tool = Object.hasOwn(host.tools || {}, name) ? host.tools[name] : null;
          assert(initialized && pkg.tools.includes(name) && tool?.effect === 'read' && typeof tool.call === 'function', 'UNDECLARED_TOOL');
          assert(pendingTools < 8, 'BUSY');
          const args = appJson(m.params.arguments ?? {}, 12000);
          await gate('tool', { tool: name, input: args }); pendingTools += 1;
          try { const result = appJson(await tool.call(args, { scope, signal: controller.signal }), 512000); active(); reply({ structuredContent: result }); }
          catch (e) { reply({ isError: true, content: [{ type: 'text', text: failure(e).code }] }); }
          finally { pendingTools -= 1; }
          return;
        }
        case 'ailab/notifications/resume-input': {
          const args = mmResumeInput(pkg, m.params?.arguments);
          if (!host.remember) return;
          await gate('remember', { input: args });
          resumeQueue = resumeQueue.catch(() => {}).then(async () => { active(); await host.remember(args, { scope, signal: controller.signal }); });
          void resumeQueue.catch(e => { lastError = failure(e); host.onError?.(lastError); }); return;
        }
        case 'ailab/open': {
          assert(initialized && typeof m.params?.content === 'string' && m.params.content.length <= 2048 && typeof host.open === 'function', 'UNSUPPORTED_NAVIGATION');
          await gate('open', { target: m.params.content }); reply({ accepted: true });
          if ([...pending.values()].some(p => p.method === 'ailab/content/invoke')) pendingOpen = m.params.content;
          else await host.open(m.params.content, { scope }); return;
        }
        case 'ui/message': {
          const text = (Array.isArray(m.params?.content) ? m.params.content : []).map(c => typeof c.text === 'string' ? c.text : '').join('\n');
          assert(text.length > 0 && text.length <= 4000 && typeof host.draftMessage === 'function', 'UNSUPPORTED_MESSAGE');
          await gate('draft-message'); host.draftMessage(text); reply({}); return;
        }
        case 'ui/open-link': {
          assert(typeof host.openLink === 'function', 'UNSUPPORTED_LINK');
          const url = new URL(m.params?.url); assert(['https:', 'http:'].includes(url.protocol), 'INVALID_LINK');
          await gate('open-link', { target: url.href }); await host.openLink(url.href, { scope }); reply({}); return;
        }
        case 'ui/request-display-mode': assert(m.params?.mode === 'inline', 'UNSUPPORTED_DISPLAY_MODE'); reply({ mode: 'inline' }); return;
        case 'ui/notifications/size-changed': return;
        case 'ping': reply({}); return;
        default: appFail('UNSUPPORTED_METHOD', 'The requested app method is not supported.');
      }
    } catch (error) {
      reject(error);
      if (m.method === 'ailab/notifications/content-state') fatal(error);
    }
  }
  addEventListener('message', receive); signal?.addEventListener('abort', close, { once: true });
  try {
    active();
    if (documentUrl) {
      const url = new URL(await documentUrl({ bundle, channel }), location.href);
      assert(url.origin === location.origin && ['http:', 'https:'].includes(url.protocol), 'INVALID_DOCUMENT_ORIGIN');
      active(); frame.src = url.href;
    } else frame.srcdoc = createAppDocument(bundle, { channel });
  } catch (error) { close(); throw error; }

  return Object.freeze({
    node: frame, ready, scope, bundle, close, teardown: close,
    status: () => ({ ready: readySettled && initialized && !closed && (!pkg.content || snapshot !== null), closed, error: lastError }),
    async describe() { await gate('describe'); return freezeAppJson({ profile: bundle.profile, scope, packageName: pkg.name, packageVersion: pkg.version, description: pkg.content || null, stateAuthority: 'FRAME_REPORTED', stateScope: 'app-view' }); },
    async read() { await gate('read'); assert(initialized && pkg.content, 'NOT_READY'); const result = await rpc('ailab/content/read', {}); await gate('read'); accept(result); return observed(); },
    async subscribe(listener) { assert(typeof listener === 'function', 'INVALID_LISTENER'); await gate('read'); subscribers.add(listener); if (snapshot) listener(observed()); return () => subscribers.delete(listener); },
    invoke(raw) {
      let request;
      try { request = appJson(raw, 16000); } catch (error) { return Promise.resolve(failure(error)); }
      const execute = async () => {
        await gate('invoke', { request });
        assert(initialized && pkg.content && snapshot, 'NOT_READY');
        const allowed = ['contentId', 'descriptorRevision', 'actionId', 'input', 'expectedStateRevision', 'idempotencyKey', 'instanceId', 'bundleDigest'];
        assert(Object.keys(request).length === allowed.length && allowed.every(k => Object.hasOwn(request, k)), 'INVALID_REQUEST');
        assert(request.instanceId === scope.instanceId && request.bundleDigest === scope.bundleDigest, 'STALE_INSTANCE');
        assert(request.contentId === scope.contentId && request.descriptorRevision === scope.descriptorRevision, 'CONTENT_CHANGED');
        assert(validId(request.idempotencyKey) && request.idempotencyKey.length <= 128, 'INVALID_REQUEST');
        const fingerprint = stableAppJson(request), saved = invocations.get(request.idempotencyKey);
        if (saved) { assert(saved.fingerprint === fingerprint, 'IDEMPOTENCY_MISMATCH'); return saved.result; }
        const action = pkg.content.actions.find(a => a.id === request.actionId); assert(action, 'UNKNOWN_ACTION');
        assert(!action.gestureRequired, 'GESTURE_REQUIRED'); assert(!action.requiresConfirmation, 'CONFIRMATION_REQUIRED');
        assert(Number.isSafeInteger(request.expectedStateRevision) && request.expectedStateRevision === snapshot.stateRevision, 'STALE_REVISION');
        const args = decodeMmShape(action.input, request.input);
        const resultPromise = (async () => {
          try {
            const result = await rpc('ailab/content/invoke', { contentId: request.contentId, descriptorRevision: request.descriptorRevision, actionId: request.actionId, input: args,
              expectedStateRevision: request.expectedStateRevision, idempotencyKey: request.idempotencyKey, actor: 'agent' });
            await gate('read'); assert(result?.ok === true && result.snapshot, 'INVALID_RESULT');
            const actionSnapshot = accept(result.snapshot), output = appJson(result.output ?? {}, 12000);
            const outcome = freezeAppJson({ ok: true, ...observed(actionSnapshot), output, actionId: request.actionId, idempotencyKey: request.idempotencyKey, expectedStateRevision: request.expectedStateRevision });
            if (pendingOpen) { const target = pendingOpen; pendingOpen = null; queueMicrotask(() => { if (!closed) void host.open(target, { scope }); }); }
            return outcome;
          } catch (error) { pendingOpen = null; return failure(error); }
        })();
        invocations.set(request.idempotencyKey, { fingerprint, result: resultPromise });
        while (invocations.size > 128) invocations.delete(invocations.keys().next().value);
        return resultPromise;
      };
      const result = queue.catch(() => {}).then(execute).catch(failure); queue = result; return result;
    },
    async flush() { await resumeQueue; active(); },
    async canReplace() {
      await gate('replace');
      if (pendingTools || pending.size || snapshot?.state.unsaved || snapshot?.state.unsavedItems > 0 || snapshot?.state.draft) return false;
      if (!pkg.hotReload) return false;
      try { return (await rpc('ailab/hot-check', {}))?.ok === true; } catch { return false; }
    },
    refresh() { if (initialized && !closed) send({ method: 'ui/notifications/host-context-changed', params: context() }); },
  });
}
