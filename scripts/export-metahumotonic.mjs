import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assets } from './assets.mjs';

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--target' || !['--check', '--write'].includes(args[2])) {
  throw new Error('Usage: node scripts/export-metahumotonic.mjs --target TARGET --check|--write');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(args[1]);
const pkg = JSON.parse(await readFile(resolve(target, 'ts/package.json'), 'utf8'));
if (pkg.name !== 'metahumotonic-web-back-ts') throw new Error('Target is not the expected reference host');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const files = await Promise.all(Object.entries(assets).map(async ([source, name]) => {
  const bytes = await readFile(resolve(root, source));
  return { source, path: `ts/static/program-feed/${name}`, sha256: digest(bytes), bytes };
}));
const license = await readFile(resolve(root, 'LICENSE'));
files.push({ source: 'LICENSE', path: 'ts/vendor/hoh-ui-LICENSE', sha256: digest(license), bytes: license });
const notice = await readFile(resolve(root, 'NOTICE'));
files.push({ source: 'NOTICE', path: 'ts/vendor/hoh-ui-NOTICE', sha256: digest(notice), bytes: notice });
const uiPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const manifest = {
  schema: 'hoh/vendored-ui@1', repositoryId: 'repository:hoh', package: uiPackage.name, version: uiPackage.version,
  license: 'AGPL-3.0-only', mode: 'EXPLICIT_COPY_NO_RUNTIME_SIBLING_IMPORT',
  files: files.map(({ bytes, ...file }) => file)
};
files.push({ path: 'ts/vendor/hoh-ui-source.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
if (args[2] === '--write') {
  for (const file of files) {
    const path = resolve(target, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
  }
}
const mismatches = [];
for (const file of files) {
  try { if (!(await readFile(resolve(target, file.path))).equals(file.bytes)) mismatches.push(file.path); }
  catch { mismatches.push(file.path); }
}
if (mismatches.length) throw new Error(`HOH asset drift: ${mismatches.join(', ')}`);
console.log(JSON.stringify({ mode: args[2], verifiedFiles: files.length, status: 'MATCH' }));
