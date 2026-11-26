// Express app: REST tools, openapi.json, a stateless MCP endpoint, and Dan's inbox.
// Vercel runs this file as the server; scripts/dev.ts listens locally.
import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOLS, toolByName, ToolError, type Ctx } from './tools.js';
import { MemoryStore, NeonStore, type MessageStore, type NeonSql } from './messages.js';
import { findBannedClaims, allStrings } from './banned.js';
import { openapi } from './openapi.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createApp(opts: { store?: MessageStore; baseUrl?: string } = {}) {
  const store = opts.store ?? defaultStore();
  const baseUrl = (opts.baseUrl ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const allowed = new Set((process.env.ALLOWED_ORIGINS ?? 'https://dan-stoner-cv-site.vercel.app,http://localhost:3000').split(',').map(s => s.trim()));
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '32kb' }));

  // CORS: only the CV site (and local dev) call this from a browser. Agentplace and MCP clients call server-side.
  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && allowed.has(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-session-id, mcp-protocol-version'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); }
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });
  app.use(rateLimit(60, 60_000));

  const ctxOf = (req: Request): Ctx => ({ ip: clientIp(req), store, baseUrl });

  async function runTool(name: string, args: unknown, ctx: Ctx) {
    const t = toolByName.get(name);
    if (!t) throw new ToolError(404, 'unknown_tool', `No tool called '${name}'.`, { tools: TOOLS.map(x => x.name) });
    const parsed = t.input.safeParse(args ?? {});
    if (!parsed.success) throw new ToolError(400, 'invalid_input', 'Missing or invalid parameters.', { issues: z.treeifyError(parsed.error) });
    const result = await t.run(parsed.data, ctx);
    guard(name, result);
    return result;
  }

  // ---------------- REST
  app.get('/api/health', (_req, res) => { res.json({ ok: true, tools: TOOLS.length, store: store.constructor.name }); });
  app.get('/openapi.json', (_req, res) => { res.json(openapi(baseUrl)); });
  app.get('/api/tools', (_req, res) => { res.json({ tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description })) }); });
  const handle = (args: (req: Request) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
    try { res.json(await runTool(String(req.params.name), args(req), ctxOf(req))); } catch (e) { next(e); }
  };
  app.post('/api/tools/:name', handle(req => req.body));
  app.get('/api/tools/:name', (req, res, next) => {
    const t = toolByName.get(String(req.params.name));
    if (t && !t.readOnly) return void res.status(405).json({ error: 'use_post', message: 'This tool changes data. Use POST.' });
    return handle(r => r.query)(req, res, next);
  });

  // ---------------- MCP (Streamable HTTP, stateless: a fresh server per request)
  app.post('/mcp', async (req, res) => {
    const server = new McpServer({ name: 'agent-dan-facts', version: '0.1.0' });
    const ctx = ctxOf(req);
    for (const t of TOOLS) {
      server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input.shape, annotations: { readOnlyHint: t.readOnly, openWorldHint: false } },
        async (args: unknown) => {
          try {
            const r = await runTool(t.name, args, ctx);
            return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], structuredContent: r as Record<string, unknown> };
          } catch (e) {
            const err = e instanceof ToolError ? { error: e.code, message: e.message, ...e.extra } : { error: 'internal', message: 'Something went wrong. Try again.' };
            if (!(e instanceof ToolError)) console.error('mcp tool error', t.name, e);
            return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(err) }] };
          }
        });
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (e) { console.error('mcp error', e); if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }); }
  });
  app.all('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This server is stateless: POST only.' }, id: null }); });

  // ---------------- Dan's inbox (bearer token, Dan only)
  const inboxAuth = (req: Request, res: Response, next: NextFunction) => {
    const want = process.env.INBOX_TOKEN;
    const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!want || want.length < 24) return void res.status(503).json({ error: 'inbox_not_configured' });
    const a = Buffer.from(got), b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return void res.status(401).json({ error: 'unauthorised' });
    next();
  };
  app.get('/api/inbox', inboxAuth, async (_req, res, next) => { try { res.json({ messages: await store.list(200) }); } catch (e) { next(e); } });
  app.post('/api/inbox/:ref/read', inboxAuth, async (req, res, next) => {
    try { (await store.markRead(String(req.params.ref))) ? res.json({ ok: true }) : res.status(404).json({ error: 'not_found' }); } catch (e) { next(e); }
  });

  app.use(express.static(join(ROOT, 'public'), { extensions: ['html'] }));
  app.use((_req, res) => { res.status(404).json({ error: 'not_found' }); });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ToolError) return void res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    if ((err as { type?: string })?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid_json' });
    console.error('unhandled', err);
    res.status(500).json({ error: 'internal', message: 'Something went wrong. Try again.' });
  });
  return app;
}

/** Last line of defence: a response that would make a banned claim is refused, loudly, instead of served. */
function guard(tool: string, result: unknown) {
  const hits = allStrings(result).flatMap(findBannedClaims);
  if (hits.length) {
    console.error('BANNED CLAIM BLOCKED', tool, hits);
    throw new ToolError(500, 'blocked_claim', 'This answer was blocked by a content check. Ask Dan directly.');
  }
}

function defaultStore(): MessageStore {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.VERCEL_ENV === 'production') throw new Error('DATABASE_URL must be set in production: messages would be lost');
    return new MemoryStore();
  }
  // Imported lazily so tests and local dev never need the driver or a network.
  let sql: Promise<NeonSql> | null = null;
  return new NeonStore(() => (sql ??= import('@neondatabase/serverless').then(m => m.neon(url) as unknown as NeonSql)));
}

/**
 * The visitor's IP, from a source the visitor cannot write. On Vercel the platform sets x-real-ip and
 * x-vercel-forwarded-for itself; the leftmost x-forwarded-for entry is client-controlled, so it is never used.
 * Off Vercel (local dev, tests) x-real-ip is honoured so tests can simulate visitors.
 */
export function clientIp(req: Request) {
  const fromPlatform = String(req.headers['x-vercel-forwarded-for'] ?? '').split(',')[0].trim() || String(req.headers['x-real-ip'] ?? '').trim();
  return fromPlatform || req.socket.remoteAddress || 'unknown';
}

function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>(); // per instance: a soft limit; send_message also has a database-backed limit
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/health') return next();
    const ip = clientIp(req), now = Date.now();
    const list = (hits.get(ip) ?? []).filter(t => t > now - windowMs);
    list.push(now); hits.delete(ip); hits.set(ip, list); // re-insert: Map order is least-recently-seen first
    if (hits.size > 5000) for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k); // evict the oldest, never everyone
    if (list.length > max) return void res.status(429).set('Retry-After', String(Math.ceil(windowMs / 1000))).json({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' });
    next();
  };
}

export default createApp();
