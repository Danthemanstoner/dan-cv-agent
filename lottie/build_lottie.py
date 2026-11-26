#!/usr/bin/env python3
"""Build the CV-agent Lottie ("Dan" head, CRT green) from DanShopPro splash end frames.

Poses are traced with potrace from the calm end of the splash (smile, open laugh, laughing wink,
smile wink). One Lottie file holds every mood as a marker segment: idle, greeting, thinking, talking.
"""
import json, re, subprocess, sys, os, math
from PIL import Image, ImageFilter
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, 'source-frames')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'dan-agent.json')

GREEN = [0, 1, 0.416, 1]          # #00ff6a
DARK = [0.02, 0.039, 0.027, 1]    # #050a07
POSES = {'smile': '01', 'open': '09', 'laughwink': '12', 'wink': '20'}
REF = '01'
UP = 2  # trace at 2x for smoother curves

# ---------------------------------------------------------------- tracing

def bbox(mask):
    ys, xs = np.where(mask)
    return xs.min(), xs.max(), ys.min(), ys.max()

def trace(frame_id, shift):
    im = Image.open(os.path.join(FRAMES, f'f_{frame_id}.png')).convert('L')
    big = im.resize((im.width * UP, im.height * UP), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.2))
    light = np.asarray(big) > 128
    pbm = os.path.join(HERE, 'trace', f'p_{frame_id}.pbm')
    svg = pbm[:-4] + '.svg'
    Image.fromarray(np.where(light, 0, 255).astype('uint8')).convert('1').save(pbm)
    subprocess.run(['potrace', '-s', '-t', '20', '-a', '1.1', '-O', '0.6', '-u', '1', pbm, '-o', svg], check=True)
    H = big.height
    paths = parse_potrace(open(svg).read(), H)
    sx, sy = shift
    return paths, [[transform_seg(seg, sx, sy) for seg in sub] for sub in paths]

def transform_seg(seg, sx, sy):
    kind, pts = seg
    return kind, [(round(x / UP + sx, 1), round(y / UP + sy, 1)) for x, y in pts]

TOK = re.compile(r'[MmCcLlZz]|-?\d+(?:\.\d+)?')

def parse_potrace(svg, H):
    """Return list of subpaths; each subpath is [('start',[p]), ('c',[c1,c2,p]) | ('l',[p]) ...] in absolute,
    y-down pixel coords of the traced (2x) image."""
    subs = []
    for d in re.findall(r'<path d="([^"]+)"', svg):
        toks = TOK.findall(d)
        i = 0; cmd = None; cur = (0.0, 0.0); start = None; sub = None
        def num():
            nonlocal i
            v = float(toks[i]); i += 1; return v
        while i < len(toks):
            t = toks[i]
            if re.match(r'[MmCcLlZz]', t):
                cmd = t; i += 1
                if cmd in 'Zz':
                    if sub: subs.append(sub)
                    sub = None; cur = start
                continue
            if cmd in 'Mm':
                x, y = num(), num()
                cur = (x, y) if cmd == 'M' or start is None else (cur[0] + x, cur[1] + y)
                start = cur; sub = [('start', [cur])]
                cmd = 'l' if cmd == 'm' else 'L'
            elif cmd == 'c':
                v = [num() for _ in range(6)]
                c1 = (cur[0] + v[0], cur[1] + v[1]); c2 = (cur[0] + v[2], cur[1] + v[3]); p = (cur[0] + v[4], cur[1] + v[5])
                sub.append(('c', [c1, c2, p])); cur = p
            elif cmd == 'l':
                x, y = num(), num(); p = (cur[0] + x, cur[1] + y)
                sub.append(('l', [p])); cur = p
            elif cmd == 'L':
                x, y = num(), num(); p = (x, y)
                sub.append(('l', [p])); cur = p
            else:
                raise ValueError(cmd)
    # flip y (potrace svg is y-up with translate(0,H) scale(1,-1))
    flipped = []
    for sub in subs:
        flipped.append([(k, [(x, H - y) for x, y in pts]) for k, pts in sub])
    return flipped

def to_lottie_shape(sub):
    """sub: [('start',[p0]), segs...] closed. -> Lottie path dict."""
    p0 = sub[0][1][0]
    segs = sub[1:]
    v = [p0]; o = []; i_ = [None]
    for k, pts in segs:
        prev = v[-1]
        if k == 'c':
            c1, c2, p = pts
            o.append((c1[0] - prev[0], c1[1] - prev[1]))
            v.append(p); i_.append((c2[0] - p[0], c2[1] - p[1]))
        else:
            p = pts[0]
            o.append((0, 0)); v.append(p); i_.append((0, 0))
    # closed: last vertex equals first
    if abs(v[-1][0] - v[0][0]) < 0.6 and abs(v[-1][1] - v[0][1]) < 0.6:
        i_[0] = i_[-1]; v.pop(); i_.pop()
    else:
        o.append((0, 0)); i_[0] = (0, 0)
    r = lambda pts: [[round(a, 1), round(b, 1)] for a, b in pts]
    return {'ty': 'sh', 'ks': {'a': 0, 'k': {'i': r(i_), 'o': r(o), 'v': r(v), 'c': True}}}

def area(sub):
    pts = [sub[0][1][0]] + [s[1][-1] for s in sub[1:]]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))

def pose_shapes(frame_id):
    ref = np.asarray(Image.open(os.path.join(FRAMES, f'f_{REF}.png')).convert('L')) > 128
    me = np.asarray(Image.open(os.path.join(FRAMES, f'f_{frame_id}.png')).convert('L')) > 128
    rx0, rx1, ry0, ry1 = bbox(ref); mx0, mx1, my0, my1 = bbox(me)
    shift = ((rx0 + rx1) / 2 - (mx0 + mx1) / 2, ry1 - my1)
    _, subs = trace(frame_id, shift)
    subs = [s for s in subs if len(s) > 2]
    outer = max(subs, key=area)
    green = {'ty': 'gr', 'nm': 'lines', 'it': [to_lottie_shape(s) for s in subs] + [
        {'ty': 'fl', 'c': {'a': 0, 'k': GREEN}, 'o': {'a': 0, 'k': 100}, 'r': 2, 'nm': 'green'}, tr()]}
    dark = {'ty': 'gr', 'nm': 'silhouette', 'it': [to_lottie_shape(outer),
        {'ty': 'fl', 'c': {'a': 0, 'k': DARK}, 'o': {'a': 0, 'k': 100}, 'r': 1, 'nm': 'dark'}, tr()]}
    return [green, dark]

# ---------------------------------------------------------------- lottie helpers

def tr():
    return {'ty': 'tr', 'p': {'a': 0, 'k': [0, 0]}, 'a': {'a': 0, 'k': [0, 0]}, 's': {'a': 0, 'k': [100, 100]},
            'r': {'a': 0, 'k': 0}, 'o': {'a': 0, 'k': 100}}

EASE = {'i': {'x': [0.42], 'y': [1]}, 'o': {'x': [0.58], 'y': [0]}}

def anim(keys, hold=False):
    """keys: [(t, value)] value scalar or list. Returns animated property."""
    if len(keys) == 1:
        v = keys[0][1]; return {'a': 0, 'k': v}
    ks = []
    for n, (t, v) in enumerate(keys):
        k = {'t': t, 's': v if isinstance(v, list) else [v]}
        if n < len(keys) - 1:
            if hold: k['h'] = 1
            else: k.update(EASE)
        ks.append(k)
    return {'a': 1, 'k': ks}

def ks(p=None, a=None, s=None, r=None, o=None):
    return {'o': o or {'a': 0, 'k': 100}, 'r': r or {'a': 0, 'k': 0}, 'p': p or {'a': 0, 'k': [0, 0, 0]},
            'a': a or {'a': 0, 'k': [0, 0, 0]}, 's': s or {'a': 0, 'k': [100, 100, 100]}}

LAYERS = []
def layer(nm, ty, ksd, shapes=None, parent=None, ip=0, op=None):
    ind = len(LAYERS) + 1
    L = {'ddd': 0, 'ind': ind, 'ty': ty, 'nm': nm, 'sr': 1, 'ks': ksd, 'ao': 0, 'ip': ip, 'op': op or TOTAL, 'st': 0, 'bm': 0}
    if shapes is not None: L['shapes'] = shapes
    if parent: L['parent'] = parent
    LAYERS.append(L)
    return ind

# ---------------------------------------------------------------- timeline
# Every mood starts and ends on HOME (centred, upright, smiling, no flames) and may pass through HOME
# at the frames listed in HOMES. A player only switches moods at a home frame, so changes never jump.
# 10-frame gaps of HOME between segments mean the boundary frame a player renders is always HOME too.

FR = 30
SEG = {'idle': (0, 150), 'greeting': (160, 220), 'thinking': (230, 320), 'talking': (330, 420)}
HOMES = {'idle': [0, 30, 60, 90, 120, 150], 'greeting': [0, 60], 'thinking': [0, 90], 'talking': [0, 30, 60, 90]}
TOTAL = 430
NECK = (272, 655)      # pivot in source-frame px
HOME = (266, 478)      # pivot on canvas
SC = 62                # head scale %

def pose_timeline():
    tl = [(0, 'smile')]
    i0 = SEG['idle'][0]
    tl += [(i0 + 98, 'wink'), (i0 + 112, 'smile')]
    g0 = SEG['greeting'][0]
    tl += [(g0, 'smile'), (g0 + 6, 'laughwink'), (g0 + 36, 'wink'), (g0 + 48, 'smile')]
    t0 = SEG['thinking'][0]
    tl += [(t0, 'smile'), (t0 + 66, 'wink'), (t0 + 80, 'smile')]
    k0 = SEG['talking'][0]
    flaps = [(2, 'open'), (6, 'smile'), (10, 'open'), (14, 'smile'), (19, 'open'), (23, 'smile'), (25, 'open'), (28, 'smile')]
    for c in range(3):
        if c == 1:
            tl += [(k0 + 30 + 2, 'open'), (k0 + 30 + 8, 'laughwink'), (k0 + 30 + 20, 'open'), (k0 + 30 + 24, 'smile')]
        else:
            tl += [(k0 + c * 30 + t, p) for t, p in flaps]
    tl.append((k0 + 90, 'smile'))
    return sorted(dict(tl).items())

def rig_motion():
    """Keys per segment in local frames: (t, dx, dy, rot, sx, sy). HOME = (0,0,0,1,1)."""
    H = (0, 0, 0, 1, 1)
    segs = {
        'idle': [(0, *H), (15, 0, -6, -3, .99, 1.02), (30, *H), (45, 0, -6, 3, .99, 1.02), (60, *H),
                 (66, 0, 4, 0, 1.04, .95), (74, 0, -20, -4, .96, 1.05), (82, 0, 2, 2, 1.03, .97), (90, *H),
                 (100, 2, -5, 6, 1, 1), (112, 0, -3, 3, 1, 1), (120, *H), (135, 0, -6, -3, .99, 1.02), (150, *H)],
        'greeting': [(0, *H), (6, 0, 8, 0, 1.07, .91), (16, 0, -36, -8, .94, 1.1), (22, 0, 4, 6, 1.06, .94),
                     (30, 0, -10, -3, .98, 1.03), (40, 0, 0, 3, 1, 1), (48, 0, -3, -1, 1, 1), (60, *H)],
        'thinking': [(0, *H), (12, -8, -14, -10, 1, 1), (30, -4, -20, -7, 1, 1), (50, -10, -14, -11, 1, 1),
                     (62, -6, -12, -9, 1.04, .95), (68, 0, -30, 4, .95, 1.06), (76, 0, 2, -2, 1.03, .97), (84, 0, -2, 1, 1, 1),
                     (90, *H)],
        'talking': [],
    }
    for c in range(3):
        b = c * 30
        segs['talking'] += [(b, *H), (b + 8, 3, -6, 3, 1.015, .985), (b + 16, -2, -2, -2, 1, 1), (b + 23, 2, -5, 2, 1.01, .99)]
    segs['talking'].append((90, *H))
    hx, hy = HOME
    P = []; R = []; S = []
    for name, keys in segs.items():
        a = SEG[name][0]
        for t, dx, dy, r, sx, sy in keys:
            P.append((a + t, [hx + dx, hy + dy, 0])); R.append((a + t, r)); S.append((a + t, [SC * sx, SC * sy, 100]))
    return P, R, S

def flame_path(h=36, w=20):
    # teardrop flame, tip up, origin at base centre
    v = [[0, -h], [w * 0.5, -h * 0.35], [0, 0], [-w * 0.5, -h * 0.35]]
    i = [[0, 0], [0, -h * 0.3], [w * 0.3, 0], [-w * 0.05, h * 0.28]]
    o = [[0, 0], [w * 0.05, h * 0.28], [-w * 0.3, 0], [0, -h * 0.3]]
    # make the tip curl slightly
    i[0] = [-w * 0.15, h * 0.25]; o[0] = [w * 0.2, h * 0.2]
    return {'ty': 'sh', 'ks': {'a': 0, 'k': {'i': i, 'o': o, 'v': v, 'c': True}}}

def flame_shapes(scale=1.0):
    outer = {'ty': 'gr', 'nm': 'flame', 'it': [flame_path(36 * scale, 22 * scale),
             {'ty': 'fl', 'c': {'a': 0, 'k': GREEN}, 'o': {'a': 0, 'k': 100}, 'r': 1}, tr()]}
    inner_tr = tr(); inner_tr['p'] = {'a': 0, 'k': [0, -3 * scale]}
    inner = {'ty': 'gr', 'nm': 'core', 'it': [flame_path(20 * scale, 10 * scale),
             {'ty': 'fl', 'c': {'a': 0, 'k': DARK}, 'o': {'a': 0, 'k': 100}, 'r': 1}, inner_tr]}
    return [inner, outer]

def main():
    global LAYERS
    LAYERS = []
    P, R, S = rig_motion()
    # layers are listed top-first; parent must exist, so build rig first and re-order at the end
    rig = layer('rig', 3, ks(p=anim(P), a={'a': 0, 'k': [NECK[0], NECK[1], 0]}, s=anim(S), r=anim(R)))

    # flames. Each finishes before the next home frame, so a mood switch never cuts one mid-flight.
    flames = []
    g0, g1 = SEG['greeting']
    for n in range(6):   # greeting burst from behind the head
        ang = math.radians(-160 + n * 28)
        sx, sy = NECK[0], 330
        ex, ey = sx + math.cos(ang) * 330, sy + math.sin(ang) * 300
        t0 = g0 + 8 + n * 2
        o = anim([(g0, 0), (t0, 0), (t0 + 3, 100), (t0 + 16, 100), (t0 + 24, 0)])
        p = anim([(t0, [sx, sy, 0]), (t0 + 24, [ex, ey, 0])])
        s = anim([(t0, [40, 40, 100]), (t0 + 8, [120, 120, 100]), (t0 + 24, [50, 50, 100])])
        r = anim([(t0, math.degrees(ang) + 90), (t0 + 24, math.degrees(ang) + 90)])
        flames.append(('burst%d' % n, ks(o=o, p=p, s=s, r=r), g0, g1))
    h0, h1 = SEG['thinking']
    for n in range(3):   # thinking "..." flames, two cycles, all gone by local frame 64
        bx, by = 505 + n * 48, 170 - n * 50
        keys_o = [(h0, 0)]; keys_s = []; keys_p = []
        for cycle in range(2):
            t0 = h0 + 14 + cycle * 24 + n * 5
            keys_o += [(t0, 0), (t0 + 5, 100), (t0 + 15, 100), (t0 + 20, 0)]
            keys_s += [(t0, [30, 30, 100]), (t0 + 7, [100 + n * 10, 100 + n * 10, 100]), (t0 + 20, [80, 80, 100])]
            keys_p += [(t0, [bx, by + 12, 0]), (t0 + 20, [bx, by - 6, 0])]
        keys_o.append((h1, 0))
        flames.append(('thought%d' % n, ks(o=anim(keys_o), p=anim(keys_p), s=anim(keys_s)), h0, h1))
    i0, i1 = SEG['idle']
    for n, (x, c) in enumerate([(200, 0), (330, 60), (250, 120)]):   # idle embers, one per chosen cell
        t0 = i0 + c + 3
        flames.append(('ember%d' % n, ks(o=anim([(i0, 0), (t0, 0), (t0 + 6, 90), (t0 + 22, 0)]),
                       p=anim([(t0, [x, 110, 0]), (t0 + 22, [x + 12, 20, 0])]),
                       s=anim([(t0, [50, 50, 100]), (t0 + 22, [25, 25, 100])])), i0, i1))
    k0, k1 = SEG['talking']
    for n, lt in enumerate([4, 18, 64, 78]):   # talking sparks, each inside one 30-frame cell
        t0 = k0 + lt
        flames.append(('spark%d' % n, ks(o=anim([(k0, 0), (t0, 0), (t0 + 3, 100), (t0 + 10, 0)]),
                       p=anim([(t0, [420, 520, 0]), (t0 + 10, [520 + n * 8, 470 - n * 14, 0])]),
                       s=anim([(t0, [70, 70, 100]), (t0 + 10, [110, 110, 100])]),
                       r=anim([(t0, 60), (t0 + 10, 80)])), k0, k1))
    SIZE = {'burst': 2.4, 'thought': 2.6, 'ember': 1.6, 'spark': 1.9}
    flame_ids = [layer(nm, 4, k, flame_shapes(SIZE[nm.rstrip('0123456789')]), parent=rig, ip=ip, op=op) for nm, k, ip, op in flames]

    # poses
    tl = pose_timeline()
    pose_ids = []
    for name, fid in POSES.items():
        keys = []
        for n, (t, p) in enumerate(tl):
            keys.append((t, 100 if p == name else 0))
        keys = [(0, keys[0][1])] + keys if keys[0][0] != 0 else keys
        # collapse repeats
        ck = []
        for t, v in keys:
            if not ck or ck[-1][1] != v: ck.append((t, v))
        o = anim(ck, hold=True) if len(ck) > 1 else {'a': 0, 'k': ck[0][1]}
        pose_ids.append(layer('pose_' + name, 4, ks(o=o), pose_shapes(fid), parent=rig))

    # order: flames on top, then poses, rig (null) last
    by = {L['ind']: L for L in LAYERS}
    front = [by[i] for i in flame_ids if by[i]['nm'].startswith(('thought', 'spark'))]
    back = [by[i] for i in flame_ids if not by[i]['nm'].startswith(('thought', 'spark'))]
    ordered = front + [by[i] for i in pose_ids] + back + [by[rig]]
    doc = {'v': '5.7.4', 'fr': FR, 'ip': 0, 'op': TOTAL, 'w': 512, 'h': 512, 'nm': 'Dan agent', 'ddd': 0, 'assets': [],
           'layers': ordered,
           'markers': [{'tm': a, 'cm': k, 'dr': b - a} for k, (a, b) in SEG.items()],
           'meta': {'g': 'build_lottie.py', 'homes': HOMES}}
    s = json.dumps(doc, separators=(',', ':'))
    open(OUT, 'w').write(s)
    print('wrote', OUT, len(s) // 1024, 'KB')

if __name__ == '__main__':
    main()
