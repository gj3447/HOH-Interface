import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assets } from './assets.mjs';

const args = process.argv.slice(2), options = new Map();
if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !['--backend', '--port'].includes(arg))) {
  throw new Error('Usage: node scripts/preview.mjs [--port 8020] [--backend http://127.0.0.1:8018]');
}
for (let i = 0; i < args.length; i += 2) options.set(args[i], args[i + 1]);
const port = Number(options.get('--port') ?? 8020);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
const backend = options.has('--backend') ? new URL(options.get('--backend')) : null;
if (backend && (backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1' || backend.pathname !== '/' || backend.search || backend.hash || backend.username || backend.password)) {
  throw new Error('Preview backend must be an explicitly selected http://127.0.0.1:PORT origin');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const routes = new Map(Object.entries(assets).map(([source, name]) => [`/feed/${name}`, source]));
routes.set('/feed/', 'examples/metahumotonic/index.html');
routes.set('/realtime/', 'examples/realtime/index.html');
routes.set('/realtime/app.js', 'examples/realtime/app.js');
routes.set('/realtime/local-webrtc.js', 'adapters/local-webrtc.js');
routes.set('/semantic/', 'examples/semantic/index.html');
routes.set('/host/', 'examples/host-contract/index.html');
routes.set('/host/app.js', 'examples/host-contract/app.js');
for (const file of ['app.js', 'model.js', 'validators.js', 'style.css', 'board.json']) routes.set(`/semantic/${file}`, `examples/semantic/${file}`);
for (const file of ['runtime.js', 'agent-session.js', 'mcp-mapping.js', 'outcome.schema.json']) routes.set(`/protocol/${file}`, `protocol/${file}`);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json' };
const unavailable = response => { response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ reason: 'HOH 미리보기 백엔드가 연결되지 않았습니다.' })); };
const server = createServer(async (request, response) => {
  try {
    const expectedHost = `127.0.0.1:${port}`;
    if (request.headers.host !== expectedHost) { response.writeHead(403); response.end(); return; }
    const url = new URL(request.url, `http://${expectedHost}`);
    if (url.pathname.startsWith('/api/program-feed/v1/')) {
      if (!backend) return unavailable(response);
      if (request.headers.origin && request.headers.origin !== `http://${expectedHost}` || request.headers['sec-fetch-site'] === 'cross-site') { response.writeHead(403); response.end(); return; }
      const upstream = httpRequest(new URL(url.pathname + url.search, backend), { method: request.method,
        // Keep the selected preview Host/Origin paired for the host's existing CSRF check.
        headers: request.headers, timeout: 10_000 }, incoming => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!response.headersSent) unavailable(response); else response.destroy(); });
      request.on('aborted', () => upstream.destroy());
      request.pipe(upstream); return;
    }
    if (url.pathname === '/' || ['/feed', '/realtime', '/semantic', '/host'].includes(url.pathname)) { response.writeHead(302, { Location: url.pathname === '/' ? '/feed/' : url.pathname + '/' }); response.end(); return; }
    const source = routes.get(url.pathname);
    if (!source || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
    const bytes = await readFile(resolve(root, source));
    response.writeHead(200, { 'Content-Type': types[source.split('.').at(-1)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(bytes);
  } catch { if (!response.headersSent) unavailable(response); else response.destroy(); }
});
server.listen(port, '127.0.0.1', () => console.log(`HOH Interface: http://127.0.0.1:${port}/feed/ (${backend ? 'explicit local reference backend' : 'backend not connected'}); realtime example: http://127.0.0.1:${port}/realtime/`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
