# Open interface and adoption plan

The useful part of the Arm comparison is a precise contract between independently
built components: versioned requirements, profiles, reference implementations and
repeatable compatibility checks. HOH has no Arm affiliation or certification.

The public draft consists of the content specification, schemas/context, local
runtime, human/agent example, MCP payload mapping and conformance fixtures. They
retain MetaHumotonic Foundation attribution and the repository's existing license.
No new patent license, standards-body endorsement or trademark program is implied.

| Gate | Deliverable | Evidence required |
| --- | --- | --- |
| Draft 0.1 | Small semantic/action core; one human+agent reference | Same state and receipt through both paths; rejection tests |
| Host pilot | Migrate one real backend app to authoritative actions | Authentication, durable CAS/idempotency, independent clients |
| MCP interoperability | Real server + MCP Apps renderer where useful | Two external MCP hosts; exact supported revisions; transport tests |
| Second implementation | Runtime in another language/framework | Same positive/negative fixture results; no shared execution code |
| Candidate 1.0 | Stable profile registry and migration window | Implementer feedback, independent review, documented incompatibilities |
| Ecosystem | Starter kits, app catalog and compatibility declarations | Real adopters; published interoperability results |

Suggested profiles are core-read, interactive, realtime, MCP and HSWM-projection.
Only implemented and tested combinations may be listed as supported. A renderer
such as A2UI, an event transport such as AG-UI or a browser tool surface such as
WebMCP is optional; none changes the host's authority or the core action semantics.

Contributions should propose one capability at a time: problem and user example,
wire-contract diff, compatibility impact, threat/authority boundary where relevant,
positive and negative fixtures, and an implementation. Maintainers review proposals
in repository issues/PRs. Accepted changes update the specification, schemas,
fixtures and changelog together. Draft changes may break compatibility, but must
carry migration notes; released stable versions must not silently reinterpret fields.

The specification is intended to remain independent of an AI vendor and renderer.
Adoption is an engineering and community goal, not an outcome established by
publishing a graph. Before 1.0, maintainers should explicitly decide specification,
schema/SDK licensing and contribution governance; this draft does not change the
existing AGPL license unilaterally.
