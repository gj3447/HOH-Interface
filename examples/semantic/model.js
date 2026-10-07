import { createContentRuntime } from '../../protocol/runtime.js';
import descriptor from './board.json' with { type: 'json' };
import * as compiled from './validators.js';

export { descriptor };
export const human = Object.freeze({ principalId: 'local-owner', kind: 'human' });
export const agent = Object.freeze({ principalId: 'local-owner', kind: 'agent' });
export const initialState = () => ({ title: '오늘 함께 할 일', tasks: [
  { id: 'task-1', label: '콘텐츠를 직접 바꿔 보기', done: false },
  { id: 'task-2', label: '채팅으로 같은 보드 조작하기', done: false }
], nextId: 3 });
const schemas = new Map([descriptor.stateSchema, ...descriptor.actions.flatMap(action => [action.inputSchema, action.outputSchema])].map(schema => [schema.$id, schema]));
const entries = [...schemas.entries()].map(([id, schema], index) => [id, { bytes: JSON.stringify(schema), check: compiled[`schema${index}`] }]);
const validators = new Map(entries);
export function validate(schema, value) {
  const known = validators.get(schema?.$id);
  return Boolean(known && known.bytes === JSON.stringify(schema) && known.check(value));
}
export function createBoard() {
  const task = (state, id) => { const found = state.tasks.find(row => row.id === id); if (!found) throw new Error('할 일을 찾을 수 없습니다.'); return found; };
  return createContentRuntime({ description: descriptor, initialState: initialState(), validate,
    authorize: ({ actor }) => actor.principalId === 'local-owner' && ['human', 'agent'].includes(actor.kind),
    handlers: {
      setTitle: ({ state, input }) => ({ state: { ...state, title: input.title }, output: { message: '제목을 변경했어요.' } }),
      addTask: ({ state, input }) => ({ state: { ...state, nextId: state.nextId + 1, tasks: [...state.tasks, { id: `task-${state.nextId}`, label: input.label, done: false }] }, output: { message: '할 일을 추가했어요.' } }),
      setTaskDone: ({ state, input }) => {
        task(state, input.taskId);
        return { state: { ...state, tasks: state.tasks.map(row => row.id === input.taskId ? { ...row, done: input.done } : row) }, output: { message: input.done ? '완료로 표시했어요.' : '미완료로 표시했어요.' } };
      },
      removeTask: ({ state, input }) => {
        task(state, input.taskId);
        return { state: { ...state, tasks: state.tasks.filter(row => row.id !== input.taskId) }, output: { message: '할 일을 삭제했어요.' } };
      },
      resetBoard: () => ({ state: initialState(), output: { message: '보드를 처음 상태로 되돌렸어요.' } })
    }
  });
}

/** Deliberately bounded language demo. Replace with an actual host planner for an LLM. */
export function planDemoCommand(message, snapshot) {
  const text = message.trim();
  let match;
  if ((match = /^제목\s*[:：]\s*(.+)$/.exec(text))) return { actionId: 'setTitle', input: { title: match[1].trim() } };
  if ((match = /^추가\s*[:：]\s*(.+)$/.exec(text))) return { actionId: 'addTask', input: { label: match[1].trim() } };
  if ((match = /^(완료|미완료|삭제)\s*[:：]?\s*(\d+)$/.exec(text))) {
    const row = snapshot.state.tasks[Number(match[2]) - 1];
    if (!row) throw new Error('목록에 있는 번호를 입력해 주세요.');
    return match[1] === '삭제' ? { actionId: 'removeTask', input: { taskId: row.id } }
      : { actionId: 'setTaskDone', input: { taskId: row.id, done: match[1] === '완료' } };
  }
  if (text === '초기화') return { actionId: 'resetBoard', input: {} };
  return null;
}
