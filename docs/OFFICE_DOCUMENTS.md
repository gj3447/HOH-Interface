# Office document host

The public host accepts injected authenticated transport only. It contains no API URL, credential, account lookup, persistence implementation or private study bytes. The host retains drafts on conflict/offline and rejects late epoch/document responses. Tiptap 3.33.1 hydration is a host-supplied boundary; strict restore must not auto-save.

validateDocumentSnapshot is DOM-free and can be pinned by the private consumer. Server OfficeDocument.digest remains the existing full ContentPlatform RevisionBody digest; this package never derives or compares it from the Office body. Any client stable JSON comparison is draft/request equality only. A consumer must bundle exact Tiptap 3.33.1 and its StarterKit subset from pinned local dependencies, include its third-party notice, and never load an editor from a CDN.
