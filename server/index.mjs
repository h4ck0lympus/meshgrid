import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { GridEngine } from './engine.mjs';
import { HttpError } from './validation.mjs';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let raw = ''; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new HttpError(413, 'Request body exceeds 32 KB.');
    raw += chunk.toString();
  }
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected object');
    return parsed;
  } catch { throw new HttpError(400, 'Request body must be a JSON object.'); }
}
export function createGridServer({ engine = new GridEngine({ mode: process.env.SCHEDULER_MODE === 'openai' ? 'openai' : 'simulation' }), host = '127.0.0.1', autoTick = true } = {}) {
  const clients = new Set();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      // Local demo only: origin checks and host allowlist reduce browser-driven local API abuse.
      const allowed = new Set(['127.0.0.1', 'localhost', '[::1]', host]);
      if (!allowed.has(url.hostname)) throw new HttpError(403, 'Unrecognized host. This control plane is a local demo.');
      if (req.headers.origin && req.headers.origin !== url.origin) throw new HttpError(403, 'Cross-origin requests are not allowed.');
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, engine.snapshot());
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, name: 'Meshwork', simulation: true });
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (clients.size >= 24) throw new HttpError(429, 'Too many live connections.');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`retry: 1200\ndata: ${JSON.stringify(engine.snapshot())}\n\n`); clients.add(res);
        req.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        res.setHeader('Content-Disposition', 'attachment; filename="meshwork-audit.json"');
        return json(res, 200, { exportedAt: new Date().toISOString(), ...engine.snapshot() });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Use Content-Type: application/json.');
        const input = await body(req);
        if (url.pathname === '/api/providers') {
          if (input.source !== undefined && !['agent', 'simulation'].includes(input.source)) throw new HttpError(400, 'source must be agent or simulation.');
          return json(res, 201, engine.register(input, input.source ?? 'simulation'));
        }
        const action = url.pathname.match(/^\/api\/providers\/([^/]+)\/(offline|online|degrade|heartbeat|challenge|verify)$/);
        if (action) {
          const [, id, verb] = action;
          const token = req.headers.authorization?.replace(/^Bearer /, '');
          if (verb === 'challenge') return json(res, 200, { challenge: engine.issueChallenge(id, token) });
          if (verb === 'verify') return json(res, 200, { verification: await engine.verifyChallenge(id, token, input) });
          if (verb === 'heartbeat') return json(res, 200, engine.heartbeat(id, req.headers.authorization?.replace(/^Bearer /, ''), input.telemetry));
          if (verb === 'offline') engine.kill(id);
          if (verb === 'online') engine.revive(id);
          if (verb === 'degrade') engine.degrade(id);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/workloads') return json(res, 201, { job: engine.submit(input) });
        if (url.pathname === '/api/workload/stop') { engine.stop(); return json(res, 200, { ok: true }); }
        if (url.pathname === '/api/workload/retry') { engine.retry(); return json(res, 200, { ok: true }); }
        if (url.pathname === '/api/compute') return json(res, 200, engine.execute(input.command));
        if (url.pathname === '/api/demo/start') { engine.startDemo(); return json(res, 200, { ok: true }); }
        if (url.pathname === '/api/demo/reset') { engine.reset(); return json(res, 200, { ok: true }); }
        throw new HttpError(404, 'API route not found.');
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filePath = resolve(publicRoot, `.${requestPath}`);
      if (!filePath.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep) || !types[extname(filePath)]) throw new HttpError(404, 'Asset not found.');
      let content;
      try { content = await readFile(filePath); } catch { throw new HttpError(404, 'Asset not found.'); }
      res.writeHead(200, { 'Content-Type': types[extname(filePath)], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : 'Unexpected control-plane error. See the server console.' });
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  const broadcast = state => {
    const message = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 512_000 || client.destroyed) { client.destroy(); clients.delete(client); }
      else client.write(message);
    }
  };
  engine.on('change', broadcast);
  const timer = autoTick ? setInterval(() => { try { engine.tick(); } catch (e) { console.error('Engine tick failed:', e); } }, 250) : null;
  return { server, engine, async close() {
    clearInterval(timer); engine.off('change', broadcast);
    for (const client of clients) client.end();
    clients.clear(); server.closeAllConnections();
    if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
  } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync('.env')) {
    if (typeof process.loadEnvFile !== 'function') throw new Error('Use Node 22 to load .env, or configure environment variables in your shell.');
    process.loadEnvFile();
  }
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
  const app = createGridServer({ host });
  app.server.on('error', error => { console.error(`Cannot start Meshwork: ${error.message}`); process.exit(1); });
  app.server.listen(port, host, () => {
    console.log(`\n  ✦ MESHWORK\n  http://${host}:${app.server.address().port}\n\n  Runtime: simulation · Accounting: demo only\n  Scheduler: ${app.engine.mode}\n  No dependencies. No Docker. No payment credentials.\n`);
    if (host !== '127.0.0.1' && host !== 'localhost') console.warn('Warning: local hackathon service, not hardened for public internet exposure.');
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
