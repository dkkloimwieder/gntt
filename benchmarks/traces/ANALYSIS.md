# Performance Analysis

Current best practices and benchmark summaries for the Gantt chart performance. For historical investigation details, see [HISTORY.md](./HISTORY.md).

---

## Quick Reference

| Category | Best Choice | Improvement |
|----------|-------------|-------------|
| Bar pattern | `nochildren` | 8.5% faster than `combined` |
| Reactive pattern | `baseline` (createMemo) | 5.5% faster than `noMemos` |
| Virtualization | `combined` (single memo) | 3% faster than `xySplit` |
| Arrows | `ArrowLayerBatched` + 2D virt | ~2.5% overhead (fixed from 21%) |
| Headers | Original `DateHeaders` | "Optimizations" were slower |
| Profiling tool | `perf.mjs` | Handles Chrome automatically |

**Critical:** Use clean URLs without `.html` extension when benchmarking with `serve`.

---

## Current Best Practices

### Bar Component Pattern

Use the `nochildren` pattern - detect resize zones from click position instead of child divs:

```javascript
const handleMouseDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    if (localX <= 6) startDrag(e, 'dragging_left', ...);
    else if (localX >= width - 6) startDrag(e, 'dragging_right', ...);
    else startDrag(e, 'dragging_bar', ...);
};
```

**Why:** Eliminates child DOM nodes (3 → 1 per bar), reduces DOM size and layout work.

### Reactive Pattern

Use single `createMemo` batching all props:

```javascript
const t = createMemo(() => {
    const task = getTask();
    const bar = task?._bar;
    return {
        x: bar?.x ?? 0,
        y: bar?.y ?? 0,
        width: bar?.width ?? 40,
        name: task?.name ?? '',
        colorBg: task?.color_bg,  // Pre-computed
    };
});
```

**Why:** Cached values prevent repeated store proxy traversals. Direct access (`noMemos`) causes 2.6x more effect execution.

### Pre-computed Values

Generate derived values at data creation time:

```javascript
// In task generator
{
    color: "#3b82f6",
    color_bg: "rgba(59,130,246,0.15)",    // Pre-computed
    color_fill: "rgba(59,130,246,0.3)",   // Pre-computed
}
```

**Why:** Eliminates runtime `hexToRgba` conversion (44ms overhead in noMemos variant).

### Virtualization

Use combined single-pass filtering:

```javascript
const visibleTasks = createMemo(() => {
    const rowRange = visibleRowRange();
    const xRange = visibleXRange();
    // Single loop filtering by both axes
});
```

**Why:** Split memos (xySplit) add overhead that outweighs caching benefit.

### Scroll Performance

1. **Cache scroll dimensions** before RAF loop:
   ```javascript
   const maxScrollH = scrollArea.scrollWidth - scrollArea.clientWidth;
   ```

2. **Track position in JS**, write to DOM once:
   ```javascript
   currentScrollH += hDir * 150;
   scrollArea.scrollLeft = currentScrollH;
   ```

**Why:** Reading `scrollWidth`/`scrollLeft` in RAF triggers layout thrashing (~27% overhead).

### Headers

- Use original `DateHeaders` (not DateHeadersOptimized)
- Day-only mode: `upperHeaderHeight={0}`
- Use `??` not `||` to allow 0 values: `props.upperHeaderHeight ?? 45`

**Why:** "Optimized" versions using spread operators or Index were 4-10% slower.

---

## Methodology

### Benchmarking Protocol

Single profile:

```bash
# Build + serve (port 5174 — note URL must omit `.html`)
pnpm build:demo
npx serve dist-demo -l 5174 &

# Run a single profile against perf-isolate
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs \
  'http://localhost:5174/examples/perf-isolate?bar=nochildren&test=horizontal' \
  --iterations 3 --warmup 1 --duration 3000 \
  --output benchmarks/traces/runs/my-test.json
```

Matrix benchmarks (npm aliases):

| Script | Purpose | Cost |
|---|---|---|
| `pnpm bench:browser` | 4 reactive variants × 2 dirs × 5 iter | ~3 min |
| `pnpm bench:browser:virt` | combined vs xySplit, 5 iter | ~80 s |
| `pnpm bench:browser:matrix` | 2 bars × 3 virts × 2 dirs × 3 iter | ~4 min |
| `pnpm bench` | Constraint engine, default linear-200 | ~2 s |
| `pnpm bench:all` | Constraint engine, all 13 datasets | ~30 s |

Each matrix script writes per-combo JSON to `benchmarks/traces/runs/`
and prints `Script Duration` / `Layout Duration` / `FPS` summaries.
All require `serve` running on port 5174 first.

| Parameter | Recommended | Notes |
|-----------|-------------|-------|
| iterations | 3-5 | More for noisy systems |
| warmup | 1-2 | Discarded before measuring |
| duration | 3000ms | Per iteration |

### Serve URL Gotcha

The `serve` package redirects `.html` URLs to clean URLs, **stripping query parameters**:

```bash
# WRONG - params get stripped
http://localhost:5174/examples/perf-isolate.html?bar=nochildren&test=horizontal

# CORRECT - params preserved
http://localhost:5174/examples/perf-isolate?bar=nochildren&test=horizontal
```

### Test Harnesses

| Harness | Purpose | URL |
|---------|---------|-----|
| perf-isolate | Progressive feature testing | `/examples/perf-isolate?bar=...&grid=1&headers=1` |
| experiments | Reactive pattern comparison | `/examples/experiments?variant=baseline` |
| perf | Full Gantt stress test | `/examples/perf` |

---

## Benchmark Results Summary

### Feature Overhead (perf-isolate, nochildren bar, H-scroll)

| Feature | Script Overhead | Layout Change | Notes |
|---------|-----------------|---------------|-------|
| Baseline | - | - | No features |
| Grid | +14.7% | +1.2% | SVG background |
| **Headers** | **+24.9%** | -0.6% | Biggest cost |
| Resources | +6.0% | -20.7% | Column rendering |
| Arrows | +5% | -5% | 2D virtualized, ~2.5% total |
| Full | +31.1% | -30.8% | All features |

### Bar Variant Comparison (10K tasks, Dec 2025)

| Variant | Script | vs Baseline |
|---------|--------|-------------|
| nochildren | 759.8ms | **Winner** |
| combined | 830.9ms | +9.4% |
| experiments | ~850ms | +12% |

### Post-Audit Baseline (2026-05-10)

After the dep upgrade chain + 5 component decompositions, the canonical
perf-isolate workload measures:

| Workload | Script | Layout | FPS | Long Tasks |
|---|---|---|---|---|
| `nochildren&test=horizontal` | 607 ms | 176 ms | 118 | 0 |
| `nochildren&grid=1&headers=1&resources=1&arrows=1&test=horizontal` | 944 ms | 412 ms | 115 | 0 |

−47 % script, −60 % layout vs Dec 2025 on bar-only. Treat these as the
new baseline. Traces in `runs/baseline-2026-05-10-*.json`. See
[HISTORY.md](./HISTORY.md#2026-05-10-post-audit-baseline-refresh) for
methodology and attribution.

### Reactive Pattern Comparison (10K tasks, Dec 2025)

| Pattern | Script | Effect Time | Notes |
|---------|--------|-------------|-------|
| baseline (memo) | 1133.8ms | 91ms | **Winner** |
| noMemos | 1196.8ms | 237ms | 2.6x more effects |

### Reactive Pattern + Virt Comparison (Post-Audit, 2026-05-10)

Measured against `experiments` harness (heavier than perf-isolate),
virt=combined unless noted, 5 iter + 1 warmup:

| Variant | H script | V script | H+V total | Winner? |
|---------|---------:|---------:|----------:|---|
| baseline (single memo)  | 1434 ms | 2002 ms | 3437 ms | |
| noMemos (direct access) | 1654 ms | 2189 ms | 3843 ms | |
| splitMemo (static+dyn)  | 1521 ms | 2272 ms | 3793 ms | |
| **minimal (no handlers)** | 1498 ms | 1855 ms | **3353 ms** | **+2.5%** |

**Note:** Minimal now leads baseline by ~2.5% combined, mostly from
V-scroll. The Dec 2025 baseline-wins finding may need re-examining —
absence of event handlers in the `minimal` variant is a real ergonomic
tradeoff, not a free win.

Virt mode (variant=baseline):

| Virt | H script | V script | H+V total |
|------|---------:|---------:|----------:|
| combined | 1338 ms | 1847 ms | **3185 ms** |
| xySplit  | 1303 ms | 1944 ms | 3247 ms (+1.9%) |

`combined` still wins overall by ~2%, consistent with Dec 2025.

---

### SolidJS 2.0.0-rc.6 vs 1.9.12 (2026-09-05, paired A/B)

Same machine, same day, same scripts; the two builds served side by side
(`main`'s 1.9.12 `dist-demo` next to `solid-2`'s rc.6 build) and profiled
in alternating blocks of 3 iterations (order flipped each round, 3 rounds,
9 samples per side per scenario, `perf.mjs --duration 3000`). Medians with
interquartile range; load average sampled every 5 s during the run.
Traces in `runs/solid2-rc6-2026-09-05/`.

**10K tasks** (`--tasks=10000 --resources=100 --dense`; every block ran at
load ≤ 3.7 — this is the reliable pass):

| Scenario | Metric | 1.9.12 | rc.6 | Δ |
|---|---|---:|---:|---:|
| perf-isolate `nochildren` H-scroll | script ms | 839 (IQR 401) | 798 (IQR 410) | −4.9 % |
| | task ms | 2127 | 2073 | −2.6 % |
| | layout ms | 143 | 141 | −1.9 % |
| | FPS | 101.0 | 106.5 | +5.4 % |
| | long tasks | 1 | 1 | 0 |
| experiments `baseline` H-scroll | script ms | 1307 (IQR 193) | 1491 (IQR 320) | **+14.0 %** |
| | task ms | 3900 | 4051 | +3.9 % |
| | layout ms | 532 | 503 | −5.4 % |
| | FPS | 66.6 | 65.0 | −2.4 % |
| | janky / long tasks | 4 / 27 | 4 / 27 | 0 |

**200 tasks** (tracked `calendar.json`; only blocks whose peak load stayed
under 4 are used — the 1.9 rounds 1–2 of perf-isolate were hit by load
spikes of 5.5–8.0 and are excluded):

| Scenario | Metric | 1.9.12 | rc.6 | Δ |
|---|---|---:|---:|---:|
| perf-isolate `nochildren` H-scroll (n=3/3) | script ms | 100 | 106 | +5.7 % |
| | task ms | 264 | 253 | −4.2 % |
| | FPS | 120 (pinned) | 120 (pinned) | 0 |
| experiments `baseline` H-scroll (n=6/6) | script ms | 348 | 522 | **+49.9 %** |
| | task ms | 1040 | 1439 | +38.4 % |
| | FPS | 120.6 (pinned) | 119.8 (pinned) | −0.6 % |

Reading:

- **Library scroll path (perf-isolate, the shipped `Bar`): parity to
  slightly better on rc.6.** At 10K every metric leans rc.6's way and FPS —
  below the 120 Hz pin at this workload, so discriminating — is +5 %. All
  deltas sit inside the interquartile overlap; no regression.
- **The `experiments` harness spends more script time on rc.6** (+14 % at
  10K, +50 % at 200 tasks) while task time, layout, FPS and jank barely
  move. That harness is the demo's own `baseline` reactive pattern — one
  `createMemo` per pooled bar — and rc.6 memos are **eager** (decision D7),
  so every pooled row's memo recomputes on each scroll update whether or
  not it is read. It is the pattern E4.5 exists to measure; the candidate
  fix is `{ lazy: true }` on the per-bar memos. It is not a library-path
  regression.
- Absolute numbers are **not** comparable with the 2026-05-10 baseline
  above (today's 1.9 run is ~40 % slower than that table on the same
  URL): the machine carried a background load of 1–3 even in "quiet"
  blocks and the 10K calendar was regenerated with `--dense
  --resources=100`, which may differ from the May dataset. Compare
  within a day, paired, or not at all.
- FPS is pinned at the 120 Hz display on the light workloads; use
  script/task ms there.

---

## Performance Floor

Unavoidable browser costs (~26% of total):

| Operation | Time | % |
|-----------|------|---|
| set scrollLeft | ~838ms | 26% |
| setProperty | ~251ms | 8% |

These are DOM operations that cannot be optimized away.

---

## Future Optimization Targets

### Not Yet Tested

| Target | Hypothesis | Priority |
|--------|------------|----------|
| Headers: Fixed slot pool | CSS transforms instead of DOM add/remove | Medium |
| Grid: Canvas rendering | Draw lines on canvas instead of SVG | Low |
| Custom equality everywhere | Prevent cascades from new object refs | Medium |

### Known Regressions

| Feature | Overhead | Status |
|---------|----------|--------|
| Arrows (ArrowLayerBatched) | ~2.5% | Fixed with 2D virtualization (Dec 23) |
| Debug effects in Bar.jsx | Creates subscriptions | Should be removed |

---

## Perf-Isolate URL Parameters

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `bar` | minimal, text, handles, reactive, drag, events, full, experiments, nochildren, contained, willchange, combined | minimal | Bar variant |
| `grid` | 0, 1 | 0 | Show SVG grid |
| `headers` | 0, 1 | 0 | Show date headers |
| `headerOpt` | 0, 1 | 0 | Use DateHeadersOptimized |
| `resources` | 0, 1 | 0 | Show resource column |
| `arrows` | 0, 1 | 0 | Show dependency arrows (2D virtualized) |
| `test` | horizontal, vertical, both | - | Auto-scroll direction |
| `memos` | 1 | 0 | Enable dummy memos |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/components/GanttPerfIsolate.jsx` | Feature isolation harness |
| `src/components/GanttExperiments.jsx` | Reactive pattern comparison |
| `src/components/ArrowLayerBatched.jsx` | 2D virtualized arrow rendering |
| `src/components/DateHeaders.jsx` | Original headers (optimal) |
| `src/components/DateHeadersOptimized.jsx` | Index-based headers (slower) |
| `perf-traces/runs/` | Benchmark JSON outputs |

---

## Historical Investigations

For detailed investigation logs and raw benchmark data, see [HISTORY.md](./HISTORY.md):

- 2025-12-23: Arrow 2D virtualization (X+Y filtering, ~2.5% overhead)
- 2025-12-23: Header optimization attempts (spread operator overhead)
- 2025-12-23: Day-only headers implementation
- 2025-12-21: Virtualization mode comparison (xySplit vs combined)
- 2025-12-21: Datetime rendering benchmarks
- 2025-12-21: Bar variant analysis with 10K tasks
