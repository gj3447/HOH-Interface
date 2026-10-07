import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const expand = value => value.replace(/^h:/, 'urn:hoh:gui:').replace(/^prov:/, 'http://www.w3.org/ns/prov#');
const refs = value => Array.isArray(value) ? value : [value];

test('realtime graph keeps the user request, host boundaries, contracts, lifecycle and query answers explicit', async () => {
  const root = new URL('../', import.meta.url);
  const [base, realtime] = await Promise.all([
    readFile(new URL('graph/hoh-ui.jsonld', root), 'utf8').then(JSON.parse),
    readFile(new URL('graph/realtime.jsonld', root), 'utf8').then(JSON.parse)
  ]);
  const nodes = [...base['@graph'], ...realtime['@graph']], indexed = new Map(nodes.map(node => [node['@id'], node]));
  assert.equal(indexed.size, nodes.length);

  const source = indexed.get('urn:hoh:gui:source/user-hoh-realtime-2fc7f11a964c51ab8de7bf41ccdf23b42b099154c6d72d9b2233509278f4ad6a');
  const bytes = await readFile(new URL(source['h:path'], root));
  assert.equal(source['h:authority'], 'USER_PRIMARY');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source['h:sha256']);
  assert.match(bytes.toString('utf8'), /실시간 통화 실시간 영통 방송/);

  const extension = indexed.get('urn:hoh:gui:realtime-extension');
  assert.equal(extension['h:authority'], 'SECONDARY_AI');
  assert.equal(extension['h:extends']['@id'], 'urn:hoh:gui:hoh-ui');
  assert.equal(extension['prov:wasDerivedFrom']['@id'], source['@id']);
  for (const [predicate, type, count] of [
    ['h:hasCapability', 'h:RealtimeCapability', 3],
    ['h:requiresHostLayer', 'h:HostLayer', 5],
    ['h:hasArtifact', 'prov:Entity', 7]
  ]) {
    const values = refs(extension[predicate]);
    assert.equal(values.length, count);
    assert.equal(new Set(values.map(value => value['@id'])).size, count);
    for (const value of values) assert.equal(indexed.get(value['@id'])?.['@type'], type);
  }
  for (const ref of extension['h:hasArtifact']) { const artifact = indexed.get(ref['@id']); assert.equal(createHash('sha256').update(await readFile(new URL(artifact['h:path'], root))).digest('hex'), artifact['h:sha256']); }
  assert.equal(indexed.get(extension['h:requiresContract']['@id'])?.['@type'], 'h:SessionContract');
  assert.equal(indexed.get(extension['h:hasGuiContract']['@id'])?.['@type'], 'h:GuiContract');
  const lifecycle = indexed.get(extension['h:hasLifecycle']['@id']);
  assert.equal(lifecycle['h:hasState'].length, 7);
  for (const state of lifecycle['h:hasState']) assert.equal(indexed.get(state['@id'])?.['@type'], 'h:SessionState');

  const predicates = ['extends', 'hasCapability', 'requiresContract', 'hasLifecycle', 'hasState', 'requiresHostLayer', 'hasGuiContract', 'hasArtifact', 'retainsShell', 'realizesContract', 'technicalReference'];
  const isInstance = (node, expectedType) => {
    if (!node) return false;
    if (node['@id'] === expand(expectedType) || node['@type'] === expectedType) return true;
    const parent = node['rdfs:subClassOf'];
    return parent ? isInstance(indexed.get(expand(parent['@id'])), expectedType) : false;
  };
  for (const predicate of predicates) {
    const node = indexed.get(`urn:hoh:gui:${predicate}`);
    assert.equal(node?.['@type'], 'rdf:Property');
    assert.ok(node?.['rdfs:domain']?.['@id']);
    assert.ok(node?.['rdfs:range']?.['@id']);
    assert.ok((node?.['rdfs:comment'] ?? '').length > 20);
    const key = `h:${predicate}`, domain = node['rdfs:domain']['@id'], range = node['rdfs:range']['@id'];
    for (const subject of nodes.filter(candidate => candidate[key] !== undefined)) {
      assert.ok(isInstance(subject, domain), `${subject['@id']} must be in ${domain}`);
      for (const target of refs(subject[key])) {
        assert.ok(isInstance(indexed.get(target['@id']), range), `${target['@id']} must be in ${range}`);
      }
    }
  }

  const questions = JSON.parse(await readFile(new URL('graph/realtime-questions.json', root), 'utf8')).questions;
  for (const question of questions) {
    const checks = question.path ?? [question];
    for (const check of checks) {
      const subject = indexed.get(check.subject);
      const value = Object.entries(subject).find(([predicate]) => expand(predicate) === check.predicate)?.[1];
      assert.deepEqual(refs(value).map(ref => ref['@id']).sort(), check.expectedTargets.slice().sort());
    }
  }
});
