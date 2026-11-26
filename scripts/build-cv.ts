// Builds public/cv.html from the verified facts, then prints public/cv.pdf with local Chrome.
// The CV and Agent Dan read the same facts, so they cannot disagree.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawFacts, verified } from '../src/data.js';
import { findBannedClaims } from '../src/banned.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const t = (id: string) => {
  const f = verified(id);
  if (!f) throw new Error(`CV uses ${id}, which is not verified`);
  return f.text;
};
const first = (s: string) => s.split(/(?<=\.)\s/)[0];

const roles = rawFacts.timeline.map(r => {
  const detail = r.facts ? r.facts.map(id => first(t(id))) : r.note ? [r.note] : [];
  return `<div class="role"><div class="rh"><span class="l"><b>${esc(r.role)}</b>, ${esc(r.org)}</span><span>${esc(r.from)} – ${esc(r.to)}</span></div>${detail.length ? `<ul>${detail.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>`;
}).join('');

const projects = rawFacts.projects.filter(p => p.slug !== 'creative').map(p => {
  const nums = (p.numbers ?? []).map(([v, l]) => `<span class="n"><b>${esc(v)}</b> ${esc(l)}</span>`).join('');
  return `<div class="proj"><div class="rh"><b>${esc(p.name)}</b><span>${esc(p.client)}${p.when ? ` · ${esc(p.when)}` : ''}</span></div><p>${esc(first(t(p.facts[0])))}</p>${nums ? `<div class="nums">${nums}</div>` : ''}</div>`;
}).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dan Stoner CV</title><meta name="robots" content="noindex">
<style>
@page{size:A4;margin:12mm 14mm}
*{box-sizing:border-box}body{margin:0;font:9pt/1.38 "SF Mono","IBM Plex Mono",Menlo,monospace;color:#10180f;background:#fff}
main{max-width:182mm;margin:0 auto;padding:0}
h1{font-size:20pt;margin:0;letter-spacing:-.3px}h1 small{display:block;font-size:9.6pt;font-weight:normal;color:#2d5a3a;margin-top:2px}
h2{break-after:avoid;font-size:9.6pt;margin:11px 0 5px;padding-bottom:3px;border-bottom:1.5px solid #00a347;color:#0b3d1f}
p{margin:0 0 5px}ul{margin:2px 0 6px;padding-left:15px}li{margin:1px 0}
.contact{margin:6px 0 2px;color:#2d5a3a}.contact a{color:#0b3d1f}
.rh{display:flex;justify-content:space-between;gap:10px}.rh>span:last-child{color:#4a6b55;white-space:nowrap}.rh .l{color:inherit;white-space:normal}
.role,.proj{margin:0 0 7px;break-inside:avoid}
.nums{display:flex;flex-wrap:wrap;gap:4px 14px;color:#2d5a3a}.n b{color:#00873b}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
footer{margin-top:8px;color:#6b8a75;font-size:8pt}
</style></head><body><main>
<h1>Dan Stoner<small>Full-stack product engineer · Bangkok (UTC+7)</small></h1>
<div class="contact">danieljamesstoner@icloud.com · linkedin.com/in/danieljamesstoner · github.com/Danthemanstoner · dan-stoner-cv-site.vercel.app</div>
<h2>Profile</h2><p>${esc(t('who.summary'))}</p><p>${esc(t('who.ai'))}</p><p>${esc(t('avail.summary'))}</p>
<h2>Experience</h2>${roles}
<h2>Selected work</h2>${projects}
<h2>How I work</h2><ul>${['inc.webhook', 'inc.form', 'inc.fraud'].map(id => `<li>${esc(t(id).replace(/^Incident: /, ''))}</li>`).join('')}</ul>
<div class="cols"><div><h2>Skills</h2><p>${esc(t('skills.daily'))}</p><p>${esc(t('skills.comfortable'))}</p></div>
<div><h2>Education</h2><p>${esc(t('edu.futureworks'))}</p><p>${esc(t('edu.school'))}</p><p>${esc(t('edu.no-degree'))}</p></div></div>
<footer>Generated ${esc(rawFacts.updated)} from the same checked facts Agent Dan answers from.</footer>
</main></body></html>`;

const textOnly = html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');
const hits = findBannedClaims(textOnly);
if (hits.length) { console.error(hits); throw new Error('CV would make a banned claim'); }
for (const f of rawFacts.facts.filter(x => x.confidence !== 'verified')) if (textOnly.includes(f.text)) throw new Error(`CV includes unconfirmed ${f.id}`);

mkdirSync(join(ROOT, 'public'), { recursive: true });
writeFileSync(join(ROOT, 'public/cv.html'), html);
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) throw new Error(`Chrome not found at ${chrome}; set CHROME`);
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(ROOT, 'public/cv.pdf')}`, `file://${join(ROOT, 'public/cv.html')}`], { stdio: 'ignore' });
if (!existsSync(join(ROOT, 'public/cv.pdf'))) throw new Error('cv.pdf was not written');
console.log('wrote public/cv.html and public/cv.pdf');
