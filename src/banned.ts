// Claims Agent Dan must never make. Checked against every API response at runtime, and against all
// served data and the agent instructions in tests.
//
// Patterns match AFFIRMATIONS, not bare topic words: a sentence that names a topic while denying it
// ("Basketeer is not on Shopify Plus") is allowed. A bare word match would also fire on refusals,
// which is how a guard ends up blocking the honest answer.
export type Banned = { id: string; why: string; re: RegExp; sentenceMustAlsoMatch?: RegExp };

export const BANNED: Banned[] = [
  { id: 'oauth-basketeer', why: 'OAuth is OpsLayer only, never Basketeer', re: /\boauth\b/i, sentenceMustAlsoMatch: /^(?![\s\S]*opslayer)[\s\S]*basketeer/i },
  { id: 'public-app', why: 'no public Shopify app', re: /\bpublic (shopify )?app\b|\b(on|in|listed on) the (shopify )?app store\b/i },
  { id: 'shopify-plus', why: 'no Shopify Plus claim', re: /\bshopify plus\b/i },
  { id: 'shopify-functions', why: 'no Shopify Functions claim', re: /\bshopify functions?\b/i },
  { id: 'shopify-flow', why: 'no Shopify Flow claim', re: /\bshopify flow\b/i },
  { id: 'storefront-api', why: 'no Storefront API claim', re: /\bstorefront api\b/i },
  { id: 'hydrogen', why: 'no Hydrogen claim', re: /\bhydrogen\b/i },
  { id: 'conversion', why: 'no conversion or sales-lift metrics', re: /\bconversion (rate|lift)\b|\bincreased? (sales|revenue|conversions?)\b|\b\d+(\.\d+)?\s?% (more|uplift|increase|lift)\b/i },
  { id: 'revenue', why: 'no revenue figures', re: /\brevenue\b|\$\s?\d[\d,.]*\s?(m|k|million|bn)\b/i },
  { id: 'basil-sales', why: 'no Basil sales or revenue figures', re: /\bbasil\b[^.]{0,80}\b(revenue|closed (paid )?orders?|generated|sold|made \d)/i },
  { id: 'award', why: 'no awards or press', re: /\baward(s|-winning)?\b|\bfeatured in\b/i },
  { id: 'python', why: 'no Python claim', re: /\bpython\b/i },
  { id: 'degree', why: 'no university degree', re: /\b(bachelor'?s?|master'?s|bsc|msc|ba \(hons\)|university degree|graduated from)\b/i },
  { id: 'opslayer-commercial', why: 'OpsLayer has no customers, revenue or company', re: /\bopslayer\b[^.]{0,120}\b(has|have|had|serves|serving|signed|paying|with)\b[^.]{0,30}\b(customers|clients|merchants|revenue)\b|\bopslayer\b[^.]{0,80}\b(registered company|ltd|inc)\b/i },
  { id: 'founder', why: 'Dan did not found Basketeer', re: /\b(co-?)?found(er|ed)\b/i },
  { id: 'pay', why: 'no pay figures', re: /(฿|\$|£|€|usd|thb|gbp)\s?\d|\d[\d,.]*\s?(k\s)?(baht|thb|usd|gbp|dollars)\b|\b(day|hourly) rate of\b|\bper (hour|day)\b/i },
  { id: 'unverified-tech', why: 'no MCP, Cloudflare Workers or BigQuery as verified work', re: /\bcloudflare workers?\b|\bbigquery\b|\b(dan|he|his)\b[^.]{0,60}\bmcp (experience|expertise|servers? (he|dan) built)\b/i },
];

const NEGATION = /(\bno\b|\bnot\b|\bnever\b|n't\b|\bwithout\b|\bavoids?\b|\brefuses?\b|\bnor\b)/i;

export const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);

export type Hit = { id: string; why: string; sentence: string };

/** Affirmative banned claims in `text`. A sentence that also contains a negation is not a claim. */
export function findBannedClaims(text: string): Hit[] {
  const hits: Hit[] = [];
  for (const s of sentences(text)) {
    for (const b of BANNED) {
      if (!b.re.test(s)) continue;
      if (b.sentenceMustAlsoMatch && !b.sentenceMustAlsoMatch.test(s)) continue;
      if (NEGATION.test(s)) continue;
      hits.push({ id: b.id, why: b.why, sentence: s });
    }
  }
  return hits;
}

/** Topic-level check used by tests: which banned topics does this text mention at all, negated or not. */
export const bannedTopics = (text: string) => BANNED.filter(b => sentences(text).some(s => b.re.test(s) && (!b.sentenceMustAlsoMatch || b.sentenceMustAlsoMatch.test(s)))).map(b => b.id);

/** Collect every string inside a JSON-able value. */
/** Keys whose values are the visitor's own words echoed back (never Agent Dan's claims), so the guard skips them. */
export const VISITOR_ECHO_KEYS = new Set(['preview']);
export function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => allStrings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!VISITOR_ECHO_KEYS.has(k)) allStrings(x, out); }
  return out;
}
