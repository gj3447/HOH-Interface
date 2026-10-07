/** A host-owned planning boundary. Planner text never grants permission or changes a revision. */
export function createAgentSession({ runtime, actor, planner }) {
  if (!runtime || !actor?.principalId || typeof planner !== 'function') throw new TypeError('A runtime, trusted actor and planner are required');
  const trustedActor = structuredClone(actor);
  const pending = new Map();
  let closed = false, turn = 0;
  const active = signal => { if (closed || signal?.aborted) throw new Error('Agent context is no longer active'); };
  const requestId = () => globalThis.crypto.randomUUID();
  return Object.freeze({
    async submit(message, { signal } = {}) {
      active(signal);
      const intent = ++turn; pending.clear();
      const descriptor = await runtime.describe({ actor: trustedActor, signal });
      const snapshot = await runtime.read({ actor: trustedActor, signal });
      const plan = await planner({ message, descriptor: structuredClone(descriptor), snapshot: structuredClone(snapshot), signal });
      active(signal);
      if (intent !== turn) throw new Error('A newer agent request superseded this plan');
      if (plan?.answer && !plan.actionId) return { kind: 'answer', answer: String(plan.answer) };
      const action = descriptor.actions.find(row => row.id === plan?.actionId);
      if (!action) throw new Error('Planner returned an undeclared action');
      if (action.gestureRequired || action.effect === 'external') throw new Error('This action needs a separate host interaction');
      const request = { contentId: descriptor.id, descriptorRevision: descriptor.descriptorRevision,
        actionId: action.id, input: structuredClone(plan.input), expectedStateRevision: snapshot.stateRevision, idempotencyKey: requestId() };
      if (action.requiresConfirmation) {
        const proposalId = requestId();
        // Bounded, single-turn proposals. Replaced suggestions never remain executable.
        pending.clear(); pending.set(proposalId, request);
        return { kind: 'confirmation', proposalId, action: structuredClone(action), request: structuredClone(request) };
      }
      pending.clear();
      return { kind: 'result', result: await runtime.invoke(request, { actor: trustedActor, signal }) };
    },
    async confirm(proposalId, { signal } = {}) {
      active(signal);
      const request = pending.get(proposalId);
      pending.delete(proposalId);
      if (!request) throw new Error('Proposal expired or was cancelled');
      // Host UI calls this after displaying the exact target/action/input/revision.
      // Do not export this function as an agent tool.
      return runtime.invoke(request, { actor: trustedActor, confirmed: true, signal });
    },
    cancel(proposalId) { pending.delete(proposalId); },
    close() { closed = true; pending.clear(); }
  });
}
