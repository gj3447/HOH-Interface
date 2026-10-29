import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appJson, appSha256, assertMmShape, decodeMmShape, isVerifiedAppBundle, mmResumeInput, mmViewSnapshot, parseMmPackage, readMmBundle } from '../protocol/app-package.js';
import { createAppDocument } from '../ui/app-content-host.js';
const pkg = JSON.parse(await readFile(new URL('./fixtures/packaged-app/content.json', import.meta.url), 'utf8'));
const template = await readFile(new URL('./fixtures/packaged-app/app.html', import.meta.url), 'utf8');
const clone = value => structuredClone(value);
async function envelope(change = x => x) {
  const value = { schema: 'mm.content-bundle/v1', source: { repository: 'fixture', revision: '1'.repeat(40), dir: 'test/fixtures/packaged-app', fixture: true }, package: clone(pkg), template, templateSha256: await appSha256(template) };
  const bytes = JSON.stringify(change(value)); return { bytes, expectedDigest: await appSha256(bytes) };
}
async function load(change) { const { bytes, expectedDigest } = await envelope(change); return readMmBundle(bytes, { expectedDigest, allowFixture: true }); }

test('unchanged package preserves source identity, action names and original template hash', async () => {
  const b = await load(); assert.equal(b.package.content.id, pkg.content.id); assert.equal(b.template, template);
  assert.deepEqual(b.package.content.actions, pkg.content.actions); assert.equal(b.templateSha256, await appSha256(template));
  assert.ok(Object.isFrozen(b.package.content.actions[0])); assert.ok(isVerifiedAppBundle(b)); assert.equal(isVerifiedAppBundle({ ...b }), false);
});
test('host pin and template hash independently detect substitution', async () => {
  const e = await envelope();
  await assert.rejects(readMmBundle(e.bytes + ' ', { expectedDigest: e.expectedDigest, allowFixture: true }), { code: 'BUNDLE_CHANGED' });
  await assert.rejects(load(x => ({ ...x, template: x.template.replace('count', 'total') })), { code: 'TEMPLATE_CHANGED' });
  await assert.rejects(readMmBundle(e.bytes), { code: 'UNPINNED_BUNDLE' });
});
test('Node Buffer mutation during hashing cannot change the verified source bytes', async () => {
  const e = await envelope(), input = Buffer.from(e.bytes);
  const loading = readMmBundle(input, { expectedDigest: e.expectedDigest, allowFixture: true });
  input.fill(0);
  const result = await loading;
  assert.equal(result.digest, e.expectedDigest);
  assert.equal(result.template, template);
});
test('fixture and unsupported package versions are not silently promoted', async () => {
  const e = await envelope(); await assert.rejects(readMmBundle(e.bytes, { expectedDigest: e.expectedDigest }), { code: 'FIXTURE_NOT_ALLOWED' });
  await assert.rejects(load(x => ({ ...x, package: { ...x.package, schema: 'mm.content-package/v2' } })), { code: 'UNSUPPORTED_PROFILE' });
});
test('source template needs one kit slot and the same semantic identity', () => {
  assert.throws(() => parseMmPackage(pkg, template.replace(pkg.content.id, 'urn:other:id')), { code: 'INVALID_PACKAGE' });
  assert.throws(() => parseMmPackage(pkg, template + '<!-- ailab-app-kit -->'), { code: 'INVALID_PACKAGE' });
});
test('action/parameter collisions and hidden authority fields are rejected', () => {
  const altered = clone(pkg); altered.content.actions.push(altered.content.actions[0]);
  assert.throws(() => parseMmPackage(altered, template), { code: 'INVALID_PACKAGE' });
  assert.throws(() => parseMmPackage({ ...pkg, params: ['count', 'count'] }, template), { code: 'INVALID_PACKAGE' });
  assert.throws(() => parseMmPackage({ ...pkg, approved: true }, template), { code: 'INVALID_PACKAGE' });
  assert.throws(() => appJson(JSON.parse('{"__proto__":{"admin":true}}')), { code: 'INVALID_JSON' });
  assert.throws(() => appJson(Array(2)), { code: 'INVALID_JSON' });
});
test('MM view schema retains its actual default limits and enum precedence', () => {
  assert.throws(() => decodeMmShape({ type: 'string' }, 'x'.repeat(4001)), { code: 'SCHEMA_MISMATCH' });
  assert.throws(() => decodeMmShape({ type: 'array', items: { type: 'boolean' } }, Array(201).fill(true)), { code: 'SCHEMA_MISMATCH' });
  assert.equal(decodeMmShape({ type: 'string', enum: ['allowed'], pattern: '^other$', maxLength: 1 }, 'allowed'), 'allowed');
  const shape = { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] };
  assert.deepEqual(decodeMmShape(shape, { count: 3, actor: 'admin' }), { count: 3 });
});
test('invalid schema requirements, references and nonfinite numbers fail', () => {
  assert.throws(() => assertMmShape({ type: 'object', properties: {}, required: ['missing'] }), { code: 'INVALID_PACKAGE' });
  assert.throws(() => assertMmShape({ $ref: 'https://example.com/schema' }), { code: 'INVALID_PACKAGE' });
  assert.throws(() => assertMmShape({ type: 'number', minimum: 2, maximum: 1 }), { code: 'INVALID_PACKAGE' });
  assert.throws(() => decodeMmShape({ type: 'number' }, NaN), { code: 'SCHEMA_MISMATCH' });
});
test('snapshots cannot change content or descriptor identity; undeclared fields are not exposed', () => {
  const state = { contentId: pkg.content.id, descriptorRevision: 1, stateRevision: 1, state: { count: 2, unsaved: false, secret: 'hidden' } };
  assert.deepEqual(mmViewSnapshot(pkg, state).state, { count: 2, unsaved: false });
  assert.throws(() => mmViewSnapshot(pkg, { ...state, contentId: 'urn:other:content' }), { code: 'INVALID_SNAPSHOT' });
  assert.throws(() => mmViewSnapshot(pkg, { ...state, descriptorRevision: 2 }), { code: 'INVALID_SNAPSHOT' });
  assert.throws(() => mmViewSnapshot(pkg, { ...state, state: { count: 101, unsaved: false } }), { code: 'SCHEMA_MISMATCH' });
});
test('resume values are declared view parameters, not arbitrary persisted state', () => {
  assert.deepEqual(mmResumeInput(pkg, { count: '3' }), { count: '3' });
  assert.throws(() => mmResumeInput(pkg, { principalId: 'other-person' }), { code: 'INVALID_RESUME_INPUT' });
  assert.throws(() => mmResumeInput(pkg, { count: { arbitrary: 'state' } }), { code: 'INVALID_RESUME_INPUT' });
});
test('rendered document keeps standards mode and constrains the frame before any app script', async () => {
  const b = await load(), html = createAppDocument(b, { channel: 'test-mount' });
  assert.ok(html.startsWith('<!doctype html>')); assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'));
  assert.ok(html.includes("connect-src 'none'")); assert.equal(b.template, template);
  assert.throws(() => createAppDocument({ ...b }, { channel: 'test' }), { code: 'UNVERIFIED_BUNDLE' });
});
