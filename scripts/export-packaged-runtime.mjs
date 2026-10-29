import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), value = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const usage = 'Usage: node scripts/export-packaged-runtime.mjs --revision COMMIT --target DIRECTORY --write|--check\nExports exact committed runtime bytes only. Use a new versioned target directory; an existing identical export is idempotent.';
if (args.includes('--help')) { console.log(usage); process.exit(0); }
const revision = value('--revision'), targetArg = value('--target'), write = args.includes('--write');
if (!/^[a-f0-9]{40}$/.test(revision || '') || !targetArg || write === args.includes('--check') || args.length !== 5) throw new Error(usage);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), target = resolve(targetArg);
const sources = ['protocol/app-package.js', 'protocol/app-package.d.ts', 'ui/app-content-host.js', 'ui/app-content-host.d.ts', 'ui/app-content-host.css', 'ui/app-content-kit.js', 'adapters/packaged-content.js', 'LICENSE', 'NOTICE'];
const blob = path => execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, maxBuffer: 4 * 1048576 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pkg = JSON.parse(blob('package.json'));
const files = sources.map(path => { const bytes = blob(path); return { path, bytes, sha256: hash(bytes) }; });
const manifest = { schema: 'hoh/packaged-runtime@1', repository: 'https://github.com/gj3447/HOH-Interface', revision,
  package: pkg.name, version: pkg.version, license: pkg.license, profile: 'urn:hoh:profile:mm-published-app:1',
  files: files.map(({ path, bytes, sha256 }) => ({ path, bytes: bytes.byteLength, sha256 })) };
files.push({ path: 'runtime.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
let entries;
try { entries = await readdir(target); } catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
if (write && entries.length === 0) {
  await mkdir(target, { recursive: true });
  for (const file of files) { const out = resolve(target, file.path); await mkdir(dirname(out), { recursive: true }); await writeFile(out, file.bytes, { flag: 'wx' }); }
}
const expectedPaths = new Set(files.flatMap(file => {
  const segments = file.path.split('/'); return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}));
async function inspect(relative = '') {
  for (const name of await readdir(resolve(target, relative))) {
    const path = relative ? `${relative}/${name}` : name;
    if (!expectedPaths.has(path)) throw new Error(`Unexpected file in runtime export: ${path}`);
    const stat = await lstat(resolve(target, path));
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported export entry: ${path}`);
    if (stat.isDirectory()) await inspect(path);
  }
}
await inspect();
const mismatches = [];
for (const file of files) {
  try { if (!(await readFile(resolve(target, file.path))).equals(file.bytes)) mismatches.push(file.path); }
  catch { mismatches.push(file.path); }
}
if (mismatches.length) throw new Error(`Runtime export differs; preserve the existing target and choose a new directory: ${mismatches.join(', ')}`);
console.log(JSON.stringify({ status: 'MATCH', revision, version: pkg.version, files: files.length }));
