// Loads data/facts.json and data/games.json, validates them, and exposes ONLY verified facts.
// A fact marked "dan-to-confirm" is kept in the file (so Dan can see it) but is never served.
import { z } from 'zod';
// Imported, not read from disk at runtime, so the serverless bundle always contains them.
import factsJson from '../data/facts.json' with { type: 'json' };
import gamesJson from '../data/games.json' with { type: 'json' };

const Fact = z.object({
  id: z.string().regex(/^[a-z0-9.-]+$/),
  topic: z.string(),
  confidence: z.enum(['verified', 'dan-to-confirm']),
  source: z.array(z.string()).min(1),
  negates: z.string().optional(),
  text: z.string().min(10),
});
const Project = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  client: z.string(),
  when: z.string().optional(),
  facts: z.array(z.string()).min(1),
  numbers: z.array(z.tuple([z.string(), z.string()])).optional(),
  stack: z.array(z.string()),
  links: z.array(z.string()).optional(),
  lottie: z.enum(['idle', 'greeting', 'thinking', 'talking']),
});
const TimelineItem = z.object({
  role: z.string(), org: z.string(), from: z.string(), to: z.string(), place: z.string().optional(),
  facts: z.array(z.string()).optional(), note: z.string().optional(), source: z.array(z.string()).optional(),
});
const FactsFile = z.object({
  updated: z.string(),
  sources: z.record(z.string(), z.string()),
  facts: z.array(Fact),
  timeline: z.array(TimelineItem),
  projects: z.array(Project),
});
const Choice = { options: z.array(z.string()).min(2).max(5), answer: z.number().int().min(0), fact: z.string() };
const GamesFile = z.object({
  quiz: z.array(z.object({ id: z.string(), question: z.string(), explain: z.string(), ...Choice })),
  incidents: z.array(z.object({ id: z.string(), title: z.string(), clue: z.string(), truth: z.string(), rule: z.string(), ...Choice })),
});

export type Fact = z.infer<typeof Fact>;
export type Project = z.infer<typeof Project>;

export const rawFacts = FactsFile.parse(factsJson);
export const games = GamesFile.parse(gamesJson);

const byId = new Map(rawFacts.facts.map(f => [f.id, f]));

// Referential checks run at load: a broken reference should fail the deploy, not a visitor's question.
for (const f of rawFacts.facts) for (const s of f.source) if (!rawFacts.sources[s]) throw new Error(`fact ${f.id}: unknown source ${s}`);
const refs = [
  ...rawFacts.projects.flatMap(p => p.facts.map(id => [`project ${p.slug}`, id] as const)),
  ...rawFacts.timeline.flatMap(t => (t.facts ?? []).map(id => [`timeline ${t.org}`, id] as const)),
  ...games.quiz.map(q => [`quiz ${q.id}`, q.fact] as const),
  ...games.incidents.map(c => [`incident ${c.id}`, c.fact] as const),
];
for (const [where, id] of refs) {
  const f = byId.get(id);
  if (!f) throw new Error(`${where}: unknown fact ${id}`);
}
for (const g of [...games.quiz, ...games.incidents]) if (g.answer >= g.options.length) throw new Error(`${g.id}: answer out of range`);

/** Verified facts only. Everything the API serves goes through here. */
export const verified = (id: string): Fact | undefined => {
  const f = byId.get(id);
  return f && f.confidence === 'verified' ? f : undefined;
};
export const verifiedFacts = (): Fact[] => rawFacts.facts.filter(f => f.confidence === 'verified');
export const sourceLabel = (ids: string[]) => ids.map(s => rawFacts.sources[s]).join('; ');
