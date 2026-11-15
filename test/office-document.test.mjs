import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeOfficeBody, decodeOfficeWrite, validateDocumentSnapshot } from '../office/contracts.js';
import { OfficeDocumentHost } from '../office/document-host.js';
const snapshot = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '한글' }] }] };
const body = { schema: 'hoh/office-document@1', editorKind: 'document', schemaVersion: 1, snapshot, assets: [] };
test('strict schema accepts supported document structure and rejects unsupported nodes, marks, attrs and nesting', () => {
  assert.deepEqual(validateDocumentSnapshot(snapshot), snapshot);
  for (const invalid of [ { text: 'opaque' }, { type: 'doc', content: [] },
    { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/a.png' } }] },
    { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'bad' } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{type:'link',attrs:{href:'https://example.com'}}] }] }] },
    { type: 'doc', content: [{ type: 'bulletList', content: [{type:'paragraph'}] }] },
    { type: 'doc', content: [{ type: 'codeBlock', content: [{type:'text',text:'x',marks:[{type:'bold'}]}] }] }
  ]) assert.throws(() => validateDocumentSnapshot(invalid));
});
test('decoder rejects server fields, invalid title and accessor arrays without evaluating getters', () => {
  assert.throws(() => decodeOfficeWrite({ title: 'x', body, revision: 1 }));
  assert.throws(() => decodeOfficeWrite({ title: '\n', body }));
  assert.throws(() => decodeOfficeBody({ ...body, snapshot: { value: NaN } }));
  let called = false; const content = [];
  Object.defineProperty(content, '0', { enumerable: true, get() { called = true; return {type:'paragraph'}; } });
  assert.throws(() => validateDocumentSnapshot({type:'doc',content})); assert.equal(called, false);
});
test('late document response cannot replace a newer open', async () => {
  let resolveA; const session = async () => ({ principalId: 'p', epoch: 'one' });
  const doc = id => ({ documentId:id, ownerPrincipalId:'p', title:id, version:1, revision:1, digest:'a'.repeat(64), body });
  const host = new OfficeDocumentHost({ session, list: async () => [], open: ({ documentId }) => documentId === 'a' ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(doc('b')) });
  const pending = host.open('a'); await Promise.resolve(); await Promise.resolve(); await host.open('b'); resolveA(doc('a')); await pending;
  assert.equal(host.state().current.documentId, 'b'); host.destroy();
});
