import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const expand = value => value.replace(/^h:/, 'urn:hoh:gui:').replace(/^prov:/, 'http://www.w3.org/ns/prov#');
const refs = value => Array.isArray(value) ? value : [value];

test('semantic-content graph keeps user source separate from the draft and validates typed endpoints', async () => {
  const root = new URL('../', import.meta.url);
  const [base, realtime, semantic, questions, shapes] = await Promise.all([
    readFile(new URL('graph/hoh-ui.jsonld', root), 'utf8').then(JSON.parse),
    readFile(new URL('graph/realtime.jsonld', root), 'utf8').then(JSON.parse),
    readFile(new URL('graph/semantic-content.jsonld', root), 'utf8').then(JSON.parse),
    readFile(new URL('graph/semantic-content-questions.json', root), 'utf8').then(JSON.parse),
    readFile(new URL('graph/semantic-content-shapes.ttl', root), 'utf8')
  ]);
  const nodes = [...base['@graph'], ...realtime['@graph'], ...semantic['@graph']];
  const indexed = new Map(nodes.map(node => [node['@id'], node]));
  assert.equal(indexed.size, nodes.length);
  const source = indexed.get('urn:hoh:gui:source/user-hoh-semantic-content-918a2adc46488a8cf1d17209b62b659f3f30abd93ba2f4b30150d6ca64a64afc');
  const bytes = await readFile(new URL(source['h:path'], root));
  assert.equal(source['h:authority'], 'USER_PRIMARY');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source['h:sha256']);
  assert.match(bytes.toString(), /시멘틱 웹 \+ hswm.*contents.*ai 챗봇/);

  const protocol = indexed.get('urn:hoh:gui:semantic-content-protocol/v0.1-draft');
  assert.equal(protocol['h:authority'], 'SECONDARY_AI');
  assert.equal(protocol['h:status'], 'DRAFT_NOT_STANDARD');
  assert.equal(protocol['prov:wasDerivedFrom']['@id'], source['@id']);
  assert.equal(refs(protocol['h:hasRequirement']).length, 6);
  assert.equal(refs(protocol['h:definesContract']).length, 4);
  assert.equal(indexed.get(protocol['h:supportsProfile']['@id'])['h:status'], 'OPTIONAL_PROJECTION_NOT_CONNECTED');
  assert.equal(indexed.get(protocol['h:mapsToBridge']['@id'])['h:status'], 'IMPLEMENTED_IN_PROCESS_MAPPING_NOT_MCP_SERVER');
  assert.deepEqual(indexed.get('urn:hoh:gui:contract/invoke-request')['h:fields'], ['contentId', 'descriptorRevision', 'actionId', 'input', 'expectedStateRevision', 'idempotencyKey']);
  assert.deepEqual(indexed.get('urn:hoh:gui:contract/runtime-methods')['h:fields'], ['describe', 'read', 'invoke', 'subscribe']);
  assert.deepEqual(indexed.get('urn:hoh:gui:contract/action-outcome')['h:fields'], ['ok', 'snapshot', 'output', 'receipt']);
  assert.equal(refs(protocol['h:hasArtifact']).length, 11);

  const isInstance = (node, expected) => {
    if (!node) return false;
    if (node['@id'] === expand(expected) || expand(node['@type'] ?? '') === expand(expected)) return true;
    const parent = node['rdfs:subClassOf'];
    if (parent) return isInstance(indexed.get(expand(parent['@id'])), expected);
    return typeof node['@type'] === 'string' && isInstance(indexed.get(expand(node['@type'])), expected);
  };
  for (const predicate of ['hasRequirement', 'definesContract', 'hasInteractionModel', 'hasParticipant', 'usesDispatcher', 'validatesAgainst', 'producesOutcome', 'emitsEvent', 'supportsProfile', 'mapsToBridge', 'satisfiedBy', 'realizesContract']) {
    const property = indexed.get(`urn:hoh:gui:${predicate}`);
    assert.equal(property?.['@type'], 'rdf:Property');
    assert.ok(property['rdfs:domain']?.['@id'] && property['rdfs:range']?.['@id']);
    for (const subject of nodes.filter(node => node[`h:${predicate}`] !== undefined)) {
      assert.ok(isInstance(subject, property['rdfs:domain']['@id']), `${subject['@id']} outside ${predicate} domain`);
      for (const target of refs(subject[`h:${predicate}`])) assert.ok(isInstance(indexed.get(target['@id']), property['rdfs:range']['@id']), `${target['@id']} outside ${predicate} range`);
    }
  }
  for (const question of questions.questions) for (const check of question.path ?? [question]) {
    const subject = indexed.get(check.subject);
    const value = Object.entries(subject).find(([predicate]) => expand(predicate) === check.predicate)?.[1];
    assert.deepEqual(refs(value).map(ref => ref['@id']).sort(), check.expectedTargets.slice().sort());
  }
  for (const ref of refs(protocol['h:hasArtifact'])) {
    const artifact = indexed.get(ref['@id']);
    assert.equal(artifact['h:implementationStatus'], 'IMPLEMENTED_ARTIFACT_HASH_PINNED');
    const file = await readFile(new URL(artifact['h:path'], root));
    assert.equal(createHash('sha256').update(file).digest('hex'), artifact['h:sha256']);
    assert.ok(indexed.has(artifact['h:validatedBy']['@id']));
  }
  assert.match(shapes, /sh:NodeShape/);
  assert.match(shapes, /h:hasRequirement/);
  assert.match(shapes, /PLANNED_ARTIFACT_UNPINNED/);
});
