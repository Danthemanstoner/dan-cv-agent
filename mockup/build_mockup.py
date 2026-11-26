#!/usr/bin/env python3
"""Inline the face Lottie, player, lottie-web and 8-bit sprite into one standalone mockup page."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sprite import NORMAL, WINK
L = os.path.join(HERE, '..', 'lottie')
out = sys.argv[1]
lottie_js = os.environ.get('LOTTIE_JS') or os.path.join(L, 'vendor', 'lottie.min.js')
s = open(os.path.join(HERE, 'agent-dan.template.html')).read()
parts = {
    '/*__LOTTIE_JS__*/': open(lottie_js).read(),
    '/*__PLAYER_JS__*/': open(os.path.join(L, 'dan-agent-player.js')).read(),
    '/*__FACE_JSON__*/': open(os.path.join(L, 'dan-agent.json')).read(),
    '/*__SPRITE__*/': json.dumps({'normal': NORMAL, 'wink': WINK}),
}
for k, v in parts.items():
    assert s.count(k) == 1, k
    s = s.replace(k, v.replace('</script', '<\\/script'))
open(out, 'w').write(s)
print('wrote', out, len(s) // 1024, 'KB')
