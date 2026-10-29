import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readMmBundle } from '../protocol/app-package.js';
import { APP_DOCUMENT_CSP, createAppDocument } from '../ui/app-content-host.js';
import { appContentKitSource } from '../ui/app-content-kit.js';

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (args.includes('--help')) {
  console.log('Usage: node scripts/serve-packaged-content.mjs [--port PORT] [--mm-reference DIRECTORY]\nLoopback-only fixture host. MM reference must contain pinned web/app-host.js, web/apps/kit.js and selected package sources. No model or production service is called.');
  process.exit(0);
}
export async function startPackagedPreview({ port = 0, reference = null } = {}) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), bundles = new Map();
  const hash = value => createHash('sha256').update(value).digest('hex');
  async function add(directory, source) {
    const pkg = JSON.parse(await readFile(resolve(directory, 'content.json'), 'utf8')), template = await readFile(resolve(directory, 'app.html'), 'utf8');
    const bytes = JSON.stringify({ schema: 'mm.content-bundle/v1', source, package: pkg, template, templateSha256: hash(template) });
    const digest = hash(bytes), verified = await readMmBundle(bytes, { expectedDigest: digest, allowFixture: true });
    bundles.set(pkg.name, { bytes, digest, verified });
  }
  await add(resolve(root, 'test/fixtures/packaged-app'), { repository: 'interop-fixture', revision: '1'.repeat(40), dir: 'test/fixtures/packaged-app', fixture: true });
  try { await add(resolve(root, 'apps/counter'), { repository: 'fixture:counter-working-copy', revision: '1'.repeat(40), dir: 'apps/counter', fixture: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let mmKit = null, mmHost = null;
  if (reference) {
    reference = await realpath(reference);
    const pin = JSON.parse(await readFile(resolve(reference, 'reference.json'), 'utf8'));
    if (typeof pin.repository !== 'string' || !/^[a-f0-9]{40}$/.test(pin.commit) || !Array.isArray(pin.files)) throw new Error('MM reference needs its exact private source pin.');
    const inputs = ['web/app-host.js', 'web/apps/kit.js', ...['tests/fixtures/playback-demo', 'contents/org', 'contents/phone-workspace'].flatMap(p => [`${p}/content.json`, `${p}/app.html`])];
    for (const path of inputs) {
      const declared = pin.files.find(f => f.path === path);
      if (!declared || hash(await readFile(resolve(reference, path))) !== declared.sha256) throw new Error(`MM reference bytes changed: ${path}`);
    }
    mmKit = await readFile(resolve(reference, 'web/apps/kit.js'), 'utf8'); mmHost = await readFile(resolve(reference, 'web/app-host.js'));
    for (const path of ['tests/fixtures/playback-demo', 'contents/org', 'contents/phone-workspace']) {
      await add(resolve(reference, path), { repository: pin.repository, revision: pin.commit, dir: path, fixture: true });
    }
  }
  const server = createServer(async (request, response) => {
    const send = (status, type, body, more = {}) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...more }); response.end(body); };
    try {
      const expected = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== expected || request.method !== 'GET') return send(403, 'text/plain', 'Forbidden');
      const url = new URL(request.url, `http://${expected}`), path = url.pathname;
      if (path === '/interop/catalog') return send(200, 'application/json', JSON.stringify({ items: [...bundles].map(([name, b]) => ({ name, title: b.verified.package.title, digest: b.digest, templateSha256: b.verified.templateSha256, contentId: b.verified.package.content.id, descriptorRevision: b.verified.package.content.revision })) }));
      if (path.startsWith('/interop/bundles/')) { const b = bundles.get(path.slice('/interop/bundles/'.length)); return b ? send(200, 'application/json', b.bytes) : send(404, 'text/plain', 'Not found'); }
      if (path.startsWith('/interop/document/')) {
        const b = bundles.get(path.slice('/interop/document/'.length)), channel = url.searchParams.get('channel');
        if (!b || url.searchParams.get('bundle') !== b.digest || !/^[a-f0-9-]{36}$/.test(channel || '')) return send(409, 'text/plain', 'Package or channel changed');
        return send(200, 'text/html; charset=utf-8', createAppDocument(b.verified, { channel }), { 'Content-Security-Policy': `${APP_DOCUMENT_CSP}; frame-ancestors 'self'; sandbox allow-scripts` });
      }
      if (path === '/reference/app-host.js' && mmHost) return send(200, 'text/javascript', mmHost);
      if (path.startsWith('/apps/') && mmKit) {
        const b = bundles.get(path.slice('/apps/'.length));
        if (!b || url.searchParams.get('bundle') !== b.digest) return send(409, 'text/plain', 'Package changed');
        const kit = url.searchParams.get('kit') === 'shared' ? appContentKitSource({ content: b.verified.package.content }) : mmKit;
        return send(200, 'text/html; charset=utf-8', b.verified.template.replace('<!-- ailab-app-kit -->', `<script>${kit}</script>`), { 'Content-Security-Policy': `${APP_DOCUMENT_CSP}; frame-ancestors 'self'; sandbox allow-scripts` });
      }
      const relative = path === '/' ? 'examples/packaged/index.html' : path.slice(1);
      if (!/^(ui|protocol|adapters|examples\/packaged)\/[A-Za-z0-9/_-]+\.(js|mjs|css|html|json)$/.test(relative) || relative.includes('..')) return send(404, 'text/plain', 'Not found');
      const file = await realpath(resolve(root, relative)); if (!file.startsWith(root + sep)) return send(403, 'text/plain', 'Forbidden');
      const type = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json' }[extname(file)];
      const policy = path === '/' && url.searchParams.get('strict') === '1'
        ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'self'" } : {};
      send(200, type, await readFile(file), policy);
    } catch (error) { send(error.code === 'ENOENT' ? 404 : 500, 'text/plain', 'Fixture request failed'); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  return { server, url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(resolve => server.close(resolve)) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = await startPackagedPreview({ port: Number(option('--port') || 0), reference: option('--mm-reference') });
  console.log(JSON.stringify({ url: preview.url, mode: 'fixture-only', reference: Boolean(option('--mm-reference')) }));
  process.on('SIGINT', async () => { await preview.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await preview.close(); process.exit(0); });
}
