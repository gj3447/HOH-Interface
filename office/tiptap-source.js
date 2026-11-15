import { Editor } from "@tiptap/core"
import { StarterKit } from "@tiptap/starter-kit"
import { validateDocumentSnapshot } from "./contracts.js"
export const TIPTAP_VERSION = "3.33.1"
export const TIPTAP_SUPPORTED_NODES = Object.freeze(["doc", "paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "hardBreak", "horizontalRule", "text"])
export const createTiptap = ({ element, content, onUpdate, onSelectionUpdate, onContentError }) => new Editor({
  element,
  extensions: [StarterKit.configure({ link: false })],
  content: validateDocumentSnapshot(content),
  enableContentCheck: true,
  onUpdate,
  onSelectionUpdate,
  onContentError: event => {
    onContentError?.(event)
    throw event.error
  },
})
