/** Portable, bounded reader for MM's published-app format. Importing never executes an app. */
export const MM_PACKAGE_PROFILE = 'urn:hoh:profile:mm-published-app:1';
export const MM_KIT_SLOT = '<!-- ailab-app-kit -->';
export const APP_LIMITS = Object.freeze({ bundle: 4 * 1048576, template: 2 * 1048576, snapshot: 12000, resume: 2048 });
const encoder = new TextEncoder();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const verifiedBundles = new WeakSet();
export const isVerifiedAppBundle = bundle => verifiedBundles.has(bundle);
export class AppPackageError extends Error {
  constructor(code, message) { super(message); this.name = 'AppPackageError'; this.code = code; }
}
export const appFail = (code, message) => { throw new AppPackageError(code, message); };
function requireValue(ok, message, code = 'INVALID_PACKAGE') { if (!ok) appFail(code, message); }
export function appJson(value, limit = APP_LIMITS.bundle) {
  const ancestors = new Set(); let nodes = 0;
  const visit = (v, depth) => {
    requireValue(++nodes <= 100000 && depth <= 40, 'JSON exceeds structural limits.', 'INVALID_JSON');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    requireValue((Array.isArray(v) || plain(v)) && !ancestors.has(v), 'Only finite, acyclic, plain JSON is accepted.', 'INVALID_JSON');
    ancestors.add(v);
    const result = Array.isArray(v) ? Array.from(v, x => visit(x, depth + 1)) : Object.fromEntries(Object.entries(v).map(([key, x]) => {
      requireValue(!forbidden.has(key), 'Prototype keys are prohibited.', 'INVALID_JSON'); return [key, visit(x, depth + 1)];
    }));
    ancestors.delete(v); return result;
  };
  const result = visit(value, 0);
  requireValue(encoder.encode(JSON.stringify(result)).length <= limit, 'JSON exceeds its byte limit.', 'INVALID_JSON');
  return result;
}
export function freezeAppJson(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeAppJson); Object.freeze(value); }
  return value;
}
export function stableAppJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableAppJson).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableAppJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const text = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
const integer = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const unique = values => new Set(values).size === values.length;
function fields(value, required, optional = []) {
  requireValue(plain(value) && required.every(k => Object.hasOwn(value, k)), 'Required object fields are missing.');
  const allowed = new Set([...required, ...optional]);
  requireValue(Object.keys(value).every(k => allowed.has(k)), 'Unsupported fields must not be silently reinterpreted.');
}

/** This is MM's bounded shape dialect, including its defaults and enum precedence. */
export function assertMmShape(shape, depth = 0) {
  requireValue(plain(shape) && depth <= 6, 'Invalid or overly deep MM shape.');
  if (Object.hasOwn(shape, 'anyOf')) {
    fields(shape, ['anyOf']);
    requireValue(Array.isArray(shape.anyOf) && shape.anyOf.length >= 1 && shape.anyOf.length <= 8, 'Invalid anyOf.');
    shape.anyOf.forEach(s => assertMmShape(s, depth + 1)); return;
  }
  switch (shape.type) {
    case 'object':
      fields(shape, ['type', 'properties'], ['required']);
      requireValue(plain(shape.properties) && Object.keys(shape.properties).length <= 64, 'Invalid shape properties.');
      for (const [key, child] of Object.entries(shape.properties)) {
        requireValue(/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key) && !forbidden.has(key), 'Invalid shape key.'); assertMmShape(child, depth + 1);
      }
      if (shape.required !== undefined) requireValue(Array.isArray(shape.required) && shape.required.length <= 64 && unique(shape.required) && shape.required.every(k => Object.hasOwn(shape.properties, k)), 'Invalid required properties.');
      break;
    case 'string':
      fields(shape, ['type'], ['maxLength', 'enum', 'pattern']);
      if (shape.maxLength !== undefined) requireValue(integer(shape.maxLength, 1, 20000), 'Invalid string length.');
      if (shape.enum !== undefined) requireValue(Array.isArray(shape.enum) && shape.enum.length >= 1 && shape.enum.length <= 64 && shape.enum.every(v => text(v, 200)), 'Invalid string enum.');
      if (shape.pattern !== undefined) {
        requireValue(text(shape.pattern, 200), 'Invalid pattern.');
        try { new RegExp(shape.pattern); } catch { appFail('INVALID_PACKAGE', 'Invalid pattern syntax.'); }
      }
      break;
    case 'integer': case 'number':
      fields(shape, ['type'], ['enum', 'minimum', 'maximum']);
      for (const key of ['minimum', 'maximum']) if (shape[key] !== undefined) requireValue(typeof shape[key] === 'number' && Number.isFinite(shape[key]), 'Invalid numeric bound.');
      requireValue(shape.minimum === undefined || shape.maximum === undefined || shape.minimum <= shape.maximum, 'Reversed numeric bounds.');
      if (shape.enum !== undefined) requireValue(Array.isArray(shape.enum) && shape.enum.length >= 1 && shape.enum.length <= 64 && shape.enum.every(v => typeof v === 'number' && Number.isFinite(v) && (shape.type !== 'integer' || Number.isInteger(v)) && (shape.minimum === undefined || v >= shape.minimum) && (shape.maximum === undefined || v <= shape.maximum)), 'Invalid numeric enum.');
      break;
    case 'array':
      fields(shape, ['type', 'items'], ['maxItems']);
      if (shape.maxItems !== undefined) requireValue(integer(shape.maxItems, 1, 1000), 'Invalid array bound.');
      assertMmShape(shape.items, depth + 1); break;
    case 'boolean': case 'null': fields(shape, ['type']); break;
    default: appFail('INVALID_PACKAGE', 'Unsupported MM shape type.');
  }
}

/** Match MM's Effect decoder: undeclared object fields are projected out, not passed to handlers. */
export function decodeMmShape(shape, value) {
  const mismatch = () => appFail('SCHEMA_MISMATCH', 'Value does not match the declared MM shape.');
  if (shape.anyOf) {
    for (const candidate of shape.anyOf) { try { return decodeMmShape(candidate, value); } catch (e) { if (e.code !== 'SCHEMA_MISMATCH') throw e; } }
    return mismatch();
  }
  switch (shape.type) {
    case 'object': {
      if (!plain(value) || (shape.required || []).some(k => !Object.hasOwn(value, k))) return mismatch();
      return Object.fromEntries(Object.entries(shape.properties).filter(([k]) => Object.hasOwn(value, k)).map(([k, s]) => [k, decodeMmShape(s, value[k])]));
    }
    case 'string':
      if (typeof value !== 'string' || (shape.enum ? !shape.enum.includes(value) : value.length > (shape.maxLength ?? 4000) || shape.pattern && !new RegExp(shape.pattern).test(value))) return mismatch();
      return value;
    case 'integer': case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || shape.type === 'integer' && !Number.isInteger(value) || (shape.enum ? !shape.enum.includes(value) : shape.minimum !== undefined && value < shape.minimum || shape.maximum !== undefined && value > shape.maximum)) return mismatch();
      return value;
    case 'array':
      if (!Array.isArray(value) || value.length > (shape.maxItems ?? 200)) return mismatch();
      return value.map(v => decodeMmShape(shape.items, v));
    case 'boolean': if (typeof value !== 'boolean') return mismatch(); return value;
    case 'null': if (value !== null) return mismatch(); return null;
    default: return mismatch();
  }
}

export function parseMmPackage(raw, template) {
  const pkg = appJson(raw);
  fields(pkg, ['schema', 'name', 'title', 'summary', 'tools', 'params', 'version'], ['hotReload', 'admin', 'icon', 'color', 'content']);
  requireValue(pkg.schema === 'mm.content-package/v1', 'Unsupported package format.', 'UNSUPPORTED_PROFILE');
  requireValue(typeof pkg.name === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(pkg.name), 'Invalid package name.');
  requireValue(text(pkg.title, 40, 1) && text(pkg.summary, 400) && integer(pkg.version, 1), 'Invalid package metadata.');
  requireValue(Array.isArray(pkg.tools) && pkg.tools.length <= 32 && unique(pkg.tools) && pkg.tools.every(v => text(v, 128, 1) && !forbidden.has(v)), 'Invalid tool list.');
  requireValue(Array.isArray(pkg.params) && pkg.params.length <= 8 && unique(pkg.params) && pkg.params.every(v => typeof v === 'string' && /^[a-z][a-zA-Z0-9]{0,30}$/.test(v) && !forbidden.has(v)), 'Invalid parameter list.');
  for (const key of ['admin', 'hotReload']) if (pkg[key] !== undefined) requireValue(typeof pkg[key] === 'boolean', `Invalid ${key}.`);
  for (const key of ['icon', 'color']) if (pkg[key] !== undefined) requireValue(text(pkg[key], 20), `Invalid ${key}.`);
  requireValue(typeof template === 'string' && encoder.encode(template).length <= APP_LIMITS.template && template.split(MM_KIT_SLOT).length === 2, 'Template needs exactly one MM kit slot and must fit the size limit.');
  if (pkg.content !== undefined) {
    const c = pkg.content;
    fields(c, ['id', 'revision', 'description', 'state', 'actions'], ['controls', 'links']);
    requireValue(typeof c.id === 'string' && /^urn:ailab:[a-z0-9][a-z0-9:.-]{2,120}$/.test(c.id) && integer(c.revision, 1) && text(c.description, 8000), 'Invalid content description.');
    requireValue(template.includes(c.id), 'Template must register the declared content identity.');
    if (c.controls !== undefined) requireValue(c.controls === 'playback', 'Unsupported content controls.');
    if (c.links !== undefined) requireValue(Array.isArray(c.links) && c.links.length <= 8 && c.links.every(v => text(v, 300)), 'Invalid content links.');
    assertMmShape(c.state); requireValue(c.state.type === 'object', 'Content state must be an object.');
    requireValue(Array.isArray(c.actions) && c.actions.length <= 32 && unique(c.actions.map(a => a?.id)), 'Invalid action list.');
    for (const a of c.actions) {
      fields(a, ['id', 'title', 'description', 'input', 'gestureRequired'], ['requiresConfirmation']);
      requireValue(typeof a.id === 'string' && /^[a-z][a-zA-Z0-9]{0,40}$/.test(a.id) && !forbidden.has(a.id) && text(a.title, 80) && text(a.description, 1200) && typeof a.gestureRequired === 'boolean' && (a.requiresConfirmation === undefined || typeof a.requiresConfirmation === 'boolean'), 'Invalid action declaration.');
      assertMmShape(a.input); requireValue(a.input.type === 'object', 'Action input must be an object.');
    }
  }
  return freezeAppJson(pkg);
}

export async function appSha256(bytes) {
  const data = typeof bytes === 'string' ? encoder.encode(bytes) : bytes;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** expectedDigest is a host-selected pin, not a value an untrusted app may choose. */
export async function readMmBundle(bytes, { expectedDigest, allowFixture = false } = {}) {
  requireValue(typeof expectedDigest === 'string' && /^[a-f0-9]{64}$/.test(expectedDigest), 'A host-selected bundle digest is required.', 'UNPINNED_BUNDLE');
  const data = typeof bytes === 'string' ? encoder.encode(bytes) : bytes;
  requireValue(data instanceof Uint8Array && data.byteLength <= APP_LIMITS.bundle, 'Bundle exceeds its byte limit.');
  // Buffer.slice() is a view in Node. Always own a copy before the asynchronous digest.
  const immutable = new Uint8Array(data);
  const digest = await appSha256(immutable);
  requireValue(digest === expectedDigest, 'Bundle bytes differ from the host pin.', 'BUNDLE_CHANGED');
  let bundle;
  try { bundle = appJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(immutable))); }
  catch (error) { if (error instanceof AppPackageError) throw error; appFail('INVALID_PACKAGE', 'Bundle must be valid UTF-8 JSON.'); }
  fields(bundle, ['schema', 'source', 'package', 'template', 'templateSha256']);
  requireValue(bundle.schema === 'mm.content-bundle/v1', 'Unsupported bundle format.', 'UNSUPPORTED_PROFILE');
  fields(bundle.source, ['repository', 'revision', 'dir'], ['fixture']);
  requireValue(text(bundle.source.repository, 200, 1) && /^[a-f0-9]{40}$/.test(bundle.source.revision) && text(bundle.source.dir, 200, 1), 'Invalid source provenance.');
  if (bundle.source.fixture !== undefined) requireValue(typeof bundle.source.fixture === 'boolean', 'Invalid fixture flag.');
  requireValue(!bundle.source.fixture || allowFixture, 'Fixture bundles are not production packages.', 'FIXTURE_NOT_ALLOWED');
  const pkg = parseMmPackage(bundle.package, bundle.template);
  requireValue(typeof bundle.templateSha256 === 'string' && /^[a-f0-9]{64}$/.test(bundle.templateSha256) && await appSha256(bundle.template) === bundle.templateSha256, 'Template bytes differ from their declared hash.', 'TEMPLATE_CHANGED');
  const result = freezeAppJson({ profile: MM_PACKAGE_PROFILE, digest, source: bundle.source, package: pkg, template: bundle.template, templateSha256: bundle.templateSha256 });
  verifiedBundles.add(result);
  return result;
}

export function mmViewSnapshot(pkg, raw) {
  const snapshot = appJson(raw, APP_LIMITS.snapshot), c = pkg.content;
  requireValue(c && plain(snapshot) && snapshot.contentId === c.id && snapshot.descriptorRevision === c.revision && integer(snapshot.stateRevision, 0), 'Snapshot identity or revision does not match the mounted content.', 'INVALID_SNAPSHOT');
  return freezeAppJson({ contentId: c.id, descriptorRevision: c.revision, stateRevision: snapshot.stateRevision, state: decodeMmShape(c.state, snapshot.state) });
}

export function mmResumeInput(pkg, raw) {
  const value = appJson(raw, APP_LIMITS.resume);
  requireValue(plain(value) && Object.keys(value).every(k => pkg.params.includes(k)) && Object.values(value).every(v => text(v, 512)), 'Resume input must use declared string parameters.', 'INVALID_RESUME_INPUT');
  return value;
}
