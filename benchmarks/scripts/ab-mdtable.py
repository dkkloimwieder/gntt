"""Render one ab-blocks.sh run dir as the markdown table used in ANALYSIS.md.

usage: python3 benchmarks/scripts/ab-mdtable.py <run-dir> <A-name> <B-name> <caption> [null-run-dir]

The last column compares each delta with the null floor: the largest |delta|
the SAME build produced against itself per metric. Pass the null run dir to
derive the floors from it; without it the E4.5 (2026-09-05) null values are
used. "overlapping IQRs — noise" marks a delta >= 3 % whose quartiles still
overlap; "noise" marks anything smaller; better/worse needs disjoint
quartiles AND a delta beyond the floor.
"""
import glob, json, os, re, statistics as st, sys
S, NA, NB, CAP = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3], sys.argv[4]
KEYS = [('scriptDuration','script ms',True),('taskDuration','task ms',True),('layoutDuration','layout ms',True),('fps','FPS',False),('longTaskCount','long tasks',True)]
DEFAULT_FLOORS = {"script ms": 3.1, "task ms": 0.1, "layout ms": 7.9, "FPS": 6.8, "long tasks": 14.3}
def null_floors(null_dir):
    fl = {}
    ns = sorted({re.search(r'/[AB]-(.+)-r\d+\.json$', f).group(1) for f in glob.glob(f'{null_dir}/*-r*.json')})
    for n in ns:
        a, b = samples('A', n, null_dir), samples('B', n, null_dir)
        for k, label, _ in KEYS:
            if len(a[k]) >= 3 and len(b[k]) >= 3 and st.median(a[k]):
                fl[label] = max(fl.get(label, 0.0), abs(st.median(b[k]) - st.median(a[k])) / st.median(a[k]) * 100)
    return fl

names = sorted({re.search(r'/[AB]-(.+)-r\d+\.json$', f).group(1) for f in glob.glob(f'{S}/*-r*.json')})
def samples(tag, name, base=None):
    out = {k: [] for k,_,_ in KEYS}
    for f in sorted(glob.glob(f'{base or S}/{tag}-{name}-r*.json')):
        try: runs = json.load(open(f)).get('runs') or []
        except Exception: continue
        for r in runs:
            for k,_,_ in KEYS:
                v = r.get(k)
                if isinstance(v,(int,float)): out[k].append(float(v))
    return out
loads=[]
try:
    for line in open(f'{S}/load.log'):
        t,v=line.split()[:2]; loads.append(float(v))
except FileNotFoundError: pass
FLOORS = null_floors(sys.argv[5]) if len(sys.argv) > 5 else DEFAULT_FLOORS
ld = f'load per block min {min(loads):.1f} / median {st.median(loads):.1f} / max {max(loads):.1f}' if loads else ''
print(f'{CAP} ({ld}):\n')
print(f'| Scenario | Metric | {NA} | {NB} | Δ | vs null floor |')
print('|---|---|---:|---:|---:|---|')
for name in names:
    a,b = samples('A',name), samples('B',name)
    first=True
    for k,label,lower in KEYS:
        x,y=a[k],b[k]
        if len(x)<3 or len(y)<3: continue
        qx,qy=st.quantiles(x,n=4),st.quantiles(y,n=4); mx,my=st.median(x),st.median(y)
        d=(my-mx)/mx*100 if mx else float('nan')
        disjoint=(qy[0]>qx[2]) or (qx[0]>qy[2])
        floor = FLOORS[label]
        if abs(d) < 3.0: v='noise'
        elif not disjoint: v='overlapping IQRs — noise'
        elif abs(d) <= floor: v='noise (inside null floor)'
        else: v=('**better**' if ((d<0)==lower) else '**worse**')+f' (beyond {floor:.0f} % null spread)'
        fmt=(lambda m,q: f'{m:.0f} (IQR {q[2]-q[0]:.0f})') if label!='FPS' else (lambda m,q: f'{m:.1f} (IQR {q[2]-q[0]:.1f})')
        print(f"| {name + f' (n={len(x)}/{len(y)})' if first else ''} | {label} | {fmt(mx,qx)} | {fmt(my,qy)} | {d:+.1f} % | {v} |")
        first=False
