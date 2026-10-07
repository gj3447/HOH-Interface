import { mountHohInterface } from '/feed/hoh-ui.js';
import { createAgentSession } from '../../protocol/agent-session.js';
import { createMcpMapping } from '../../protocol/mcp-mapping.js';
import { createBoard, descriptor, human, agent, planDemoCommand } from './model.js';

const runtime = createBoard();
let latest = await runtime.read({ actor: human });
let currentId = descriptor.id, viewRevision = 0, contextLifetime = new AbortController();
const receipts = [], updates = new Set(), pendingCards = new Set();
const planner = ({ message, snapshot }) => planDemoCommand(message, snapshot) || {
  answer: '명령 예제: 제목: 새 이름 / 추가: 새 할 일 / 완료 1 / 미완료 1 / 삭제 1 / 초기화.\n이 예제는 규칙 기반 명령 해석을 사용합니다. LLM·HSWM은 연결되지 않았습니다.'
};
let agentSession = createAgentSession({ runtime, actor: agent, planner });
await runtime.subscribe(snapshot => { latest = snapshot; for (const update of updates) update(); }, { actor: human });
const board = { content: { id: descriptor.id, title: descriptor.title, payload: {} }, manifest: { kind: 'SEMANTIC', id: 'hoh-semantic-board', revision: 1 } };
const guide = { content: { id: 'semantic-guide', title: '사람과 AI가 같은 콘텐츠를 다루는 방법', payload: { body: '보드의 버튼과 옆의 채팅 명령은 같은 상태와 조작 계약을 사용합니다. 사람이 먼저 바꾼 내용을 오래된 AI 명령이 덮어쓰면 충돌로 거절합니다. 삭제와 초기화는 대상과 변경 내용을 확인한 뒤 실행합니다. 데이터는 이 탭의 메모리에만 있고 새로고침하면 초기화됩니다.' } }, manifest: { kind: 'ARTICLE' } };
const dashboard = { content: { id: 'dashboard-home', title: '콘텐츠 작업공간', payload: {} }, manifest: { kind: 'DASHBOARD' } };
const items = [board, guide], favorites = new Set(), comments = new Map(), reactions = new Map();
const profile = () => ({ viewRevision, activeContentId: currentId, favorites: items.filter(item => favorites.has(item.content.id)).map(item => ({ id: item.content.id, title: item.content.title, kind: item.manifest.kind })) });
function record(result) {
  receipts.unshift(result.receipt); receipts.splice(8);
  for (const update of updates) update();
}
const errorMessage = error => error.code === 'STALE_REVISION' ? '그동안 내용이 바뀌었어요. 현재 내용을 확인하고 다시 요청해 주세요.' : error.code === 'INVALID_NEXT_STATE' ? '할 일은 최대 30개까지 추가할 수 있어요.' : error.code === 'INVALID_INPUT' ? '입력 형식을 확인해 주세요. 한 줄로 1~120자를 입력할 수 있어요.' : '변경을 적용하지 못했어요. 현재 내용을 확인하고 다시 시도해 주세요.';
function showProposal(proposal, signal) {
  const box = document.createElement('li'); box.className = 'proposal';
  const label = document.createElement('p'); label.textContent = `${proposal.action.title} · 보드 상태 ${proposal.request.expectedStateRevision}에 적용`;
  const details = document.createElement('p');
  details.textContent = proposal.request.actionId === 'removeTask'
    ? `삭제할 할 일: ${latest.state.tasks.find(row => row.id === proposal.request.input.taskId)?.label || '선택한 할 일'}`
    : '현재 제목과 할 일을 모두 처음 상태로 되돌립니다.';
  const approve = document.createElement('button'); approve.type = 'button'; approve.textContent = '변경 적용';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '취소';
  let settled = false;
  const stop = text => { if (settled) return; settled = true; pendingCards.delete(stop); approve.disabled = true; cancel.disabled = true; label.textContent = text; };
  pendingCards.add(stop);
  approve.onclick = async () => {
    approve.disabled = true; cancel.disabled = true;
    try { const result = await agentSession.confirm(proposal.proposalId, { signal }); record(result); stop(result.output.message); }
    catch (error) { stop(errorMessage(error)); }
  };
  cancel.onclick = () => { agentSession.cancel(proposal.proposalId); stop('취소했어요. 내용을 변경하지 않았어요.'); };
  signal.addEventListener('abort', () => stop('콘텐츠를 이동해서 이 제안을 닫았어요.'), { once: true });
  box.append(label, details, approve, cancel); document.querySelector('#messages').append(box);
}
const adapter = {
  bootstrap: async () => ({ profile: profile() }), list: async () => ({ items }),
  open: async ({ contentId }) => {
    const item = [dashboard, ...items].find(row => row.content.id === contentId);
    if (!item) throw new Error('Unknown content');
    contextLifetime.abort(); contextLifetime = new AbortController(); agentSession.close();
    agentSession = createAgentSession({ runtime, actor: agent, planner });
    currentId = contentId; viewRevision += 1;
    return { ...item, viewRevision, appState: latest.state, favorite: favorites.has(contentId), reaction: reactions.get(contentId), comments: comments.get(contentId) || [],
      dashboard: { fixed: items.map(row => ({ id: row.content.id, title: row.content.title, kind: row.manifest.kind })), favorites: profile().favorites } };
  },
  favorite: async ({ contentId, favorite }) => { favorite ? favorites.add(contentId) : favorites.delete(contentId); return {}; },
  react: async ({ contentId, reaction }) => { reactions.set(contentId, reaction); return {}; },
  comment: async ({ contentId, body }) => { const rows = [...(comments.get(contentId) || []), { body }]; comments.set(contentId, rows); return { comments: rows }; },
  saveState: async () => { throw new Error('Semantic contents require declared actions'); },
  profile: async () => ({ profile: profile() }),
  status: async () => ({ readiness: { hswm: { status: 'NOT_READY', reason: '명령 예제 · 규칙 기반 · LLM/HSWM 미연결' } } }),
  chat: async ({ contentId, message, viewRevision: expectedView }) => {
    if (contentId !== descriptor.id || contentId !== currentId || expectedView !== viewRevision) return { answer: '보드를 연 다음 요청해 주세요.' };
    for (const stop of [...pendingCards]) stop('새 요청을 받아 이전 제안을 닫았어요.');
    const signal = contextLifetime.signal;
    try {
      const response = await agentSession.submit(message, { signal });
      if (response.kind === 'answer') return { answer: response.answer };
      if (response.kind === 'confirmation') { showProposal(response, signal); return { answer: '위 제안의 대상과 내용을 확인한 뒤 적용해 주세요.' }; }
      record(response.result); return { answer: `${response.result.output.message} 현재 상태 ${response.result.snapshot.stateRevision}.` };
    } catch (error) { return { answer: errorMessage(error) }; }
    finally { requestAnimationFrame(() => { const messages = document.querySelector('#messages'); if (messages) messages.scrollTop = messages.scrollHeight; }); }
  }
};

function renderer({ signal, isCurrent }) {
  const card = document.createElement('article'); card.className = 'semantic-board';
  card.innerHTML = '<p class="eyebrow">SHARED CONTENT</p><h2></h2><p class="intro">직접 바꾸거나 옆의 채팅으로 요청해 보세요. 두 방법 모두 같은 보드를 변경합니다.</p><div class="semantic-meta"><span data-revision></span><span>이 탭에만 저장</span></div><form class="semantic-form" data-title-form><label for="board-title">보드 제목</label><div><input id="board-title" maxlength="120" required><button data-action-id="setTitle">제목 변경</button></div></form><form class="semantic-form" data-add-form><label for="task-label">새 할 일</label><div><input id="task-label" maxlength="120" required placeholder="무엇을 함께 할까요?"><button data-action-id="addTask">추가</button></div></form><ol class="task-list"></ol><button type="button" data-action-id="resetBoard">처음 상태로</button><p class="semantic-status" role="status" aria-live="polite"></p><section class="semantic-history"><strong>변경 기록</strong><ol data-history></ol></section><details><summary>채팅 명령 예시</summary><p>제목: 이번 주 계획<br>추가: 회의 준비<br>완료 1<br>미완료 1<br>삭제 1<br>초기화</p><p>이 예제는 규칙 기반 명령 해석입니다. LLM·HSWM은 연결되지 않았습니다.</p></details>';
  const titleInput = card.querySelector('#board-title'), addInput = card.querySelector('#task-label'), list = card.querySelector('.task-list'), status = card.querySelector('.semantic-status');
  let busy = false, drawnRevision = -1;
  const run = async (actionId, input, confirmed = false) => {
    if (busy || !isCurrent()) return;
    const expectedStateRevision = latest.stateRevision;
    busy = true; card.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const result = await runtime.invoke({ contentId: descriptor.id, descriptorRevision: descriptor.descriptorRevision, actionId, input,
        expectedStateRevision, idempotencyKey: crypto.randomUUID() }, { actor: human, confirmed, signal });
      record(result); status.textContent = result.output.message; status.dataset.error = 'false';
      if (actionId === 'addTask') addInput.value = '';
    } catch (error) { status.textContent = errorMessage(error); status.dataset.error = 'true'; }
    finally { busy = false; card.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  };
  function update() {
    if (signal.aborted) return;
    card.querySelector('h2').textContent = latest.state.title;
    card.querySelector('[data-revision]').textContent = `현재 상태 ${latest.stateRevision}`;
    if (document.activeElement !== titleInput) titleInput.value = latest.state.title;
    if (drawnRevision !== latest.stateRevision) {
      const focused = document.activeElement?.dataset?.taskId, action = document.activeElement?.dataset?.actionId;
      const rows = latest.state.tasks.map((row, index) => {
        const li = document.createElement('li'), toggle = document.createElement('button'), remove = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'task-toggle'; toggle.dataset.taskId = row.id; toggle.dataset.actionId = 'setTaskDone';
        toggle.setAttribute('aria-pressed', String(row.done)); toggle.textContent = `${row.done ? '✓' : '○'} ${index + 1}. ${row.label}`;
        toggle.onclick = () => run('setTaskDone', { taskId: row.id, done: !row.done });
        remove.type = 'button'; remove.dataset.taskId = row.id; remove.dataset.actionId = 'removeTask'; remove.textContent = '삭제';
        remove.setAttribute('aria-label', `${row.label} 삭제`);
        remove.onclick = () => { if (window.confirm(`“${row.label}” 할 일을 삭제할까요?`)) run('removeTask', { taskId: row.id }, true); };
        li.append(toggle, remove); return li;
      });
      if (!rows.length) rows.push(Object.assign(document.createElement('li'), { textContent: '할 일이 없어요. 직접 또는 채팅으로 추가해 보세요.' }));
      list.replaceChildren(...rows); drawnRevision = latest.stateRevision;
      if (focused) (card.querySelector(`[data-task-id="${focused}"][data-action-id="${action}"]`) || addInput).focus();
    }
    card.querySelector('[data-history]').replaceChildren(...receipts.map(row => Object.assign(document.createElement('li'), {
      textContent: `${row.actor.kind === 'agent' ? '채팅 명령' : '직접 조작'} · ${descriptor.actions.find(action => action.id === row.actionId)?.title} · 상태 ${row.stateRevision}`
    })));
  }
  card.querySelector('[data-title-form]').onsubmit = event => { event.preventDefault(); run('setTitle', { title: titleInput.value.trim() }); };
  card.querySelector('[data-add-form]').onsubmit = event => { event.preventDefault(); run('addTask', { label: addInput.value.trim() }); };
  card.querySelector('[data-action-id="resetBoard"]').onclick = () => { if (window.confirm('보드를 처음 상태로 되돌릴까요?')) run('resetBoard', {}, true); };
  updates.add(update); signal.addEventListener('abort', () => updates.delete(update), { once: true }); update(); return card;
}
const ui = mountHohInterface({ root: document.querySelector('#hoh-root'), adapter, renderers: { SEMANTIC: renderer }, workspaceName: '공유 콘텐츠 예제', homeContentId: 'dashboard-home' });
await ui.ready;
if (!new URL(location.href).searchParams.has('content')) await ui.open(descriptor.id);
document.querySelector('.chat h2').textContent = '콘텐츠에 요청하기';
document.querySelector('#chatInput').placeholder = '추가: 회의 준비';
window.hohSemanticExample = { ui, runtime, agentSession, bridge: createMcpMapping({ runtime, actor: agent }), read: () => runtime.read({ actor: human }), receipts };
