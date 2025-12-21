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
