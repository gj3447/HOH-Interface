# Content contract conformance

Draft 0.1 has a local reference suite, not an independent certification program.
The contract is [CONTENT_CONTRACT.md](CONTENT_CONTRACT.md); implementation notes
and optional adapter proposals do not override its requirements.
The latest local [verification record](../provenance/verification-content-0.1.json)
identifies the exercised checks and the boundaries of that evidence.

From the repository root:

```sh
npm ci
npm test
npm run check:semantic
uv run --no-project --with-requirements scripts/requirements-semantic.txt python scripts/validate-semantic-standards.py
```

The Node suite checks positive and rejected runtime operations, JSON Schema
2020-12, compiled-validator agreement, human/agent races, confirmations and the
MCP payload mapping. The Python command parses real JSON-LD/RDF, executes SHACL
with RDFS inference, verifies competency-query subjects and tests a negative
graph fixture. It does not fetch remote JSON-LD contexts. Its dependencies may
be installed on first use; `--offline` can be added when already cached.

Rendered verification uses a running local preview and explicitly selected tools:

```sh
npm run preview -- --port 8022
npm run test:semantic:browser -- \
  --playwright-module /path/to/playwright-core \
  --browser-executable /path/to/chromium \
  --url http://127.0.0.1:8022/semantic/ \
  --output /tmp/hoh-semantic-browser
```

The browser suite edits the board directly and through chat, checks origin
receipts, exercises cancel/confirm/stale proposals and navigation cancellation,
and checks keyboard operation and mobile reflow. Its planner is deterministic.
Passing it says nothing about a model's reasoning quality, deployed HSWM,
cross-device synchronization or a network MCP server.

An implementation claiming compatibility must publish:

1. protocol/profile version and descriptor/schema revision;
2. implementation source revision and the exact test-suite revision;
3. supported operations and external-effect/gesture boundaries;
4. positive and negative fixture results, with skipped checks identified;
5. authority, storage, retry, cancellation and subscription behavior.

The supplied board is a local interactive-core example. The in-process MCP
mapping is tested as a payload mapping only. Legacy adapters, a real LLM planner,
MCP transports/Apps, HSWM execution and durable distributed storage require their
own interoperability evidence. Accessibility testing here is limited rendered
verification; full WCAG or real-user assistive-technology conformance is not claimed.
