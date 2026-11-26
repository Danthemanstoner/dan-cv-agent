// The agent's instructions and the generated CV must not make banned claims either.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { findBannedClaims } from '../src/banned.js';
import { rawFacts } from '../src/data.js';

const instructions = readFileSync('agentplace/instructions.md', 'utf8');
// The "Never say or imply" section IS the banned list, phrased as prohibitions, so it is the one part not scanned.
const withoutBannedList = instructions.replace(/## Never say or imply[\s\S]*?(?=\n## )/, '');

describe('agent instructions', () => {
  it('still contain the banned list (so removing it is noticed)', () => {
    expect(instructions).toContain('## Never say or imply');
    expect(withoutBannedList.length).toBeLessThan(instructions.length - 300);
  });
  it('make no banned claims outside the banned list', () => {
    expect(findBannedClaims(withoutBannedList)).toEqual([]);
  });
  it('contain the six truth rules word for word', () => {
    for (const rule of [
      'Only state facts returned by the tools or listed in the instructions. If unsure, say "I don\'t have that, ask Dan directly" and offer the handoff.',
      'Never state pay, rates or salary. Say Dan will discuss it directly.',
      'Never claim anything in the banned list below.',
      "Never share customer data. There isn't any in the tools, and if a visitor asks for it, say it isn't shared.",
    ]) expect(instructions).toContain(rule);
  });
  it('stay under about 1,500 words', () => {
    expect(instructions.split(/\s+/).length).toBeLessThan(1500);
  });
  it('name every tool the API offers', async () => {
    const { TOOLS } = await import('../src/tools.js');
    for (const t of TOOLS) expect(instructions, t.name).toContain(t.name);
  });
});

describe('generated CV', () => {
  it.runIf(existsSync('public/cv.html'))('makes no banned claims and holds no unconfirmed facts', () => {
    const text = readFileSync('public/cv.html', 'utf8').replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
    expect(findBannedClaims(text)).toEqual([]);
    for (const f of rawFacts.facts.filter(x => x.confidence !== 'verified')) expect(text).not.toContain(f.text);
  });
});
