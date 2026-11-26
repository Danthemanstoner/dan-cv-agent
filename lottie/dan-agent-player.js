/* Dan agent face player.
 * Plays one mood of dan-agent.json on a loop and switches moods only at a "home" frame (centred,
 * upright, smiling, no flames), so a change never jumps. Homes are listed in the file's meta.homes.
 *
 *   const face = DanAgentFace(lottie, container, data, { start: 'idle' });
 *   face.set('greeting');          // plays once, then returns to `after` (default 'idle')
 *   face.set('thinking');          // loops until the next set()
 *   face.mood()                    // current mood
 *   face.destroy()
 *
 * prefers-reduced-motion: shows the still home frame and ignores set().
 */
(function (root) {
  var ONE_SHOT = { greeting: true };

  function DanAgentFace(lottie, container, data, opts) {
    opts = opts || {};
    var seg = {}, homes = (data.meta && data.meta.homes) || {};
    data.markers.forEach(function (m) { seg[m.cm] = [m.tm, m.tm + m.dr]; });
    var reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var anim = (opts.createAnim || function (cfg) { return lottie.loadAnimation(cfg); })({
      container: container, renderer: 'svg', loop: false, autoplay: false,
      animationData: JSON.parse(JSON.stringify(data)),
    });
    var current = null, pending = null, after = opts.after || 'idle', lastLocal = 0;

    function play(m) {
      current = m; pending = null; lastLocal = 0;
      anim.playSegments(seg[m], true);
    }
    function nextAfter(m) { return ONE_SHOT[m] ? after : m; }

    // A home frame inside the segment was just crossed: take the pending switch there.
    anim.addEventListener('enterFrame', function () {
      var local = anim.currentFrame;              // frames since the segment start
      var prev = lastLocal;
      lastLocal = local;                          // tracked every frame, pending or not
      if (!pending || !current) return;
      var hs = homes[current] || [0];
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        if (h > 0 && prev < h && local >= h) { play(pending); return; }
      }
    });
    // Segment end is always home: loop, or take the pending / follow-on mood.
    anim.addEventListener('complete', function () {
      play(pending || nextAfter(current));
    });

    function start() {
      if (reduced) { anim.goToAndStop(seg.idle[0], true); current = 'idle'; return; }
      play(opts.start || 'idle');
    }
    if (anim.isLoaded) start(); else anim.addEventListener('DOMLoaded', start);

    return {
      set: function (m) {
        if (reduced || !seg[m]) return;
        if (m === current && !ONE_SHOT[m]) { pending = null; return; }
        pending = m;
      },
      mood: function () { return pending || current; },
      destroy: function () { anim.destroy(); },
      anim: anim,
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = DanAgentFace;
  else root.DanAgentFace = DanAgentFace;
})(typeof window !== 'undefined' ? window : globalThis);
