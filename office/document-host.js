import { decodeOfficeWrite } from './contracts.js';
const clone = value => structuredClone(value);
const empty = () => ({ status: 'idle', documents: [], current: null, draft: null, draftId: null, dirty: false, error: null, retryPending: false, after: null, hasMore: false });
const problem = (code, message = code) => Object.assign(new Error(message), { code });
const keyOf = session => JSON.stringify([session.principalId, session.epoch]);
const canonical = value => JSON.stringify(value, (_key, child) => child && !Array.isArray(child) && typeof child === 'object'
  ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
const summary = document => { const { body, ...row } = document; return { ...row, editorKind: body.editorKind }; };
const documentFrom = (value, principalId, documentId) => {
  if (value?.documentId !== documentId || value?.ownerPrincipalId !== principalId) throw problem('SESSION_CHANGED');
  if (!Number.isSafeInteger(value.version) || value.version < 1 || value.revision !== value.version || !/^[a-f0-9]{64}$/.test(value.digest)) throw problem('INVALID_RESPONSE');
  const write = decodeOfficeWrite({ title: value.title, body: value.body });
  if (write.body.editorKind !== 'document') throw problem('INVALID_RESPONSE');
  return { ...clone(value), ...write };
};

/** Account-bound draft state. Transport owns auth/CSRF; no principal is sent in a write. */
export class OfficeDocumentHost {
  #transport; #state = empty(); #listeners = new Set(); #generation = 0; #edits = 0; #binding = null; #pending = null; #disposed = false; #stop; #listing = 0;
  constructor(transport) {
    this.#transport = transport;
    this.#stop = transport.onSessionChange?.(() => this.reset('SESSION_CHANGED'));
  }
  state() { return clone(this.#state); }
  subscribe(listener) { this.#listeners.add(listener); listener(this.state()); return () => this.#listeners.delete(listener); }
  #publish() { if (!this.#disposed) for (const listener of this.#listeners) listener(this.state()); }
  reset(error = null) { this.#generation++; this.#edits++; this.#binding = null; this.#pending = null; this.#state = { ...empty(), error }; this.#publish(); }
  destroy() { this.#disposed = true; this.#generation++; this.#stop?.(); this.#listeners.clear(); this.#state = empty(); this.#pending = null; }
  async #session(generation) {
    const session = await this.#transport.session();
    if (this.#disposed || generation !== this.#generation) throw problem('STALE_OPERATION');
    if (!session?.principalId || !session?.epoch) throw problem('SESSION_CHANGED');
    const binding = keyOf(session);
    if (this.#binding && binding !== this.#binding) { this.reset('SESSION_CHANGED'); throw problem('STALE_OPERATION'); }
    this.#binding = binding;
    return session;
  }
  #failure(error, generation) {
    if (this.#disposed || generation !== this.#generation || error?.code === 'STALE_OPERATION') return;
    if (error?.status === 401 || error?.code === 'SESSION_CHANGED') { this.reset('SESSION_CHANGED'); return; }
    const code = error?.status === 409 ? 'CONFLICT' : error?.status === 400 ? 'INVALID_INPUT' : error?.code || 'CONNECTION_FAILED';
    this.#state = { ...this.#state, status: 'error', error: code, retryPending: Boolean(this.#pending) };
    this.#publish();
  }
  async list({ more = false } = {}) {
    const generation = this.#generation, listing = ++this.#listing;
    if (!this.#state.current && !this.#state.draft) { this.#state.status = 'loading'; this.#publish(); }
    try {
      const session = await this.#session(generation);
      const rows = await this.#transport.list({ limit: 50, ...(more && this.#state.after ? { after: this.#state.after } : {}) });
      await this.#session(generation);
      if (listing !== this.#listing) return;
      if (!Array.isArray(rows) || rows.some(row => row.ownerPrincipalId !== session.principalId)) throw problem('INVALID_RESPONSE');
      const documents = rows.filter(row => row.editorKind === 'document');
      this.#state = { ...this.#state, documents: more ? [...this.#state.documents, ...documents] : documents,
        after: rows.at(-1)?.documentId ?? null, hasMore: rows.length === 50,
        ...(!this.#state.draft ? { status: 'ready', error: null } : {}) };
      this.#publish();
    } catch (error) { this.#failure(error, generation); }
  }
  newDocument() {
    if (this.#disposed || this.#state.status === 'saving') return;
    this.#generation++; this.#edits++; this.#pending = null;
    this.#state = { ...this.#state, status: 'ready', current: null, draftId: `office:${crypto.randomUUID()}`,
      draft: { title: '새 문서', body: { schema: 'hoh/office-document@1', editorKind: 'document', schemaVersion: 1, snapshot: { type: 'doc', content: [{ type: 'paragraph' }] }, assets: [] } },
      dirty: true, error: null, retryPending: false };
    this.#publish();
  }
  async open(documentId) {
    if (this.#disposed || this.#state.status === 'saving') return;
    const generation = ++this.#generation;
    this.#state = { ...this.#state, status: 'loading', error: null }; this.#publish();
    try {
      const session = await this.#session(generation);
      const row = await this.#transport.open({ documentId });
      await this.#session(generation);
      const current = documentFrom(row, session.principalId, documentId);
      this.#pending = null; this.#edits++;
      this.#state = { ...this.#state, status: 'ready', current, draftId: documentId,
        draft: { title: current.title, body: current.body }, dirty: false, error: null, retryPending: false };
      this.#publish();
    } catch (error) { this.#failure(error, generation); }
  }
  edit(draft) {
    if (this.#disposed || !this.#state.draft || this.#state.status === 'loading') return;
    this.#edits++;
    // Keep incomplete titles during input; validate the complete boundary at save.
    this.#state = { ...this.#state, draft: clone(draft), dirty: true };
    this.#publish();
  }
  async observe() {
    const session = await this.#session(this.#generation);
    const current = this.#state.current;
    return { principalId: session.principalId, epoch: session.epoch, documentId: current?.documentId ?? null,
      version: current?.version ?? null, generation: this.#generation, dirty: this.#state.dirty };
  }
  async invokeOffice({ action, context, input } = {}) {
    if (!['list', 'new', 'open', 'save', 'discard'].includes(action)) throw problem('INVALID_INPUT');
    const actual = await this.observe();
    if (!context || context.principalId !== actual.principalId || context.epoch !== actual.epoch || context.generation !== actual.generation
      || context.documentId !== actual.documentId || context.version !== actual.version) throw problem('STALE_OPERATION');
    if (action === 'list') await this.list();
    if (action === 'new') this.newDocument();
    if (action === 'open') { if (typeof input?.documentId !== 'string') throw problem('INVALID_INPUT'); await this.open(input.documentId); }
    if (action === 'save') await this.save();
    if (action === 'discard') this.discard();
    const state = this.#state, current = state.current;
    return { status: state.status, error: state.error, documentId: current?.documentId ?? null, version: current?.version ?? null,
      revision: current?.revision ?? null, digest: current?.digest ?? null, dirty: state.dirty };
  }
  discard() {
    if (this.#state.current) return this.open(this.#state.current.documentId);
    this.#generation++; this.#pending = null; this.#state = { ...empty(), documents: this.#state.documents }; this.#publish();
  }
  async save() {
    if (this.#disposed || !this.#state.draft || this.#state.status === 'saving' || this.#state.status === 'loading') return;
    const generation = this.#generation, editNumber = this.#edits;
    try {
      if (!this.#pending) {
        let input;
        try { input = decodeOfficeWrite(this.#state.draft); } catch { throw problem('INVALID_INPUT'); }
        this.#pending = { documentId: this.#state.draftId, requestId: crypto.randomUUID(),
          expectedVersion: this.#state.current?.version ?? null, ...clone(input) };
      }
      // A retry reconciles the original body even if the user has since typed more.
      const pending = this.#pending;
      this.#state = { ...this.#state, status: 'saving', error: null, retryPending: true }; this.#publish();
      const session = await this.#session(generation);
      const written = await (pending.expectedVersion === null ? this.#transport.create(clone(pending)) : this.#transport.save(clone(pending)));
      await this.#session(generation);
      const saved = documentFrom(written, session.principalId, pending.documentId);
      if (saved.version !== (pending.expectedVersion ?? 0) + 1) throw problem('INVALID_RESPONSE');
      if (saved.title !== pending.title || canonical(saved.body) !== canonical(pending.body)) throw problem('INVALID_RESPONSE');
      const row = await this.#transport.open({ documentId: pending.documentId });
      await this.#session(generation);
      const current = documentFrom(row, session.principalId, pending.documentId);
      if (current.version !== saved.version || current.digest !== saved.digest || canonical(current.body) !== canonical(saved.body) || current.title !== saved.title) throw problem('CONFLICT');
      const unchanged = editNumber === this.#edits && canonical(this.#state.draft) === canonical({ title: pending.title, body: pending.body });
      this.#pending = null;
      const documents = [summary(current), ...this.#state.documents.filter(row => row.documentId !== current.documentId)];
      this.#state = { ...this.#state, status: 'ready', current, documents,
        draft: unchanged ? { title: current.title, body: current.body } : this.#state.draft,
        dirty: !unchanged, error: null, retryPending: false };
      this.#publish();
    } catch (error) {
      if (error?.status === 400 || error?.status === 403 || error?.status === 409 || ['CONFLICT','INVALID_INPUT'].includes(error?.code)) this.#pending = null;
      this.#failure(error, generation);
    }
  }
}
