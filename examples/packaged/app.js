import { mountHohInterface } from '/ui/hoh-ui.js';
import { readMmBundle, AppPackageError } from '/protocol/app-package.js';
import { appResumeKey, createPackagedContentRenderer } from '/adapters/packaged-content.js';

// Explicit local compatibility example. Commands use a deterministic planner, not a model.
const query = new URL(location.href).searchParams;
const mode = ['mm', 'mm-kit'].includes(query.get('host')) ? query.get('host') : 'hoh', principalId = query.get('principal') || 'fixture-person';
const catalog = await fetch('/interop/catalog').then(r => r.json());
const summaries = catalog.items;
const bundles = new Map(), memories = new Map(), errors = [];
let currentId = null, viewRevision = 0, currentController = null, latestSnapshot = null, ui = null, policyAllowed = true;
const root = document.getElementById('hoh-root');
async function bundleFor(name) {
  if (!bundles.has(name)) {
    const summary = summaries.find(s => s.name === name); if (!summary) throw new Error('Unknown fixture package');
    const response = await fetch(`/interop/bundles/${encodeURIComponent(name)}`);
    bundles.set(name, await readMmBundle(new Uint8Array(await response.arrayBuffer()), { expectedDigest: summary.digest, allowFixture: true }));
  }
  return bundles.get(name);
}
const items = summaries.map(s => ({ content: { id: s.contentId, title: s.title, payload: { packageName: s.name, packageDigest: s.digest } }, manifest: { kind: 'PACKAGED_APP', id: s.contentId, revision: s.descriptorRevision } }));
const selected = items.find(i => i.content.payload.packageName === query.get('app')) || items[0];
const profiles = () => ({ activeContentId: currentId, viewRevision, favorites: [] });
const memoryKey = (contentId, who = principalId) => appResumeKey({ hostId: 'interop-example', principalId: who, contentId, parameters: {} });
const renderer = createPackagedContentRenderer({
  load: ({ item }) => bundleFor(item.content.payload.packageName),
  hostFor: async ({ item, bundle }) => ({ params: memories.get(memoryKey(item.content.id)) || {},
    ...(query.get('strict') === '1' ? { documentUrl: ({ channel }) => `/interop/document/${bundle.package.name}?bundle=${bundle.digest}&channel=${channel}` } : {}),
    host: {
    id: 'interop-example', principalId, theme: 'dark', tools: {},
    authorize: ({ requirements }) => policyAllowed && requirements.admin !== true,
    remember: async args => { memories.set(memoryKey(item.content.id), args); },
    open: async id => { const target = items.find(i => i.content.id === id || `app:${i.content.payload.packageName}` === id); if (!target) throw new AppPackageError('UNKNOWN_CONTENT', 'Target is not in this fixture catalog.'); await ui.open(target.content.id); },
    onError: error => errors.push(error.code),
  } }),
  onMounted: controller => { currentController = controller; void controller.subscribe(value => { latestSnapshot = value.snapshot; }); },
});
async function current() {
  if (mode === 'hoh') return renderer.current(currentId);
  if (!currentController) throw new Error('Not mounted'); return currentController;
}
async function read() {
  const c = await current();
  if (mode === 'hoh') return c.read();
  return { snapshot: c.content(), authority: 'FRAME_REPORTED', stateScope: 'app-view' };
}
async function invoke(actionId, input = {}, overrides = {}) {
  const c = await current(), before = await read();
  const request = { contentId: before.snapshot.contentId, descriptorRevision: before.snapshot.descriptorRevision, expectedStateRevision: before.snapshot.stateRevision,
    actionId, input, idempotencyKey: crypto.randomUUID(), ...(mode === 'hoh' ? { instanceId: c.scope.instanceId, bundleDigest: c.scope.bundleDigest } : {}), ...overrides };
  window.hohInteropLastRequest = request;
  return c.invoke(request);
}
const adapter = {
  bootstrap: async () => ({ profile: profiles() }), list: async () => ({ items }),
  open: async ({ contentId }) => { const item = items.find(i => i.content.id === contentId); if (!item) throw new Error('Unknown package'); currentId = contentId; viewRevision += 1; return { ...item, viewRevision, appState: {}, comments: [] }; },
  favorite: async () => ({}), react: async () => ({}), comment: async () => ({ comments: [] }),
  saveState: async () => { throw new Error('Package state is changed through its actions.'); }, profile: async () => ({ profile: profiles() }),
  status: async () => ({ readiness: { chat: { status: 'NOT_READY', reason: '호환 검증용 규칙 기반 명령 · LLM 미연결' } } }),
  chat: async ({ message }) => {
    if (!/^하나 추가$/.test(message.trim())) return { answer: '검증용 명령: 하나 추가. 이 예제에는 LLM이 연결되지 않았어요.' };
    const result = await invoke('increment'); return { answer: result.ok ? `화면의 수가 ${result.snapshot.state.count}입니다.` : `변경하지 못했어요: ${result.code}` };
  },
};
async function openMm(name) {
  currentController?.teardown(); const bundle = await bundleFor(name), pkg = bundle.package;
  currentId = pkg.content.id;
  const { mountApp } = await import('/reference/app-host.js');
  const stage = document.createElement('main'); stage.className = 'interop-reference'; root.replaceChildren(stage);
  const controller = mountApp({ item: { params: memories.get(memoryKey(currentId)) || {} }, manifest: { ...pkg, events: [], content: { id: pkg.content.id, revision: pkg.content.revision }, published: { bundle: bundle.digest, hotReload: pkg.hotReload === true } }, tools: {}, stage,
    open: () => {}, say: () => {}, remember: args => memories.set(memoryKey(pkg.content.id), args) });
  if (mode === 'mm-kit') controller.node.src += '&kit=shared';
  stage.append(controller.node); currentController = controller;
  if (!(await controller.ready)) throw new Error('MM reference host did not become ready.');
}
if (mode === 'hoh') {
  ui = mountHohInterface({ root, adapter, renderers: { PACKAGED_APP: renderer.render }, workspaceName: '콘텐츠 호환 예제' });
  await ui.ready; await ui.open(selected.content.id); await renderer.current(currentId);
} else await openMm(selected.content.payload.packageName);
window.hohInterop = { mode, read, invoke, current, errors, items, summaries,
  setPolicyAllowed: value => { policyAllowed = value === true; },
  peek: () => mode !== 'hoh' ? currentController?.content() : latestSnapshot,
  open: async name => { if (mode !== 'hoh') return openMm(name); await ui.open(items.find(i => i.content.payload.packageName === name).content.id); await renderer.current(currentId); },
  resume: (contentId = currentId, who = principalId) => memories.get(memoryKey(contentId, who)) || null,
  close: () => mode !== 'hoh' ? currentController.teardown() : renderer.close(),
};
