import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('GUI graph preserves the Korean source, defined edge endpoints, host scope and query answers', async () => {
  const root = new URL('../', import.meta.url);
  const graph = JSON.parse(await readFile(new URL('graph/hoh-ui.jsonld', root), 'utf8'));
  const nodes = graph['@graph'], indexed = new Map(nodes.map(node => [node['@id'], node]));
  assert.equal(indexed.size, nodes.length);
  const source = nodes.find(node => node['h:authority'] === 'USER_PRIMARY');
  const bytes = await readFile(new URL(source['h:path'], root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source['h:sha256']);
  assert.ok(bytes.toString('utf8').startsWith('일단 이 ui 를 HOH UI 라고해줘'));
  const ui = indexed.get('urn:hoh:gui:hoh-ui');
  assert.equal(ui['h:authority'], 'SECONDARY_AI');
  assert.equal(ui['prov:wasDerivedFrom']['@id'], source['@id']);
  const rules = [['h:hasComponent', 'h:Component', 4], ['h:intendedHost', 'h:ApplicationHost', 3]];
  for (const [predicate, type, count] of rules) {
    assert.equal(ui[predicate].length, count);
    assert.equal(new Set(ui[predicate].map(ref => ref['@id'])).size, count);
    for (const ref of ui[predicate]) assert.equal(indexed.get(ref['@id'])?.['@type'], type);
  }
  assert.equal(indexed.get('urn:hoh:gui:host/mm')['h:status'], 'INTENDED_TARGET_NOT_RESOLVED');
  assert.equal(indexed.get('urn:hoh:gui:host/company-work')['h:status'], 'INTENDED_NOT_INTEGRATED');
  const questions = JSON.parse(await readFile(new URL('graph/questions.json', root), 'utf8')).questions;
  const expanded = name => name.replace(/^h:/, 'urn:hoh:gui:').replace(/^prov:/, 'http://www.w3.org/ns/prov#');
  for (const question of questions) {
    const subject = indexed.get(question.subject);
    const value = Object.entries(subject).find(([predicate]) => expanded(predicate) === question.predicate)?.[1];
    const refs = Array.isArray(value) ? value : [value];
    assert.deepEqual(refs.map(ref => ref['@id']).sort(), question.expectedTargets.slice().sort());
  }
});
