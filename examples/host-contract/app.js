/* Copyright (C) 2026 MetaHumotonic Foundation. SPDX-License-Identifier: AGPL-3.0-only */
import { mountHohInterface } from '/feed/hoh-ui.js';

// A host shows what the shell leaves to it: its own dashboard icons, which host resources each content accepts,
// and opening content on its own initiative without dropping the answer a person is waiting for.
const items = [
  { content: { id: 'note', title: '메모', payload: { body: '반응·댓글·공유·저장을 모두 받는 콘텐츠입니다.' } }, manifest: { kind: 'ARTICLE' }, reasons: ['모든 행동을 받음'] },
  { content: { id: 'tool', title: '도구 앱', payload: { body: '저장과 공유만 받는 앱입니다 — 반응과 댓글은 호스트가 받지 않습니다.' } }, manifest: { kind: 'ARTICLE' }, reasons: ['저장·공유만'],
    accepts: { reaction: false, comment: false } }
];
const dashboard = { content: { id: 'dashboard-home', title: '호스트 연결 예제', payload: {} }, manifest: { kind: 'DASHBOARD' } };
let revision = 0; const saved = new Set(), reactions = new Map(), comments = new Map();
const find = id => items.find(item => item.content.id === id);
const favoriteItems = () => items.filter(item => saved.has(item.content.id)).map(item => ({ id: item.content.id, title: item.content.title, kind: item.manifest.kind, icon: '★' }));
const profile = () => ({ viewRevision: revision, favorites: favoriteItems() });
const fixed = [
  { id: 'note', title: '메모', kind: 'ARTICLE', icon: '✎' },
  { id: 'tool', title: '도구 앱', kind: 'ARTICLE', icon: '⚒' },
  { id: 'note', title: '기본 아이콘', kind: 'GAME' },
  { id: 'tool', title: '너무 긴 아이콘', kind: 'CHECKLIST', icon: '아이콘세개' }
];
const adapter = {
  bootstrap: async () => ({ profile: profile(), readiness: { chat: { status: 'READY', reason: 'example' } } }),
  list: async () => ({ items }),
  open: async ({ contentId }) => {
    const item = contentId === dashboard.content.id ? dashboard : find(contentId);
    if (!item) throw new Error('콘텐츠를 찾을 수 없습니다.');
    return { content: item.content, manifest: item.manifest, viewRevision: ++revision, favorite: saved.has(contentId), reaction: reactions.get(contentId),
      comments: comments.get(contentId) || [], ...(item.accepts ? { accepts: item.accepts } : {}), dashboard: { fixed, favorites: favoriteItems() } };
  },
  favorite: async ({ contentId, favorite }) => { favorite ? saved.add(contentId) : saved.delete(contentId); return { viewRevision: ++revision }; },
  react: async ({ contentId, reaction }) => { if (find(contentId)?.accepts?.reaction === false) throw new Error('반응을 받지 않는 콘텐츠입니다.'); reactions.set(contentId, reaction); return { viewRevision: ++revision }; },
  comment: async ({ contentId, body }) => { if (find(contentId)?.accepts?.comment === false) throw new Error('댓글을 받지 않는 콘텐츠입니다.'); const rows = [...(comments.get(contentId) || []), { body }]; comments.set(contentId, rows); return { comments: rows, viewRevision: ++revision }; },
  saveState: async ({ state }) => ({ appState: state, viewRevision: ++revision }),
  // The answer takes a moment, like a real provider; a host-initiated open during it must not drop it.
  chat: async ({ message }) => { await new Promise(resolve => setTimeout(resolve, 600)); return { answer: '답: ' + message }; },
  profile: async () => ({ profile: profile() }),
  status: async () => ({ readiness: { chat: { status: 'READY', reason: 'example' } } })
};
// Exposes the public lifecycle surface (open with an initiator, refresh, destroy) to local example instrumentation.
window.hohExample = mountHohInterface({ root: document.querySelector('#hoh-root'), adapter, workspaceName: '호스트 연결 예제' });
