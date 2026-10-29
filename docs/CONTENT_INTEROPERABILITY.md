# MM package interoperability

Implementation scope: a reusable reader, app kit and sandbox host for the existing
`mm.content-package/v1` and `mm.content-bundle/v1` formats. An unchanged app
package can run under MM or HOH; host integrations remain responsible for their
own sessions, available tools, data and publication policy. This is an explicit
compatibility profile, not a claim that every MM app or MCP host is supported.

The user's 2026-10-29 request is to implement shared app execution while keeping
the concepts logically consistent. The following contract is engineering design.
It builds on [Content Contract 0.1](CONTENT_CONTRACT.md), not a replacement
definition of HOH, HSWM or user canon.

## Identity, meaning and authority

| Object | Identity/version | Meaning and owner |
| --- | --- | --- |
| App package | original package name/version and exact bundle SHA-256 | Immutable code and declarations; its publisher owns it |
| Semantic content | original `content.id` and `content.revision` | What the app means and which actions it declares; never renamed on import |
| Mounted instance | host-created instance ID + bundle digest | One app in one host/session and parameter context |
| View snapshot | app `stateRevision` | What that mounted app reports; MM may version only its declared key projection |
| Resume input | declared string parameters | A host-scoped request to restore a view; not a saved business transaction |
| Business state/result | owner service's IDs, revisions and receipts | Authoritative data; owned and authorized by the service, not the iframe |
| Invocation | content, descriptor, bundle, instance and request ID | One action against an observed view; a successful message is not proof of an external write |

`MM_PACKAGE_PROFILE = urn:hoh:profile:mm-published-app:1` distinguishes this
browser-view contract from the local transactional state machine in `runtime.js`.
Describe/read/invoke/subscribe retain their purposes, but an app view snapshot is
attributed `FRAME_REPORTED`; it must not be presented as a host-owned durable
snapshot or measured physical state. Source annotations such as simulated,
replay and observed timestamps must survive a provider adapter.

MM's package schema has view actions without an `effect` or output schema. Its
runtime treats these as view writes and performs business reads through named
host tools. The importer must not invent an output contract, silently treat a view
action as an external write, or claim transactional rollback for JavaScript that
has already run. New service writes need their owner's existing action and
confirmation contract; the published-app read-tool profile does not grant them.

## Existing MM compatibility

The package format and `ailab-apps/1` postMessage vocabulary remain unchanged.
`content.json` and `app.html` do not acquire HOH-specific imports or rewritten
content IDs. A host inserts its kit at `<!-- ailab-app-kit -->`; the kit supports
the existing `window.ailab` API and is an implementation of a declared host
profile. Kit insertion is rendering, not a new source-template identity.

`protocol/app-package.js` preserves MM's bounded shape decoder, including default
string/array limits, enum precedence and projection of undeclared object fields.
This is explicitly the MM shape dialect, not arbitrary JSON Schema support.
Unsupported fields and versions fail closed instead of changing their meaning.
Package source/revision fields are provenance, not authorization.

The host pins exact bundle bytes and checks the template digest before creating
an executable frame. It requires an explicit host authorization callback and
only exposes declared, host-registered read tools. An `admin` flag is an access
requirement; an app cannot grant itself that role. Fixture bundles require an
explicit development-only option and are refused by default.

## Lifecycle and actions

The frame has scripts enabled and an opaque origin. Its network, parent DOM,
storage, navigation and tool access are not inherited from the host's session.
Messages are bound to the exact frame and mount channel. Teardown invalidates
pending work, rejects later messages and releases listeners and timers.

The host checks action ID, descriptor revision, expected view revision and input
shape before asking the frame to act. It supplies agent origin itself and refuses
model-supplied actor/confirmation flags. Gesture-required actions remain human
steps. A cached invocation is replayed only for the same request and host scope;
the cache is bounded and mount-local, not durable exactly-once execution.

Human controls and agent actions use the app's own action registry. An old
template that bypasses that registry cannot obtain a parity claim merely because
it renders. Frame-returned results and snapshots are independently validated.
Timeout/cancellation is reported as uncertain completion when the action may
already have run; it is not reported as rollback or automatically retried.

Changing a package does not mutate a mounted instance's descriptor. Replacement
is explicit, validates the new package first, retains the previous package on
failure, and must not discard unsaved work. View restore uses declared resume
parameters scoped to host, principal, content and instance parameters. Business
data stays at its original owner; moving hosts does not merge user identities.

## Completion boundary

Compatibility requires the same source package/template digest to pass in both
hosts: load, declared human and agent actions, state updates, stale/action/input
rejection, view restore, teardown and unavailable-provider behavior. Tests must
also reject forged authority, undeclared tools, changed bundle bytes, different
content IDs, delayed replies after navigation and cross-principal state reuse.

Consumer source pins and real application inputs belong to the private host
workspace. This distribution includes independently implemented shared modules
and synthetic fixtures only; it does not publish a consumer's source snapshots
or company application data.

Production completion additionally requires host API/renderer registration,
the existing HOH release procedure and public readback. Local compatibility
checks alone must not be reported as deployed or as complete company-app import.


## Host integration and delivery

Import the package reader, host and renderer through the package exports and load
`@hoh/ui/content/app-host.css`. The existing shell accepts the renderer as
`renderers: { PACKAGED_APP: extension.render }`; catalog membership and source
bytes must come from the authenticated host, not a URL supplied by the app.

A host with `script-src 'self'` should supply `documentUrl` and serve the generated
app document through its own authorized route. That route must re-read the pinned
bundle, call `createAppDocument(bundle, {channel})`, apply the app CSP plus
`frame-ancestors 'self'; sandbox allow-scripts`, and reject changed digests and
unavailable packages. Do not relax the main page's CSP to execute app scripts.
The default `srcdoc` path is useful only where the parent policy permits it.

`documentUrl` is a trusted host binding, not an arbitrary app-controlled URL. The
host owns endpoint authorization and delivery of the verified document. Read-tool
providers must keep enforcing authorization at the server even though the browser
host also checks its tool allowlist.

The source package version, descriptor revision, runtime SDK version and bundle
hash remain separate. A consumer can vendor only this runtime, preserving relative
imports and leaving its existing shell untouched:

```sh
node scripts/export-packaged-runtime.mjs --revision COMMIT --target VERSIONED_DIRECTORY --write
node scripts/export-packaged-runtime.mjs --revision COMMIT --target VERSIONED_DIRECTORY --check
```

The exporter reads committed Git objects, records exact hashes and refuses to
replace a different existing export. A host pins the resulting runtime manifest;
there is no startup download or implicit dependency on a sibling checkout.

Local example: `npm run preview:packaged -- --port 8023`. `?strict=1` exercises
same-origin document delivery with the production main-page CSP. Chat in this
example is explicitly deterministic and view restore is in memory.

The optional MM comparison uses `--mm-reference DIRECTORY`. That directory needs
`reference.json` with a repository, exact `commit` and `{path,sha256}` file entries
for the selected host/kit and app inputs. The fixture server verifies every input
before serving it and binds to loopback. Consumer source bytes are never bundled
with this distribution. Run `scripts/verify-app-interoperability.py --help` for
explicit Node, browser, reference and output locations.


## Verified scope — 2026-10-29

The public Interface suite passes 48 unit/regression checks (11 package checks),
and the exported TypeScript contracts pass strict checking. Browser validation
passes 43 checks across the pinned MM reference host, that host using the shared
kit, and the actual HOH shell using the new package renderer. The same source
package/template digests are used in all paths. This covers two selected consumer
apps, a consumer playback fixture and the portable synthetic board.

Observed: direct controls and deterministic chat invoke the same view actions;
changed hashes/identities, stale state/mounts, forged authority and undeclared tools
are rejected; replay does not repeat a view write; revoked access blocks reads
and cached replay; declared view restore works; pending invocation at teardown
reports uncertain completion. Desktop/phone rendering and same-origin document
delivery under the current production script/style CSP were checked in Chromium.

These checks use private reference inputs and isolated loopback servers. They do
not exercise a live model, a company service's business writes, persistent account
state or a production deployment. The host integrations and their release/readback
remain separate acceptance work.
