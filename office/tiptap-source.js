import { Editor } from "@tiptap/core"
import { StarterKit } from "@tiptap/starter-kit"
import { validateDocumentSnapshot } from "./contracts.js"
export const TIPTAP_VERSION = "3.33.1"
export const TIPTAP_SUPPORTED_NODES = Object.freeze(["doc", "paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "hardBreak", "horizontalRule", "text"])
export const createTiptap = ({ element, content, onUpdate }) => new Editor({ element, extensions: [StarterKit], content: validateDocumentSnapshot(content), onUpdate })
