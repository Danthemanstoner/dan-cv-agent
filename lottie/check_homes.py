import json, sys
d = json.load(open(sys.argv[1]))
homes = d['meta']['homes']; seg = {m['cm']: (m['tm'], m['tm'] + m['dr']) for m in d['markers']}
def val(prop, t):
    if prop['a'] == 0: return prop['k']
    ks = prop['k']
    if t <= ks[0]['t']: return ks[0]['s']
    for a, b in zip(ks, ks[1:]):
        if t == a['t']: return a['s']
        if a['t'] < t < b['t']:
            if a.get('h') or a['s'] == b['s']: return a['s']
            return None   # moving
    return ks[-1]['s']
rig = next(L for L in d['layers'] if L['nm'] == 'rig')
H = {k: val(rig['ks'][k], seg['idle'][0]) for k in 'prs'}
bad = 0
check_frames = []
for m, hs in homes.items():
    a, b = seg[m]
    check_frames += [(m, a + h) for h in hs]
# also every gap frame
for t in range(431):
    if not any(a <= t <= b for a, b in seg.values()): check_frames.append(('gap', t))
for m, t in check_frames:
    probs = []
    for k in 'prs':
        if val(rig['ks'][k], t) != H[k]: probs.append(f'rig.{k}={val(rig["ks"][k], t)}')
    for L in d['layers']:
        if L['nm'] == 'rig': continue
        visible_layer = L['ip'] <= t < L['op']
        o = val(L['ks']['o'], t)
        o = o[0] if isinstance(o, list) else o
        if L['nm'].startswith('pose_'):
            want = 100 if L['nm'] == 'pose_smile' else 0
            if o != want: probs.append(f'{L["nm"]} o={o}')
        elif visible_layer and o not in (0, None) and o != 0:
            probs.append(f'{L["nm"]} o={o}')
        elif visible_layer and o is None:
            probs.append(f'{L["nm"]} moving')
    if probs: bad += 1; print('NOT HOME', m, t, probs[:4])
print('checked', len(check_frames), 'frames;', 'all home' if not bad else f'{bad} bad')
# loop seamless: first and last frame of each segment identical (both home) is covered above
