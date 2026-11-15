import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficeDocumentHost } from '../office/document-host.js';
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const fixture = () => {
  let session = { principalId: 'owner', epoch: 'one' }, change, stored, lose = false, gate;
  const calls = [], receipts = new Map();
  const write = async request => {
    calls.push(structuredClone(request));
    if (!receipts.has(request.requestId)) {
      stored = { documentId: request.documentId, ownerPrincipalId: session.principalId, title: request.title,
        body: structuredClone(request.body), version: (request.expectedVersion ?? 0) + 1, revision: (request.expectedVersion ?? 0) + 1, digest: 'a'.repeat(64) };
      receipts.set(request.requestId, structuredClone(stored));
    }
    if (gate) await gate.promise;
    if (lose) { lose = false; throw new TypeError('lost response after commit'); }
    return structuredClone(receipts.get(request.requestId));
  };
  const transport = { session: async () => session, onSessionChange: listener => { change = listener; return () => { change = null; }; },
    list: async () => [], open: async () => structuredClone(stored), create: write, save: write };
  return { host: new OfficeDocumentHost(transport), calls,
    lose() { lose = true; }, delay() { gate = defer(); return gate; },
    switch() { session = { principalId: 'other', epoch: 'two' }; change?.(); },
    staleRead() { transport.open = async () => ({ ...stored, version: stored.version + 1, revision: stored.revision + 1, digest: 'b'.repeat(64) }); } };
};
test('new document creates, checks server readback, then saves current CAS revision', async () => {
  const {host, calls} = fixture(); host.newDocument(); await host.save();
  assert.equal(host.state().current.version, 1); assert.equal(host.state().dirty, false);
  host.edit({ ...host.state().draft, title: 'Changed' }); await host.save();
  assert.equal(calls[0].expectedVersion, null); assert.equal(calls[1].expectedVersion, 1);
  assert.equal(host.state().current.version, 2); host.destroy();
});
test('lost commit response reuses exact write identity and preserves newer typing', async () => {
  const f = fixture(); f.host.newDocument(); f.lose(); await f.host.save();
  assert.equal(f.host.state().dirty, true); assert.equal(f.host.state().retryPending, true);
  f.host.edit({ ...f.host.state().draft, title: 'Typed while uncertain' }); await f.host.save();
  assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.host.state().current.version, 1);
  assert.equal(f.host.state().draft.title, 'Typed while uncertain'); assert.equal(f.host.state().dirty, true);
  await f.host.save(); assert.equal(f.calls[2].expectedVersion, 1); assert.equal(f.host.state().dirty, false); f.host.destroy();
});
test('duplicate save clicks cannot send twice; typing during save stays dirty', async () => {
  const f = fixture(), gate = f.delay(); f.host.newDocument(); const first = f.host.save();
  await f.host.save(); f.host.edit({ ...f.host.state().draft, title: 'Newer edit' });
  gate.resolve(); await first;
  assert.equal(f.calls.length, 1); assert.equal(f.host.state().draft.title, 'Newer edit'); assert.equal(f.host.state().dirty, true); f.host.destroy();
});
test('session reset clears visible data and ignores the in-flight old account response', async () => {
  const f = fixture(), gate = f.delay(); f.host.newDocument(); const save = f.host.save();
  await Promise.resolve(); f.switch(); gate.resolve(); await save;
  assert.equal(f.host.state().draft, null); assert.equal(f.host.state().current, null); assert.deepEqual(f.host.state().documents, []); f.host.destroy();
});
test('newer readback is a conflict and an invalid title stays editable without a write', async () => {
  const f = fixture(); f.host.newDocument(); f.host.edit({ ...f.host.state().draft, title: '' }); await f.host.save();
  assert.equal(f.calls.length, 0); assert.equal(f.host.state().draft.title, ''); assert.equal(f.host.state().error, 'INVALID_INPUT');
  f.host.edit({ ...f.host.state().draft, title: 'Retained draft' }); f.staleRead(); await f.host.save();
  assert.equal(f.host.state().error, 'CONFLICT'); assert.equal(f.host.state().draft.title, 'Retained draft'); assert.equal(f.host.state().dirty, true); f.host.destroy();
});
test('UI and trusted caller share operation dispatch and exact server readback', async () => {
  const {host,calls} = fixture();
  const perform = async (action,input={}) => host.invokeOffice({action,context:await host.observe(),input});
  const created = await perform('new'); assert.match(created.documentId,/^office:/);
  const saved = await perform('save'); assert.equal(saved.version,1); assert.equal(saved.dirty,false);
  assert.equal(saved.digest,host.state().current.digest); assert.equal(calls.length,1); host.destroy();
});
test('trusted operations reject stale selection, epoch, revision and newer typing', async () => {
  const {host,calls} = fixture(); host.newDocument(); const original = await host.observe();
  for (const changed of [{epoch:'other'},{version:3},{documentId:'office:other'},{principalId:'forged'}])
    await assert.rejects(host.invokeOffice({action:'save',context:{...original,...changed}}),{code:'STALE_OPERATION'});
  host.edit({...host.state().draft,title:'Newer'});
  await assert.rejects(host.invokeOffice({action:'save',context:original}),{code:'STALE_OPERATION'});
  const current = await host.observe();
  await assert.rejects(host.invokeOffice({action:'discard',context:current}),{code:'DISCARD_CONFIRMATION_REQUIRED'});
  await assert.rejects(host.invokeOffice({action:'save',context:current,input:{ownerPrincipalId:'forged'}}),{code:'INVALID_INPUT'});
  assert.equal(calls.length,0); assert.equal(host.state().draft.title,'Newer'); host.destroy();
});
