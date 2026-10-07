# HOH Content Contract 0.1 — draft

**Status: experimental project specification, 2026-10-07.** This document is the
normative contract for this draft. It is not an adopted industry standard.
The [user's source](../sources/user-hoh-semantic-content-2026-10-07.txt) establishes
the direction; the names, field choices and rules below are implementation design.

HOH content is a **semantic resource with observable state and declared actions**.
A person and an adjacent agent operate that resource through the same host-owned
action boundary. A renderer presents it; an AI planner interprets intent; the host
decides whether and how an operation may run.

## Small core, independent implementations

| Operation | Meaning | Reference API |
| --- | --- | --- |
| Describe | Discover identity, meaning, schema and available actions | `await runtime.describe({actor, signal})` |
| Read | Observe a caller-visible state and its revision | `await runtime.read({actor, signal})` |
| Invoke | Request one declared action against the observed revision | `await runtime.invoke(request, trustedContext)` |
| Subscribe | Receive caller-visible state updates | `await runtime.subscribe(listener, {actor, signal})` |

The reference is framework-independent JavaScript. These operations describe a
language-neutral data contract; an implementation can use another language,
storage engine, renderer or model. `close()` is a local lifecycle helper.
Core conformance does not require HOH CSS, the feed, an LLM vendor, HSWM or MCP.

## Identity and semantic description

The [descriptor schema](../protocol/descriptor.schema.json) uses JSON Schema
2020-12. A descriptor MUST carry a stable absolute IRI `id`, `protocolVersion`,
positive integer `descriptorRevision`, human-readable `title` and `description`,
`stateSchema`, and an `actions` array. Zero actions represents read-only content.
Content identity MUST NOT be a mutable screen position, DOM selector or title.

The core [JSON-LD context](../protocol/context.jsonld) maps the descriptor to
stable IRIs. Core definitions MUST remain identical; additional terms may extend
the context without overriding those definitions. Action `id` is a local camelCase
name; an optional action `@id` supplies its global semantic IRI. JSON Schemas are
RDF JSON literals, not a fabricated RDF ontology of JSON Schema keywords.

Implementers MUST validate both the descriptor and each embedded schema before
registering the content. Schemas and contexts MUST be pinned or locally resolved;
viewing content MUST NOT automatically fetch or execute arbitrary definitions.
The reference runtime accepts a mandatory host `validate(schema,value)` function.
The example uses generated Ajv validators; the runtime is not itself a complete
JSON Schema processor.

`descriptorRevision` identifies the action/meaning contract. `stateRevision`
identifies the authoritative state. The existing shell's `viewRevision` identifies
a navigation context. These are distinct and MUST NOT be substituted for each other.
JSON-LD makes the meaning inspectable; it does not guarantee correct AI reasoning.

## Actions and human parity

Each action MUST declare `id`, `title`, `description`, input/output JSON Schemas,
`effect`, `requiresConfirmation`, and `gestureRequired`. IDs MUST be unique in a
descriptor. An interactive content implementation MUST expose every supported
domain mutation in its action registry and map its human controls to that registry.
An agent MUST NOT use a hidden DOM mutation path or bypass an action's host checks.

| Effect | Rule in draft 0.1 |
| --- | --- |
| `read` | Does not change authoritative state. |
| `write` | Changes local or host-managed state through the same invocation boundary. |
| `external` | Has effects beyond the local state machine; the reference rejects it. |

`requiresConfirmation` is a minimum requirement, not an authorization grant. Hosts
may require stronger approval, scopes, quotas or device policies. `gestureRequired`
means a planner cannot synthesize the required human activation. Such actions remain
discoverable but MUST be presented as requiring a human step. Camera capture, screen
selection, payments and physical control need their own host/provider contracts.
An agent can initiate a supported workflow; it cannot silently replace that step.

The reference board registers all five domain mutations: change title, add task,
change completion, remove task and reset. Its human controls and chat planner use
the same dispatcher. Existing legacy ARTICLE/GAME/CHECKLIST and realtime adapters
are **not automatically core-conformant** merely because they render in the shell.
Their host state/actions need explicit migration. Shell navigation, reactions and
favorites are separate host resources; this draft does not falsely expose them as
board actions.

## Request and host context

An invocation MUST match [invoke.schema.json](../protocol/invoke.schema.json):

```json
{
  "contentId": "urn:hoh:example:board",
  "descriptorRevision": 1,
  "actionId": "setTaskDone",
  "input": { "taskId": "task-1", "done": true },
  "expectedStateRevision": 3,
  "idempotencyKey": "a-new-host-scoped-request-id"
}
```

The authenticated principal, whether the operation originated from a person or
agent, confirmation evidence and user activation MUST come from trusted host
context. They MUST NOT be accepted from model output or content-supplied JSON.
The in-process runtime assumes its caller is that trusted host; exposing it as an
unauthenticated network endpoint does not satisfy this requirement.

Before commit, the host MUST verify the content and descriptor, declared action,
input schema, current authorization, required confirmation/activation and exact
`expectedStateRevision`. The host MUST validate next state and output before making
the new state visible. A failed action MUST NOT be reported as a successful change.
If another operation changed the state, return `STALE_REVISION`; the planner must
read again and reconsider, rather than rewriting the expected revision blindly.

`idempotencyKey` binds one normalized request to its authenticated execution scope.
Reusing it with different arguments MUST be rejected. Replaying a result MUST still
respect current authorization. The reference cache is bounded and memory-only;
it does not provide durable exactly-once execution after eviction, reload or restart.
Production effects require a transactional store/outbox and a documented retry policy.

## Outcomes, subscriptions and cancellation

A successful invocation returns `{ok, snapshot, output, receipt}`, described by
[outcome.schema.json](../protocol/outcome.schema.json). The receipt
identifies the content, descriptor, action, host-bound actor, request key and state
revision. This records what ran; a chat answer alone is not an execution receipt.
The reference returns JSON objects; a host decides what evidence may be persisted
or exposed. It must avoid exposing hidden state through receipts or subscriptions.

Reads and subscriptions MUST enforce host authorization and caller-specific
projection. Subscription updates are state snapshots, not an exhaustive event log.
The reference coalesces updates for slow subscribers to bound memory use.
Consumers compare revisions and re-read after a gap; transport reconnect, durable
event replay and multi-process subscriptions need an explicit host profile.

Context navigation MUST cancel pending proposals and old renderer operations.
Cancellation can prevent an uncommitted local transition; it MUST NOT be described
as undoing an already committed or external effect. Content and media lifetimes
remain separate: the existing realtime provider owns its capture tracks.

## Errors

The reference throws `ContentRuntimeError` with a stable `code`. Invalid input,
unknown action, denied access, required confirmation/gesture, stale revision,
idempotency mismatch, cancelled/closed context and unsupported external effect
are distinct failure conditions. Network adapters map these to their transport
without turning a failure into `{ok:true}`. Internal exceptions must not disclose
private state, credentials or stack traces to an untrusted agent.

## MCP and HSWM profiles

[MCP mapping](../protocol/mcp-mapping.js) exports descriptor/state as resource
payloads and eligible declared operations through a typed `hoh_content_invoke` tool.
It is an in-process mapping, not an MCP server or MCP Apps implementation.
An actual server must implement transport, authentication, MCP version negotiation
and discovery. The researched current revision is **2026-07-28**; **2025-11-25** is
a separate compatibility target. Destructive actions can report confirmation
required; the model-facing mapping never sets its own confirmation flag.

The [HSWM profile](HSWM_CONTENT_PROFILE.md) connects owner-stable semantic
references and outcome evidence to a selected schema-relative projection. The
core state machine is not HSWM itself. No HSWM admission, learning event or remote
execution is created by a descriptor or graph edge.

## Versioning and conformance

Draft 0.1 accepts the exact protocol version `0.1`; unsupported versions MUST fail.
Descriptor revisions advance when actions or their interpretation change. A
breaking wire-contract change requires a new protocol version and migration notes.
Additive optional profiles have explicit namespace/version identifiers. Unknown
required functionality must be reported unsupported, never silently executed.

Run `npm ci`, `npm test`, and `npm run check:semantic`. Browser and RDF/SHACL checks
are documented in [conformance](CONFORMANCE.md). A compatibility declaration names
the exact profile, implementation revision and checks. Passing the reference suite
is not independent certification or proof that every app/AI understands the content.
The [adoption plan](ADOPTION.md) defines the next interoperability gates.
