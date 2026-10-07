import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('GUI graph preserves the Korean source, defined edge endpoints, host scope and query answers', async () => {
  const root = new URL('../', import.meta.url);
  const graph = JSON.parse(await readFile(new URL('graph/hoh-ui.jsonld', root), 'utf8'));
  const nodes = graph['@graph'], indexed = new Map(nodes.map(node => [node['@id'], node]));
  assert.equal(indexed.size, nodes.length);
  const sources = nodes.filter(node => node['h:authority'] === 'USER_PRIMARY');
  assert.equal(sources.length, 2);
  for (const source of sources) {
    const bytes = await readFile(new URL(source['h:path'], root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source['h:sha256']);
    assert.ok(bytes.toString('utf8').includes(source['h:path'].includes('interface') ? 'HOH Interface 인거야' : 'HOH UI 라고해줘'));
  }
  const ui = indexed.get('urn:hoh:gui:hoh-ui');
  assert.equal(ui['h:authority'], 'SECONDARY_AI');
  assert.equal(ui['skos:prefLabel'], 'HOH Interface');
  assert.deepEqual(ui['skos:altLabel'], ['HOH UI', 'HOH GUI']);
  assert.deepEqual(ui['prov:wasDerivedFrom'].map(ref => ref['@id']).sort(), sources.map(source => source['@id']).sort());
  const rules = [['h:hasComponent', 'h:Component', 4], ['h:intendedHost', 'h:ApplicationHost', 3], ['h:hasInvariant', 'h:Invariant', 5]];
  for (const [predicate, type, count] of rules) {
    assert.equal(ui[predicate].length, count);
    assert.equal(new Set(ui[predicate].map(ref => ref['@id'])).size, count);
    for (const ref of ui[predicate]) assert.equal(indexed.get(ref['@id'])?.['@type'], type);
  }
  assert.equal(indexed.get('urn:hoh:gui:host/mm')['h:status'], 'INTEGRATED_EXTERNAL_HOST');
  assert.equal(indexed.get('urn:hoh:gui:host/company-work')['h:status'], 'INTEGRATED_THROUGH_HOST');
  assert.equal(indexed.get('urn:hoh:gui:host/company-work')['h:integratedVia']['@id'], 'urn:hoh:gui:host/mm');
  const observation = indexed.get(indexed.get('urn:hoh:gui:host/mm')['h:observedIn']['@id']);
  assert.equal(createHash('sha256').update(await readFile(new URL(observation['h:path'], root))).digest('hex'), observation['h:sha256']);
  assert.equal(JSON.parse(await readFile(new URL(observation['h:path'], root), 'utf8')).readiness.hswm, 'NOT_CONNECTED');
  const currentImplementation = indexed.get('urn:hoh:gui:implementation/v0.4.0');
  assert.equal(currentImplementation['prov:wasRevisionOf']['@id'], 'urn:hoh:gui:implementation/v0.3.2');
  assert.equal(createHash('sha256').update(await readFile(new URL(currentImplementation['h:path'], root))).digest('hex'), currentImplementation['h:sha256']);
  const questions = JSON.parse(await readFile(new URL('graph/questions.json', root), 'utf8')).questions;
  const expanded = name => name.replace(/^h:/, 'urn:hoh:gui:').replace(/^prov:/, 'http://www.w3.org/ns/prov#');
  for (const question of questions) {
    const subject = indexed.get(question.subject);
    const value = Object.entries(subject).find(([predicate]) => expanded(predicate) === question.predicate)?.[1];
    const refs = Array.isArray(value) ? value : [value];
    assert.deepEqual(refs.map(ref => ref['@id']).sort(), question.expectedTargets.slice().sort());
  }
});
