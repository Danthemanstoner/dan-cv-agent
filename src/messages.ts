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

export type Limits = { perIp: number; global: number; windowMs: number };
export type SaveResult = { status: 'saved' | 'duplicate'; ref: string } | { status: 'limited'; scope: 'visitor' | 'everyone' };

export interface MessageStore {
  /**
   * Checks the limits and saves in ONE atomic step, so parallel sends cannot all pass a check made
   * before any of them saved. A token that was already used returns its existing reference.
   */
  saveLimited(row: Draft & { token_hash: string; ip_hash: string }, limits: Limits): Promise<SaveResult>;
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

const REF = (id: number) => 'AD-' + String(id).padStart(4, '0');

export class MemoryStore implements MessageStore {
  rows: (Saved & { token_hash: string; ip_hash: string; at: number })[] = [];
  // No await between the checks and the push: in a single-threaded runtime that block is atomic.
  async saveLimited(row: Draft & { token_hash: string; ip_hash: string }, l: Limits): Promise<SaveResult> {
    const dup = this.rows.find(r => r.token_hash === row.token_hash);
    if (dup) return { status: 'duplicate', ref: dup.ref };
    const since = Date.now() - l.windowMs;
    const recent = this.rows.filter(r => r.at >= since);
    if (recent.filter(r => r.ip_hash === row.ip_hash).length >= l.perIp) return { status: 'limited', scope: 'visitor' };
    if (recent.length >= l.global) return { status: 'limited', scope: 'everyone' };
    const ref = REF(this.rows.length + 1);
    this.rows.push({ ...row, ref, created_at: new Date().toISOString(), read_at: null, at: Date.now() });
    return { status: 'saved', ref };
  }
  async list(limit: number) {
    return [...this.rows].reverse().slice(0, limit).map(({ token_hash: _t, ip_hash: _i, at: _a, ...r }) => r);
  }
  async markRead(ref: string) { const r = this.rows.find(x => x.ref === ref); if (!r) return false; r.read_at ??= new Date().toISOString(); return true; }
}

/** The subset of @neondatabase/serverless's `neon()` function this store uses. */
export type NeonSql = {
  (q: TemplateStringsArray, ...v: unknown[]): Promise<any[]>;
  transaction(queries: Promise<any[]>[]): Promise<any[][]>;
};

const SEND_LOCK = 7_361_902; // advisory lock key: serialises sends so check-and-insert is atomic

export class NeonStore implements MessageStore {
  private ready: Promise<void> | null = null;
  constructor(private db: () => Promise<NeonSql>) {}
  private async sql() {
    const sql = await this.db();
    this.ready ??= (async () => {
      await sql`CREATE TABLE IF NOT EXISTS agent_messages (
        id bigserial PRIMARY KEY,
        name text NOT NULL, reply_to text NOT NULL, message text NOT NULL,
        token_hash text NOT NULL UNIQUE, ip_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz)`;
      await sql`CREATE INDEX IF NOT EXISTS agent_messages_ip_time ON agent_messages (ip_hash, created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS agent_messages_time ON agent_messages (created_at)`;
    })();
    await this.ready;
    return sql;
  }
  async saveLimited(r: Draft & { token_hash: string; ip_hash: string }, l: Limits): Promise<SaveResult> {
    const sql = await this.sql();
    const secs = Math.ceil(l.windowMs / 1000);
    // One transaction: take the lock, insert only if both limits allow it, then read back what happened.
    const [, ins, existing, counts] = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(${SEND_LOCK})`,
      sql`INSERT INTO agent_messages (name, reply_to, message, token_hash, ip_hash)
          SELECT ${r.name}, ${r.reply_to}, ${r.message}, ${r.token_hash}, ${r.ip_hash}
          WHERE (SELECT count(*) FROM agent_messages WHERE ip_hash = ${r.ip_hash} AND created_at > now() - make_interval(secs => ${secs})) < ${l.perIp}
            AND (SELECT count(*) FROM agent_messages WHERE created_at > now() - make_interval(secs => ${secs})) < ${l.global}
          ON CONFLICT (token_hash) DO NOTHING
          RETURNING id`,
      sql`SELECT id FROM agent_messages WHERE token_hash = ${r.token_hash}`,
      sql`SELECT count(*)::int AS n FROM agent_messages WHERE ip_hash = ${r.ip_hash} AND created_at > now() - make_interval(secs => ${secs})`,
    ]);
    if (ins.length === 1) return { status: 'saved', ref: REF(Number(ins[0].id)) };
    if (existing.length === 1) return { status: 'duplicate', ref: REF(Number(existing[0].id)) };
    // Not inserted and no row for this token: the only remaining reason is a limit. Say which.
    return { status: 'limited', scope: counts[0].n >= l.perIp ? 'visitor' : 'everyone' };
  }
  async list(limit: number) {
    const sql = await this.sql();
    const rows = await sql`SELECT id, name, reply_to, message, created_at, read_at FROM agent_messages ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(r => ({ ref: REF(Number(r.id)), name: r.name, reply_to: r.reply_to, message: r.message,
      created_at: new Date(r.created_at).toISOString(), read_at: r.read_at ? new Date(r.read_at).toISOString() : null }));
  }
  async markRead(ref: string) {
    const id = Number(String(ref).replace(/^AD-/, ''));
    if (!Number.isInteger(id) || id < 1) return false;
    const sql = await this.sql();
    const r = await sql`UPDATE agent_messages SET read_at = coalesce(read_at, now()) WHERE id = ${id} RETURNING id`;
    return r.length === 1;
  }
}
