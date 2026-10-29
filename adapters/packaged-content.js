import { mountAppContent } from '../ui/app-content-host.js';
import { appJson, AppPackageError, stableAppJson } from '../protocol/app-package.js';

/** A renderer extension; the owner still supplies catalog membership, authorization and storage. */
export function createPackagedContentRenderer({ load, hostFor, onMounted = () => {} }) {
  if (typeof load !== 'function' || typeof hostFor !== 'function') throw new TypeError('Package loader and host factory are required.');
  const active = new Map();
  return Object.freeze({
    render({ item, signal, isCurrent }) {
      const container = document.createElement('section'); container.className = 'hoh-packaged-content';
      const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '앱을 여는 중…'; container.append(status);
      let mounted = null;
      const contentId = item.content.id;
      const entry = { controller: null, ready: null };
      active.set(contentId, entry);
      const close = () => { mounted?.close(); if (active.get(contentId) === entry) active.delete(contentId); };
      signal.addEventListener('abort', close, { once: true });
      entry.ready = (async () => {
        const bundle = await load({ item, signal });
        if (signal.aborted || !isCurrent()) return null;
        if (bundle.package.content?.id !== contentId) throw new AppPackageError('CONTENT_CHANGED', 'The catalog item and package must identify the same content.');
        const { host, params = {}, documentUrl } = await hostFor({ item, bundle, signal });
        if (signal.aborted || !isCurrent()) return null;
        mounted = await mountAppContent({ bundle, host, params, documentUrl, signal, stage: container });
        if (signal.aborted || !isCurrent()) { mounted.close(); return null; }
        entry.controller = mounted; container.replaceChildren(mounted.node);
        if (!(await mounted.ready)) throw new AppPackageError('APP_NOT_READY', 'The app did not become ready.');
        if (signal.aborted || !isCurrent()) return null;
        onMounted(mounted, { item }); return mounted;
      })().catch(error => {
        mounted?.close();
        if (!signal.aborted && isCurrent()) { status.textContent = '이 앱을 열지 못했어요. 다시 열어 주세요.'; container.replaceChildren(status); }
        entry.error = error; return null;
      });
      return container;
    },
    async current(contentId) {
      const entry = active.get(contentId); if (!entry) throw new AppPackageError('NOT_READY', 'This app is not mounted.');
      const controller = await entry.ready;
      if (!controller || active.get(contentId) !== entry) throw entry.error || new AppPackageError('CLOSED', 'This app is no longer current.');
      return controller;
    },
    close() { for (const entry of active.values()) entry.controller?.close(); active.clear(); },
  });
}

/** Host/principal/parameters form the key. Content IDs alone must never merge users' view state. */
export function appResumeKey({ hostId, principalId, contentId, parameters = {} }) {
  if (![hostId, principalId, contentId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 300)) throw new AppPackageError('INVALID_RESUME_SCOPE', 'Resume scope is incomplete.');
  return stableAppJson(appJson({ hostId, principalId, contentId, parameters }));
}
