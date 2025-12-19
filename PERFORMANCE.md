# Performance Optimization

This document covers performance analysis and optimizations for the SolidJS Gantt chart implementation.

## Benchmark Configuration

- **Tasks**: 1000
- **View Mode**: Hour (most demanding - creates ~8,700 columns for a year)
- **Dependencies**: 926 arrows

## Performance History

| Date | Render Time | Notes |
|------|-------------|-------|
| Baseline | ~5,000ms | Initial Hour view with 1000 tasks |
| After scrollTo fix | ~2,100ms | Changed `scrollTo()` to direct `scrollLeft` assignment |
| After SVG pattern grid | ~1,800ms | Replaced `<line>` elements with SVG `<pattern>` |
| After DateTimeFormat cache | ~1,138ms | Cached `Intl.DateTimeFormat` instances |
| After DateHeaders virtualization | ~568ms | Render only visible columns (64 vs 8,700) |
| **After horizontal task/arrow virtualization** | **~30ms** | **10K tasks: only ~11 bars/arrows rendered** |

## Completed Optimizations

### 1. ScrollTo Forced Reflow Fix

**Problem**: `scrollTo({ left: x, behavior: 'auto' })` triggered synchronous layout calculation (~1,900ms forced reflow).

**Solution**: Use direct property assignment for non-smooth scrolling.

**File**: `src/components/GanttContainer.jsx`

```jsx
const scrollTo = (x, smooth = true) => {
    if (scrollAreaRef) {
        if (smooth) {
            scrollAreaRef.scrollTo({ left: x, behavior: 'smooth' });
        } else {
            // Direct property set - no layout thrashing
            scrollAreaRef.scrollLeft = x;
        }
    }
};
```

**Impact**: ~58% improvement (5,000ms → 2,100ms)

### 2. SVG Pattern for Grid Lines

**Problem**: GridTicks created one `<line>` element per column (~8,700 elements in Hour view), causing massive style recalculation.

**Solution**: Use SVG `<pattern>` element for repeating vertical lines.

**File**: `src/components/Grid.jsx`

```jsx
<defs>
    <pattern id={patternId()} width={columnWidth()} height={10} patternUnits="userSpaceOnUse">
        <line x1={columnWidth() - 0.5} y1={0} x2={columnWidth() - 0.5} y2={10}
              stroke={lineColor()} stroke-width="0.5" />
    </pattern>
</defs>

{/* Single rect instead of thousands of lines */}
<rect fill={`url(#${patternId()})`} ... />

{/* Single path for thick lines (month boundaries) */}
<path d={thickLinesPath()} stroke={thickLineColor()} stroke-width="1" />
```

**Impact**: Eliminated ~8,700 `<line>` elements → 3 elements (pattern, rect, path)

### 3. Removed GridTicks Component

**File**: `src/components/Gantt.jsx`

GridTicks component removed entirely. Vertical lines now rendered via Grid.jsx pattern. Horizontal row lines use stroke on row rects.

### 4. Intl.DateTimeFormat Caching

**Problem**: `date_utils.format()` created 2 new `Intl.DateTimeFormat` instances per call. With 8,700 hour columns, this meant 17,400 expensive constructor calls per render (~1 second of scripting time).

**Solution**: Cache formatters at module level by locale.

**File**: `src/utils/date_utils.js`

```javascript
// Cache Intl.DateTimeFormat instances
const formatterCache = new Map();

function getFormatters(lang) {
    if (!formatterCache.has(lang)) {
        formatterCache.set(lang, {
            long: new Intl.DateTimeFormat(lang, { month: 'long' }),
            short: new Intl.DateTimeFormat(lang, { month: 'short' }),
        });
    }
    return formatterCache.get(lang);
}
```

**Impact**: ~37% improvement (1,800ms → 1,138ms)

### 5. DateHeaders Virtualization

**Problem**: DateHeaders rendered 8,700 `<div>` elements (one per hour column) regardless of viewport.

**Solution**: Only render visible columns + buffer based on scroll position.

**Files**:
- `src/components/GanttContainer.jsx` - Added viewport height signal
- `src/components/Gantt.jsx` - Added viewport range calculations
- `src/components/DateHeaders.jsx` - Filter entries by visible range

```jsx
// Gantt.jsx - Viewport range calculation
const viewportCols = createMemo(() => {
    const colWidth = dateStore.columnWidth();
    const sl = scrollLeft();
    const vw = viewportWidth();

    const startCol = Math.max(0, Math.floor(sl / colWidth) - BUFFER_COLS);
    const endCol = Math.ceil((sl + vw) / colWidth) + BUFFER_COLS;

    return { startCol, endCol };
});

// DateHeaders.jsx - Virtualized rendering
const lowerTextEntries = createMemo(() => {
    const infos = dateInfos();
    const start = Math.max(0, startCol());
    const end = Math.min(infos.length, endCol());
    return infos.slice(start, end).map(...);
});
```

**Impact**: ~50% improvement (1,138ms → 568ms), 8,700 → ~64 elements

### 6. Row-Level Task Grouping

**Change**: Restructured TaskLayer to group tasks by resource/row for future row virtualization.

**File**: `src/components/TaskLayer.jsx`

```jsx
const tasksByResource = createMemo(() => {
    const grouped = new Map();
    for (const task of tasks()) {
        const resource = task.resource || 'Unassigned';
        if (!grouped.has(resource)) grouped.set(resource, []);
        grouped.get(resource).push(task);
    }
    return grouped;
});

// Render by row groups
<For each={visibleResources()}>
    {({ resource, rowIndex }) => (
        <g class="task-row" data-resource={resource}>
            <For each={tasksByResource().get(resource) || []}>
                {(task) => <Bar task={task} ... />}
            </For>
        </g>
    )}
</For>
```

**Impact**: Foundation for row virtualization (renders all tasks when all rows visible)

### 7. Arrow Rendering - No Scroll-Based Filtering

**Finding**: Scroll-based arrow filtering actually **hurts** performance due to reactive cascades and array reconciliation.

**File**: `src/components/ArrowLayer.jsx`

**Approach**: Render all arrows statically. Let the browser handle SVG clipping.

```jsx
// Simple mapping - NO filtering, NO memos that depend on scroll
const dependencies = () => {
    const rels = props.relationships || [];
    return rels.map((rel) => ({
        id: `${fromId}-${toId}`,
        fromId,
        toId,
        type: rel.type || 'FS',
        ...rel,
    }));
};
```

**Why Filtering Failed**:
1. `createMemo` depending on scroll position triggers on every frame
2. New array returned each frame forces `<For>` to reconcile thousands of Arrow components
3. CSS visibility checks trigger reactive cascades in each Arrow component
4. All filtering approaches are SLOWER than just rendering all arrows

**Benchmark Results** (4300 tasks, 9353 arrows, Hour view):

| Approach | INP (Interaction to Next Paint) | Notes |
|----------|--------------------------------|-------|
| **No filtering** | **148ms** ✅ | Browser SVG clipping |
| createMemo filtering | 215ms | Array reconciliation overhead |
| CSS visibility checks | 715ms | Reactive cascades in 9353 components |

**Conclusion**: Browser SVG clipping is more efficient than ANY JavaScript-based filtering for arrows. The simplest approach wins.

### 8. Unified Viewport Virtualization

**Problem**: With 10K tasks, all bars and arrows rendered regardless of scroll position (~5,500ms).

**Solution**: Created a single `createVirtualViewport.js` utility following the solid-primitives/virtual pattern. All components share one viewport calculation.

**Files**:
- `src/utils/createVirtualViewport.js` - **NEW** - Simple 2D viewport virtualization utility
- `src/components/Gantt.jsx` - Uses single viewport for all components
- `src/components/TaskLayer.jsx` - Filters tasks by row range and X range
- `src/components/ArrowLayer.jsx` - **No filtering** (see Section 7 - filtering hurts performance)

```jsx
// src/utils/createVirtualViewport.js - Simple pattern: offset / itemSize → visible range
export function createVirtualViewport(config) {
    const { scrollX, scrollY, viewportWidth, viewportHeight, columnWidth, rowHeight, totalRows,
            overscanCols = 5, overscanRows = 3, overscanX = 600 } = config;

    const colRange = createMemo(() => ({
        start: Math.max(0, Math.floor(scrollX() / columnWidth()) - overscanCols),
        end: Math.ceil((scrollX() + viewportWidth()) / columnWidth()) + overscanCols,
    }));

    const rowRange = createMemo(() => ({
        start: Math.max(0, Math.floor(scrollY() / rowHeight()) - overscanRows),
        end: Math.min(totalRows(), Math.ceil((scrollY() + viewportHeight()) / rowHeight()) + overscanRows),
    }));

    const xRange = createMemo(() => ({
        start: Math.max(0, scrollX() - overscanX),
        end: scrollX() + viewportWidth() + overscanX,
    }));

    return { colRange, rowRange, xRange };
}

// Gantt.jsx - Single viewport shared by all components
const viewport = createVirtualViewport({
    scrollX: scrollLeft, scrollY: scrollTop, viewportWidth, viewportHeight,
    columnWidth: () => dateStore.columnWidth(), rowHeight, totalRows: () => resourceCount(),
});

// All components use the same viewport:
<DateHeaders startCol={viewport.colRange().start} endCol={viewport.colRange().end} />
<TaskLayer startRow={viewport.rowRange().start} endRow={viewport.rowRange().end}
           startX={viewport.xRange().start} endX={viewport.xRange().end} />
<ArrowLayer startRow={viewport.rowRange().start} endRow={viewport.rowRange().end}
            startX={viewport.xRange().start} endX={viewport.xRange().end} />
```

**Impact**: 99.9% reduction in rendered elements (10K → ~11), render time ~30ms

### 9. Item-Keyed Rendering with `<For>`

**Approach**: TaskLayer and ArrowLayer use SolidJS `<For>` to render virtualized items, following the solid-primitives/virtual pattern.

```jsx
// TaskLayer.jsx - Keyed by item identity
<For each={visibleTasks()}>
    {(task) => <Bar task={task} taskId={task.id} ... />}
</For>
```

**Why `<For>` is essential for virtualization**:
- Components are keyed by **item reference**, not array index
- Tasks entering the viewport get **new** Bar components with correct initial state
- Tasks leaving the viewport have their Bar components **destroyed**
- Visible tasks that remain keep their **existing** components (no re-render)

This ensures smooth visual transitions during scroll - each task bar always displays its own colors and data.

**File**: `src/components/TaskLayer.jsx`

**Test Results**:
| Test | FPS | Worst Frame | Avg Frame |
|------|-----|-------------|-----------|
| H-Scroll | 60 | 24.7ms | 16.8ms |
| V-Scroll | 60 | 24.6ms | 16.8ms |

---

## Current DOM Structure (After Full Virtualization)

With 10,000 tasks in Hour view:

| Component | Before | After | Reduction |
|-----------|--------|-------|-----------|
| DateHeaders lower | ~78,000 | ~64 | 99.9% |
| Grid rows | 26 | 26 | - |
| Task bars | 10,000 | ~11 | **99.9%** |
| Arrows | 9,179 | ~11 | **99.9%** |
| **Total** | ~97,000+ | ~112 | **99.9%** |

**Note**: Horizontal virtualization filters by scroll position. Only tasks/arrows overlapping the visible viewport (plus 200px buffer) are rendered.

---

## Remaining Bottlenecks (Resolved)

### Task Bar Elements

Each task creates 4-8 SVG elements:
- Main rect
- Progress rect
- Expected progress rect (optional)
- Label text
- Left/right resize handles
- Progress handle

### Arrow Elements

Each dependency arrow creates 3 elements:
- Path for arrow line
- Polygon for arrowhead
- Wrapper group

---

### 10. Batched Arrow Rendering with Spatial Indexing

**Problem**: At 50K+ tasks with ~47K arrows, both individual Arrow components and O(n) filtering per frame cause performance issues:
- Individual components: Component churn (create/destroy) during scroll
- O(n) filtering: 47K iterations per scroll frame

**Solution**: `ArrowLayerBatched` with spatial row indexing.

**File**: `src/components/ArrowLayerBatched.jsx`

**Architecture**:
1. **Spatial Index** (built once when tasks load):
   - Map: `row number → Set<relationship indices>`
   - Each arrow indexed to all rows it spans
   - Complexity: O(n) build, O(1) per-row lookup

2. **Batched Path Generation** (per scroll frame):
   - Query visible rows from spatial index: O(visible_rows)
   - Generate SVG path strings for visible arrows only
   - Render as 2 `<path>` elements (lines + heads)

```jsx
// Spatial index - O(visible_rows) lookup instead of O(total_arrows)
const spatialIndex = createMemo(() => {
    const index = new Map(); // row → Set<relIndex>
    for (let i = 0; i < rels.length; i++) {
        const fromRow = Math.floor(fromPos.y / rowHeight);
        const toRow = Math.floor(toPos.y / rowHeight);
        // Add to all rows this arrow spans
        for (let row = minRow; row <= maxRow; row++) {
            if (!index.has(row)) index.set(row, new Set());
            index.get(row).add(i);
        }
    }
    return { index, positions };
});

// Batched paths - only visible arrows
const batchedPaths = createMemo(() => {
    const visibleIndices = new Set();
    for (let row = startRow - 3; row <= endRow + 3; row++) {
        const rowRels = index.get(row);
        if (rowRels) for (const idx of rowRels) visibleIndices.add(idx);
    }
    // Generate path strings for visible arrows only
    return { lines: lineSegments.join(' '), heads: headSegments.join(' ') };
});

// Just 2 DOM elements regardless of arrow count
<path d={batchedPaths().lines} ... />
<path d={batchedPaths().heads} ... />
```

**Usage**:
```jsx
<Gantt arrowRenderer="batched" ... />
```

**Performance Comparison** (50K tasks, 47K arrows):

| Approach | DOM Elements | Per-scroll work | Scroll FPS |
|----------|--------------|-----------------|------------|
| `ArrowLayer` (individual) | ~47K components | O(47K) filter + churn | ~15 FPS |
| `ArrowLayerBatched` (no index) | 2 paths | O(47K) iteration | ~25 FPS |
| `ArrowLayerBatched` (spatial index) | 2 paths | O(visible_rows) | ~40 FPS |

**Impact**: Scales linearly with visible rows, not total arrows. 50K arrows performs same as 200 arrows.

### 11. Reactivity Fixes for Drag Performance

**Problem**: During drag, reactive cascades caused all arrows to re-render on every frame.

**Files**:
- `src/components/ArrowLayer.jsx`
- `src/components/TaskLayer.jsx`
- `src/components/Gantt.jsx`

**Fixes**:
1. **ArrowLayer positionMap**: Use `untrack()` around position reads to prevent cascade
2. **TaskLayer visibleTaskIds**: Use `untrack()` for `$bar` access during X filtering
3. **Gantt Y-sync effect**: Wrap position updates in `untrack()` to avoid feedback loop

```jsx
// ArrowLayer.jsx - Prevent cascade on position changes
const positionMap = createMemo(() => {
    untrack(() => {
        for (const taskId in tasks) {
            positions.set(taskId, { x: task.$bar.x, y: task.$bar.y, ... });
        }
    });
    return positions;
});

// TaskLayer.jsx - Untrack during X filtering
const bar = untrack(() => task.$bar);
if (bar && (bar.x + bar.width < sx - 200 || bar.x > ex + 200)) continue;
```

**Impact**: Drag performance improved from ~15 FPS to ~60 FPS.

---

## Future Optimizations

### Row-to-Row Drag

Enable moving tasks between resources.

**Changes Required**:
1. Track Y-axis in drag handler (`Bar.jsx`)
2. Compute target row from Y position
3. Add `onResourceChange` callback
4. Update task store with new resource

### Arrow Path Caching

Cache generated path strings and only regenerate when visible row set changes significantly.

**Current**: Path strings regenerated every scroll frame
**Proposed**: Skip regeneration if visible rows changed by < N rows

---

## View Mode Performance Comparison

| View Mode | Columns | Before | After Virtualization | Notes |
|-----------|---------|--------|---------------------|-------|
| Hour | ~8,700 | ~1,138ms | **~568ms** | 50% faster with virtualization |
| Day | ~365 | ~21ms | ~21ms | Already fast |
| Week | ~52 | ~15ms | ~15ms | Minimal DOM |
| Month | ~12 | ~10ms | ~10ms | Fastest |

**Note**: Hour view now renders only ~64 header divs instead of 8,700 (viewport + buffer).

**Recommendation**: Default to Day view for large datasets. Hour view is now usable for full year timelines.

---

## Testing Performance

```bash
# Start dev server
pnpm run dev:solid

# Open performance test page
# http://localhost:5173/examples/perf.html

# Select "JSON (1000)" source and "Hour" view
# Observe render time in header
```

## Files Modified

| File | Change |
|------|--------|
| `src/utils/createVirtualViewport.js` | **NEW** - Simple 2D viewport virtualization utility |
| `src/components/Grid.jsx` | SVG pattern for vertical lines |
| `src/components/GanttContainer.jsx` | Direct scrollLeft assignment, viewport signals |
| `src/components/Gantt.jsx` | Uses createVirtualViewport, untrack() in Y-sync effect |
| `src/components/DateHeaders.jsx` | Column virtualization |
| `src/components/TaskLayer.jsx` | Row/X filtering, untrack() for $bar access |
| `src/components/ArrowLayer.jsx` | Row filtering, untrack() in positionMap, cached positions during drag |
| `src/components/ArrowLayerBatched.jsx` | **ENHANCED** - Spatial row indexing for O(visible_rows) lookup |
| `src/components/GanttPerfDemo.jsx` | Default to 'batched' arrow renderer |
| `src/utils/date_utils.js` | Cached Intl.DateTimeFormat instances |
