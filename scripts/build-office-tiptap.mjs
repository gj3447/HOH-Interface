import { build } from "esbuild"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
const output = new URL("../office/tiptap.js", import.meta.url)
await build({ entryPoints: [new URL("../office/tiptap-source.js", import.meta.url).pathname], outfile: output.pathname, bundle: true, format: "esm", platform: "browser", target: "es2022", legalComments: "inline", external: ["./contracts.js"] })
const bytes = await readFile(output)
const digest = createHash("sha256").update(bytes).digest("hex")
await writeFile(new URL("../office/tiptap.bundle.json", import.meta.url), JSON.stringify({ schema: "hoh/office-tiptap-bundle@1", source: "office/tiptap-source.js", digest, bytes: bytes.length, packages: { "@tiptap/core": "3.33.1", "@tiptap/starter-kit": "3.33.1", esbuild: "0.25.11" } }) + "\n")
console.log(JSON.stringify({ digest, bytes: bytes.length }))
