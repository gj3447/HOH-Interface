/* Copyright (C) 2026 MetaHumotonic Foundation. SPDX-License-Identifier: AGPL-3.0-only */
import { mountHohInterface } from '/feed/hoh-ui.js';

// A host shows what the shell leaves to it: its own dashboard icons and counts, which host resources each content accepts,
// opening content on its own initiative without dropping the answer a person is waiting for, a feed that continues,
// comments with their authors, reaction counts, and answers that stream with steps and render as the host draws them.
const page1 = [
  { content: { id: 'note', title: '메모', payload: { body: '반응·댓글·공유·저장을 모두 받는 콘텐츠입니다.' } }, manifest: { kind: 'ARTICLE' }, reasons: ['모든 행동을 받음'] },
  { content: { id: 'tool', title: '도구 앱', payload: { body: '저장과 공유만 받는 앱입니다 — 반응과 댓글은 호스트가 받지 않습니다.' } }, manifest: { kind: 'ARTICLE' }, reasons: ['저장·공유만'],
    accepts: { reaction: false, comment: false } }
];
const page2 = [{ content: { id: 'more', title: '더 받은 콘텐츠', payload: { body: '피드 끝에서 이어 받은 두 번째 묶음입니다.' } }, manifest: { kind: 'ARTICLE' }, reasons: ['이어 받음'] }];
const all = [...page1, ...page2];
const dashboard = { content: { id: 'dashboard-home', title: '호스트 연결 예제', payload: {} }, manifest: { kind: 'DASHBOARD' } };
let revision = 0, nextComment = 3; const saved = new Set(), reactions = new Map();
const counts = new Map([['note', { like: 2, dislike: 0 }]]), reactedBy = new Map([['note', { like: ['김연구', '이현장'], dislike: [] }]]);
const comments = new Map([['note', [
  { id: 'c1', body: '첫 댓글입니다.', author: '김연구', at: '2026-10-07T09:00:00+09:00', canDelete: false },
  { id: 'c2', body: '제가 단 댓글입니다.', author: '나', at: '2026-10-07T09:30:00+09:00', canDelete: true }
]]]);
const find = id => all.find(item => item.content.id === id);
const favoriteItems = () => all.filter(item => saved.has(item.content.id)).map(item => ({ id: item.content.id, title: item.content.title, kind: item.manifest.kind, icon: '★' }));
const profile = () => ({ viewRevision: revision, favorites: favoriteItems() });
const fixed = [
  { id: 'note', title: '메모', kind: 'ARTICLE', icon: '✎', badge: 3 },
  { id: 'tool', title: '도구 앱', kind: 'ARTICLE', icon: '⚒', badge: 120 },
  { id: 'note', title: '기본 아이콘', kind: 'GAME' },
  { id: 'tool', title: '너무 긴 아이콘', kind: 'CHECKLIST', icon: '아이콘세개' }
];
const social = id => ({ reaction: reactions.get(id), reactionCounts: counts.get(id) || { like: 0, dislike: 0 }, reactedBy: reactedBy.get(id) || { like: [], dislike: [] } });
// The host draws answers: here **bold** becomes <strong>, built as DOM nodes (never HTML from the answer).
const renderAnswer = ({ answer }) => {
  const paragraph = document.createElement('p');
  for (const part of String(answer || '').split(/(\*\*[^*]+\*\*)/)) {
    if (/^\*\*[^*]+\*\*$/.test(part)) paragraph.append(Object.assign(document.createElement('strong'), { textContent: part.slice(2, -2) }));
    else if (part) paragraph.append(part);
  }
  return paragraph;
};
const adapter = {
  bootstrap: async () => ({ profile: profile(), readiness: { chat: { status: 'READY', reason: 'example' } } }),
  list: async ({ cursor } = {}) => (cursor === 'page-2' ? { items: page2, hasMore: false } : { items: page1, hasMore: true, cursor: 'page-2' }),
  open: async ({ contentId }) => {
    const item = contentId === dashboard.content.id ? dashboard : find(contentId);
    if (!item) throw new Error('콘텐츠를 찾을 수 없습니다.');
    return { content: item.content, manifest: item.manifest, viewRevision: ++revision, favorite: saved.has(contentId), ...social(contentId),
      comments: comments.get(contentId) || [], commentScope: '이 예제의 모든 사람', ...(item.accepts ? { accepts: item.accepts } : {}), dashboard: { fixed, favorites: favoriteItems() } };
  },
  favorite: async ({ contentId, favorite }) => { favorite ? saved.add(contentId) : saved.delete(contentId); return { viewRevision: ++revision }; },
  react: async ({ contentId, reaction }) => {
    if (find(contentId)?.accepts?.reaction === false) throw new Error('반응을 받지 않는 콘텐츠입니다.');
    const before = reactions.get(contentId), c = { ...(counts.get(contentId) || { like: 0, dislike: 0 }) };
    if (before) c[before.toLowerCase()] -= 1; if (reaction !== 'CLEAR') c[reaction.toLowerCase()] += 1;
    reactions.set(contentId, reaction === 'CLEAR' ? undefined : reaction); counts.set(contentId, c);
    return { viewRevision: ++revision, ...social(contentId) };
  },
  comment: async ({ contentId, body }) => {
    if (find(contentId)?.accepts?.comment === false) throw new Error('댓글을 받지 않는 콘텐츠입니다.');
    const rows = [...(comments.get(contentId) || []), { id: 'c' + nextComment++, body, author: '나', at: new Date().toISOString(), canDelete: true }];
    comments.set(contentId, rows); return { comments: rows, viewRevision: ++revision };
  },
  deleteComment: async ({ contentId, commentId }) => {
    const rows = (comments.get(contentId) || []).filter(c => !(c.id === commentId && c.canDelete)); comments.set(contentId, rows);
    return { comments: rows, viewRevision: ++revision };
  },
  saveState: async ({ state }) => ({ appState: state, viewRevision: ++revision }),
  // The answer streams: a step, then the text in pieces; «멈추기» aborts the signal. «열어» asks the screen to open a content after the answer.
  chat: async ({ message, onProgress, signal }) => {
    const wait = ms => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('멈춤', 'AbortError')); }, { once: true });
    });
    onProgress?.({ step: '콘텐츠를 살펴보는 중' });
    const answer = '답: ' + message + (message.includes('자세히') ? ' — **굵게** 표시한 부분' : '');
    const pieces = message.includes('길게') ? 12 : 3;
    for (let i = 1; i <= pieces; i += 1) { await wait(200); onProgress?.({ answer: answer.slice(0, Math.ceil(answer.length * i / pieces)) }); }
    return { answer, ...(message.includes('열어') ? { open: 'tool' } : {}) };
  },
  profile: async () => ({ profile: profile() }),
  status: async () => ({ readiness: { chat: { status: 'READY', reason: 'example' } } })
};
// Exposes the public lifecycle surface (open with an initiator, refresh, destroy) to local example instrumentation.
window.hohExample = mountHohInterface({ root: document.querySelector('#hoh-root'), adapter, renderAnswer, workspaceName: '호스트 연결 예제' });
