# Performance Investigation History

This document archives detailed investigation logs and historical benchmark data. For current best practices, see [ANALYSIS.md](./ANALYSIS.md).

---

## 2025-12-23: Header Optimization Investigation

### Hypothesis

Headers add +24.9% script overhead. Attempted optimizations:
- **Option A**: Use `<Index>` with `createMemo` caching per slot
- **Option B**: Use `<For>` with static base styles + spread operator

### What We Tried

#### DateHeadersOptimized.jsx (Index-based)

| Aspect | DateHeaders | DateHeadersOptimized |
|--------|-------------|----------------------|
| Loop primitive | `<For>` (value-based) | `<Index>` (position-based) |
| Memo output | Full entry objects | Just indices `[0, 1, 2...]` |
| Style definition | Function per entry | Static base object |

#### Option A: Index + createMemo caching

```javascript
{(dayIndex) => {
    const entry = createMemo(() => dateInfos()[dayIndex()]);
    return <div style={{...lowerTextBaseStyle, left: `${entry()?.x}px`, ...}}>
}}
```

#### Option B: For + static styles with spread

```javascript
<For each={lowerTextEntries()}>
    {(entry) => <div style={{...lowerTextBaseStyle, left: `${entry.x}px`, width: `${entry.width}px`}}>}
</For>
```

### Results

| Variant | Script (ms) | Layout (ms) | Total (ms) | vs Original |
|---------|-------------|-------------|------------|-------------|
| **Original DateHeaders** | **1081** | 479 | **1560** | **baseline** |
| DateHeadersOptimized (Index) | 1185 | 444 | 1629 | +4.4% slower |
| Option A (Index + memos) | 1238 | 431 | 1669 | +7.0% slower |
| Option B (For + static styles) | 1299 | 417 | 1716 | +10.0% slower |

### Root Cause Analysis

**Why spread operator is slower:**
```javascript
// SLOWER: Spread operator copies all properties
style={{ ...lowerTextBaseStyle, left: `${x}px`, width: `${w}px` }}

// FASTER: Object literal created directly
style={lowerTextStyle(entry)}  // Returns full object
```

The spread operator (`...`) has hidden overhead:
1. Creates a new object
2. Copies all base style properties
3. Then adds dynamic properties

Object literals are compiled to efficient bytecode.

**Why createMemo inside render is slower:**

SolidJS already tracks fine-grained dependencies. Adding `createMemo` inside render adds:
- Extra subscription overhead
- Extra cleanup on slot changes
- No benefit since the getter is already reactive

**Why `<Index>` has layout regression:**
- `<Index>` uses position-based identity
- On scroll, ALL slot signals update (cascade effect)
- Each signal update triggers style recalculation
- `<For>` reuses DOM nodes, minimizing style updates

### Conclusion

The original DateHeaders implementation is optimal. The +24.9% overhead is inherent to rendering date columns during scroll - focus optimization efforts elsewhere.

---

## 2025-12-23: Day-Only Headers

### Change

Removed upper header (week labels) to show only day numbers:
- Set `upperHeaderHeight={0}` in GanttPerfIsolate
- Added `<Show when={upperHeaderHeight() > 0}>` to conditionally hide upper header
- Fixed `props.upperHeaderHeight || 45` to `props.upperHeaderHeight ?? 45` to allow 0 values

### Results

| Metric | With Headers | No Headers | Difference |
|--------|--------------|------------|------------|
| Script (median) | 1119ms | 1149ms | -30ms (-3%) |
| Layout (median) | 466ms | 442ms | +24ms (+5%) |
| Total (median) | 3257ms | 3370ms | -113ms (-3%) |

Headers add ~5% layout overhead (from DOM nodes) but script time is equivalent.

---

## 2025-12-21: Datetime Rendering Benchmarks

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

---

## 2025-12-21: Virtualization Mode Comparison

### Hypothesis
- **combined**: Single memo filters by row AND X range together
- **xySplit**: Stage 1 filters by row (Y), Stage 2 filters by X from cached results

Expected: xySplit faster for horizontal scroll (skips row recalc).

### Results (3-run averages, baseline bar, 3s stress test)

| Virtualization | H-Scroll (ms) | V-Scroll (ms) |
|----------------|---------------|---------------|
| combined | 1444 | 1581 |
| xySplit | 1489 | 1608 |
| **Diff** | **+3.1% slower** | **+1.7% slower** |

### Conclusion

**xySplit does NOT improve performance.** The overhead of the extra memo stage outweighs the benefit of caching row tasks. The combined single-pass approach is more efficient.

---

## 2025-12-21: Evolution of Layout Thrashing Fixes

### Phase 1: scrollWidth reads (27% overhead)
- **Problem**: Reading `scrollWidth` in RAF loop causes layout thrashing
- **Fix**: Cache scroll dimensions before loop

### Phase 2: scrollLeft reads (26% overhead)
- **Problem**: Reading `scrollLeft` every tick triggers reflow
- **Fix**: Track scroll position in JS variables

### Phase 3: hexToRgba conversion (44ms in noMemos)
- **Problem**: Runtime color conversion on every access
- **Fix**: Pre-compute colors in task generator (`color_bg`, `color_fill`)

---

## 2025-12-21: Full Matrix Benchmark Results

### Bar Variants x Virtualization Modes

| Config | H-Scroll (ms) | V-Scroll (ms) |
|--------|---------------|---------------|
| **baseline + combined** | **2981** | **3160** |
| baseline + smartCache | 2889 (-3.1%) | 3215 (+1.7%) |
| baseline + splitEquals | 3235 (+8.5%)* | 3128 (-1.0%) |
| noMemos + combined | 3128 (+4.9%) | 3336 (+5.6%) |
| noMemos + smartCache | 3149 (+5.6%) | 3244 (+2.7%) |
| noMemos + splitEquals | 3220 (+8.0%)* | 3289 (+4.1%) |

*splitEquals was slower due to cleanNode bug (fixed later)

### splitEquals Fix Results

After adding custom equality to Stage 2:

| Metric | Before Fix | After Fix | Change |
|--------|------------|-----------|--------|
| Script Duration | 3550ms | 2597ms | **-27%** |
| cleanNode | 31.4% (1901ms) | 3.0% (159ms) | **-92%** |

---

## 2025-12-21: Bar Variant Analysis (10K Tasks)

### Summary (3-run averages)

| Variant | Script (ms) | Layout (ms) | Heap (MB) |
|---------|-------------|-------------|-----------|
| baseline | 1133.8 | 537.3 | 51.6 |
| noMemos | 1196.8 | 514.0 | 50.6 |
| **Diff** | **+5.5%** | **-4.3%** | **-2%** |

**baseline is 5.5% faster** - memos cache computed values, avoiding repeated property access costs.

### Hot Function Comparison

| Function | baseline | noMemos | Notes |
|----------|----------|---------|-------|
| set scrollLeft | 838ms (26%) | 818ms (26%) | DOM scroll cost (unavoidable) |
| setProperty | 251ms (8%) | 261ms (8%) | DOM style updates |
| store.get | 196ms (6.1%) | 135ms (4.3%) | Proxy reads |
| _$effect | 91ms (2.8%) | 237ms (7.7%) | **Effect runs 2.6x more in noMemos** |
| cleanNode | - | 74ms (2.4%) | Reactive cleanup |

**Key finding:** noMemos has 2.6x more effect execution time because direct store access doesn't cache values like memos do.
