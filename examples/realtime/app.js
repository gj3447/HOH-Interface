/* Copyright (C) 2026 MetaHumotonic Foundation. SPDX-License-Identifier: AGPL-3.0-only */
import { mountHohInterface } from '/feed/hoh-ui.js';
import { createLocalWebRTCProvider } from './local-webrtc.js';

// This example deliberately uses no account service, public signaling, or external ICE server.
const candidate = new URL(location.href).searchParams.get('room') || 'demo-1';
const room = /^[a-zA-Z0-9_-]{1,64}$/.test(candidate) ? candidate : 'demo-1';
const programs = [
  ['voice', '음성 통화', 'audio', 'participant'],
  ['video', '영상 통화', 'video', 'participant'],
  ['broadcast-host', '방송 시작하기', 'broadcast', 'publisher'],
  ['broadcast-watch', '방송 시청하기', 'broadcast', 'viewer']
];
const items = programs.map(([id, title, mode, role]) => ({
  content: { id, title, manifestId: 'hoh-realtime', manifestRevision: 1, payload: {
    body: `로컬 연결 예제 · ${room}. 같은 브라우저의 다른 탭에서 같은 방을 열어 연결하세요.`, realtime: { mode, role }
  } }, manifest: { kind: 'REALTIME' }, reasons: ['같은 브라우저에서 실제 미디어 연결 확인']
}));
const guide = { content: { id: 'guide', title: '실시간 콘텐츠 사용 안내', payload: { body: '음성·영상 통화는 두 탭에서 같은 콘텐츠를 열고 참여하세요. 방송은 한 탭에서 시작하고 다른 탭에서 시청하세요. 시청자는 마이크·카메라 권한을 요청하지 않습니다. 다른 기기와의 연결에는 호스트의 인증·시그널링·ICE 구성이 필요합니다.' } }, manifest: { kind: 'ARTICLE' } };
items.push(guide);
const dashboard = { content: { id: 'dashboard-home', title: '실시간 콘텐츠', payload: {} }, manifest: { kind: 'DASHBOARD' } };
let revision = 0; const saved = new Set(), reactions = new Map(), comments = new Map(), states = new Map();
const favoriteItems = () => items.filter(item => saved.has(item.content.id)).map(item => ({ id: item.content.id, title: item.content.title, kind: item.manifest.kind }));
const unavailable = () => { throw new Error('이 연결 예제에는 AI 제공자가 연결되지 않았습니다.'); };
const profile = () => ({ viewRevision: revision, favorites: favoriteItems() });
const adapter = {
  bootstrap: async () => ({ profile: profile() }), list: async () => ({ items }),
  open: async ({ contentId }) => {
    const item = contentId === dashboard.content.id ? dashboard : items.find(item => item.content.id === contentId);
    if (!item) throw new Error('콘텐츠를 찾을 수 없습니다.');
    return { ...item, viewRevision: ++revision, favorite: saved.has(contentId), reaction: reactions.get(contentId), comments: comments.get(contentId) || [], appState: states.get(contentId) || {},
      dashboard: { fixed: [...programs.map(([id, title]) => ({ id, title, kind: 'REALTIME' })), { id: 'guide', title: '사용 안내', kind: 'ARTICLE' }], favorites: favoriteItems() } };
  },
  favorite: async ({ contentId, favorite }) => { favorite ? saved.add(contentId) : saved.delete(contentId); return { viewRevision: ++revision }; },
  react: async ({ contentId, reaction }) => { reactions.set(contentId, reaction); return { viewRevision: ++revision }; },
  comment: async ({ contentId, body }) => { const rows = [...(comments.get(contentId) || []), { body }]; comments.set(contentId, rows); return { comments: rows, viewRevision: ++revision }; },
  saveState: async ({ contentId, state }) => { states.set(contentId, state); return { appState: state, viewRevision: ++revision }; },
  profile: async () => ({ profile: profile() }), chat: async () => unavailable(),
  status: async () => ({ readiness: { hswm: { status: 'NOT_READY', reason: '이 로컬 연결 예제에는 AI 제공자가 연결되지 않았습니다.' } } })
};
let provider = null;
try { provider = createLocalWebRTCProvider(); } catch { /* The shell still shows unavailable content on unsupported browsers. */ }
const ui = mountHohInterface({ root: document.querySelector('#hoh-root'), adapter, workspaceName: '실시간 콘텐츠 예제', realtime: {
  provider,
  authorize: async ({ context, request, signal }) => {
    if (signal.aborted) throw new DOMException('취소되었습니다.', 'AbortError');
    const entry = programs.find(([id]) => id === context.contentId);
    if (!entry || request.mode !== entry[2] || request.role !== entry[3]) throw new Error('허용하지 않은 예제 콘텐츠입니다.');
    return { roomId: `hoh-example-${room}-${entry[2]}`, mode: entry[2], role: entry[3] };
  }
} });
// Exposes the same public lifecycle surface to local example instrumentation; no credentials.
window.hohExample = ui;
