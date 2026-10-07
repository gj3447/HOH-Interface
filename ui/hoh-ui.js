import { shellMarkup } from './shell.js';
import { createRealtimeSession } from './realtime-session.js';
import { renderRealtimeView } from './realtime-view.js';

/** Full-page HOH Interface. Hosts supply trusted adapters/renderers; payloads never install code. */
export function mountHohInterface({ root, adapter, renderers = {}, realtime = null, workspaceName = 'HOH', homeContentId = 'dashboard-home' }) {
  if (!root || !adapter) throw new Error('HOH UI requires a root and an adapter');
  const methods = ['bootstrap', 'list', 'open', 'favorite', 'react', 'comment', 'saveState', 'chat', 'profile', 'status'];
  if (methods.some(name => typeof adapter[name] !== 'function')) throw new Error('Incomplete HOH adapter');
  const listeners = new AbortController();
  let rendererLifetime = new AbortController(), renderGeneration = 0;
  let disposed = false;
  let mediaContentId = null;
  const mediaSession = realtime?.provider && typeof realtime.authorize === 'function' ? createRealtimeSession({ provider: {
    capabilities: realtime.provider.capabilities,
    async connect(request) {
      const granted = await realtime.authorize({ context: request.context, request: { mode: request.mode, role: request.role }, signal: request.signal });
      if (request.signal.aborted) throw new DOMException('연결이 취소되었습니다.', 'AbortError');
      if (!granted?.roomId || granted.mode !== request.mode || granted.role !== request.role) throw new Error('이 콘텐츠의 통화 권한을 확인하지 못했습니다.');
      return realtime.provider.connect({ ...request, ...granted, signal: request.signal, onUpdate: request.onUpdate });
    }
  } }) : null;
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: listeners.signal });
  const mutationMethods = { '/favorites': 'favorite', '/reactions': 'react', '/comments': 'comment', '/state': 'saveState', '/chat': 'chat' };
  root.innerHTML = shellMarkup;
  root.querySelector('.brand').textContent = 'HOH Interface';
  root.querySelector('.brand').title = workspaceName;
  document.title = `HOH Interface · ${workspaceName}`;
const state = { items: [], index: -1, direct: null, lastFeedId: null, profile: {}, view: null, intent: 0, operation: Promise.resolve() };
const $ = (selector) => root.querySelector(selector);
const current = () => state.index >= 0 ? state.items[state.index] : state.direct;

function status(message, retry = false) { if (disposed) return; $('#providerStatus').textContent = message; $('#retryButton').hidden = !retry; }
function setBusy(busy) { if (disposed) return; root.querySelectorAll('[data-save],[data-remove],[data-reaction],[data-comment],[data-share],#commentSubmit,#chatForm button,[data-check-id],[data-tile],[data-game-reset],[data-dashboard-content-id],[data-dashboard-action]').forEach((button) => { button.disabled = busy; }); }
function payload(item) { return item?.content?.payload && typeof item.content.payload === 'object' ? item.content.payload : {}; }
function scopedRendererActions(item) {
  const context = Object.freeze({ contentId: item.content.id, viewRevision: state.profile.viewRevision,
    manifestId: item.content.manifestId, manifestRevision: item.content.manifestRevision });
  const intent = state.intent, generation = renderGeneration, signal = rendererLifetime.signal;
  const isCurrent = () => !disposed && !signal.aborted && generation === renderGeneration && intent === state.intent
    && current()?.content?.id === context.contentId && state.profile.viewRevision === context.viewRevision;
  const stale = () => Promise.resolve({ applies: false, reason: 'stale_context' });
  return { context, signal, isCurrent,
    open: contentId => isCurrent() ? openById(contentId) : stale(),
    saveState: next => isCurrent() ? saveState(next, context) : stale() };
}
/** Reactions, comments, sharing and favorites are host resources: the opened view may say which apply (`accepts`); unsaid means yes. */
function accepts(resource, view = state.view) { return view?.accepts?.[resource] !== false; }
function isDashboard(item = current()) { return item?.content?.id === homeContentId || item?.manifest?.kind === 'DASHBOARD'; }
const dashboardKindLabel = { ACCOUNT: '계정 및 설정', CHECKLIST: '점검 목록', GAME: '미니 게임', ARTICLE: '읽을거리', FEED: '추천 콘텐츠', REALTIME: '통화 및 방송' };
const dashboardKindIcon = { ACCOUNT: '⚙', CHECKLIST: '✓', GAME: '◈', ARTICLE: '◇', FEED: '✦', REALTIME: '◉' };
/** A host may give each dashboard entry its own short icon (text, at most two characters); otherwise the kind's icon. */
function dashboardIcon(entry) { const icon = typeof entry.icon === 'string' ? entry.icon.trim() : ''; return icon && graphemes(icon) <= 2 ? icon : dashboardKindIcon[entry.kind] || '◇'; }
function openRecommendedFeed() {
  const previous = state.items.findIndex(item => item.content.id === state.lastFeedId);
  const index = previous >= 0 ? previous : 0;
  const item = state.items[index];
  if (item?.content?.id) openById(item.content.id, index);
}
function renderDashboard(item) {
  const dashboard = state.view?.dashboard || {};
  const fixed = [...(Array.isArray(dashboard.fixed) ? dashboard.fixed : []), { action: 'feed', title: '추천 콘텐츠', kind: 'FEED', description: '추천 피드에서 이어서 보기' }];
  const favorites = Array.isArray(dashboard.favorites) ? dashboard.favorites : [];
  const card = document.createElement('article'); card.className = 'dashboard-card';
  const heading = document.createElement('header'); heading.innerHTML = '<p class="eyebrow">DASHBOARD</p><h2></h2><p></p>';
  heading.children[1].textContent = item?.content?.title || '대시보드';
  heading.children[2].textContent = '자주 쓰는 앱과 저장한 콘텐츠를 한곳에서 엽니다.';
  const makeGroup = (title, entries, emptyText) => {
    const section = document.createElement('section'); section.className = 'dashboard-group';
    const label = document.createElement('h3'); label.textContent = title; section.append(label);
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'dashboard-empty'; empty.textContent = emptyText; section.append(empty); return section; }
    const grid = document.createElement('div'); grid.className = 'app-grid';
    for (const entry of entries) {
      if (!entry?.id && !entry?.action) continue;
      const button = document.createElement('button'); button.type = 'button';
      if (entry.action === 'feed') button.dataset.dashboardAction = 'feed'; else button.dataset.dashboardContentId = entry.id;
      button.innerHTML = '<span class="app-icon" aria-hidden="true"></span><span class="app-name"></span><span class="app-description"></span>';
      button.children[0].textContent = dashboardIcon(entry);
      button.children[1].textContent = entry.title || entry.id;
      button.children[2].textContent = entry.description || dashboardKindLabel[entry.kind] || '콘텐츠 열기';
      const badge = Number.isInteger(entry.badge) && entry.badge > 0 ? entry.badge : 0;
      if (badge) { // a host count (new messages, unread replies) on the icon; read out as words after the name
        const mark = document.createElement('span'); mark.className = 'app-badge'; mark.textContent = badge > 99 ? '99+' : String(badge); button.children[0].append(mark);
        const spoken = document.createElement('span'); spoken.className = 'sr-only'; spoken.textContent = ` 새 항목 ${badge}개`; button.children[1].after(spoken);
      }
      grid.append(button);
    }
    section.append(grid); return section;
  };
  card.append(heading, makeGroup('앱', fixed, '등록된 앱이 없습니다.'), makeGroup('저장한 콘텐츠', favorites, '저장한 콘텐츠가 아직 없습니다. 콘텐츠 화면에서 저장하면 여기에 앱 아이콘으로 나타납니다.'));
  return card;
}
function renderStage(item) {
  if (!item) return Object.assign(document.createElement('div'), { className: 'empty', textContent: '콘텐츠가 없습니다.' });
  if (isDashboard(item)) return renderDashboard(item);
  const data = payload(item), kind = item.manifest?.kind || 'ARTICLE';
  if (kind === 'REALTIME') {
    const scoped = scopedRendererActions(item);
    return renderRealtimeView({ item, ...scoped, session: mediaSession, available: Boolean(mediaSession),
      start(request) {
        if (!scoped.isCurrent()) return;
        mediaContentId = item.content.id;
        return mediaSession.join({ ...request, context: scoped.context });
      } });
  }
  if (Object.hasOwn(renderers, kind)) {
    const node = renderers[kind]({ item, view: state.view, payload: data, ...scopedRendererActions(item) });
    if (!(node instanceof Node)) throw new Error('HOH renderer must return a DOM Node');
    return node;
  }
  const card = document.createElement('article');
  card.className = 'content-card'; card.innerHTML = '<p class="eyebrow"></p><h2></h2><p></p>';
  card.children[0].textContent = kind; card.children[1].textContent = item.content?.title || '제목 없는 콘텐츠';
  card.children[2].textContent = typeof data.body === 'string' ? data.body : (item.reasons || []).join(' · ') || '표시할 내용이 없습니다.';
  if (kind === 'CHECKLIST') {
    const checked = new Set(state.view?.appState?.checked || []), list = document.createElement('div'); list.className = 'checklist';
    for (const row of Array.isArray(data.items) ? data.items : []) { const b = document.createElement('button'); b.type = 'button'; b.dataset.checkId = row.id; b.setAttribute('aria-pressed', String(checked.has(row.id))); b.textContent = (checked.has(row.id) ? '✓ ' : '□ ') + (row.label || row.id); list.append(b); }
    card.append(list);
  }
  if (kind === 'GAME') {
    const grid = document.createElement('div'), count = Math.max(5, Math.min(25, Number(data.tileCount) || 15)); grid.className = 'tile-grid';
    for (let i = 0; i < count; i += 1) { const b = document.createElement('button'); b.type = 'button'; b.dataset.tile = String(i); b.setAttribute('aria-label', '타일 ' + (i + 1)); grid.append(b); }
    const tools = document.createElement('div'); tools.className = 'mini-toolbar'; tools.append('점수 ' + String(Number(state.view?.appState?.score || 0)).padStart(3, '0'));
    const reset = document.createElement('button'); reset.type = 'button'; reset.dataset.gameReset = ''; reset.textContent = '초기화'; tools.append(reset); card.append(grid, tools);
  }
  if (kind === 'ACCOUNT') {
    const list = document.createElement('div'); list.className = 'checklist';
    for (const row of Array.isArray(data.rows) ? data.rows : []) { const line = document.createElement('div'); line.textContent = (row.label || '') + '  ' + (row.value || ''); list.append(line); }
    const install = document.createElement('button'); install.type = 'button'; install.dataset.installApp = ''; install.textContent = '앱 설치 안내';
    const installStatus = document.createElement('p'); installStatus.id = 'installStatus'; installStatus.setAttribute('role', 'status');
    list.append(install, installStatus); card.append(list);
  }
  const source = data.source;
  if (typeof source === 'string') {
    try { const url = new URL(source); if (url.protocol === 'https:' || url.protocol === 'http:') { const label = document.createElement('p'); label.className = 'source'; const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = url.hostname; label.append(link); card.append(label); } } catch {}
  }
  return card;
}
function renderFavorites() {
  const list = $('#favoritesList'); list.replaceChildren();
  $('.favorites').hidden = isDashboard();
  if (isDashboard()) return;
  if (!(state.profile.favorites || []).length) {
    const empty = document.createElement('button');
    empty.type = 'button'; empty.disabled = true; empty.textContent = '☆'; empty.setAttribute('aria-label', '저장한 콘텐츠 없음');
    list.append(empty);
    return;
  }
  for (const favorite of state.profile.favorites || []) { const b = document.createElement('button'); b.type = 'button'; b.dataset.favorite = favorite.id; b.title = favorite.title || favorite.id; b.textContent = favorite.title || favorite.id; b.setAttribute('aria-current', String(current()?.content?.id === favorite.id)); list.append(b); }
}
function render() {
  if (disposed) return;
  rendererLifetime.abort(); rendererLifetime = new AbortController(); renderGeneration += 1;
  const item = current(), view = state.view;
  const dashboard = isDashboard(item);
  $('#contentStage').classList.toggle('is-dashboard', dashboard);
  $('#contentStage').classList.toggle('is-realtime', item?.manifest?.kind === 'REALTIME');
  $('#viewerTitle').textContent = item?.content?.title || '콘텐츠'; $('#position').textContent = dashboard ? '앱' : (state.items.length ? (state.index + 1) + ' / ' + state.items.length : '0 / 0');
  $('#contentStage').replaceChildren(renderStage(item)); const saved = Boolean(view?.favorite); $('[data-save-label]').textContent = saved ? '저장됨' : '저장'; $('[data-save]').setAttribute('aria-pressed', String(saved));
  for (const reaction of ['like', 'dislike']) { const button = $('[data-reaction="' + reaction + '"]'); button.setAttribute('aria-pressed', String(view?.reaction === reaction.toUpperCase())); button.hidden = !accepts('reaction'); }
  $('[data-comment]').hidden = !accepts('comment'); $('[data-share]').hidden = !accepts('share'); $('[data-save]').hidden = !accepts('favorite'); $('[data-remove]').hidden = !saved || !accepts('favorite');
  $('.action-rail').hidden = dashboard || !['reaction', 'comment', 'share'].some(accepts); $('.viewer-foot').hidden = dashboard;
  $('#contentMeta').textContent = (item?.reasons || []).join(' · '); $('#comments').replaceChildren(...(view?.comments || []).map((c) => Object.assign(document.createElement('li'), { textContent: c.body || '' }))); renderFavorites();
}
/** Opens a content and says what happened: {applies:true, contentId} once it is on screen, otherwise {applies:false, reason}
 *  — superseded (a later navigation won), navigation_cancelled, disposed, or failed (with message and status). */
async function openById(contentId, rankedIndex = -1, { initiator = 'user' } = {}) {
  if (!contentId || disposed) return { applies: false, reason: disposed ? 'disposed' : 'no_content' };
  // A host- or agent-initiated open does not cancel what the person is waiting for (an AI answer, a save):
  // it lets the work already in flight finish and apply, then opens. A person's own navigation still supersedes it.
  if (initiator === 'host') for (let tail = null; tail !== state.operation;) { tail = state.operation; await tail.catch(() => {}); if (disposed) return { applies: false, reason: 'disposed' }; }
  if (mediaSession?.isActive()) {
    if (contentId === mediaContentId && current()?.content?.id === contentId) return { applies: true, contentId };
    if (!window.confirm('현재 통화·방송을 종료하고 다른 콘텐츠를 열까요?')) return { applies: false, reason: 'navigation_cancelled' };
    mediaSession.leave(); mediaContentId = null;
  }
  rendererLifetime.abort();
  const intent = ++state.intent;
  status('콘텐츠 여는 중');
  const run = state.operation = state.operation.catch(() => {}).then(async () => {
    if (disposed) return 'disposed';
    const view = await adapter.open({ contentId, expectedViewRevision: state.profile.viewRevision });
    if (disposed) return 'disposed';
    state.profile = { ...state.profile, viewRevision: view.viewRevision };
    if (intent !== state.intent) return 'superseded';
    let index = rankedIndex >= 0 ? rankedIndex : state.items.findIndex((item) => item.content?.id === contentId);
    if (index < 0) state.direct = { content: view.content, manifest: view.manifest, reasons: [] };
    else {
      state.direct = null;
      // Feed entries are discovery snapshots; the opened view owns the current payload and program revision.
      state.items[index] = { ...state.items[index], content: view.content, manifest: view.manifest };
    }
    state.index = index;
    if (index >= 0) state.lastFeedId = contentId;
    state.view = view;
    state.profile = { ...state.profile, activeContentId: contentId };
    status('연결됨');
    render();
    return 'opened';
  });
  try { const outcome = await run; return outcome === 'opened' ? { applies: true, contentId } : { applies: false, reason: outcome }; }
  catch (error) { if (intent === state.intent) status(error.message, true); return { applies: false, reason: 'failed', message: error.message, ...(error.status ? { status: error.status } : {}) }; }
}
function mutate(path, body) {
  const capturedContentId = body.contentId;
  const capturedRevision = state.profile.viewRevision;
  const capturedIntent = state.intent;
  setBusy(true);
  state.operation = state.operation.catch(() => {}).then(async () => {
    if (disposed) throw new Error('HOH UI is unmounted');
    const result = await adapter[mutationMethods[path]]({ ...body, viewRevision: capturedRevision });
    if (result.viewRevision !== undefined) state.profile = { ...state.profile, viewRevision: result.viewRevision };
    return { result, applies: !disposed && state.intent === capturedIntent && current()?.content?.id === capturedContentId };
  });
  return state.operation.catch((error) => { status(error.status === 503 ? '저장소 또는 제공자를 사용할 수 없습니다.' : '변경하지 못했습니다.', true); throw error; }).finally(() => setBusy(false));
}
async function initialize() {
  if (disposed) return;
  if (mediaSession?.isActive()) {
    if (!window.confirm('현재 통화·방송을 종료하고 새로고침할까요?')) return;
    mediaSession.leave(); mediaContentId = null;
  }
  rendererLifetime.abort(); state.intent += 1;
  try {
    const session = await adapter.bootstrap(); if (disposed) return; state.profile = session.profile || {};
    const feed = await adapter.list(); if (disposed) return; state.items = feed.items || [];
    const requested = new URLSearchParams(location.search).get('content') || state.profile.activeContentId || homeContentId;
    await openById(requested, state.items.findIndex((item) => item.content?.id === requested));
    const live = await adapter.status().catch(() => null); if (disposed) return; const chat = chatReadiness(live?.readiness, session.readiness);
    $('#chatStatus').textContent = chat?.status === 'READY' ? 'AI 채팅을 사용할 수 있습니다.' : (chat?.reason || 'AI 제공자에 연결되지 않았습니다.');
  } catch { if (disposed) return; status('연결할 수 없음', true); $('#chatStatus').textContent = '콘텐츠 또는 AI 제공자에 연결할 수 없습니다.'; render(); }
}
async function saveState(next, context = null) {
  const item = current();
  if (disposed || !item || context && (item.content.id !== context.contentId || state.profile.viewRevision !== context.viewRevision)) return { applies: false, reason: 'stale_context' };
  const active = document.activeElement?.dataset?.checkId || document.activeElement?.dataset?.tile;
  try {
    const queued = await mutate('/state', { contentId: item.content.id, state: next });
    if (!queued.applies) return { applies: false, reason: 'context_changed' };
    const appState = queued.result.appState || next;
    state.view = { ...state.view, appState }; render();
    if (active !== undefined) root.querySelector('[data-check-id="' + active + '"]')?.focus() || root.querySelector('[data-tile="' + active + '"]')?.focus();
    return { applies: true, appState };
  } catch { return { applies: false, reason: 'save_failed' }; }
}
listen(root, 'click', async (event) => {
  const b = event.target.closest('button'); if (!b) return;
  if (b.matches('[data-prev]') && state.items.length) return openById(state.items[(state.index - 1 + state.items.length) % state.items.length].content.id, (state.index - 1 + state.items.length) % state.items.length);
  if (b.matches('[data-next]') && state.items.length) return openById(state.items[(state.index + 1) % state.items.length].content.id, (state.index + 1) % state.items.length);
  if (b.matches('[data-home]')) return openById(homeContentId);
  if (b.matches('#dashboardGesture')) { const suppress = dashboardClickSuppressed && event.detail !== 0; dashboardClickSuppressed = false; if (suppress) return; return openById(homeContentId); }
  if (b.matches('[data-dashboard-action="feed"]')) return openRecommendedFeed();
  if (b.matches('[data-dashboard-content-id]')) return openById(b.dataset.dashboardContentId); if (b.matches('[data-favorite]')) return openById(b.dataset.favorite); if (b.matches('[data-sheet-close]')) return setSheet('content');
  const item = current(); if (!item) return;
  if (isDashboard(item)) return;
  if ((b.matches('[data-save]') || b.matches('[data-remove]')) && !accepts('favorite') || b.dataset.reaction && !accepts('reaction') || b.matches('[data-comment]') && !accepts('comment') || b.matches('[data-share]') && !accepts('share')) return;
  if (b.matches('[data-save]') || b.matches('[data-remove]')) { const favorite = b.matches('[data-save]') ? !state.view?.favorite : false; try { const queued = await mutate('/favorites', { contentId: item.content.id, favorite }); if (!queued.applies) return; state.view = { ...state.view, favorite }; const profile = await adapter.profile(); if (disposed) return; state.profile = profile.profile || profile; render(); } catch {} }
  if (b.dataset.reaction) { const wanted = b.dataset.reaction.toUpperCase(), reaction = state.view?.reaction === wanted ? 'CLEAR' : wanted; try { const queued = await mutate('/reactions', { contentId: item.content.id, reaction }); if (!queued.applies) return; state.view = { ...state.view, reaction }; render(); } catch {} }
  if (b.matches('[data-comment]')) $('#commentDialog').showModal();
  if (b.matches('[data-share]')) { const url = new URL(location.pathname, location.origin); url.searchParams.set('content', item.content.id); try { navigator.share ? await navigator.share({ title: item.content.title, url: url.href }) : await navigator.clipboard.writeText(url.href); status('공유 링크를 복사했습니다.'); } catch {} }
  if (b.dataset.checkId) { const checked = new Set(state.view?.appState?.checked || []); checked.has(b.dataset.checkId) ? checked.delete(b.dataset.checkId) : checked.add(b.dataset.checkId); await saveState({ checked: [...checked] }); }
  if (b.dataset.tile !== undefined) await saveState({ score: Number(state.view?.appState?.score || 0) + 1 }); if (b.matches('[data-game-reset]')) await saveState({ score: 0 });
});
listen($('#chatForm'), 'submit', async (event) => {
  event.preventDefault(); const input = $('#chatInput'), message = input.value.trim(), item = current(); if (!message || !item) return;
  const bubble = Object.assign(document.createElement('li'), { className: 'user', textContent: message }); $('#messages').append(bubble);
  try { const queued = await mutate('/chat', { message, contentId: item.content.id }); if (!queued.applies) return; input.value = ''; const answer = queued.result.answer || queued.result.message; if (typeof answer === 'string' && answer) $('#messages').append(Object.assign(document.createElement('li'), { textContent: answer })); }
  catch { if (disposed) return; bubble.classList.add('failed'); bubble.textContent = message + ' (전송 실패)'; $('#chatStatus').textContent = 'AI 제공자가 준비되지 않았습니다. 입력은 그대로 남아 있습니다.'; }
});
listen($('#commentSubmit'), 'click', async () => { const body = $('#commentInput').value.trim(), item = current(); if (!body || !item) return; try { const queued = await mutate('/comments', { contentId: item.content.id, body }); if (!queued.applies) return; state.view = { ...state.view, comments: queued.result.comments || [...(state.view?.comments || []), { body }] }; $('#commentInput').value = ''; render(); $('#commentDialog').close(); } catch {} });
listen($('#retryButton'), 'click', initialize);
function placeSheetHandle() { if (disposed) return; const chat = $('.chat'), handle = $('#sheetHandle'); if (innerWidth <= 760) handle.style.top = (chat.getBoundingClientRect().top - 22) + 'px'; }
function syncViewport() { if (disposed) return; $('.app-shell').style.setProperty('--hoh-viewport-height', (window.visualViewport?.height || innerHeight) + 'px'); placeSheetHandle(); }
function setSheet(name, height = null) { if (disposed) return; const shell = $('.app-shell'); shell.dataset.sheet = name; height === null ? shell.style.removeProperty('--hoh-chat-height') : shell.style.setProperty('--hoh-chat-height', height + 'px'); requestAnimationFrame(placeSheetHandle); }
let dashboardClickSuppressed = false;
function installGestures() {
  const sheet = $('#sheetHandle'), feed = $('#feedGesture'), dashboard = $('#dashboardGesture'); let drag = null, horizontal = null, dashboardStart = null, draggedAt = 0;
  listen(sheet, 'pointerdown', (event) => { if (innerWidth > 760) return; drag = { y: event.clientY, height: $('.chat').offsetHeight }; sheet.setPointerCapture(event.pointerId); $('.chat').classList.add('is-dragging'); });
  listen(sheet, 'pointermove', (event) => { if (!drag) return; const max = (window.visualViewport?.height || innerHeight) - 56, height = Math.max(44, Math.min(max, drag.height + drag.y - event.clientY)); setSheet('split', height); });
  const settle = () => { if (!drag) return; const max = (window.visualViewport?.height || innerHeight) - 56, height = $('.chat').offsetHeight, poses = [['chat', max], ['split', max / 2], ['content', 44]]; const next = poses.reduce((best, pose) => Math.abs(pose[1] - height) < Math.abs(best[1] - height) ? pose : best)[0]; $('.chat').classList.remove('is-dragging'); if (Math.abs(height - drag.height) > 4) draggedAt = Date.now(); setSheet(next); drag = null; };
  listen(sheet, 'pointerup', settle); listen(sheet, 'pointercancel', settle);
  listen(sheet, 'click', () => { if (Date.now() - draggedAt < 300) return; const name = $('.app-shell').dataset.sheet; setSheet(name === 'content' ? 'split' : name === 'split' ? 'chat' : 'content'); });
  listen(feed, 'pointerdown', (event) => { if (innerWidth <= 760) { horizontal = event.clientX; feed.setPointerCapture(event.pointerId); } });
  const releaseFeed = (event) => { if (horizontal === null) return; const delta = event.clientX - horizontal; horizontal = null; if (Math.abs(delta) > 35) root.querySelector(delta < 0 ? '[data-next]' : '[data-prev]').click(); };
  listen(feed, 'pointerup', releaseFeed); listen(feed, 'pointercancel', () => { horizontal = null; });
  listen(dashboard, 'pointerdown', (event) => { dashboardClickSuppressed = false; dashboardStart = { x: event.clientX, y: event.clientY }; dashboard.setPointerCapture(event.pointerId); });
  const releaseDashboard = (event) => {
    if (!dashboardStart) return; const dx = event.clientX - dashboardStart.x, dy = event.clientY - dashboardStart.y; dashboardStart = null;
    const qualifyingSwipe = dy > 50 && dy > Math.abs(dx);
    const dragged = Math.hypot(dx, dy) > 6;
    dashboardClickSuppressed = qualifyingSwipe || dragged;
    if (qualifyingSwipe) openById(homeContentId);
  };
  listen(dashboard, 'pointerup', releaseDashboard); listen(dashboard, 'pointercancel', () => { dashboardStart = null; dashboardClickSuppressed = true; });
}
listen($('.chat'), 'transitionend', placeSheetHandle);
listen(window, 'resize', syncViewport);
if (window.visualViewport) listen(window.visualViewport, 'resize', syncViewport);
listen(window, 'pagehide', () => mediaSession?.leave());
listen(window, 'beforeunload', event => { if (mediaSession?.isActive()) { event.preventDefault(); event.returnValue = ''; } });
syncViewport();
installGestures();
const ready = initialize();
return { ready, open: (contentId, options = {}) => openById(contentId, -1, options), refresh: initialize, realtime: mediaSession, destroy() { disposed = true; listeners.abort(); rendererLifetime.abort(); mediaSession?.close(); state.intent += 1; root.replaceChildren(); } };

}

function graphemes(text) { return typeof Intl?.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length : [...text].length; }

/** Compatibility with the original @hoh/ui entry point. */
export const mountHohUI = mountHohInterface;
/** AI 대화 제공자의 준비 상태. `readiness.chat` 이 일반 열쇠이고, 없으면 참조 호스트가 주는 `readiness.hswm`(HSWM 채팅)을 같은 뜻으로 읽는다.
 *  앞의 것(살아 있는 status())이 뒤의 것(bootstrap)보다 앞선다. HSWM 이 아닌 제공자는 `hswm` 자리를 채우지 않는다. */
export function chatReadiness(...readinesses) {
  for (const readiness of readinesses) { const provider = readiness?.chat || readiness?.hswm; if (provider) return provider; }
  return null;
}
