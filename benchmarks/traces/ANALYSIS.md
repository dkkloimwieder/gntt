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

### Memo laziness (E4.5, 2026-09-05) — decision D7: eager everywhere

**Question.** rc.6 memos are eager. The rc.6-vs-1.9 table above showed the
`experiments` harness's per-bar-memo pattern spending +14 % (10K) / +50 %
(200 tasks) script time with FPS unchanged, and the hypothesis was eager
recomputes of pooled memos nobody reads. `createMemo(fn, { lazy: true })`
was the candidate fix. This section is the measurement D7 asked for.

**What `{ lazy: true }` does in rc.6** (read from
`@solidjs/signals` 2.0.0-rc.6 `dist/dev.js`; every line below is pinned by
`tests/memoLaziness.test.ts`, which fails if a runtime bump changes it):

- Creation skips the first compute (`dev.js:4469`) — the only work it saves
  *at creation time*, repaid in full on the first read (`prepareComputed`,
  `:4588`), which also clears `REACTIVE_LAZY` (`:4589`) for good: laziness is
  a one-shot creation property plus a lifecycle change, never re-armed. The
  node, its owner splice and its height are still allocated. (A lazy node is
  also skipped by creation-time snapshot capture, `:4470`.)
- It sets `CONFIG_AUTO_DISPOSE` (`:4291`) — the same bit a memo created with
  **no owner** gets without asking. The memo is torn down when its last
  tracked subscriber unlinks (`unlinkSubs`, `:2880-2892`) and again on every
  flush that follows an *ownerless* read (`read()` queues it in
  `dormantNodes`, `:4867-4882`; `sweepDormant` runs at the top of
  `flush()`, `:1813`). Ownerless = event handler, timer, rAF, promise
  continuation, **an effect's apply phase** (`runEffect`, `:6236`, installs
  no context), `untrack` at a root, and the unowned `onSettled` form. An
  *owned* `onSettled` body and `untrack` inside a computed are **not**
  ownerless.
- Propagation has no lazy branch: `insertSubs` / `enqueueSub` /
  `insertIntoHeap` / `runHeap` never test `REACTIVE_LAZY`. A lazy memo with
  a live tracked subscriber recomputes **during the flush, exactly as often
  as an eager one**.
- Consequences measured in `tests/memoLaziness.test.ts` (11 cases; the
  shapes below are cases 1–4, 7, 8 and 11): tracked
  reader → 1 + 5 body runs after 5 writes, lazy and eager alike; no reader →
  eager 6, lazy 0; handler-only reads with a flush between them → eager 1,
  **lazy 5** (one full recompute per tick it is read in); the same from an
  effect apply (lazy 5 body runs over 5 applies with an unchanging source,
  eager 1); `equals` stops the reader, never the body — `{ equals }` is not a
  cheaper substitute for laziness. A memo behind a `<Show>` is the one shape
  lazy is for: eager 3 body runs while hidden and re-shown, lazy 2.
- The built-in profiler cannot see any of this: dormancy revivals are
  `create` recomputes, which `attribution.costs()` / `HOT_SCOPE_RERUNS`
  skip. A misplaced `{ lazy: true }` is invisible to diagnostics.

**Direct evidence — recompute counts** (`benchmarks/scripts/memo-recompute-probe.mjs`
against a 10K-dense build of `experiments.html?variant=baseline&virt=combined`;
the harness carries a counter on `TestBarBaseline`'s per-bar memo and a
`?lazy=1` switch, so both arms are the same build; headless Chrome on a
private port with a 1503×786 scroll area — counts, not timings, so the
headless viewport is fine; 30 scroll steps per axis, two rAFs plus a
macrotask per step; eager arm first, one pass — counts are deterministic
enough that block interleaving is not needed):

| | eager | `{ lazy: true }` |
|---|---:|---:|
| bars created at mount | 984 | 984 |
| memo recomputes at mount | 1 786 | 1 786 |
| recomputes per horizontal step (100 px, mean of 30) | 1 072.5 | 1 072.5 |
| recomputes per vertical step (60 px, mean of 30) | 1 054.4 | 1 054.4 |
| on-screen bars after the sweeps | 1 080 / 1 066 | 1 080 / 1 066 |

Byte-identical per-step arrays across all 120 samples. The reason is the
pool: `<For keyed={false}>` reuses row *i* and rewrites its item signal when
the visible window shifts, so essentially every on-screen bar's memo is
invalidated on every scroll step **because it is subscribed by its JSX**,
and laziness changes nothing for a subscribed memo. The +14 % / +50 % is
per-row invalidation cost under 2.0, not eager waste; there is no unread
memo to defer.

**Reader census** (adversarially verified; line numbers as of `main` @
`3d67fcb` — the E4.5 commit moves `getAllDateInfos` to `:402`, the
experiments `t` memo to `:274` and `staticProps`/`dynamicProps` to
`:442`/`:453`):

| Candidate | Tracked readers, always present while mounted | Lazy could save |
|---|---|---|
| `GanttExperiments.tsx:227` per-bar `t` (and `:411`/`:422`) | 2 permanent JSX subscribers per row (its style effect and its text insert); 5 further `t()` sites are event handlers | nothing (counted above) |
| `useBarConfig.ts:37-70`, 7 memos per `<Bar>` | JSX attributes/styles, `progressWidth` / `expectedProgressWidth` memos; also read from drag/keyboard handlers — mixed reads never enter dormancy (`!el._subs` guard) | nothing; sources change only on config writes |
| `ganttDateStore.ts:399` `getAllDateInfos` | the eager `dateInfos` memo at `Gantt.tsx:394`, whose creation-time compute subscribes before any JSX exists (then read from the header/grid JSX at `:665`/`:724`) | nothing — the wrapper pulls it in its creation tick (pinned by test case 9) |
| `useGanttModals.ts:106-136`, 5 memos | `TaskDataPopup.tsx:17-22` / `TaskDataModal.tsx:20` create their `formattedData` / `formatted` memo in the component body, **outside** the `<Show>`; each memo early-returns on a null id anyway | nothing |

Every memo in `src/` that has a live consumer and still spends time with
zero tracked subscribers is read from an ownerless scope while
unsubscribed — the shape lazy makes *worse* (next paragraph). None has the
shape lazy is for — periods with no subscriber **and** no ownerless read
(test case 8). The one memo that had that shape at measurement time,
`createVirtualViewport.ts:121` `yRange`, had it only because nothing read
it at all; `gantt-avv.9` deleted it rather than flag it.

**What "lazy everywhere" would cost.** Flipping every `createMemo` outside
`src/demo/` — 165 sites, 75 in the library proper and 90 in the
`@ts-nocheck` harness `src/entries/index-test.tsx` — (`lazy-ALL` variant)
passes the whole gate — 27 files / 539 tests, tsc, lint (27 files / 539 tests is main's count at `3d67fcb`; this commit adds
one file and 11 tests) — because nothing in the suite distinguishes lazy
from eager. Read from the code, not measured: four library memos have only
ownerless readers. Two would churn in the measured builds —
`TaskLayer.tsx:91` `relationshipIndex` (re-read from `handleConstrainPosition`
on every drag move) and `SummaryBar.tsx:83` `columnWidth` (per drag move of
a summary bar). Two are the same hazard for a consumer but do not churn
in-repo: `resourceStore.ts:76` `resourceIndexMap` is read once per setup
from the setup effect's *apply* (`ganttSetup.ts:127`), where lazy trades
one recompute per setup for eager's recompute per group toggle, and `:133`
`getGroups` is read only by the public `collapseAll`, which nothing in-repo
calls — lazy, it never computes. The one pure win was
`createVirtualViewport.ts:121` `yRange`, which had no reader at all; it is
counted in the 165 sites above and was deleted afterwards (`gantt-avv.9`).

**Paired A/B, browser, 10K dense** (`benchmarks/scripts/ab-blocks.sh`, 3
rounds × 3 iterations × 3 s per side per scenario, order flipped per round,
eager = `main` @ `3d67fcb` served on one port, each variant = that commit
plus only the `{ lazy: true }` additions, built the same way and served on
another — none of the A/B builds carries the probe instrumentation; traces
in `runs/ab/e45-*`). An unrelated compile loaded the machine
during the null and lazy-A pairs (load average per block 2–12, median ~6);
the lazy-B, lazy-Bcfg, lazy-ALL and drag runs ran quiet (≤ 3.1). The run
starts with a **null test — eager against itself** — to bound the noise
before reading any variant:

Null test — the same eager build on both sides (load per block min 1.2 / median 5.7 / max 12.5):

| Scenario | Metric | eager | eager-again | Δ | vs null floor |
|---|---|---:|---:|---:|---|
| exp-h (n=15/15) | script ms | 1521 (IQR 315) | 1473 (IQR 323) | -3.1 % | overlapping IQRs — noise |
|  | task ms | 4102 (IQR 720) | 4099 (IQR 716) | -0.1 % | noise |
|  | layout ms | 517 (IQR 120) | 521 (IQR 105) | +0.7 % | noise |
|  | FPS | 63.3 (IQR 4.2) | 63.0 (IQR 5.4) | -0.5 % | noise |
|  | long tasks | 21 (IQR 12) | 18 (IQR 10) | -14.3 % | overlapping IQRs — noise |
| perf-h (n=9/9) | script ms | 1688 (IQR 269) | 1727 (IQR 605) | +2.3 % | noise |
|  | task ms | 3716 (IQR 679) | 3716 (IQR 1459) | +0.0 % | noise |
|  | layout ms | 208 (IQR 24) | 192 (IQR 48) | -7.9 % | noise (inside null floor) |
|  | FPS | 75.4 (IQR 8.6) | 70.3 (IQR 10.0) | -6.8 % | overlapping IQRs — noise |
|  | long tasks | 12 (IQR 2) | 13 (IQR 4) | +8.3 % | overlapping IQRs — noise |

The null test's own deltas — up to 3 % script, 8 % layout and
7 % FPS between two copies of the same build — are the floor a variant
delta has to clear to mean anything; the runner's disjoint-IQR rule alone
fires spuriously under this load (its one disjoint cell below, the null's
perf-h layout −7.9 %, is exactly that). The null's scroll scenario was
extended to five rounds once the machine went quiet; a sixth was cut
mid-way and is not on disk. "Load per block" in the captions is the
1-minute load average sampled right after each block. In the tables,
"overlapping IQRs — noise" marks a delta of 3 % or more whose quartiles
still overlap; "noise" marks anything smaller.

lazy-A — the three experiments per-bar memos lazy (`t`, `staticProps`, `dynamicProps`) (load per block min 1.8 / median 5.5 / max 9.5):

| Scenario | Metric | eager | lazy-A | Δ | vs null floor |
|---|---|---:|---:|---:|---|
| exp-h (n=9/9) | script ms | 1621 (IQR 537) | 2005 (IQR 476) | +23.7 % | overlapping IQRs — noise |
|  | task ms | 4515 (IQR 1017) | 4782 (IQR 424) | +5.9 % | overlapping IQRs — noise |
|  | layout ms | 488 (IQR 122) | 415 (IQR 176) | -15.1 % | overlapping IQRs — noise |
|  | FPS | 63.4 (IQR 2.3) | 62.1 (IQR 1.2) | -2.1 % | noise |
|  | long tasks | 18 (IQR 6) | 13 (IQR 7) | -27.8 % | overlapping IQRs — noise |
| exp-v (n=9/9) | script ms | 1733 (IQR 1103) | 1648 (IQR 257) | -4.9 % | overlapping IQRs — noise |
|  | task ms | 4688 (IQR 1720) | 4413 (IQR 600) | -5.9 % | overlapping IQRs — noise |
|  | layout ms | 425 (IQR 319) | 512 (IQR 147) | +20.5 % | overlapping IQRs — noise |
|  | FPS | 62.3 (IQR 1.9) | 63.1 (IQR 0.8) | +1.3 % | noise |
|  | long tasks | 15 (IQR 10) | 18 (IQR 4) | +20.0 % | overlapping IQRs — noise |
| split-h (n=9/9) | script ms | 1769 (IQR 852) | 2083 (IQR 718) | +17.7 % | overlapping IQRs — noise |
|  | task ms | 5118 (IQR 1749) | 5010 (IQR 1245) | -2.1 % | noise |
|  | layout ms | 473 (IQR 118) | 446 (IQR 194) | -5.6 % | overlapping IQRs — noise |
|  | FPS | 61.6 (IQR 0.9) | 62.2 (IQR 1.3) | +1.0 % | noise |
|  | long tasks | 16 (IQR 10) | 14 (IQR 4) | -12.5 % | overlapping IQRs — noise |

lazy-B — the 13 Tier B library memos lazy (7 `useBarConfig`, `getAllDateInfos`, 5 `useGanttModals`); perf.html = the real `<Gantt>` + `Bar` at 10K (load per block min 0.5 / median 1.2 / max 2.3):

| Scenario | Metric | eager | lazy-B | Δ | vs null floor |
|---|---|---:|---:|---:|---|
| perf-h (n=9/9) | script ms | 1703 (IQR 363) | 1684 (IQR 509) | -1.1 % | noise |
|  | task ms | 3709 (IQR 678) | 3706 (IQR 832) | -0.1 % | noise |
|  | layout ms | 159 (IQR 53) | 166 (IQR 25) | +4.6 % | overlapping IQRs — noise |
|  | FPS | 77.0 (IQR 6.9) | 78.8 (IQR 9.3) | +2.3 % | noise |
|  | long tasks | 13 (IQR 6) | 12 (IQR 7) | -7.7 % | overlapping IQRs — noise |
| perf-reload (n=9/9) | script ms | 303 (IQR 206) | 332 (IQR 141) | +9.4 % | overlapping IQRs — noise |
|  | task ms | 627 (IQR 396) | 689 (IQR 273) | +9.9 % | overlapping IQRs — noise |
|  | layout ms | 1 (IQR 0) | 1 (IQR 0) | +2.4 % | noise |
|  | FPS | 61.4 (IQR 0.1) | 61.4 (IQR 0.1) | +0.0 % | noise |
|  | long tasks | 1 (IQR 0) | 1 (IQR 0) | +0.0 % | noise |

lazy-Bcfg — only the 7 `useBarConfig` memos lazy (one set per mounted `Bar`) (load per block min 0.3 / median 1.2 / max 2.0):

| Scenario | Metric | eager | lazy-Bcfg | Δ | vs null floor |
|---|---|---:|---:|---:|---|
| perf-h (n=9/9) | script ms | 1575 (IQR 209) | 1635 (IQR 196) | +3.8 % | overlapping IQRs — noise |
|  | task ms | 3482 (IQR 303) | 3490 (IQR 368) | +0.2 % | noise |
|  | layout ms | 185 (IQR 23) | 198 (IQR 22) | +6.8 % | overlapping IQRs — noise |
|  | FPS | 81.6 (IQR 3.6) | 81.0 (IQR 5.2) | -0.7 % | noise |
|  | long tasks | 14 (IQR 4) | 14 (IQR 4) | +0.0 % | noise |
| perf-reload (n=9/9) | script ms | 308 (IQR 68) | 297 (IQR 62) | -3.6 % | overlapping IQRs — noise |
|  | task ms | 633 (IQR 117) | 621 (IQR 120) | -1.8 % | noise |
|  | layout ms | 1 (IQR 0) | 1 (IQR 0) | +3.9 % | overlapping IQRs — noise |
|  | FPS | 61.4 (IQR 0.1) | 61.4 (IQR 0.1) | +0.0 % | noise |
|  | long tasks | 1 (IQR 0) | 1 (IQR 0) | +0.0 % | noise |

lazy-ALL — every `createMemo` outside `src/demo/` lazy (165 sites) plus the three experiments memos: the lazy-by-default upper bound (load per block min 0.7 / median 1.5 / max 3.1):

| Scenario | Metric | eager | lazy-ALL | Δ | vs null floor |
|---|---|---:|---:|---:|---|
| exp-h (n=9/9) | script ms | 1505 (IQR 149) | 1540 (IQR 93) | +2.3 % | noise |
|  | task ms | 3984 (IQR 244) | 4096 (IQR 229) | +2.8 % | noise |
|  | layout ms | 470 (IQR 73) | 467 (IQR 74) | -0.7 % | noise |
|  | FPS | 64.5 (IQR 3.6) | 64.6 (IQR 1.2) | +0.2 % | noise |
|  | long tasks | 24 (IQR 4) | 24 (IQR 4) | +0.0 % | noise |
| isolate-h (n=9/9) | script ms | 1059 (IQR 448) | 1091 (IQR 561) | +3.0 % | overlapping IQRs — noise |
|  | task ms | 2548 (IQR 922) | 2840 (IQR 1184) | +11.5 % | overlapping IQRs — noise |
|  | layout ms | 133 (IQR 10) | 127 (IQR 37) | -4.5 % | overlapping IQRs — noise |
|  | FPS | 99.0 (IQR 16.8) | 93.4 (IQR 19.5) | -5.7 % | overlapping IQRs — noise |
|  | long tasks | 1 (IQR 1) | 1 (IQR 4) | +0.0 % | noise |
| perf-h (n=9/9) | script ms | 1617 (IQR 247) | 1619 (IQR 297) | +0.1 % | noise |
|  | task ms | 3531 (IQR 361) | 3551 (IQR 475) | +0.6 % | noise |
|  | layout ms | 181 (IQR 26) | 158 (IQR 64) | -12.8 % | overlapping IQRs — noise |
|  | FPS | 80.7 (IQR 4.2) | 79.3 (IQR 4.3) | -1.7 % | noise |
|  | long tasks | 12 (IQR 3) | 12 (IQR 2) | +0.0 % | noise |
| perf-reload (n=9/9) | script ms | 377 (IQR 134) | 378 (IQR 60) | +0.4 % | noise |
|  | task ms | 776 (IQR 250) | 771 (IQR 139) | -0.7 % | noise |
|  | layout ms | 1 (IQR 0) | 1 (IQR 0) | -2.8 % | noise |
|  | FPS | 61.3 (IQR 0.3) | 61.4 (IQR 0.0) | +0.2 % | noise |
|  | long tasks | 1 (IQR 0) | 1 (IQR 0) | +0.0 % | noise |

Reading the four pairs. The three library pairs (lazy-B, lazy-Bcfg,
lazy-ALL) ran quiet and sit inside the null floor on every metric; FPS —
the most stable metric here — never moves more than the null moved it.
lazy-A is the one pair with a lean: +23.7 % script on exp-h and +17.7 % on
split-h, quartiles overlapping, same sign in all three exp-h rounds. Every
lazy-A block ran under the compile (1.8–9.5, median 5.5), and the
like-for-like yardstick is not the pooled five-round null but the null's own
three loaded rounds (n=9, same shape): +11.1 % between two copies of the
same build, with per-round swings of -18.3 %, -12.7 % and +32.0 %
(the two quiet null rounds alone: +1.6 %). lazy-A's lean is about twice
that floor and inside that swing, and in two of the three exp-h rounds the
eager side carried the heavier load and still came out faster, so load does
not explain it away either. The planned quiet lazy-A re-run was stopped
before it produced a single block (the null's sixth round was the one cut
mid-way, and is not on disk), so **lazy-A is unresolved under load** and
the decision does not rest on it. What does bear on it: the quiet-machine
lazy-ALL pair profiles the identical URL with the same three memos flipped
plus the roughly dozen library memos `experiments.html` actually mounts
(`GanttContainer`, `Grid`, `DateHeaders`, `ResourceColumn`, `useDrag` — all
permanently subscribed from JSX, the case laziness provably cannot change;
the other flipped sites, `index-test.tsx`'s 90 included, are not on that
page) and moves script by +2.3 % with quartiles a quarter to a fifth the
size; and the probe above counted identical recomputes. `perf-reload`
catches only the tail of the 10K remount (the runner's 500 ms click settle
precedes the trace), so its 300 ms script windows say little either way.

**Drag gestures on the real `Bar`** (`benchmarks/scripts/drag-bench.mjs`
against each build's `perf.html` at 10K, headed Chrome on a private port, 12
drags of 12 × 8 px per run, two runs per side, run after the blocks on a
quiet machine, results in `runs/ab/e45-drag/` with the chain's own
`load.log`; medians are over the eight drags per run that actually moved a
bar — including the four that did not changes eager 6.0 → 5.9 and lazy-ALL
5.8 → 5.6 and no verdict. A drag calls `onConstrainPosition` on every move,
which under lazy-ALL re-reads `relationshipIndex` from an ownerless scope
each time — test case 11's treadmill, on the 1 975 dependency edges of the
regenerated 10K set (seed 12345):

| Variant | Run | script ms per drag (median, IQR) | task ms per drag | moved | n (moved) | errors | load |
|---|---|---:|---:|---:|---:|---:|---:|
| eager | r1 | 5.9 (IQR 2.6) | 106.9 | 67% | 8 | 0 | 2.6 |
| eager | r2 | 6.2 (IQR 4.5) | 123.5 | 67% | 8 | 0 | 2.9 |
| lazy-B | r1 | 6.4 (IQR 3.6) | 112.5 | 67% | 8 | 0 | 2.8 |
| lazy-B | r2 | 6.5 (IQR 4.3) | 116.1 | 67% | 8 | 0 | 2.9 |
| lazy-Bcfg | r1 | 6.0 (IQR 2.9) | 109.5 | 67% | 8 | 0 | 2.8 |
| lazy-Bcfg | r2 | 7.0 (IQR 4.2) | 117.3 | 67% | 8 | 0 | 2.7 |
| lazy-ALL | r1 | 5.8 (IQR 4.4) | 112.8 | 67% | 8 | 0 | 2.7 |
| lazy-ALL | r2 | 5.8 (IQR 2.9) | 112.8 | 67% | 8 | 0 | 2.6 |

| Variant | pooled script ms per drag (median, IQR, n) | Δ vs eager |
|---|---:|---:|
| eager | 6.0 (IQR 2.7, n=16) | +0.0 % |
| lazy-B | 6.5 (IQR 3.6, n=16) | +7.2 % |
| lazy-Bcfg | 6.3 (IQR 3.7, n=16) | +4.4 % |
| lazy-ALL | 5.8 (IQR 3.0, n=16) | -2.8 % |

The treadmill (case 11) does not show up here, and the cost model says it
should have: `buildRelationshipIndex` over 1 975 edges takes ~0.36 ms in
node, and twelve rebuilds per drag would be ~4 ms on a 6 ms drag, yet
lazy-ALL measures 5.8 ms against eager's 6.0. Either the synthetic gesture
does not drive the constraint path the way the model assumes, or the
recompute is far cheaper in the page than in the micro-benchmark — no
artifact here counts `relationshipIndex` body runs during a drag, so this
is unresolved (follow-up `gantt-avv.9`) and does not bear on the decision, which
rests on the mechanism and the scroll pairs. Four of the twelve drags per
run register no net movement, at the same indices on every side: two cost
~1 ms of script (the gesture never engaged the bar) and two cost a full
drag's worth (moved and constrained back). The pattern is identical on
every side, so it does not bias the comparison.

**Decision (D7, final).** Memos stay eager everywhere; no `{ lazy: true }`
is applied in the library (the only one in the tree is the demo's `?lazy=1`
probe switch). The rule for future code, now in CLAUDE.md rule 7: use
`lazy` only for a memo that has periods with zero tracked subscribers
**and** is never read from an ownerless scope (handler, timer, rAF, effect
apply) while unsubscribed **and** is not read by an eager memo in its
creation tick. The third condition has no grep, lint or runtime diagnostic —
it is checked by reading the wrapper chain by hand. None exists in `src/`
today. The
`experiments` script-time gap against 1.9 belongs to the per-row
invalidation path (`<For keyed={false}>` pool + row-signal rewrite), which
is E4.7/E5.1 territory, not a laziness question.

**Reproduce.**

```bash
# 1. 10K dense build of the current tree (carries the probe instrumentation)
pnpm generate:calendar --tasks=10000 --resources=100 --dense   # pnpm forwards the flags to tsx
npx vite build --config config/vite/demo.js --outDir dist-demo-10k
# (restore src/data/generated/calendar.json only after step 3 has copied it)
# 2. recompute counts, both arms from that one build (needs window.__memoStats
#    and ?lazy=1, i.e. src/demo/GanttExperiments.tsx as of the E4.5 commit)
node benchmarks/scripts/memo-recompute-probe.mjs dist-demo-10k memo-recompute-probe.json
# 3. a variant = a git worktree with `{ lazy: true }` added to the memos under
#    test (lazy-ALL: every createMemo( / createMemo<T>( outside src/demo/,
#    merging into any existing options object), built the same way
git worktree add ../gantt-lazy main && (cd ../gantt-lazy && <edit memos> && pnpm install --offline && \
  cp ../gantt/src/data/generated/calendar.json src/data/generated/ && npx vite build --config config/vite/demo.js --outDir dist-demo-10k)
git checkout -- src/data/generated/calendar.json           # now restore the 200-task fixture
(cd dist-demo-10k && python3 -m http.server 5178 --bind 127.0.0.1 &)               # eager
(cd ../gantt-lazy/dist-demo-10k && python3 -m http.server 5179 --bind 127.0.0.1 &) # variant
# 4. paired blocks (nothing else may drive Chrome meanwhile — not the probe, not drag-bench)
SCENARIOS='exp-h|experiments.html?variant=baseline&virt=combined&test=horizontal;perf-h|perf.html|button:nth-of-type(2)' \
  benchmarks/scripts/ab-blocks.sh eager-vs-variant 5178 5179 3
python3 benchmarks/scripts/ab-compare.py benchmarks/traces/runs/ab/eager-vs-variant eager variant
# 5. drag gestures on the real Bar (perf.html), one run per side, after the blocks
node benchmarks/scripts/drag-bench.mjs http://localhost:5178/examples/perf.html --drags 12 --out drag-eager.json
node benchmarks/scripts/drag-bench.mjs http://localhost:5179/examples/perf.html --drags 12 --out drag-variant.json
pkill -f 'http.server 5178'; pkill -f 'http.server 5179'      # the two static servers (never pkill chrome)
# 6. the semantics, pinned
pnpm exec vitest run tests/memoLaziness.test.ts --project client
```

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
| `src/demo/GanttPerfIsolate.tsx` | Feature isolation harness |
| `src/demo/GanttExperiments.tsx` | Reactive pattern comparison |
| `src/components/ArrowLayerBatched.tsx` | 2D virtualized arrow rendering |
| `src/components/DateHeaders.tsx` | Original headers (optimal) |
| `src/demo/DateHeadersOptimized.tsx` | Index-based headers (slower) |
| `benchmarks/traces/runs/` | Benchmark JSON outputs |

---

## Historical Investigations

For detailed investigation logs and raw benchmark data, see [HISTORY.md](./HISTORY.md):

- 2025-12-23: Arrow 2D virtualization (X+Y filtering, ~2.5% overhead)
- 2025-12-23: Header optimization attempts (spread operator overhead)
- 2025-12-23: Day-only headers implementation
- 2025-12-21: Virtualization mode comparison (xySplit vs combined)
- 2025-12-21: Datetime rendering benchmarks
- 2025-12-21: Bar variant analysis with 10K tasks
