import { OfficeDocumentHost } from './document-host.js';
const el = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);
const errors = {
  SESSION_CHANGED: '계정 연결이 바뀌었어요. 다시 연결해 문서를 불러오세요.',
  CONFLICT: '다른 곳에서 수정된 문서예요. 현재 초안은 남아 있어요. 최신 문서를 다시 불러오거나 내용을 복사해 보관하세요.',
  INVALID_INPUT: '제목과 지원되는 문서 내용을 확인해 주세요. 초안은 그대로 남아 있어요.',
  INVALID_RESPONSE: '저장 결과를 확인하지 못했어요. 초안을 유지했어요.',
  CONNECTION_FAILED: '연결을 확인해 주세요. 초안은 이 화면에 남아 있어요.'
};

/** Content-first native surface. No auth details, remote scripts or automatic uploads. */
export function mountOfficeDocuments(root, { transport, createTiptap, confirmDiscard = () => window.confirm('저장하지 않은 변경을 버릴까요?') }) {
  const host = new OfficeDocumentHost(transport), view = el('section', { className: 'office-documents' });
  view.innerHTML = '<aside class="office-sidebar"><div class="office-list-heading"><h2>내 문서</h2><button type="button" data-office-new>새 문서</button></div><nav data-office-list aria-label="내 문서 목록"></nav><p data-office-empty>아직 문서가 없어요. 새 문서로 시작해 보세요.</p><button type="button" data-office-more hidden>더 보기</button><button type="button" data-office-refresh>목록 새로고침</button></aside><main class="office-main"><div class="office-heading"><label>문서 제목<input data-office-title maxlength="240" autocomplete="off" placeholder="제목을 입력하세요"></label><button type="button" data-office-save>저장</button></div><p data-office-status role="status" aria-live="polite" data-office-state="idle" data-office-dirty="false"></p><div data-office-toolbar aria-label="문서 서식" role="group"></div><div data-office-editor class="office-page"></div><p data-office-start>문서를 선택하거나 새 문서를 만들어 주세요.</p><footer><button type="button" data-office-reload>최신 문서 불러오기</button><button type="button" data-office-discard>변경 버리기</button></footer></main>';
  root.replaceChildren(view);
  const $ = selector => view.querySelector(selector);
  const status = $('[data-office-status]'), list = $('[data-office-list]'), title = $('[data-office-title]'), stage = $('[data-office-editor]');
  let editor = null, editorId = null, disposed = false, restoring = false, lastDraft = null;
  const canLeave = () => !host.state().dirty || confirmDiscard();
  const draftFromEditor = () => ({ title: title.value, body: { schema: 'hoh/office-document@1', editorKind: 'document', schemaVersion: 1, snapshot: editor.getJSON(), assets: [] } });
  const recordEdit = () => { if (editor && !restoring) host.edit(draftFromEditor()); };
  const toolbar = [
    ['굵게', 'bold', chain => chain.toggleBold()], ['기울임', 'italic', chain => chain.toggleItalic()],
    ['밑줄', 'underline', chain => chain.toggleUnderline()], ['제목', 'heading', chain => chain.toggleHeading({ level: 2 })],
    ['글머리 목록', 'bulletList', chain => chain.toggleBulletList()], ['번호 목록', 'orderedList', chain => chain.toggleOrderedList()],
    ['인용', 'blockquote', chain => chain.toggleBlockquote()], ['실행 취소', null, chain => chain.undo()], ['다시 실행', null, chain => chain.redo()]
  ].map(([label, mark, command]) => {
    const button = el('button', { type: 'button', textContent: label });
    button.dataset.officeFormat = mark || (label === '실행 취소' ? 'undo' : 'redo');
    if (mark) button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => { if (editor) command(editor.chain().focus()).run(); });
    $('[data-office-toolbar]').append(button); return { button, mark };
  });
  const updateToolbar = () => { for (const {button, mark} of toolbar) if (mark) button.setAttribute('aria-pressed', String(Boolean(editor?.isActive(mark)))); };
  const render = state => {
    if (disposed) return;
    const busy = state.status === 'loading' || state.status === 'saving';
    status.dataset.officeState = state.status; status.dataset.officeDirty = String(state.dirty);
    status.textContent = state.error ? errors[state.error] || '요청을 처리하지 못했어요. 초안은 그대로 남아 있어요.'
      : state.status === 'saving' ? '서버에 저장하고 확인하는 중…' : state.status === 'loading' ? '문서를 불러오는 중…'
      : state.dirty ? '저장되지 않은 변경 · Ctrl / ⌘ + S' : state.current ? `저장됨 · 버전 ${state.current.version}` : '내 계정의 문서를 만들고 저장할 수 있어요.';
    $('[data-office-save]').disabled = busy || !state.draft || state.error === 'CONFLICT' || !state.dirty && !state.retryPending;
    $('[data-office-save]').textContent = state.retryPending && state.status !== 'saving' ? '저장 확인 재시도' : '저장';
    $('[data-office-new]').disabled = busy;
    $('[data-office-reload]').disabled = busy || !state.current;
    $('[data-office-discard]').disabled = busy || !state.dirty;
    $('[data-office-refresh]').disabled = busy;
    $('[data-office-more]').hidden = !state.hasMore; $('[data-office-more]').disabled = busy;
    title.disabled = !state.draft || state.status === 'loading';
    $('[data-office-empty]').hidden = Boolean(state.documents.length) || busy;
    $('[data-office-start]').hidden = Boolean(state.draft);
    stage.hidden = !state.draft; $('[data-office-toolbar]').hidden = !state.draft;
    // Preserve the active list control when only editor input/state changes.
    const listKey = JSON.stringify(state.documents.map(row => [row.documentId, row.title, row.version])) + '|' + state.draftId;
    if (list.dataset.items !== listKey) {
      list.dataset.items = listKey;
      list.replaceChildren(...state.documents.map(doc => {
        const button = el('button', { type: 'button', textContent: doc.title });
        button.dataset.officeDocumentId = doc.documentId;
        button.setAttribute('aria-current', String(doc.documentId === state.draftId));
        button.addEventListener('click', () => { if (canLeave()) void host.open(doc.documentId); });
        return button;
      }));
    }
    for (const button of list.querySelectorAll('button')) button.disabled = busy;
    if (!state.draft) {
      editor?.destroy(); editor = null; editorId = null; lastDraft = null; stage.replaceChildren(); title.value = '';
    } else {
      if (title.value !== state.draft.title) title.value = state.draft.title;
      const snapshot = JSON.stringify(state.draft.body.snapshot);
      if (!editor || editorId !== state.draftId) {
        editor?.destroy(); stage.replaceChildren(); restoring = true;
        try {
          editor = createTiptap({ element: stage, content: state.draft.body.snapshot, onUpdate: recordEdit, onSelectionUpdate: updateToolbar });
          editorId = state.draftId;
          const editable = stage.querySelector('[contenteditable]');
          editable?.setAttribute('data-office-editor-ready', 'true'); editable?.setAttribute('aria-label', '문서 본문');
          editable?.setAttribute('role', 'textbox'); editable?.setAttribute('aria-multiline', 'true');
        } finally { restoring = false; }
      } else if (snapshot !== lastDraft && JSON.stringify(editor.getJSON()) !== snapshot) {
        restoring = true;
        try { editor.commands.setContent(state.draft.body.snapshot, { emitUpdate: false, errorOnInvalidContent: true }); }
        finally { restoring = false; }
      }
      lastDraft = snapshot; editor.setEditable(state.status !== 'loading');
    }
    for (const {button} of toolbar) button.disabled = !editor || state.status === 'loading';
    updateToolbar();
  };
  const unsubscribe = host.subscribe(render);
  title.addEventListener('input', recordEdit);
  $('[data-office-new]').addEventListener('click', () => { if (canLeave()) { host.newDocument(); title.focus(); title.select(); } });
  $('[data-office-save]').addEventListener('click', () => { void host.save(); });
  $('[data-office-reload]').addEventListener('click', () => { const current = host.state().current; if (current && canLeave()) void host.open(current.documentId); });
  $('[data-office-discard]').addEventListener('click', () => { if (canLeave()) void host.discard(); });
  $('[data-office-refresh]').addEventListener('click', () => { void host.list(); });
  $('[data-office-more]').addEventListener('click', () => { void host.list({ more: true }); });
  view.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); $('[data-office-save]').click(); } });
  const beforeUnload = event => { if (host.state().dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const ready = host.list();
  return { host, ready, canLeave, isDirty: () => host.state().dirty, observe: () => host.observe(), invokeOffice: request => host.invokeOffice(request), destroy() {
    disposed = true; unsubscribe(); host.destroy(); editor?.destroy(); window.removeEventListener('beforeunload', beforeUnload); root.replaceChildren();
  } };
}
