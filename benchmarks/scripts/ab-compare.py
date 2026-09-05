"""Compare the two sides of an ab-blocks.sh run.

usage: python3 benchmarks/scripts/ab-compare.py benchmarks/traces/runs/ab/<label> [A-name] [B-name]

Pools every iteration of every block per side, prints medians with the
interquartile range, and calls a delta only when the two IQRs are disjoint
and |delta| >= 3 % — anything else is reported as "within noise". FPS is
pinned at the display refresh rate on light workloads (use script/task ms
there); on the dense 10K workload it sits below the pin and discriminates.
"""
import glob, json, os, re, statistics as st, sys

S = sys.argv[1].rstrip('/')
NA = sys.argv[2] if len(sys.argv) > 2 else 'A'
NB = sys.argv[3] if len(sys.argv) > 3 else 'B'
KEYS = [('scriptDuration', 'script ms', True), ('taskDuration', 'task ms', True), ('layoutDuration', 'layout ms', True),
        ('fps', 'FPS', False), ('jankyFrames', 'janky', True), ('longTaskCount', 'long tasks', True), ('frameCount', 'frames', False)]
names = sorted({re.search(r'/[AB]-(.+)-r\d+\.json$', f).group(1) for f in glob.glob(f'{S}/*-r*.json')})

def samples(tag, name):
    out = {k: [] for k, _, _ in KEYS}
    for f in sorted(glob.glob(f'{S}/{tag}-{name}-r*.json')):
        try:
            runs = json.load(open(f)).get('runs') or []
        except Exception:
            continue
        for r in runs:
            for k, _, _ in KEYS:
                v = r.get(k)
                if isinstance(v, (int, float)):
                    out[k].append(float(v))
    return out

print(f'{os.path.basename(S)}: {NA} vs {NB}')
for name in names:
    a, b = samples('A', name), samples('B', name)
    print(f"\n== {name}  ({NA} n={len(a['scriptDuration'])}, {NB} n={len(b['scriptDuration'])}) ==")
    print(f"  {'metric':10s} {NA + ' median':>12s} {'IQR':>7s} {NB + ' median':>12s} {'IQR':>7s} {'delta':>7s}  verdict")
    for k, label, lower in KEYS:
        x, y = a[k], b[k]
        if len(x) < 3 or len(y) < 3:
            continue
        qx, qy = st.quantiles(x, n=4), st.quantiles(y, n=4)
        mx, my = st.median(x), st.median(y)
        d = (my - mx) / mx * 100 if mx else float('nan')
        disjoint = (qy[0] > qx[2]) or (qx[0] > qy[2])
        if not disjoint or abs(d) < 3:
            v = '≈ within noise'
        else:
            v = f'{NB} better' if ((d < 0) == lower) else f'{NB} WORSE'
        print(f'  {label:10s} {mx:12.1f} {qx[2]-qx[0]:7.1f} {my:12.1f} {qy[2]-qy[0]:7.1f} {d:+6.1f}%  {v}')

# per-block peak load, from load.log samples taken after each block
loads = []
try:
    for line in open(f'{S}/load.log'):
        t, v = line.split()
        loads.append((int(t), float(v)))
except FileNotFoundError:
    pass
if loads:
    print(f'\nload samples: n={len(loads)} min={min(v for _, v in loads):.2f} median={st.median(v for _, v in loads):.2f} max={max(v for _, v in loads):.2f}  (blocks measured above ~4 are suspect; see run.log)')
