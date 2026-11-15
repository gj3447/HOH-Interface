# Office document host

The public host accepts injected authenticated transport only. It contains no API URL, credential, account lookup, persistence implementation or private study bytes. The host retains drafts on conflict/offline and rejects late epoch/document responses. Tiptap 3.33.1 hydration is a host-supplied boundary; strict restore must not auto-save.

validateDocumentSnapshot is DOM-free and can be pinned by the private consumer. Server OfficeDocument.digest remains the existing full ContentPlatform RevisionBody digest; this package never derives or compares it from the Office body. Any client stable JSON comparison is draft/request equality only. A consumer must bundle exact Tiptap 3.33.1 and its StarterKit subset from pinned local dependencies, include its third-party notice, and never load an editor from a CDN.

Consumers import mountOfficeDocuments from @hoh/ui/office/documents, createTiptap from @hoh/ui/office/tiptap, validateDocumentSnapshot from @hoh/ui/office/contracts, and the stylesheet from @hoh/ui/office/styles.css.

The transport supplies authenticated session, create, list, open, save and onSessionChange. The mount result exposes observe and invokeOffice only to a trusted injected consumer; this does not enable a Chat model tool. Session change clears visible account state. Unsaved drafts remain in memory and are not guest data; there is no automatic guest-to-account migration.

The supported body is hoh/office-document@1 with editorKind document, schemaVersion 1, and the pinned StarterKit subset: paragraphs, headings, lists, blockquotes, code blocks, horizontal rules, hard breaks, text, and bold/italic/underline/strike/code marks. Unsupported nodes, attributes and links are rejected before restore; restore never auto-saves.
