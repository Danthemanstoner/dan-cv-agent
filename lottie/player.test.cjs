const assert = require('assert');
const Face = require('./dan-agent-player.js');
const data = require('./dan-agent.json');
const seg = {}; data.markers.forEach(m => { seg[m.cm] = [m.tm, m.tm + m.dr]; });
const isHome = abs => Object.entries(seg).some(([m, [a]]) => data.meta.homes[m].some(h => Math.abs(a + h - abs) <= 0.5));
let A, bad = [];
function mockAnim() {
  const ev = {}; const a = { isLoaded: true, currentFrame: 0, seg: null, abs: null,
    addEventListener(n, f) { (ev[n] = ev[n] || []).push(f); },
    playSegments(s) { if (a.abs !== null && !isHome(a.abs)) bad.push(a.abs); a.seg = s; a.currentFrame = 0; a.abs = s[0]; },
    goToAndStop() {}, destroy() {},
    tick(dt) { const len = a.seg[1] - a.seg[0]; a.currentFrame = Math.min(a.currentFrame + dt, len); a.abs = a.seg[0] + a.currentFrame;
      if (a.currentFrame >= len) (ev.complete || []).forEach(f => f()); else (ev.enterFrame || []).forEach(f => f()); } };
  return a;
}
const face = Face(null, {}, data, { createAnim: () => (A = mockAnim()) });
const run = n => { for (let i = 0; i < n * 2; i++) A.tick(0.5); };
const waitFor = (m, max) => { let t = 0; while (A.seg[0] !== seg[m][0]) { A.tick(0.5); t += 0.5; assert(t <= max, m + ' took ' + t); } return t; };
run(40);                                         // idle local 40
face.set('greeting'); const w1 = waitFor('greeting', 30); assert.strictEqual(w1, 20, 'idle->greeting must wait for home 60'); console.log('idle -> greeting waited', w1);
console.log('greeting -> idle after', waitFor('idle', 60), 'frames (plays once)');
run(10); face.set('thinking'); console.log('idle -> thinking waited', waitFor('thinking', 30));
run(250); assert.strictEqual(A.seg[0], seg.thinking[0], 'thinking loops');
face.set('talking'); console.log('thinking -> talking waited', waitFor('talking', 90));
run(250); assert.strictEqual(A.seg[0], seg.talking[0], 'talking loops');
face.set('idle'); console.log('talking -> idle waited', waitFor('idle', 30));
for (const [m, n] of [['talking', 13], ['thinking', 41], ['idle', 7], ['greeting', 3], ['talking', 77], ['idle', 55]]) { face.set(m); run(n); }
run(200);
assert.deepStrictEqual(bad, [], 'switches off home: ' + bad);
console.log('every switch landed on a home frame; loops hold');
