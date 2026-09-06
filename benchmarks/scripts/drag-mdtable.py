"""Render drag-bench.mjs runs as the markdown tables used in ANALYSIS.md.

usage: python3 benchmarks/scripts/drag-mdtable.py <dir-with-<variant>-r<n>.json>
Variants are recognised by file prefix (eager, lazyB, lazyBcfg, lazyALL — edit
`order`/`label` for other names). Medians are over the drags that actually
moved a bar; the n column counts those.
"""
import glob, json, os, re, statistics as st, sys
D = sys.argv[1].rstrip('/')
order = ['eager', 'lazyB', 'lazyBcfg', 'lazyALL']
label = {'eager': 'eager', 'lazyB': 'lazy-B', 'lazyBcfg': 'lazy-Bcfg', 'lazyALL': 'lazy-ALL'}
rows = {}
for f in sorted(glob.glob(f'{D}/*-r*.json')):
    m = re.search(r'/([A-Za-z]+)-r(\d+)\.json$', f); v, r = m.group(1), int(m.group(2))
    d = json.load(open(f)); drags = [x for x in d['drags'] if x.get('engaged')]
    sc = [x['scriptMs'] for x in drags]; tk = [x['taskMs'] for x in drags]
    rows.setdefault(v, []).append((r, st.median(sc), st.quantiles(sc, n=4), st.median(tk), d['median'].get('movedRate'), len(drags), len(d.get('errors') or [])))
loads = {}
try:
    for line in open(f'{D}/load.log'):
        t, l, tag = line.split()[:3]; loads[tag] = float(l)
except FileNotFoundError: pass
print('| Variant | Run | script ms per drag (median, IQR) | task ms per drag | moved | n (moved) | errors | load |')
print('|---|---|---:|---:|---:|---:|---:|---:|')
base = None
for v in order:
    for (r, ms, q, tk, mv, n, err) in sorted(rows.get(v, [])):
        if v == 'eager' and base is None: base = ms
        print(f"| {label[v]} | r{r} | {ms:.1f} (IQR {q[2]-q[0]:.1f}) | {tk:.1f} | {mv:.0%} | {n} | {err} | {loads.get(f'drag-{v}-r{r}', float('nan')):.1f} |")
# pooled per variant
print()
print('| Variant | pooled script ms per drag (median, IQR, n) | Δ vs eager |')
print('|---|---:|---:|')
pool = {}
for f in sorted(glob.glob(f'{D}/*-r*.json')):
    v = re.search(r'/([A-Za-z]+)-r\d+\.json$', f).group(1)
    pool.setdefault(v, []).extend(x['scriptMs'] for x in json.load(open(f))['drags'] if x.get('engaged'))
e = st.median(pool['eager']) if 'eager' in pool else None
for v in order:
    if v not in pool: continue
    xs = pool[v]; q = st.quantiles(xs, n=4); m = st.median(xs)
    d = f'{(m-e)/e*100:+.1f} %' if e else ''
    print(f'| {label[v]} | {m:.1f} (IQR {q[2]-q[0]:.1f}, n={len(xs)}) | {d} |')
