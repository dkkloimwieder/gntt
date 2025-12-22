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

## Current Variants Summary

### Bar Variants
| Variant | Description | Status |
|---------|-------------|--------|
| baseline | Single memo batching all props | ✓ Best performer |
| noMemos | Direct store access | ✓ 3-5% slower |
| splitMemo | Static + dynamic separation | Implemented |
| minimal | Bare minimum rendering | Implemented |

### Virtualization Modes
| Mode | Description | Status |
|------|-------------|--------|
| combined | Single memo for row + X filtering | ✓ Best performer |
| xySplit | Separate row and X memos | ✓ 2-3% slower |

### URL Parameters
```
?variant=baseline|noMemos|splitMemo|minimal
&virt=combined|xySplit
&test=horizontal|vertical|both
```

---

## Hot Functions Analysis (Latest Profiles)

| Function | % Time | Notes |
|----------|--------|-------|
| (program) | ~30% | Browser overhead |
| set scrollLeft/Top | ~26% | DOM scroll (unavoidable) |
| setProperty | ~7% | CSS style updates |
| updateComputation | ~6% | SolidJS reactive updates |
| get (store) | ~3% | Store proxy reads |
| cleanNode | ~2% | Reactive cleanup |

**Main bottleneck**: DOM operations (scroll + setProperty) account for ~33% of time. JavaScript reactive overhead is ~11%.

---

## Comprehensive Benchmark Results (2025-12-21)

### Test Configuration
- Duration: 5 seconds per run
- Runs: 5 per variant per direction
- Total: 40 benchmark runs
- Tasks: 10,000
- Virtualization: combined mode

### Results (5-run averages)

| Variant | H-Scroll (ms) | V-Scroll (ms) | vs Baseline H | vs Baseline V |
|---------|---------------|---------------|---------------|---------------|
| **baseline** | **2286** | **2435** | - | - |
| noMemos | 2408 | 2589 | +5.4% | +6.3% |
| splitMemo | 2450 | 2590 | +7.2% | +6.4% |
| minimal | 2508 | 2784 | +9.7% | +14.3% |

### Analysis

**baseline wins across all tests.** The single memo pattern that batches all props is the most efficient approach.

**Why baseline is fastest:**
1. Single memo read per render vs multiple store accesses
2. Memo caching prevents redundant computations
3. Object allocation overhead is outweighed by cache benefits

**Why minimal is slowest:**
- "Minimal" removes drag handlers but still has full reactivity
- Removing handlers doesn't help - the overhead is in style updates
- Every bar still updates styles on scroll

### Ranking (Best to Worst)

1. **baseline** - Single memo batching all props ✓
2. **noMemos** - Direct store access (+5-6%)
3. **splitMemo** - Static/dynamic separation (+6-7%)
4. **minimal** - Bare minimum rendering (+10-14%)

### Recommendation

**Use the baseline pattern for production:**

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
        // ... all props in one memo
    };
});
```
