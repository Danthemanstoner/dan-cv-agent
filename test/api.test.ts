import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.CONFIRM_SECRET = 'test-secret-0123456789abcdef0123456789';
process.env.INBOX_TOKEN = 'test-inbox-token-0123456789abcdef';

const { createApp } = await import('../src/app.js');
const { MemoryStore, signDraft } = await import('../src/messages.js');
const { TOOLS, toolByName } = await import('../src/tools.js');
const { rawFacts, verifiedFacts } = await import('../src/data.js');
const { findBannedClaims, bannedTopics, allStrings } = await import('../src/banned.js');

let store: InstanceType<typeof MemoryStore>;
// One listening server per test. (Passing the bare app to supertest opens and closes a server per request,
// and with ~40 quick requests that intermittently gave 'socket hang up' and stray responses.)
let app: Server;
beforeEach(async () => {
  store = new MemoryStore();
  app = createApp({ store, baseUrl: 'https://api.test' }).listen(0, '127.0.0.1');
  await new Promise(r => app.once('listening', r));
});
afterEach(() => new Promise<void>(r => { app.closeAllConnections?.(); app.close(() => r()); }));
const call = (name: string, body: unknown = {}, ip = '203.0.113.1') =>
  request(app).post(`/api/tools/${name}`).set('x-real-ip', ip).send(body as object);

// Valid input for every tool, so every response can be scanned.
const SAMPLE: Record<string, unknown> = {
  get_project: { slug: 'basketeer-ops' }, search_facts: { query: 'webhook' },
  draft_message: { name: 'Nikita', reply_to: 'n@example.com', message: 'Hello Dan' },
  quiz_question: { number: 1 }, quiz_answer: { number: 1, choice: 2 },
  incident_case: { number: 1 }, incident_solve: { number: 1, choice: 2 },
};
async function everyResponse() {
  const out: unknown[] = [];
  for (const t of TOOLS) {
    if (t.name === 'send_message') continue;
    const r = await call(t.name, SAMPLE[t.name] ?? {});
    expect(r.status, t.name).toBe(200);
    out.push(r.body);
  }
  for (const p of rawFacts.projects) out.push((await call('get_project', { slug: p.slug })).body);
  for (let n = 1; n <= 5; n++) for (const tool of ['quiz_question', 'quiz_answer']) out.push((await call(tool, { number: n, choice: 1 })).body);
  for (let n = 1; n <= 3; n++) for (const tool of ['incident_case', 'incident_solve']) out.push((await call(tool, { number: n, choice: 1 })).body);
  return out;
}

describe('normal requests', () => {
  it('health', async () => {
    const r = await request(app).get('/api/health');
    expect(r.body).toMatchObject({ ok: true, tools: TOOLS.length });
  });
  it('get_profile gives facts with sources and the iCloud email', async () => {
    const r = await call('get_profile');
    expect(r.status).toBe(200);
    expect(r.body.facts.length).toBeGreaterThan(4);
    expect(JSON.stringify(r.body)).toContain('danieljamesstoner@icloud.com');
    for (const f of r.body.facts) expect(f.source).toBeTruthy();
  });
  it('get_project returns numbers, stack and a showcase card', async () => {
    const r = await call('get_project', { slug: 'basketeer-migration' });
    expect(r.status).toBe(200);
    expect(r.body.numbers).toContainEqual({ value: '30,000+', label: 'customers migrated' });
    expect(r.body.showcase).toMatchObject({ title: 'WooCommerce → Shopify migration', lottie: 'talking' });
  });
  it('GET works for read-only tools', async () => {
    const r = await request(app).get('/api/tools/get_project?slug=peek');
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Peek');
  });
  it('share_cv points at the PDF on this host', async () => {
    expect((await call('share_cv')).body.url).toBe('https://api.test/cv.pdf');
  });
  it('quiz never leaks the answer in the question', async () => {
    const q = (await call('quiz_question', { number: 2 })).body;
    expect(q).not.toHaveProperty('answer');
    const a = (await call('quiz_answer', { number: 2, choice: 3 })).body;
    expect(a).toMatchObject({ correct: true, answer: { choice: 3, text: '30,000+' } });
  });
});

describe('bad requests', () => {
  it('missing parameter → 400 invalid_input', async () => {
    const r = await call('get_project', {});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_input');
  });
  it('unknown project slug → 404 with the known slugs', async () => {
    const r = await call('get_project', { slug: 'hydra' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown_project');
    expect(r.body.known).toContain('basketeer-ops');
  });
  it('unknown tool → 404', async () => {
    expect((await call('delete_everything')).status).toBe(404);
  });
  it('quiz number out of range → 400', async () => {
    expect((await call('quiz_question', { number: 99 })).status).toBe(400);
  });
  it('broken JSON → 400', async () => {
    const r = await request(app).post('/api/tools/get_profile').set('content-type', 'application/json').send('{nope');
    expect(r.status).toBe(400);
  });
  it('unknown facts are reported as unknown, not guessed', async () => {
    const r = await call('search_facts', { query: 'kubernetes' });
    expect(r.body).toMatchObject({ results: [], known: false });
  });
});

describe('truth rules', () => {
  it('no dan-to-confirm fact is ever served', async () => {
    const pending = rawFacts.facts.filter(f => f.confidence !== 'verified');
    expect(pending.length).toBeGreaterThan(0); // the test must have something to catch
    const served = JSON.stringify(await everyResponse());
    for (const f of pending) {
      expect(served, f.id).not.toContain(f.text);
      // Search with the fact's own words: a normal 200 answer that still leaves it out. (A blocked 500 would hide the leak.)
      const r = await call('search_facts', { query: f.text.slice(0, 100) });
      expect(r.status, f.id).toBe(200);
      expect(JSON.stringify(r.body.results), f.id).not.toContain(f.text);
      expect(r.body.results.length, `${f.id}: the search must find related facts, or this test proves nothing`).toBeGreaterThan(0);
    }
  });
  it('no response makes a banned claim', async () => {
    const hits = (await everyResponse()).flatMap(r => allStrings(r).flatMap(findBannedClaims));
    expect(hits).toEqual([]);
  });
  it('every served fact that mentions a banned topic declares what it negates', () => {
    for (const f of verifiedFacts()) {
      const topics = bannedTopics(f.text);
      if (topics.length) expect(f.negates, `${f.id} mentions ${topics.join(',')}`).toBeTruthy();
    }
  });
  it('the detector catches affirmative claims and allows denials', () => {
    const bad = ['Dan is a Shopify Plus expert.', 'Basil generated revenue for Basketeer.', 'He founded Basketeer in 2020.',
      'Dan knows Python well.', 'OpsLayer has 20 paying customers.', 'Dan has a BSc in computing.', 'His rate is $80 per hour.',
      'Dan built the Basketeer OAuth flow.', 'OpsLayer serves 12 merchants.', 'OpsLayer is a registered company.', 'He increased sales by 40% with the redesign.', 'Dan built Shopify Functions for discounts.',
      'He won an award for the storefront.', 'Dan wrote Cloudflare Workers for the edge.'];
    for (const s of bad) expect(findBannedClaims(s).length, s).toBeGreaterThan(0);
    const ok = ['Basketeer is not on Shopify Plus.', "Dan doesn't have a university degree.", 'OpsLayer has no paying customers.',
      'He did not found Basketeer.', "I don't give pay or rates.", 'OpsLayer has a real OAuth install flow.', 'OpsLayer is packaged so other Shopify merchants could run it.'];
    for (const s of ok) expect(findBannedClaims(s), s).toEqual([]);
  });
  it('a response with a banned claim is blocked at runtime, not served', async () => {
    const evil = { ...TOOLS[0], name: 'evil_test_tool', run: () => ({ text: 'Dan is a Shopify Plus expert.' }) };
    TOOLS.push(evil); toolByName.set(evil.name, evil);
    try {
      const r = await call('evil_test_tool');
      expect(r.status).toBe(500);
      expect(r.body.error).toBe('blocked_claim');
      expect(JSON.stringify(r.body)).not.toContain('Shopify Plus');
    } finally { TOOLS.pop(); toolByName.delete(evil.name); }
  });
});

describe('message Dan', () => {
  const draft = { name: 'Nikita', reply_to: 'nikita@example.com', message: 'Loved the agent. Friday?' };
  const auth = { Authorization: `Bearer ${process.env.INBOX_TOKEN}` };
  it('draft saves nothing; send saves exactly the drafted message; Dan sees it in the inbox', async () => {
    const d = await call('draft_message', draft);
    expect(d.body).toMatchObject({ persisted: false, preview: { from: 'Nikita', message: draft.message } });
    expect(store.rows).toHaveLength(0);
    const s = await call('send_message', { confirm_token: d.body.confirm_token });
    expect(s.body).toMatchObject({ sent: true, persisted: true, emailed: false, reference: 'AD-0001' });
    const inbox = await request(app).get('/api/inbox').set(auth);
    expect(inbox.body.messages).toEqual([expect.objectContaining({ ref: 'AD-0001', name: 'Nikita', reply_to: draft.reply_to, message: draft.message, read_at: null })]);
    expect((await request(app).post('/api/inbox/AD-0001/read').set(auth)).status).toBe(200);
    expect((await request(app).get('/api/inbox').set(auth)).body.messages[0].read_at).toBeTruthy();
  });
  it('sending the same token twice saves once', async () => {
    const t = (await call('draft_message', draft)).body.confirm_token;
    await call('send_message', { confirm_token: t });
    const again = await call('send_message', { confirm_token: t });
    expect(again.body).toMatchObject({ already_sent: true, reference: 'AD-0001' });
    expect(store.rows).toHaveLength(1);
  });
  it('a tampered token is refused and saves nothing', async () => {
    const t: string = (await call('draft_message', draft)).body.confirm_token;
    const [p, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), message: 'something else' })).toString('base64url') + '.' + sig;
    const r = await call('send_message', { confirm_token: forged });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('token_bad_signature');
    expect(store.rows).toHaveLength(0);
  });
  it('an expired token is refused', async () => {
    const old = signDraft(draft, Date.now() - 31 * 60 * 1000);
    const r = await call('send_message', { confirm_token: old });
    expect(r.body.error).toBe('token_expired');
  });
  it("a visitor's own words are never blocked by the claims check", async () => {
    const d = await call('draft_message', { ...draft, message: 'Is he a Shopify Plus expert? We pay $80 per hour.' });
    expect(d.status).toBe(200);
    const s = await call('send_message', { confirm_token: d.body.confirm_token });
    expect(s.status).toBe(200);
    expect(store.rows[0].message).toBe('Is he a Shopify Plus expert? We pay $80 per hour.');
  });
  it('a bad email is refused at the draft step', async () => {
    expect((await call('draft_message', { ...draft, reply_to: 'not-an-email' })).status).toBe(400);
  });
  it('limits sends per visitor per hour', async () => {
    for (let i = 0; i < 3; i++) {
      const t = (await call('draft_message', { ...draft, message: `m${i}` }, '198.51.100.7')).body.confirm_token;
      expect((await call('send_message', { confirm_token: t }, '198.51.100.7')).status).toBe(200);
    }
    const t = (await call('draft_message', { ...draft, message: 'm4' }, '198.51.100.7')).body.confirm_token;
    const r = await call('send_message', { confirm_token: t }, '198.51.100.7');
    expect(r.status).toBe(429);
    expect(store.rows).toHaveLength(3);
  });
  it('a faked x-forwarded-for does not get round the limit', async () => {
    const send = async (n: number) => {
      const t = (await request(app).post('/api/tools/draft_message').set({ 'x-real-ip': '198.51.100.9', 'x-forwarded-for': `10.0.0.${n}` }).send({ ...draft, message: `spoof ${n}` })).body.confirm_token;
      return request(app).post('/api/tools/send_message').set({ 'x-real-ip': '198.51.100.9', 'x-forwarded-for': `10.0.0.${n}` }).send({ confirm_token: t });
    };
    const codes = [];
    for (let n = 0; n < 5; n++) codes.push((await send(n)).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(store.rows).toHaveLength(3);
  });
  it('parallel sends cannot beat the limit', async () => {
    const tokens = await Promise.all(Array.from({ length: 8 }, (_, i) => call('draft_message', { ...draft, message: `burst ${i}` }, '198.51.100.20').then(r => r.body.confirm_token)));
    const codes = (await Promise.all(tokens.map(t => call('send_message', { confirm_token: t }, '198.51.100.20')))).map(r => r.status).sort();
    expect(codes).toEqual([200, 200, 200, 429, 429, 429, 429, 429]);
    expect(store.rows).toHaveLength(3);
  });
  it('a cap across all visitors backs up the per-visitor limit', async () => {
    const { SEND_LIMITS } = await import('../src/tools.js');
    let ok = 0, limited = 0;
    for (let i = 0; i < SEND_LIMITS.global + 2; i++) {
      const ip = `192.0.2.${i + 1}`;
      const t = (await call('draft_message', { ...draft, message: `g${i}` }, ip)).body.confirm_token;
      const r = await call('send_message', { confirm_token: t }, ip);
      if (r.status === 200) ok++; else if (r.status === 429) limited++;
    }
    expect([ok, limited]).toEqual([SEND_LIMITS.global, 2]);
  });
  it('send_message cannot be called with GET', async () => {
    expect((await request(app).get('/api/tools/send_message?confirm_token=x'.padEnd(60, 'x'))).status).toBe(405);
  });
  it('the inbox needs Dan\'s token', async () => {
    expect((await request(app).get('/api/inbox')).status).toBe(401);
    expect((await request(app).get('/api/inbox').set({ Authorization: 'Bearer wrong-token-0123456789abcdef!' })).status).toBe(401);
  });
});

describe('openapi.json', () => {
  it('documents every tool', async () => {
    const r = await request(app).get('/openapi.json');
    for (const t of TOOLS) expect(r.body.paths[`/api/tools/${t.name}`]?.post?.operationId).toBe(t.name);
    expect(r.body.paths['/api/tools/get_project'].post.requestBody.content['application/json'].schema.required).toContain('slug');
  });
});

describe('MCP, with the real SDK client', () => {
  let server: Server; let url: string;
  beforeAll(async () => {
    server = createApp({ store: new MemoryStore(), baseUrl: 'https://api.test' }).listen(0);
    await new Promise(r => server.once('listening', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise(r => server.close(r)));
  it('lists every tool and calls one', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(TOOLS.map(t => t.name).sort());
    const r = await client.callTool({ name: 'get_project', arguments: { slug: 'opslayer' } });
    expect(r.isError).toBeFalsy();
    expect(JSON.stringify(r.structuredContent)).toContain('no paying customers');
    const bad = await client.callTool({ name: 'get_project', arguments: { slug: 'nope' } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain('unknown_project');
    await client.close();
  });
});
