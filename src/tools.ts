// The tool registry. REST routes, the MCP server and openapi.json are all generated from this list,
// so the three can never disagree about what a tool takes or returns.
import { z } from 'zod';
import { games, rawFacts, verified, verifiedFacts, sourceLabel, type Fact } from './data.js';
import { DraftInput, signDraft, verifyDraft, tokenHash, ipHash, type MessageStore } from './messages.js';

export type Ctx = { ip: string; store: MessageStore; baseUrl: string };
export class ToolError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

type Tool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly: boolean;
  run: (input: z.infer<S>, ctx: Ctx) => Promise<unknown> | unknown;
};
const tool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool;

const cite = (f: Fact) => ({ id: f.id, text: f.text, source: sourceLabel(f.source) });
const must = (id: string) => {
  const f = verified(id);
  if (!f) throw new Error(`fact ${id} is not verified`); // referenced from code: fail loudly, never serve an unchecked fact
  return f;
};
const firstSentence = (t: string) => t.split(/(?<=\.)\s/)[0];
/** Per visitor, and a backstop across everyone, per hour. */
export const SEND_LIMITS = { perIp: 3, global: 30, windowMs: 3600_000 };

const project = (slug: string) => rawFacts.projects.find(p => p.slug === slug);
const projectFacts = (slugFacts: string[]) => slugFacts.map(verified).filter((f): f is Fact => !!f);

export const TOOLS: Tool[] = [
  tool({
    name: 'get_profile', title: 'Who Dan is', readOnly: true, input: z.object({}),
    description: "Short profile of Dan Stoner: who he is, where he's based, how he works, links and contact email. Call this for 'who is Dan' questions.",
    run: () => ({
      name: 'Dan Stoner',
      facts: ['who.summary', 'who.location', 'who.operator', 'who.ai', 'who.liquid', 'avail.summary', 'who.links', 'contact.email'].map(id => cite(must(id))),
      note: 'Agent Dan is an AI assistant, not Dan himself.',
    }),
  }),
  tool({
    name: 'list_projects', title: "Dan's projects", readOnly: true, input: z.object({}),
    description: "List Dan's projects with a one-line summary each. Use get_project for the details of one.",
    run: () => ({
      projects: rawFacts.projects.map(p => {
        const fs = projectFacts(p.facts);
        return { slug: p.slug, name: p.name, client: p.client, summary: fs[0] ? firstSentence(fs[0].text) : '' };
      }),
    }),
  }),
  tool({
    name: 'get_project', title: 'One project in detail', readOnly: true,
    input: z.object({ slug: z.string().min(1).max(40).describe('Project slug from list_projects, e.g. basketeer-ops') }),
    description: 'Details of one project: what Dan did, key numbers, stack and links, plus a showcase card (title, bullets, link, and a lottie mood hint) the page can render.',
    run: ({ slug }) => {
      const p = project(slug);
      if (!p) throw new ToolError(404, 'unknown_project', `No project called '${slug}'.`, { known: rawFacts.projects.map(x => x.slug) });
      const fs = projectFacts(p.facts);
      return {
        slug: p.slug, name: p.name, client: p.client, when: p.when ?? null,
        facts: fs.map(cite), numbers: (p.numbers ?? []).map(([value, label]) => ({ value, label })),
        stack: p.stack, links: p.links ?? [],
        showcase: { title: p.name, bullets: fs.map(f => firstSentence(f.text)).slice(0, 4), link: p.links?.[0] ?? null, lottie: p.lottie },
      };
    },
  }),
  tool({
    name: 'get_timeline', title: "Dan's career", readOnly: true, input: z.object({}),
    description: "Dan's career history, newest first, with education.",
    run: () => ({
      roles: rawFacts.timeline.map(t => ({
        role: t.role, org: t.org, from: t.from, to: t.to, place: t.place ?? null,
        detail: t.facts ? projectFacts(t.facts).map(f => firstSentence(f.text)) : t.note ? [t.note] : [],
      })),
      education: ['edu.futureworks', 'edu.school', 'edu.no-degree'].map(id => cite(must(id))),
    }),
  }),
  tool({
    name: 'search_facts', title: 'Search the facts', readOnly: true,
    input: z.object({ query: z.string().trim().min(2).max(120).describe('Keywords, e.g. "webhook" or "degree"') }),
    description: "Keyword search over Dan's checked facts. Returns matching facts with their sources, or an empty list. An empty list means the answer is not known: say so and offer the message to Dan.",
    run: ({ query }) => {
      const words = query.toLowerCase().split(/[^a-z0-9+#.]+/).filter(w => w.length > 1);
      const scored = verifiedFacts().map(f => {
        const hay = `${f.topic} ${f.id} ${f.text}`.toLowerCase();
        return { f, score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
      return { results: scored.map(x => cite(x.f)), known: scored.length > 0 }; // the query is not echoed: the guard scans only our own words
    },
  }),
  tool({
    name: 'get_availability', title: 'Availability', readOnly: true, input: z.object({}),
    description: 'What kind of work Dan is open to. This is a note Dan keeps up to date, not live calendar data.',
    run: () => ({ ...cite(must('avail.summary')), contact: must('contact.email').text, live_calendar: false }),
  }),
  tool({
    name: 'share_cv', title: "Dan's CV as a PDF", readOnly: true, input: z.object({}),
    description: "Link to Dan's CV as a PDF, generated from the same checked facts this API serves.",
    run: (_i, ctx) => ({ url: `${ctx.baseUrl}/cv.pdf`, html: `${ctx.baseUrl}/cv.html`, updated: rawFacts.updated }),
  }),
  tool({
    name: 'draft_message', title: 'Draft a message to Dan', readOnly: true, input: DraftInput,
    description: "Step 1 of 2 for passing a visitor's message to Dan. Saves nothing. Returns a preview and a confirm_token. Show the preview to the visitor and ask them to confirm. Only call send_message after they clearly say yes.",
    run: d => ({
      preview: { from: d.name, reply_to: d.reply_to, message: d.message },
      confirm_token: signDraft(d), expires_in_minutes: 30, persisted: false,
      next: 'Show the preview. Call send_message with confirm_token only after the visitor confirms.',
    }),
  }),
  tool({
    name: 'send_message', title: 'Send the confirmed message to Dan', readOnly: false,
    input: z.object({ confirm_token: z.string().min(20).max(4000).describe('The confirm_token from draft_message') }),
    description: "Step 2 of 2. Saves the exact message the visitor confirmed, for Dan to read in his inbox. Nothing is emailed. Call only after the visitor said yes to the draft_message preview.",
    run: async ({ confirm_token }, ctx) => {
      const v = verifyDraft(confirm_token);
      if (!v.ok) throw new ToolError(400, `token_${v.reason}`, v.reason === 'expired' ? 'That draft expired. Draft the message again.' : 'That confirm token is not valid. Draft the message again.');
      const r = await ctx.store.saveLimited({ ...v.draft, token_hash: tokenHash(confirm_token), ip_hash: ipHash(ctx.ip) }, SEND_LIMITS);
      if (r.status === 'limited') throw new ToolError(429, 'too_many_messages', r.scope === 'visitor'
        ? `Only ${SEND_LIMITS.perIp} messages an hour can be sent from here. Email Dan directly at danieljamesstoner@icloud.com.`
        : 'Agent Dan has passed on a lot of messages this hour. Email Dan directly at danieljamesstoner@icloud.com.');
      return { sent: true, reference: r.ref, persisted: true, already_sent: r.status === 'duplicate', emailed: false, note: `Saved for Dan. He replies to ${v.draft.reply_to} himself.` };
    },
  }),
  tool({
    name: 'quiz_question', title: 'Guess the stack: get a question', readOnly: true,
    input: z.object({ number: z.coerce.number().int().min(1).max(games.quiz.length).describe(`Question number, 1 to ${games.quiz.length}`) }),
    description: `Mini quiz about Dan's projects (${games.quiz.length} questions). Returns the question and options without the answer.`,
    run: ({ number }) => {
      const q = games.quiz[number - 1];
      return { number, of: games.quiz.length, question: q.question, options: q.options.map((o, i) => ({ choice: i + 1, text: o })) };
    },
  }),
  tool({
    name: 'quiz_answer', title: 'Guess the stack: check an answer', readOnly: true,
    input: z.object({ number: z.coerce.number().int().min(1).max(games.quiz.length), choice: z.coerce.number().int().min(1).max(5) }),
    description: 'Check a quiz answer. Returns whether it is right, the right answer and a one-line explanation with its source.',
    run: ({ number, choice }) => {
      const q = games.quiz[number - 1];
      if (choice > q.options.length) throw new ToolError(400, 'bad_choice', `Choose 1 to ${q.options.length}.`);
      return { number, correct: choice - 1 === q.answer, answer: { choice: q.answer + 1, text: q.options[q.answer] }, explain: q.explain, source: sourceLabel(must(q.fact).source) };
    },
  }),
  tool({
    name: 'incident_case', title: 'Incident detective: get a case', readOnly: true,
    input: z.object({ number: z.coerce.number().int().min(1).max(games.incidents.length) }),
    description: `Incident detective: one of ${games.incidents.length} real production bugs from Dan's work. Returns the clue and suspects, without the answer.`,
    run: ({ number }) => {
      const c = games.incidents[number - 1];
      return { number, of: games.incidents.length, title: c.title, clue: c.clue, suspects: c.options.map((o, i) => ({ choice: i + 1, text: o })) };
    },
  }),
  tool({
    name: 'incident_solve', title: 'Incident detective: reveal', readOnly: true,
    input: z.object({ number: z.coerce.number().int().min(1).max(games.incidents.length), choice: z.coerce.number().int().min(1).max(5) }),
    description: "Check a guess for an incident case. Returns whether it's right, what really happened, and the rule Dan took from it.",
    run: ({ number, choice }) => {
      const c = games.incidents[number - 1];
      if (choice > c.options.length) throw new ToolError(400, 'bad_choice', `Choose 1 to ${c.options.length}.`);
      return { number, correct: choice - 1 === c.answer, cause: c.options[c.answer], what_happened: c.truth, dans_rule: c.rule, source: sourceLabel(must(c.fact).source) };
    },
  }),
];

export const toolByName = new Map(TOOLS.map(t => [t.name, t]));
