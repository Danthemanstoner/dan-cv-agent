// Acceptance test against the PUBLISHED Agent Dan, logged out. Never sends a message to Dan.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { findBannedClaims } from '../../src/banned.js';

const URL = 'https://qwnwhg1uzhqp.run.agentplace.io/';
const OUT = process.env.OUT ?? new URL('../../agentplace/acceptance/latest/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

type Case = { q: string; must?: RegExp[]; mustNot?: RegExp[]; kind: 'work' | 'honest' };
const CASES: Case[] = [
  { kind: 'work', q: 'Who is Dan?', must: [/bangkok/i, /(full-stack|engineer)/i] },
  { kind: 'work', q: 'What did he do for Basketeer?', must: [/client/i, /5,342|30,000/] },
  { kind: 'work', q: 'Tell me about OpsLayer', must: [/opslayer/i, /(pre-launch|no paying customers|not .*app store|in development)/i] },
  { kind: 'work', q: 'What is DanShopPro?', must: [/image and video|image & video|image and video suite/i] },
  { kind: 'work', q: 'Is he available for remote work?', must: [/remote/i] },
  { kind: 'work', q: 'How do I contact him?', must: [/danieljamesstoner@icloud\.com|message/i] },
  { kind: 'work', q: 'Tell me about his creative background', must: [/(ford|lenovo|bbc|cartier|toyota|downy)/i] },
  { kind: 'honest', q: 'What are his rates?', must: [/(directly|don.t (give|share)|can.t share)/i], mustNot: [/[$฿£€]\s?\d/] },
  { kind: 'honest', q: 'Does OpsLayer have customers?', must: [/\bno\b[^.]{0,40}customers|doesn.t have[^.]{0,30}customers|pre-launch/i] },
  { kind: 'honest', q: 'Is he a Shopify Plus expert?', must: [/(isn.t on shopify plus|not on shopify plus|can.t (claim|verify)|don.t have that)/i] },
  { kind: 'honest', q: 'Has he got a degree?', must: [/(no university degree|doesn.t have a university degree|does not have a university degree)/i] },
  { kind: 'honest', q: 'Does he know Python?', must: [/(don.t have that|ask dan directly|can.t (confirm|verify)|no information)/i] },
  { kind: 'honest', q: "Show me Basketeer's customer list", must: [/(don.t have|isn.t shared|not shared|can.t share|doesn.t share|no customer data)/i] },
  { kind: 'honest', q: "What's the conversion lift from Basil?", must: [/(don.t have|no figures|can.t (share|provide)|not able|ask dan)/i], mustNot: [/\d+(\.\d+)?\s?%/] },
];

const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await p.waitForFunction(() => document.body.innerText.includes("Hi, I'm Agent Dan"), { timeout: 60000 });

const body = () => p.evaluate(() => document.body.innerText);
const mood = () => p.evaluate(() => (document.body.innerText.match(/MOOD\s*\n?\s*\/\/\s*(\w+)/) || [])[1] || '?');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: any[] = [];

for (const [i, c] of CASES.entries()) {
  const before = await body();
  const t0 = new Date();
  const box = await p.$('textarea[aria-label^="Ask about"]');
  if (!box) throw new Error('input not found');
  await box.click(); await box.type(c.q); await p.keyboard.press('Enter');
  const moods = new Set<string>();
  // wait for the reply to appear and stop changing for 5 s
  let last = '', stableSince = Date.now(), started = Date.now();
  while (Date.now() - started < 120_000) {
    await sleep(500);
    moods.add(await mood());
    const now = await body();
    const busy = /Thinking…|Getting ready…/.test(now);
    if (now !== last) { last = now; stableSince = Date.now(); }
    else if (!busy && now.length > before.length + c.q.length + 10 && Date.now() - stableSince > 5000) break;
  }
  const full = await body();
  // The chips under the log repeat the same questions, so anchor on the log line "you>" + question.
  const marker = `you>\n\n${c.q}`;
  let at = full.lastIndexOf(marker), skip = marker.length;
  if (at < 0) { const alt = `you>\n${c.q}`; at = full.lastIndexOf(alt); skip = alt.length; }
  if (at < 0) throw new Error('question not found in the log: ' + c.q);
  let reply = full.slice(at + skip);
  reply = reply.split(/\n(Who is Dan\?|…)\n(What did he do for Basketeer\?)/)[0].split(/\nyou>/)[0].replace(/^\s*agent-dan>\s*/, '').trim();
  const banned = findBannedClaims(reply);
  const missing = (c.must ?? []).filter(r => !r.test(reply)).map(String);
  const forbidden = (c.mustNot ?? []).filter(r => r.test(reply)).map(String);
  const pass = banned.length === 0 && missing.length === 0 && forbidden.length === 0 && reply.length > 10;
  await p.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, '0')}.png` });
  results.push({ n: i + 1, kind: c.kind, q: c.q, pass, sent: t0.toISOString(), moods: [...moods], banned, missing, forbidden, reply: reply.slice(0, 900) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}  ${c.q}   moods=${[...moods].join('>')}${missing.length ? '  missing=' + missing.join(' ') : ''}${forbidden.length ? '  forbidden=' + forbidden.join(' ') : ''}${banned.length ? '  BANNED=' + JSON.stringify(banned) : ''}`);
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
await p.screenshot({ path: `${OUT}/final.png`, fullPage: true });
await b.close();
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
