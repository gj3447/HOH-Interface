/** MetaHumotonic Program Feed transport adapter. Keep endpoint, session and CSRF details here. */
export function createProgramFeedAdapter({ base = '/api/program-feed/v1' } = {}) {
  let csrf = '';
  const api = async (path, { method = 'GET', body, mutation = false } = {}) => {
    const headers = { Accept: 'application/json' }; if (body) headers['Content-Type'] = 'application/json'; if (mutation) headers['X-CSRF-Token'] = csrf;
    const response = await fetch(base + path, { method, credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined }); let data = {}; try { data = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(data.reason || data.message || 'Request failed.'); error.status = response.status; throw error; } return data;
  };
  const requestId = () => crypto.randomUUID();
  return {
    async bootstrap() { const session = await api('/session', { method: 'POST', body: {} }); csrf = session.csrfToken || ''; return { profile: session.profile || {}, readiness: session.readiness }; },
    async list() { const page = await api('/feed'); return { ...page, items: (page.items || []).filter(item => item.content?.id !== 'account-home') }; },
    open: ({ contentId, expectedViewRevision }) => api('/view', { method: 'POST', mutation: true, body: { contentId, ...(expectedViewRevision === undefined ? {} : { expectedViewRevision }) } }),
    favorite: ({ contentId, favorite, viewRevision }) => api('/favorites', { method: 'POST', mutation: true, body: { contentId, favorite, viewRevision, requestId: requestId() } }),
    react: ({ contentId, reaction, viewRevision }) => api('/reactions', { method: 'POST', mutation: true, body: { contentId, reaction, viewRevision, requestId: requestId() } }),
    comment: ({ contentId, body, viewRevision }) => api('/comments', { method: 'POST', mutation: true, body: { contentId, body, viewRevision, requestId: requestId() } }),
    saveState: ({ contentId, state, viewRevision }) => api('/state', { method: 'PUT', mutation: true, body: { contentId, state, viewRevision, requestId: requestId() } }),
    chat: ({ contentId, message, viewRevision }) => api('/chat', { method: 'POST', mutation: true, body: { contentId, message, viewRevision, requestId: requestId() } }),
    async profile() { const result = await api('/profile'); return { profile: result.profile ?? result }; },
    status: () => api('/status')
  };
}
