# HOH Semantic Content Interface — research note

**Prepared:** 2026-10-07. **Scope:** a proposal for an open HOH profile; not a claim of standards-body endorsement, universal AI understanding, HSWM execution, or a production deployment.

## The interface to standardize

The useful unit is a **semantic, executable content contract**, not a new chat protocol. A content item must be understandable by both a person and an adjacent agent, while keeping the human able to operate the same visible controls. The adjacent agent may propose or invoke only advertised actions under the same host authorization, confirmation, concurrency, and audit rules as a person.

```
semantic document ──► content renderer ──► person operates visible affordance
       │                        │
       ├──► agent context ──► proposed action ──► policy/confirmation ──► host effect
       │                                                                    │
       └──────────── provenance + revision + result ◄──────────────────────┘
```

This makes the desired “AI can control contents beside the chat” precise without making chat text an implicit authority channel. The renderer is untrusted for authorization; the host is the effect authority.

## Proposed HOH Content Contract (HCC) 0.1

Use a versioned JSON document with a JSON-LD 1.1 context. HCC defines its own stable vocabulary and does **not** claim that all content is a W3C WoT Thing or an MCP tool.

| Layer | Required contract | Why it is separate |
| --- | --- | --- |
| Identity + meaning | `id`, `type`, labels/descriptions, JSON-LD context, semantic references, source/revision | Gives people and agents a stable subject to discuss; avoids scraping UI pixels. |
| Read model | typed state/schema, representation/media and read capability | An agent can inspect declared state without treating presentation as truth. |
| Action model | named action, input/output JSON Schema, declared effect class, preconditions, concurrency token, availability | An agent and human use the same affordance definition. |
| Event model | typed event payload/schema, subscription or polling policy | Live content can announce changes without inventing state from chat. |
| Governance | required capability/scope, confirmation policy, rate/cost/risk annotation, revocation/expiry | The content author does not grant access by embedding an action. |
| Evidence | actor class, intent/proposal, authorization decision, execution activity, immutable result/receipt, before/after revision | A claim of “the agent changed it” remains traceable and contestable. |

### Minimum action envelope

The implementation-current `invoke` request is deliberately actor-free. The caller cannot select a principal, role, approval, or confirmation state through JSON. The authenticated host binding supplies actor identity and attaches it to audit evidence after validation:

```json
{
  "contentId": "urn:example:content:42",
  "descriptorRevision": 1,
  "actionId": "taskComplete",
  "input": { "taskId": "a7" },
  "expectedStateRevision": 18,
  "idempotencyKey": "caller-generated-unique-key"
}
```

The current runtime surface is `describe`, `read`, `invoke`, and `subscribe`. The host validates action input, current descriptor, state revision, availability and authorization; it obtains a confirmation when policy requires it, commits the local action or rejects it, then returns a schema-validated result with a new revision and receipt reference. `expectedStateRevision` prevents an old chat turn from mutating a later view. Idempotency is keyed by `idempotencyKey`, never by a natural-language utterance. The reference cache is bounded and in memory; it does not guarantee durable exactly-once execution. The human or agent identity belongs to the trusted host context and the resulting audit record, not the request payload.

### Action classes

The implemented 0.1 reference recognizes three action effects; the effect is metadata for policy and does not itself grant execution:

- `read`: no persistent external effect;
- `write`: changes persistent content/state;
- `external`: sends, purchases, publishes, controls a device, or starts media.

The MCP bridge currently excludes `external` actions and gesture-required actions from model exposure. The host still makes the final authorization/confirmation decision for exposed read or write actions. `draft`, `local-ui`, and `privileged` are useful **future-profile labels**, but they are not HCC 0.1 reference effects and must not appear in a 0.1 descriptor. A human may use the same declared controls directly. An agent should not receive a hidden action unavailable to the human unless a later profile makes that delegation explicit and auditable.

## Standards mapping and boundaries

| Source | Status at access date | Reuse in HCC | Do not claim |
| --- | --- | --- | --- |
| [MCP 2026-07-28 versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning) and [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | Current MCP revision; 2025-11-25 is a final compatibility revision | an optional `hcc-mcp` adapter exposes authorized HCC actions as MCP tools and semantic documents as MCP resources; use JSON Schema I/O and tool discoverability | HCC is MCP, or MCP grants content access. Each MCP request has its own version metadata; current clients can use `server/discover`. |
| [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources) and [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) | official MCP specifications / extension documentation | resource URIs and update subscriptions map well to content snapshots; MCP Apps can host an HCC renderer in an MCP host | a standalone HOH web shell is automatically an MCP App. |
| [WoT Thing Description 1.1](https://www.w3.org/TR/wot-thing-description11/) | W3C Recommendation | use the pattern `properties`/`actions`/`events`, forms, security metadata and JSON-LD extension discipline for live applications/devices | every HCC document conforms to WoT TD, or a UI program is an IoT Thing. |
| [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) | W3C Recommendation (2020-07-16) | portable identity, vocabulary IRIs, typed links, named provenance graphs | JSON-LD itself validates business rules or makes language-model inference correct. |
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core) | published JSON Schema specification; the linked IETF Internet-Draft is historical/expired, not an IETF RFC | machine validation of HCC documents and action input/output | schema validation proves an effect is authorized or semantically sound. |
| [SHACL](https://www.w3.org/TR/shacl/) | W3C Recommendation | optional RDF graph shape validation for semantic profile, cardinalities and provenance links | SHACL validation unless actual RDF plus shapes are run. |
| [PROV-O](https://www.w3.org/TR/prov-o/) | W3C Recommendation | entities (content/revision/receipt), activities (proposal/execution), agents (human/agent/host) and derivation | provenance proves a result is desirable or truthful. |
| [A2UI](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/docs/a2ui_protocol.md) | v1.0 Candidate; repository lists v0.9.1 as current | optional renderer-stream binding for generated, schema-validated surfaces | a stable dependency for the core contract; generated surface JSON may never bypass HCC actions. |
| [AG-UI](https://github.com/ag-ui-protocol/ag-ui) | project protocol, not a W3C/MCP standard | optional transport for agent lifecycle, state and UI events | an adoption prerequisite or security boundary. |
| [WebMCP draft](https://webmachinelearning.github.io/webmcp/) | W3C Community Group Draft Report (2026-10-02), explicitly not a W3C Standard or Standards Track; [Chrome described early preview](https://developer.chrome.com/blog/webmcp-epp) | optional browser-native tool adapter research: declarative and imperative tools, structured schema and user-controlled shared context align with HCC goals | a stable browser dependency, deployed browser support, or a security boundary replacing the HOH host. |
| [Arm SystemReady](https://www.arm.com/architecture/system-architectures/systemready-compliance-program) | Arm compliance program | adoption model: narrow profiles, public requirements, self-checking compatibility suite, declared support matrix | HOH has Arm certification or equivalent ecosystem status. |

WebMCP is deliberately not a core dependency. It has a dated, official Community Group draft and a Chrome early-preview path, so it is a concrete optional adapter candidate—not merely an academic paper or an absent specification. Its Community Group status and early-preview availability still make it unsuitable as HCC’s required compatibility floor.

## HSWM profile boundary

The HSWM materials define a target identity: a token-native, LLM-executed, evolving semantic-weight hypergraph acting as living harness/world model/continuous learner. Its present efficacy is explicitly `UNJUDGED`; the repository ontology is a bounded projection rather than the cognition itself. This research cites the declared sources and their bytes, but does not issue a word-for-word HSWM query or claim a live HSWM observation. HCC should therefore offer an **optional HSWM projection**, never imply activation:

- `hswmProjection`: provenance-bound, read-only semantic references to a selected HSWM schema/revision;
- `hswmAdmission`: absent unless an authorized HSWM host returns a current admission decision;
- `hswmExecution`: `NOT_READY`/`NOT_CONNECTED`/host-reported state, never inferred from a JSON-LD edge;
- HCC’s conventional revision, authority and receipt fields may map into an HSWM host, but HCC does not create HSWM authority, grants, or learning events.

This follows the local HSWM canon’s separation of USER_PRIMARY target identity, SECONDARY_AI interpretation, schema-relative ownership, canonical atom revisions, grants, and outcome-bound learning. Current local canonical material explicitly retires fixed `H/W/A/F/Π` partitions; HCC must not reintroduce them as a mandatory projection.

## Compatibility strategy: the useful part of the Arm analogy

For HOH to spread, keep the core small and testable.

1. Publish HCC 0.1 as a pinned JSON Schema, JSON-LD context, action/error/result envelopes and a small reference renderer/host adapter.
2. Establish profiles instead of one huge “everything” standard: `core-read`, `interactive`, `realtime`, `agent-mediated`, `mcp-bridge`, `hswm-projection`.
3. Publish a conformance suite with positive/negative fixtures: unknown terms, schema failure, stale revision, denied capability, required confirmation, retry/idempotency, event ordering, provenance chain, and renderer cannot forge an authorization result.
4. Publish a compatibility declaration that names exact profile/version/test-suite result. It must say “declared compatible”, not “certified”, until there is an independent governance and certification program.
5. Maintain semver for HCC document/profile schemas. Breaking change means a new major/profile version; hosts advertise exact supported versions and clients fail closed when an action’s version is unsupported.
6. Implement adapters after the core passes fixtures: HOH browser shell first, MCP tools/resources second, A2UI/AG-UI as experimental transport bindings, and WoT TD mapping only for appropriate live/device content.

## Graph-engineering proposal

Keep immutable user wording separate from interpretation. The graph needs to answer: (1) which content/action can this person or agent use now, (2) what state/revision does it apply to, (3) which evidence proves the result, (4) which profile/schema validated it, and (5) whether it is merely an intended integration or an observed implementation.

Suggested stable nodes: `Content`, `ContentRevision`, `SemanticDescriptor`, `ActionDescriptor`, `ActionRequest`, `AuthorizationDecision`, `ExecutionActivity`, `ExecutionReceipt`, `HumanActor`, `AgentActor`, `Host`, `SchemaVersion`, `Profile`, `ValidationRun`, `SourceArtifact`.

Suggested typed edges: `describes`, `hasRevision`, `affordsAction`, `requiresCapability`, `requiresConfirmation`, `requestedFor`, `authorizedBy`, `wasGeneratedBy`, `usedDescriptor`, `validatedAgainst`, `wasDerivedFrom`, `supersedes`, `supportsProfile`, `reportsStateOf`. Each predicate should declare domain, range, direction and cardinality in the HOH graph registry. An `ActionRequest` node—not a bare edge—carries actor, time, arguments digest, expected revision, policy decision, outcome and receipt.

Competency checks: resolve content by stable ID; list actions allowed for this caller; show why a denied/confirmed action was not run; trace a visible state to a result and inputs; distinguish a proposed compatibility claim from a passed validation run; retrieve a source-backed HSWM projection without claiming HSWM execution.

## Concrete implementation sequence

1. Add `contracts/semantic-content.schema.json`, `contexts/hoh-content-v0.1.jsonld`, and `contracts/action.schema.json`; use pinned `$id` URLs/URNs and no network fetch at runtime.
2. Use the reference runtime contract `describe`, `read`, `invoke`, and `subscribe`; keep existing `open`, `saveState`, and `chat` as host implementation details until adapters migrate.
3. Render human controls from action descriptors and route both clicks and AI proposals through one host `invoke` pipeline.
4. Add a side-panel “proposed action” card containing target, arguments, impact class, required confirmation and result/receipt.
5. Add deterministic fixtures and a profile conformance command; only then make `hcc-mcp` bridge available.
6. Record source bytes, schema/profile version, validator result and artifact revision in the existing JSON-LD provenance graph. Do not write to a shared HSWM graph as part of UI work.

## Non-goals and open decisions

- No claim that semantic markup gives an AI complete or correct understanding. It creates an inspectable contract and validation surface.
- No universal tool permissions; host authorization remains mandatory.
- No remote plugin registry, trademark/certification program, or compatibility logo in 0.1.
- Decide governance before adopting public extension prefixes: maintainer process, compatibility policy, security disclosure channel, and deprecation/migration policy.
- Test accessibility and usability with actual users; semantic/action conformance is not a substitute.
