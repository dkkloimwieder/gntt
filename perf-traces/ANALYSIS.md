# Performance Profile Analysis

## Test Environment
- Date: 2025-12-21
- Duration: 3 seconds per run, 3 runs per variant
- Tasks: **10,000** (dense calendar)
- Test: horizontal scroll
- Fixes applied:
  - Cached scrollWidth/scrollHeight to avoid layout thrashing
  - Track scroll position in JS instead of reading scrollLeft/scrollTop
  - Pre-computed color values (color_bg, color_fill) to eliminate hexToRgba conversion

---

## Final Results: 10K Tasks with Pre-computed Colors

### Summary (3-run averages)

| Variant | Script (ms) | Layout (ms) | Heap (MB) |
|---------|-------------|-------------|-----------|
| baseline | 1133.8 | 537.3 | 51.6 |
| noMemos | 1196.8 | 514.0 | 50.6 |
| **Diff** | **+5.5%** | **-4.3%** | **-2%** |

**baseline is 5.5% faster** - memos cache computed values, avoiding repeated property access costs.

### Hot Function Comparison (10K tasks)

| Function | baseline | noMemos | Notes |
|----------|----------|---------|-------|
| set scrollLeft | 838ms (26%) | 818ms (26%) | DOM scroll cost (unavoidable) |
| setProperty | 251ms (8%) | 261ms (8%) | DOM style updates |
| store.get | 196ms (6.1%) | 135ms (4.3%) | Proxy reads |
| _$effect | 91ms (2.8%) | 237ms (7.7%) | **Effect runs 2.6x more in noMemos** |
| cleanNode | - | 74ms (2.4%) | Reactive cleanup |

**Key finding:** noMemos has 2.6x more effect execution time because direct store access doesn't cache values like memos do.

### Raw Data (10K tasks, pre-computed colors)

**baseline-horizontal:**
| Run | Script | Layout | Heap |
|-----|--------|--------|------|
| 1 | 1092.38ms | 549.91ms | 53.02 MB |
| 2 | 1067.09ms | 557.59ms | 43.09 MB |
| 3 | 1242.04ms | 504.29ms | 58.67 MB |

**noMemos-horizontal:**
| Run | Script | Layout | Heap |
|-----|--------|--------|------|
| 1 | 1165.76ms | 535.22ms | 31.22 MB |
| 2 | 1237.98ms | 492.02ms | 59.9 MB |
| 3 | 1186.51ms | 514.83ms | 60.61 MB |

---

## Evolution of Findings

### Phase 1: Initial Profile (200 tasks)
- scrollWidth reads caused 27% overhead (845ms) - **layout thrashing**
- Fixed by caching scroll dimensions before RAF loop

### Phase 2: Second Layout Issue (200 tasks)
- scrollLeft reads still causing 26% overhead (820ms)
- Fixed by tracking scroll position in JS variables

### Phase 3: hexToRgba Issue (200 tasks)
- noMemos variant had 44ms spent on hexToRgba conversion
- Fixed by pre-computing colors in task generator

### Phase 4: Final Comparison (10K tasks)
- With all fixes applied, baseline still 5.5% faster
- Memo caching outweighs GC overhead

---

## Reactive Pattern Trade-offs

| Pattern | Pros | Cons |
|---------|------|------|
| **baseline (memos)** | Cached values, fewer effect runs | Object allocation causes GC |
| **noMemos (direct)** | No object allocation | 2.6x more effect execution |

### Why baseline wins:

1. **Memos cache computed property bundles** - single read from memo vs multiple store proxy accesses
2. **Effect runs are expensive** - noMemos runs effects 2.6x more because every store access triggers tracking
3. **GC overhead is minor** - the 200 task tests showed baseline had 50% more GC, but at 10K tasks this doesn't dominate

---

## Key Optimizations Applied

### 1. Scroll Dimension Caching
```javascript
// BEFORE: reads scrollWidth in every RAF tick (layout thrashing)
const maxScroll = scrollArea.scrollWidth - scrollArea.clientWidth;

// AFTER: cache once before loop
const maxScrollH = scrollArea ? scrollArea.scrollWidth - scrollArea.clientWidth : 0;
let currentScrollH = scrollArea ? scrollArea.scrollLeft : 0;
```

### 2. JS Position Tracking
```javascript
// BEFORE: reads scrollLeft from DOM every tick
scrollArea.scrollLeft += hDirection * 150;

// AFTER: track in JS variable
currentScrollH += hDirection * 150;
scrollArea.scrollLeft = currentScrollH;
```

### 3. Pre-computed Colors
```javascript
// BEFORE: runtime conversion on every access
const bgRgba = hexToRgba(task.color, 0.15);

// AFTER: stored in task data
// taskGenerator.js computes: color_bg, color_fill
colorBg: task?.color_bg,  // Already rgba string
```

---

## Recommendations

1. **Use memo pattern for production** - 5.5% faster at scale
2. **Pre-compute all derived values** - no runtime conversions
3. **Cache scroll dimensions** - read once, use cached value
4. **Track position in JS** - avoid DOM reads in hot paths

## Remaining Optimization Targets

| Function | Time | Priority |
|----------|------|----------|
| set scrollLeft | 838ms | Low (unavoidable browser cost) |
| setProperty | 251ms | Medium (batch DOM updates?) |
| store.get | 196ms | Low (inherent to SolidJS stores) |

The DOM scroll cost (~26%) is the browser actually scrolling - this is the baseline we can't go below.

---

## Datetime Rendering Benchmarks (2025-12-21)

New benchmarks after switching to UTC-based datetime rendering with exact pixel positioning (no rounding).

### Changes Applied
- Parse all dates as UTC to avoid timezone offset issues
- Compute pixel positions directly from hour differences: `startHours * COLUMN_WIDTH`
- Removed all rounding from position calculations
- Timeline: 6px per hour, 144px per day

### Summary (3-run averages, 10K tasks, 3s stress test)

| Variant | Horizontal | Vertical | Combined |
|---------|------------|----------|----------|
| **baseline** | Script 1378.7ms, Layout 588.1ms | Script 1340.2ms, Layout 596.5ms | **Script 1359.4ms** |
| **noMemos** | Script 1358.5ms, Layout 605.1ms | Script 1448.1ms, Layout 583.9ms | **Script 1403.3ms** |
| **Diff** | -1.5% (noMemos faster) | +8.0% (baseline faster) | **+3.2% (baseline faster)** |

### Analysis

**Horizontal scroll:** noMemos slightly faster (-1.5%)
- Both variants perform similarly when only X positions change
- Memo overhead becomes visible when computed values don't change much

**Vertical scroll:** baseline significantly faster (+8.0%)
- Vertical scroll changes which rows are visible
- Memos cache the entire position bundle, avoiding recalculation
- noMemos triggers more effect re-runs on row changes

**Overall:** baseline still wins by 3.2% combined.

### Raw Data

**datetime-baseline-horizontal:**
| Run | Script | Layout | Heap |
|-----|--------|--------|------|
| 1 | 1359.50ms | 580.61ms | 59.42 MB |
| 2 | 1390.13ms | 603.63ms | 73.66 MB |
| 3 | 1386.35ms | 580.14ms | 87.39 MB |

**datetime-baseline-vertical:**
| Run | Script | Layout | Heap |
|-----|--------|--------|------|
| 1 | 1347.01ms | 623.58ms | 58.48 MB |
| 2 | 1389.14ms | 608.09ms | 80.19 MB |
| 3 | 1284.47ms | 557.75ms | 95.06 MB |

**datetime-noMemos-horizontal:**
| Run | Script | Layout | Heap |
|-----|--------|--------|------|
| 1 | 1329.14ms | 623.28ms | 62.32 MB |
| 2 | 1332.76ms | 614.89ms | 59.95 MB |
| 3 | 1413.61ms | 577.13ms | 57.65 MB |

**datetime-noMemos-vertical:**
| Run | Script | Layout | Heap |
|-----|--------|--------|------|
| 1 | 1400.74ms | 596.93ms | 76.04 MB |
| 2 | 1490.23ms | 580.00ms | 73.24 MB |
| 3 | 1453.23ms | 574.75ms | 76.23 MB |

### Comparison with Previous Benchmarks

| Test | Previous Script | Datetime Script | Change |
|------|-----------------|-----------------|--------|
| baseline-h | 1133.8ms | 1378.7ms | +21.6% |
| noMemos-h | 1196.8ms | 1358.5ms | +13.5% |

Script time increased ~15-20% with datetime rendering, likely due to:
1. More precise floating-point calculations (no rounding)
2. Additional position validation during scroll
3. Increased task density at certain scroll positions

---

## Virtualization Mode Benchmarks (2025-12-21)

Testing xySplit virtualization: separate X and Y filtering to avoid recalculating row visibility on horizontal scroll.

### Hypothesis
- **combined**: Single memo filters by row AND X range together
- **xySplit**: Stage 1 filters by row (Y), Stage 2 filters by X range from cached results

Expected: xySplit faster for horizontal scroll (skips row recalc), similar for vertical.

### Results (3-run averages, baseline bar variant, 3s stress test)

| Virtualization | H-Scroll (ms) | V-Scroll (ms) |
|----------------|---------------|---------------|
| combined | 1444 | 1581 |
| xySplit | 1489 | 1608 |
| **Diff** | **+3.1% slower** | **+1.7% slower** |

### Raw Data

**combined-horizontal:**
| Run | Script |
|-----|--------|
| 1 | 1427ms |
| 2 | 1454ms |
| 3 | 1452ms |

**combined-vertical:**
| Run | Script |
|-----|--------|
| 1 | 1678ms |
| 2 | 1589ms |
| 3 | 1476ms |

**xySplit-horizontal:**
| Run | Script |
|-----|--------|
| 1 | 1482ms |
| 2 | 1502ms |
| 3 | 1484ms |

**xySplit-vertical:**
| Run | Script |
|-----|--------|
| 1 | 1536ms |
| 2 | 1559ms |
| 3 | 1730ms |

### Conclusion

**xySplit does NOT improve performance.** The overhead of the extra memo stage outweighs the benefit of caching row tasks. The combined single-pass approach is more efficient.

---

## GanttExperiments Comprehensive Documentation

### Overview

`GanttExperiments.jsx` is the performance testing harness for comparing SolidJS reactive patterns at scale. It renders 10,000 tasks and measures performance during stress tests (continuous scrolling).

### URL Parameters

```
http://localhost:5173/examples/experiments.html
  ?variant=baseline|noMemos|splitMemo|minimal
  &virt=combined|xySplit|smartCache|splitEquals
  &test=horizontal|vertical|both
```

---

## Bar Variants

Each bar variant tests a different SolidJS reactive pattern for rendering individual task bars.

### 1. baseline (Best Performer)

Single memo that batches all props into one cached object.

```javascript
const t = createMemo(() => {
    const task = getTask();
    const bar = task?.$bar;
    return {
        x: bar?.x ?? 0,
        y: bar?.y ?? 0,
        width: bar?.width ?? 40,
        height: bar?.height ?? 28,
        name: task?.name ?? '',
        colorBg: task?.color_bg,
        colorFill: task?.color_fill,
    };
});

// Usage in JSX
<div style={{ transform: `translate(${t().x}px, ${t().y}px)` }}>
```

**Pros:**
- Single memo read per render
- Cached value prevents redundant store proxy accesses
- Fewer effect re-runs

**Cons:**
- Object allocation on each memo update
- GC pressure (minor at scale)

### 2. noMemos (+5-6% slower)

Direct store access without memos. Reads store properties directly in effects.

```javascript
// Direct access in effect
createEffect(() => {
    const task = getTask();
    const bar = task?.$bar;
    element.style.transform = `translate(${bar?.x ?? 0}px, ${bar?.y ?? 0}px)`;
    element.style.width = `${bar?.width ?? 40}px`;
});
```

**Pros:**
- No object allocation
- Simpler code

**Cons:**
- Multiple store proxy reads per render
- 2.6x more effect execution (each store access triggers tracking)
- More `cleanNode` calls

### 3. splitMemo (+6-7% slower)

Separates static props (name, colors) from dynamic props (x, y, width).

```javascript
const staticProps = createMemo(() => ({
    name: task?.name ?? '',
    colorBg: task?.color_bg,
}));

const dynamicProps = createMemo(() => ({
    x: bar?.x ?? 0,
    y: bar?.y ?? 0,
    width: bar?.width ?? 40,
}));
```

**Pros:**
- Static props cached separately (don't recompute on scroll)

**Cons:**
- Two memo reads per render
- Extra overhead outweighs benefit

### 4. minimal (+10-14% slower)

Bare minimum rendering with no drag handlers. Still has full reactivity.

**Why it's slowest:**
- Calls `bar()` and `getTask()` multiple times per render without caching
- No memo means repeated store proxy traversal
- "Minimal features" ≠ "minimal overhead"

---

## Virtualization Modes

Each mode tests a different strategy for filtering visible tasks during scroll.

### 1. combined (Simple & Fast)

Single memo that filters by row (Y) AND X range together in one pass.

```javascript
const visibleTasksCombined = createMemo(() => {
    const rowRange = visibleRowRange();  // depends on scrollY
    const xRange = visibleXRange();       // depends on scrollX
    const result = [];

    for (let row = rowRange.start; row < rowRange.end; row++) {
        for (const id of taskIdsByRow[row] || []) {
            const task = tasks[id];
            const bar = task?.$bar;
            if (bar && bar.x + bar.width >= xRange.start && bar.x <= xRange.end) {
                result.push(task);
            }
        }
    }
    return result;
});
```

**Behavior:**
- Runs on ANY scroll (X or Y change)
- Single tight loop with early filtering
- Returns new array every time

### 2. xySplit (+2-3% slower)

Two-stage filtering: Stage 1 caches row tasks, Stage 2 filters by X.

```javascript
// Stage 1: All tasks in visible rows (only depends on Y)
const visibleRowTasks = createMemo(() => {
    const rowRange = visibleRowRange();
    const result = [];
    for (let row = rowRange.start; row < rowRange.end; row++) {
        for (const id of taskIdsByRow[row] || []) {
            result.push(tasks[id]);
        }
    }
    return result;
});

// Stage 2: Filter by X range
const visibleTasksXYSplit = createMemo(() => {
    const rowTasks = visibleRowTasks();  // cached on X scroll?
    const xRange = visibleXRange();
    // ... filter by X
});
```

**Why it failed:**
- `visibleRowTasks` returns a NEW array every time (different reference)
- SolidJS default equality is `===` (reference check)
- Stage 2 thinks input changed on every scroll → runs anyway
- Extra memo overhead with no benefit

### 3. smartCache (Marginal Improvement)

Manual tracking of X/Y changes with conditional execution.

```javascript
let smartCacheRowTasks = [];
let smartLastYStart = -1, smartLastYEnd = -1;
let smartLastXStart = -1, smartLastXEnd = -1;

const visibleTasksSmartCache = createMemo(() => {
    const rowRange = visibleRowRange();
    const xRange = visibleXRange();

    const yChanged = rowRange.start !== smartLastYStart || rowRange.end !== smartLastYEnd;
    const xChanged = xRange.start !== smartLastXStart || xRange.end !== smartLastXEnd;

    if (yChanged) {
        // Rebuild row tasks
        smartCacheRowTasks = [];
        for (let row = rowRange.start; row < rowRange.end; row++) {
            for (const id of taskIdsByRow[row] || []) {
                smartCacheRowTasks.push(tasks[id]);
            }
        }
    }

    if (yChanged || xChanged) {
        // Re-filter by X
        smartCacheResult = [];
        for (const task of smartCacheRowTasks) {
            // ... filter
        }
    }

    return smartCacheResult;
});
```

**Why it's limited:**
- Memo still RUNS on every scroll (reads both ranges)
- Conditional logic saves work inside, but memo invocation cost remains
- ~1-3% improvement (within noise margin)

### 4. splitEquals (Custom Equality)

Uses SolidJS custom equality to prevent unnecessary downstream updates.

```javascript
// Custom equality for ID arrays
const idsEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Stage 1: Row task IDs (only depends on Y) with custom equality
const visibleRowTaskIds = createMemo(() => {
    const rowRange = visibleRowRange();
    const ids = [];
    for (let row = rowRange.start; row < rowRange.end; row++) {
        for (const id of taskIdsByRow[row] || []) {
            ids.push(id);
        }
    }
    return ids;
}, { equals: idsEqual });

// Stage 2: Visible IDs (filter by X) with custom equality
const visibleTaskIdsSplitEquals = createMemo(() => {
    const ids = visibleRowTaskIds();
    const xRange = visibleXRange();
    const result = [];
    for (const id of ids) {
        const task = tasks[id];
        const bar = task?.$bar;
        if (bar && bar.x + bar.width >= xRange.start && bar.x <= xRange.end) {
            result.push(id);  // Return ID, not task object
        }
    }
    return result;
}, { equals: idsEqual });

// Stage 3: Map IDs to tasks (only runs when IDs change)
const visibleTasksSplitEquals = createMemo(() => {
    const ids = visibleTaskIdsSplitEquals();
    return ids.map(id => tasks[id]);
});
```

**How it works:**
1. On horizontal scroll:
   - `visibleRowRange` doesn't change (only depends on scrollY)
   - `visibleRowTaskIds` returns cached value (no recompute)
   - `visibleTaskIdsSplitEquals` recomputes, but if same tasks visible, custom equality returns `true`
   - `visibleTasksSplitEquals` doesn't run (input didn't change)

2. Custom equality compares ID arrays element-by-element
3. Only triggers downstream updates when visible task IDs actually change

**Results (initial fix):**
- cleanNode: 31.4% → 3.0% (92% reduction!)
- Script time: 3550ms → 2597ms (27% faster)

---

## Benchmark Methodology

### Prerequisites

1. Start Chrome with remote debugging:
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile &
```

2. Start dev server:
```bash
pnpm run dev:solid
```

### Running Benchmarks

**Single run:**
```bash
# Navigate to test page
node .claude/skills/chrome-devtools-cli/scripts/devtools.mjs \
  --browserUrl=http://127.0.0.1:9222 \
  navigate "http://localhost:5173/examples/experiments.html?variant=baseline&virt=combined&test=horizontal"

# Wait for page load
sleep 1

# Capture 5-second profile
node .claude/skills/chrome-devtools-cli/scripts/profile.mjs capture \
  --browserUrl=http://127.0.0.1:9222 \
  --duration=5000 \
  --output=perf-traces/runs/test.json
```

**Full matrix benchmark:**
```bash
./run-virt-bench.sh
```

This runs:
- 2 bar variants (baseline, noMemos) × 3 virt modes (combined, smartCache, splitEquals)
- × 2 scroll directions (horizontal, vertical)
- × 3 runs each
- = 36 total benchmark runs
- 5 seconds per run, 1 second delay before capture

**Analyze results:**
```bash
./analyze-bench.sh
```

### Benchmark Scripts

**run-virt-bench.sh:**
```bash
#!/bin/bash
for variant in baseline noMemos; do
  for virt in combined smartCache splitEquals; do
    for test in horizontal vertical; do
      for i in 1 2 3; do
        name="bench-${variant}-${virt}-${t}-${i}"
        # Navigate, wait, capture profile
      done
    done
  done
done
```

**analyze-bench.sh:**
```bash
#!/bin/bash
for variant in baseline noMemos; do
  for virt in combined smartCache splitEquals; do
    # Parse JSON files, calculate averages
    for f in perf-traces/runs/bench-${variant}-${virt}-*.json; do
      script=$(cat "$f" | node -e "...")
    done
  done
done
```

### Profile Output

Each profile captures:
- **Script Duration**: Total JavaScript execution time
- **Layout Duration**: Browser layout/reflow time
- **Hot Functions**: Top functions by self-time (%)
- **Call Tree**: Function hierarchy with % breakdown
- **Metrics**: DOM nodes, event listeners, heap size

---

## Latest Benchmark Results (2025-12-21)

### Full Matrix: Bar Variants × Virtualization Modes

| Config | H-Scroll (ms) | V-Scroll (ms) |
|--------|---------------|---------------|
| **baseline + combined** | **2981** | **3160** |
| baseline + smartCache | 2889 (-3.1%) | 3215 (+1.7%) |
| baseline + splitEquals | 3235 (+8.5%)* | 3128 (-1.0%) |
| noMemos + combined | 3128 (+4.9%) | 3336 (+5.6%) |
| noMemos + smartCache | 3149 (+5.6%) | 3244 (+2.7%) |
| noMemos + splitEquals | 3220 (+8.0%)* | 3289 (+4.1%) |

*splitEquals was slower due to cleanNode bug (fixed below)

### splitEquals Fix Results

After adding custom equality to Stage 2:

| Metric | Before Fix | After Fix | Change |
|--------|------------|-----------|--------|
| Script Duration | 3550ms | 2597ms | **-27%** |
| cleanNode | 31.4% (1901ms) | 3.0% (159ms) | **-92%** |

### Hot Functions Comparison (H-Scroll)

| Function | combined | splitEquals (broken) | splitEquals (fixed) |
|----------|----------|---------------------|---------------------|
| (program) | 33% | 31% | ~30% |
| cleanNode | **1.9%** | **31.4%** | **3.0%** |
| set scrollLeft | 14% | 14% | 14% |
| setProperty | 4% | 4% | 4% |

---

## Key Findings

1. **baseline bar pattern wins** - 5-6% faster than noMemos
2. **Custom equality is crucial** - Without it, returning new arrays triggers massive cleanup
3. **DOM is the floor** - ~30% of time is unavoidable (scrollLeft + setProperty)
4. **Reactive overhead is ~10%** - updateComputation + cleanNode + store.get
5. **splitEquals with custom equality** - Best for horizontal scroll when visible tasks don't change

