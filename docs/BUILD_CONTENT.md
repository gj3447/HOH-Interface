# Build a content app

Start with [the board descriptor](../examples/semantic/board.json) and
[its host model](../examples/semantic/model.js). The content describes itself;
the renderer and model provider are replaceable.

1. Choose a stable content IRI and define its state JSON Schema.
2. Name each supported domain action and define input/output schemas. Mark its
   effect, confirmation and human-activation requirements explicitly.
3. Validate the descriptor and schemas. Supply a trusted host policy and one
   handler per action. For the local reference, handlers return `{state, output}`
   and perform no external effects.
4. Register a renderer with the existing HOH shell. Its buttons use `invoke()`;
   it displays state from `read()` and `subscribe()`. Keep `viewRevision` separate
   from `stateRevision`, and stop renderer work when its signal aborts.
5. Connect the adjacent chat's host planner. It reads the same descriptor and
   caller-visible snapshot and produces an action proposal. It does not get a
   raw arbitrary-state-write tool.

```js
import { createAgentSession } from '../protocol/agent-session.js';

const session = createAgentSession({
  runtime: contentRuntime,
  actor: authenticatedAgentActor, // resolved by the host, never model output
  async planner({ message, descriptor, snapshot, signal }) {
    return hostPlanner({ message, descriptor, snapshot, signal });
    // { actionId: 'setTitle', input: { title: 'A new title' } }
    // or { answer: 'A response without an action' }
  }
});

const outcome = await session.submit(message, { signal: activeContentSignal });
// outcome.kind: answer | confirmation | result
// Render confirmation's action + request before a human invokes session.confirm().
// Never expose confirm() as an agent-callable tool.
```

An asynchronous planner receives the revision it observed. If a person changes
the content while it plans, the host rejects the stale request. Read and plan
again; do not silently update only `expectedStateRevision`. Navigation closes
the session and cancels pending proposals.

For remote or shared state, place authoritative dispatch, authentication,
validation and durable storage on the server. A browser controller cannot protect
server resources. Bind the shell and MCP transports to that same server boundary.
The supplied memory-only runtime demonstrates the contract, not distributed
transactions or authenticated network delivery.

Run the [conformance checks](CONFORMANCE.md), including rejected operations.
List the actual actions your renderer and agent expose. An app is not conformant
if a visible domain mutation bypasses the registry or the agent uses a separate,
more privileged mutation path.
