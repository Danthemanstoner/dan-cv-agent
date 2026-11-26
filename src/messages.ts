// "Message Dan": a visitor's message is drafted, shown back, and saved only after they confirm.
// Nothing is emailed. Dan reads saved messages in his inbox (GET /api/inbox, behind INBOX_TOKEN).
//
// The two steps are bound by a signed token, so send_message can only save exactly what the visitor
// was shown, and only before the token expires. The token's hash is unique in storage, so a retried
// send saves once.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const DraftInput = z.object({
  name: z.string().trim().min(1).max(80),
  reply_to: z.string().trim().max(120).pipe(z.email()),
  message: z.string().trim().min(2).max(1000),
});
export type Draft = z.infer<typeof DraftInput>;

export type Saved = Draft & { ref: string; created_at: string; read_at: string | null };

export interface MessageStore {
  /** Saves once per token hash; returns the existing row if this token was already used. */
  save(row: Draft & { token_hash: string; ip_hash: string }): Promise<{ ref: string; duplicate: boolean }>;
  countSince(ip_hash: string, sinceMs: number): Promise<number>;
  list(limit: number): Promise<Saved[]>;
  markRead(ref: string): Promise<boolean>;
}

const TTL_MS = 30 * 60 * 1000;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function secret(): string {
  const s = process.env.CONFIRM_SECRET;
  if (!s || s.length < 32) throw new Error('CONFIRM_SECRET must be set (32+ chars)');
  return s;
}

export function signDraft(d: Draft, now = Date.now()): string {
  const payload = b64(JSON.stringify({ ...d, exp: now + TTL_MS, n: randomBytes(6).toString('hex') }));
  const sig = b64(createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyDraft(token: string, now = Date.now()): { ok: true; draft: Draft } | { ok: false; reason: string } {
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return { ok: false, reason: 'malformed' };
  const want = createHmac('sha256', secret()).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'bad_signature' };
  let body: unknown;
  try { body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  const parsed = DraftInput.extend({ exp: z.number() }).safeParse(body);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  if (parsed.data.exp < now) return { ok: false, reason: 'expired' };
  const { exp: _exp, ...draft } = parsed.data;
  return { ok: true, draft };
}

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const ipHash = (ip: string) => createHmac('sha256', secret()).update(`ip:${ip}`).digest('hex').slice(0, 32);

// ---------------------------------------------------------------- stores

export class MemoryStore implements MessageStore {
  rows: (Saved & { token_hash: string; ip_hash: string; at: number })[] = [];
  async save(row: Draft & { token_hash: string; ip_hash: string }) {
    const dup = this.rows.find(r => r.token_hash === row.token_hash);
    if (dup) return { ref: dup.ref, duplicate: true };
    const ref = 'AD-' + String(this.rows.length + 1).padStart(4, '0');
    this.rows.push({ ...row, ref, created_at: new Date().toISOString(), read_at: null, at: Date.now() });
    return { ref, duplicate: false };
  }
  async countSince(ip_hash: string, sinceMs: number) { return this.rows.filter(r => r.ip_hash === ip_hash && r.at >= sinceMs).length; }
  async list(limit: number) {
    return [...this.rows].reverse().slice(0, limit).map(({ token_hash: _t, ip_hash: _i, at: _a, ...r }) => r);
  }
  async markRead(ref: string) { const r = this.rows.find(x => x.ref === ref); if (!r) return false; r.read_at ??= new Date().toISOString(); return true; }
}

export class NeonStore implements MessageStore {
  private ready: Promise<void> | null = null;
  constructor(private sql: (q: TemplateStringsArray, ...v: unknown[]) => Promise<any[]>) {}
  private init() {
    this.ready ??= (async () => {
      await this.sql`CREATE TABLE IF NOT EXISTS agent_messages (
        id bigserial PRIMARY KEY,
        name text NOT NULL, reply_to text NOT NULL, message text NOT NULL,
        token_hash text NOT NULL UNIQUE, ip_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz)`;
      await this.sql`CREATE INDEX IF NOT EXISTS agent_messages_ip_time ON agent_messages (ip_hash, created_at)`;
    })();
    return this.ready;
  }
  async save(r: Draft & { token_hash: string; ip_hash: string }) {
    await this.init();
    const ins = await this.sql`INSERT INTO agent_messages (name, reply_to, message, token_hash, ip_hash)
      VALUES (${r.name}, ${r.reply_to}, ${r.message}, ${r.token_hash}, ${r.ip_hash})
      ON CONFLICT (token_hash) DO NOTHING RETURNING ('AD-' || lpad(id::text, 4, '0')) AS ref`;
    if (ins.length === 1) return { ref: ins[0].ref as string, duplicate: false };
    // Assert the side effect: a conflict must mean an existing row for this token, never a silent drop.
    const ex = await this.sql`SELECT ('AD-' || lpad(id::text, 4, '0')) AS ref FROM agent_messages WHERE token_hash = ${r.token_hash}`;
    if (ex.length !== 1) throw new Error('message not saved');
    return { ref: ex[0].ref as string, duplicate: true };
  }
  async countSince(ip_hash: string, sinceMs: number) {
    await this.init();
    const r = await this.sql`SELECT count(*)::int AS n FROM agent_messages WHERE ip_hash = ${ip_hash} AND created_at >= ${new Date(sinceMs).toISOString()}`;
    return r[0].n as number;
  }
  async list(limit: number) {
    await this.init();
    const rows = await this.sql`SELECT ('AD-' || lpad(id::text, 4, '0')) AS ref, name, reply_to, message, created_at, read_at FROM agent_messages ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(r => ({ ...r, created_at: new Date(r.created_at).toISOString(), read_at: r.read_at ? new Date(r.read_at).toISOString() : null })) as Saved[];
  }
  async markRead(ref: string) {
    await this.init();
    const id = Number(String(ref).replace(/^AD-/, ''));
    if (!Number.isInteger(id) || id < 1) return false;
    const r = await this.sql`UPDATE agent_messages SET read_at = coalesce(read_at, now()) WHERE id = ${id} RETURNING id`;
    return r.length === 1;
  }
}
