import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { createBoard, descriptor, human, agent, validate, initialState } from '../examples/semantic/model.js';
import { createAgentSession } from '../protocol/agent-session.js';
import { createMcpMapping } from '../protocol/mcp-mapping.js';

const request = (actionId, input, expectedStateRevision = 0, idempotencyKey = crypto.randomUUID()) => ({
  contentId: descriptor.id, descriptorRevision: descriptor.descriptorRevision, actionId, input, expectedStateRevision, idempotencyKey
});
const load = async name => JSON.parse(await readFile(new URL(`../protocol/${name}`, import.meta.url)));

test('descriptor and invoke use JSON Schema 2020-12; actor and changed core semantic mappings are refused', async () => {
  const ajv = new Ajv({ strict: true });
  const checkDescriptor = ajv.compile(await load('descriptor.schema.json'));
  assert.equal(checkDescriptor(descriptor), true, JSON.stringify(checkDescriptor.errors));
  const wrong = structuredClone(descriptor); wrong['@context'].id = 'https://example.com/unrelated';
  assert.equal(checkDescriptor(wrong), false);
  const checkRequest = ajv.compile(await load('invoke.schema.json'));
  const valid = request('setTitle', { title: '제목' });
  assert.equal(checkRequest(valid), true);
  assert.equal(checkRequest({ ...valid, actor: { principalId: 'admin' } }), false);
  assert.equal(checkRequest({ ...valid, expectedStateRevision: -1 }), false);
  assert.equal(checkRequest({ ...valid, idempotencyKey: '' }), false);
});

test('compiled browser validators agree with Ajv for valid and malformed sample data', () => {
  const ajv = new Ajv({ strict: true });
  const schemas = new Map([descriptor.stateSchema, ...descriptor.actions.flatMap(a => [a.inputSchema, a.outputSchema])].map(s => [s.$id, s]));
  const candidates = [initialState(), { title: '제목' }, { label: '메모' }, { taskId: 'task-1', done: true }, { taskId: 'task-1' }, {}, { message: '완료' }, null, [], 3, { admin: true }, { title: '' }, { title: 'a'.repeat(121) }, { title: '첫째\n둘째' }, { taskId: '../secret' }, { taskId: 'task-1', done: 'true' }];
  for (const schema of schemas.values()) {
    const official = ajv.compile(schema);
    for (const value of candidates) assert.equal(validate(schema, value), official(value), schema.$id);
  }
  assert.equal(validate({ $id: descriptor.stateSchema.$id, type: 'number' }, 1), false);
});

test('human edits and planned agent edits preserve the same authoritative state and receipts', async () => {
  const runtime = createBoard();
  const session = createAgentSession({ runtime, actor: agent, planner: async ({ snapshot }) => {
    assert.equal(snapshot.state.title, '직접 수정');
    return { actionId: 'addTask', input: { label: 'AI 계획으로 추가' } };
  } });
  await runtime.invoke(request('setTitle', { title: '직접 수정' }), { actor: human });
  const answer = await session.submit('추가해');
  assert.equal(answer.result.snapshot.stateRevision, 2);
  assert.equal(answer.result.snapshot.state.tasks.at(-1).label, 'AI 계획으로 추가');
  assert.equal(answer.result.receipt.actor.kind, 'agent');
});

test('a late agent plan cannot overwrite a human edit and navigation cancellation prevents invocation', async () => {
  const runtime = createBoard(); let finish, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const session = createAgentSession({ runtime, actor: agent, planner: async () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  const pending = session.submit('later'); await waiting;
  await runtime.invoke(request('setTitle', { title: '사람이 먼저 변경' }), { actor: human });
  finish({ actionId: 'setTitle', input: { title: '오래된 AI 변경' } });
  await assert.rejects(pending, error => error.code === 'STALE_REVISION');
  assert.equal((await runtime.read({ actor: human })).state.title, '사람이 먼저 변경');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(session.submit('cancelled', { signal: abort.signal }));
  assert.equal((await runtime.read({ actor: human })).stateRevision, 1);
});

test('a planner cannot self-confirm; a stale or cancelled confirmation does not delete', async () => {
  const runtime = createBoard();
  const session = createAgentSession({ runtime, actor: agent, planner: async () => ({ actionId: 'removeTask', input: { taskId: 'task-1' }, confirmed: true }) });
  const proposal = await session.submit('delete');
  assert.equal(proposal.kind, 'confirmation');
  assert.equal((await runtime.read({ actor: human })).state.tasks.length, 2);
  await runtime.invoke(request('setTitle', { title: '바뀐 제목' }), { actor: human });
  await assert.rejects(session.confirm(proposal.proposalId), error => error.code === 'STALE_REVISION');
  const cancelled = await session.submit('delete'); session.cancel(cancelled.proposalId);
  await assert.rejects(session.confirm(cancelled.proposalId));
  const confirmed = await session.submit('delete');
  assert.equal((await session.confirm(confirmed.proposalId)).snapshot.state.tasks.length, 1);
});

test('MCP mapping exposes typed tools/resources, executes the same action, and refuses forged approval', async () => {
  const runtime = createBoard(), mapping = createMcpMapping({ runtime, actor: agent });
  const listed = await mapping.listResources(); assert.equal(listed.resources.length, 2);
  const state = await mapping.readResource(listed.resources.find(r => r.uri.endsWith('/state')).uri);
  assert.equal(JSON.parse(state.contents[0].text).stateRevision, 0);
  const tools = await mapping.listTools(); assert.equal(tools.tools.length, 1);
  const validator = new Ajv({ strict: true }).compile(tools.tools[0].inputSchema);
  const command = request('setTitle', { title: 'MCP 명령' }); assert.equal(validator(command), true);
  assert.equal(validator({ ...command, actor: human }), false);
  const result = await mapping.callTool('hoh_content_invoke', command);
  assert.equal(result.isError, false); assert.equal(result.structuredContent.snapshot.state.title, 'MCP 명령');
  const outputValidator = new Ajv({ strict: true }).compile(tools.tools[0].outputSchema);
  assert.equal(outputValidator(result.structuredContent), true, JSON.stringify(outputValidator.errors));
  const denied = await mapping.callTool('hoh_content_invoke', { ...request('resetBoard', {}, 1), confirmed: true });
  assert.equal(denied.isError, true);
  assert.equal(outputValidator(denied.structuredContent), true);
  assert.equal((await runtime.read({ actor: human })).state.title, 'MCP 명령');
  await assert.rejects(mapping.readResource('file:///private'));
});
