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

### 7. Arrow Virtualization

**Change**: Filter arrows to only render those connected to visible rows.

**File**: `src/components/ArrowLayer.jsx`

```jsx
const dependencies = createMemo(() => {
    return allDependencies().filter((dep) => {
        const fromRow = props.taskStore.getTask(dep.fromId)?._resourceIndex ?? -1;
        const toRow = props.taskStore.getTask(dep.toId)?._resourceIndex ?? -1;

        // Include if either endpoint is in visible range
        return (fromRow >= start - buffer && fromRow <= end + buffer) ||
               (toRow >= start - buffer && toRow <= end + buffer);
    });
});
```

**Impact**: Reduces arrows when viewport shows subset of rows (no effect when all 26 rows visible)

### 8. Horizontal Task/Arrow Virtualization

**Problem**: With 10K tasks, all bars and arrows rendered regardless of horizontal scroll position (~5,500ms).

**Solution**: Filter tasks and arrows by X position overlap with viewport.

**Files**:
- `src/components/Gantt.jsx` - Added `viewportXRange` memo with `startX/endX` in pixels
- `src/components/TaskLayer.jsx` - Filter tasks where `bar.x + bar.width >= startX && bar.x <= endX`
- `src/components/ArrowLayer.jsx` - Filter arrows where either endpoint bar is in visible X range

```jsx
// Gantt.jsx - Pixel-based X range
const BUFFER_X = 200; // Extra pixels to render outside viewport
const viewportXRange = createMemo(() => {
    const sl = scrollLeft();
    const vw = viewportWidth();
    return {
        startX: Math.max(0, sl - BUFFER_X),
        endX: sl + vw + BUFFER_X,
    };
});

// TaskLayer.jsx - Filter by X position
const filterByViewportX = (taskList) => {
    const sx = startX();
    const ex = endX();
    if (ex === Infinity) return taskList;
    return taskList.filter((task) => {
        const bar = task.$bar;
        if (!bar) return true;
        return bar.x + bar.width >= sx && bar.x <= ex;
    });
};
```

**Impact**: 99.9% reduction in rendered elements (10K → ~11), render time ~30ms

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

## Future Optimizations

### Row-to-Row Drag

Enable moving tasks between resources.

**Changes Required**:
1. Track Y-axis in drag handler (`Bar.jsx`)
2. Compute target row from Y position
3. Add `onResourceChange` callback
4. Update task store with new resource

### Arrow Path Batching

Combine multiple arrows into single path elements where possible.

**Current**: 926 arrows × 3 elements = 2,778 elements

**Proposed**: Group arrows by style, render as single `<path>` with multiple move commands

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
| `src/components/Grid.jsx` | SVG pattern for vertical lines |
| `src/components/GanttContainer.jsx` | Direct scrollLeft assignment, viewport signals |
| `src/components/Gantt.jsx` | Viewport range calculations, removed GridTicks |
| `src/components/DateHeaders.jsx` | Column virtualization |
| `src/components/TaskLayer.jsx` | Row grouping, row virtualization |
| `src/components/ArrowLayer.jsx` | Arrow virtualization by visible rows |
| `src/components/GridTicks.jsx` | Can be deleted (unused) |
| `src/utils/date_utils.js` | Cached Intl.DateTimeFormat instances |
