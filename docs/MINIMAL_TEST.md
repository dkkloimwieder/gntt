# GanttMinimalTest - Performance-First Rendering Engine

> **⚠️ Historical Document**
>
> This documents an earlier experimental harness using **slot-based grids**. For current best practices with **timeline-based positioning**, see:
> - [perf-traces/ANALYSIS.md](../perf-traces/ANALYSIS.md) - Current benchmarks and recommendations
> - [docs/EXPERIMENTS.md](./EXPERIMENTS.md) - GanttExperiments reactive pattern testing
> - `GanttPerfIsolate.jsx` - Progressive feature testing harness
>
> The component `GanttMinimalTest.jsx` still exists for reference but active development uses the newer harnesses.

---

## 1. Purpose & Goals

### Why It Exists

GanttMinimalTest is a **performance-first** Gantt chart implementation designed to:

1. **Isolate scroll/render performance** from feature complexity
2. **Test reactive patterns** without the noise of constraint resolution, arrows, etc.
3. **Serve as the foundation** for the production Gantt after reaching feature parity

### Target Performance

- **10,000 tasks at 60fps** during scroll
- Cold render under 500ms
- Single task drag at 60fps
- Batch drag (100 dependents) at 55fps

### Design Philosophy

> "No optimization without measurement. All alternatives must be tested."

Every reactive pattern choice must be:
1. Hypothesized (what we think will be faster and why)
2. Tested (A/B comparison with controlled variables)
3. Measured (FPS, frame time, memory, subscription counts)
4. Validated (data proves the hypothesis)

---

## 2. Architecture

### 2.1 Component Structure

```
GanttMinimalTest
├── GanttContainer (scroll management)
│   ├── DateHeaders (column labels)
│   ├── ResourceColumn (row labels)
│   ├── Grid (SVG background)
│   └── barsLayer
│       └── <Index each={visibleTasks()}>
│           └── TestBar (task bars)
└── Stress Test UI (FPS metrics, controls)
```

### 2.2 Data Flow

```
calendar.json (200 tasks)
    ↓
Parse dates → Find ganttStart (earliest date)
    ↓
Pre-compute _bar positions (x, y, width, height from dates)
    ↓
createStore(initialTasks)  // Fine-grained reactivity
    ↓
Scroll Event
    ↓
onScroll(scrollLeft, scrollTop) → setRowOffset(), setColOffset()
    ↓
visibleTasks memo recalculates (2D window)
    ↓
<Index> renders TestBar for each visible task
    ↓
TestBar reads task via createMemo(t()) and pos()
    ↓
DOM with transform positioning
```

### 2.3 Layout System

**Current: Slot-based Grid**
```javascript
const TOTAL_COLS = 100;
const SLOT_WIDTH = 120;
const SLOT_HEIGHT = 28;

// Position from slot index
function getSlotPosition(slotIndex, visibleCols) {
    const row = Math.floor(slotIndex / visibleCols);
    const col = slotIndex % visibleCols;
    return {
        x: col * (SLOT_WIDTH + GAP),
        y: row * (SLOT_HEIGHT + GAP),
    };
}
```

**Target: Timeline-based**
```javascript
// Position from date calculations
const x = computeX(task._start, ganttStart, 'hour', 1, 30);
const width = computeWidth(task._start, task._end, 'hour', 1, 30);
```

### 2.4 Virtualization Strategy

**2D Window Virtualization:**
- Calculates visible row range from scrollTop
- Calculates visible column range from scrollLeft
- Only renders tasks within both ranges
- Uses overscan (OVERSCAN = 2) for smooth scrolling

**Key Signals:**
```javascript
const [rowOffset, setRowOffset] = createSignal(0);    // Current row start
const [colOffset, setColOffset] = createSignal(0);    // Current column start
const [subRowOffset, setSubRowOffset] = createSignal(0);  // Sub-pixel for smooth scroll
const [subColOffset, setSubColOffset] = createSignal(0);
```

---

## 3. SolidJS Reactive Model

### 3.1 Why createStore (not createSignal(Map))

```javascript
const [tasks] = createStore(initialTasks);  // Object of {id: task}
```

**Path-level reactivity:**
- Accessing `tasks[id]` creates subscription to ONLY that path
- Dragging task A doesn't trigger re-renders for task B, C, D...
- Critical for 10K performance: O(1) updates instead of O(n)

**Comparison:**
```javascript
// BAD: createSignal(Map) - full re-render on any change
const [tasks, setTasks] = createSignal(new Map());
// Updating one task re-renders ALL Bar components

// GOOD: createStore - path-level updates
const [tasks, setTasks] = createStore({});
// Updating tasks[id] only re-renders that Bar
```

### 3.2 Memo Patterns (MUST BE TESTED)

**Current TestBar Pattern:**
```javascript
const t = createMemo(() => {
    const task = getTask();
    const bar = task?._bar;
    return {
        color: task?.color,
        name: task?.name,
        width: bar?.width,
        height: bar?.height,
        // Combines static AND dynamic props
    };
});
```

**Alternative Patterns to Test:**

| Pattern | Description | Hypothesis |
|---------|-------------|------------|
| noMemos | Direct store access everywhere | Store proxy overhead negligible |
| singleMemo | One memo batching all props | Current TestBar pattern |
| splitMemo | Static + dynamic separation | Bar.jsx pattern |
| directTask | Task passed as prop, not lookup | Reduces store access |
| customEquality | Memo with custom equals | Avoids cascade on object creation |

**Unknown Tradeoffs (Requires Measurement):**
- Is memo overhead > store proxy overhead?
- Does object creation in memo cause downstream cascades?
- Is position memo caching worth the tracking overhead?

### 3.3 Subscription Tracking

**visibleTasks memo creates subscriptions:**
```javascript
const visibleTasks = createMemo(() => {
    // Each tasks[taskId] access creates a subscription
    for (...) result.push(tasks[allTaskIds[taskIndex]]);
});
```

**Current mitigation:** Grid layout only accesses visible window (~24 tasks).

**At 10K scale:** Timeline layout may iterate all tasks to filter by X-range, creating 10K subscriptions.

### 3.4 untrack() Usage

**Pattern:** Use `untrack()` to prevent subscriptions during read-only operations.

```javascript
// BAD: Creates subscription to every task
for (const id of Object.keys(tasks)) { ... }

// GOOD: No subscriptions created
const taskKeys = untrack(() => Object.keys(tasks));
```

**Locations in TaskLayer.jsx:**
- Line 196: `untrack()` for tasksByResource grouping
- Line 247: `untrack()` for X-range filtering
- Line 287: `untrack()` for splitTaskIds

---

## 4. Performance Characteristics

### 4.1 Current Benchmarks

| Metric | 200 tasks | Target (10K) |
|--------|-----------|--------------|
| Cold render | ~50ms | <500ms |
| H-scroll FPS | 60 | 60 |
| V-scroll FPS | 60 | 60 |
| Diagonal FPS | 60 | 60 |

### 4.2 Hot Paths

1. **visibleTasks memo** - Runs on every scroll offset change
2. **TestBar t() memo** - Runs when task data changes
3. **Scroll handler** - Converts scroll position to row/col offsets
4. **getSlotPosition()** - Called for each visible task

### 4.3 Known Bottlenecks

1. **Arrow Layer (disabled)**: 21% performance regression from SVG path updates
2. **Debug effect in Bar.jsx**: Creates subscriptions on every bar (lines 480-487)
3. **Single visibleTasks memo**: Recalculates on ANY scroll direction

---

## 5. Feature Gap Analysis

### 5.1 Matrix: Minimal-Test vs Perf Demo

| Feature | Perf Demo | Minimal-Test | Gap |
|---------|-----------|--------------|-----|
| Date-based positioning | ✓ | Partial | Uses slot grid, not timeline |
| 2D virtualization | ✓ | ✓ | Full parity |
| Drag/resize handles | ✓ | ✓ (no-op) | Hooks present, callbacks empty |
| Progress editing | ✓ | ✗ | Missing progress handle |
| Arrows | ✓ | ✗ | Disabled (21% regression) |
| Constraint resolution | ✓ | ✗ | No constraint callbacks |
| Hover/click popups | ✓ | ✗ | Events fire, no UI |
| Batch drag | ✓ | ✗ | No dependent task collection |
| Resource groups | ✓ | ✗ | Mock resources only |
| Stress test UI | ✓ | ✓ | Similar implementation |

### 5.2 Missing Components

- `constraintEngine.js` integration
- `ArrowLayerBatched.jsx` (with performance fixes)
- `TaskDataPopup.jsx` (hover popup)
- `TaskDataModal.jsx` (click modal)
- Real resource store integration

### 5.3 Migration Priorities

1. **P0:** Timeline layout (replace slot grid)
2. **P0:** Working drag/resize callbacks
3. **P1:** Constraint resolution
4. **P2:** Progress editing
5. **P3:** Hover/click popups

---

## 6. Implementation Details

### 6.1 TestBar vs Bar.jsx

| Aspect | TestBar | Bar.jsx |
|--------|---------|---------|
| Memos | 1 (combined) | 12+ (split) |
| Position source | Slot index | Store _bar |
| Debug effects | None | 1 (lines 480-487) |
| Event handlers | 4 (no-op) | 8 (functional) |
| DOM elements | 3 | 8 |
| Wrapper div | None | Yes (in TaskLayer) |

### 6.2 Grid Layout vs Timeline

**Grid (current):**
```javascript
// Fixed slot positions
const pos = getSlotPosition(props.slotIndex, props.visibleCols);
// x = col * (SLOT_WIDTH + GAP)
// y = row * (SLOT_HEIGHT + GAP)
```

**Timeline (target):**
```javascript
// Date-based positions
const x = () => getTask()?._bar?.x;
const y = () => getTask()?._bar?.y;
const width = () => getTask()?._bar?.width;
```

### 6.3 Drag Handling

**Current (no-op):**
```javascript
const { isDragging, startDrag } = useDrag({
    onDragStart: () => {},
    onDragMove: () => {},
    onDragEnd: () => {},
});
```

**Target (functional):**
```javascript
onDragMove: (move, data, state) => {
    if (state === 'dragging_bar') {
        const newX = snapToGrid(data.originalX + move.deltaX, colWidth);
        taskStore.updateBarPosition(taskId, { x: newX });
    }
}
```

---

## 7. Optimization Opportunities

### 7.1 X/Y Memo Separation

**Problem:** Single visibleTasks memo recalculates on ANY scroll.

```javascript
// CURRENT: Recalculates on horizontal OR vertical scroll
const visibleTasks = createMemo(() => {
    const sr = rowOffset();  // Creates dependency
    const sc = colOffset();  // Creates dependency
    // ...
});
```

**Solution:** Split into independent memos.

```javascript
// BETTER: Only recalculates when relevant axis changes
const visibleRowRange = createMemo(() => ({
    start: rowOffset(),
    end: rowOffset() + visibleRows()
}));

const visibleColRange = createMemo(() => ({
    start: colOffset(),
    end: colOffset() + visibleCols()
}));

// Combine only when needed
const visibleTasks = createMemo(() => {
    const rowRange = visibleRowRange();
    const colRange = visibleColRange();
    // Filter by both ranges
});
```

### 7.2 Spatial Indexing

**Problem:** Linear iteration to find visible tasks.

```javascript
// O(n) where n = total tasks
for (let r = 0; r < vRows; r++) {
    for (let c = 0; c < vCols; c++) {
        // ...
    }
}
```

**Solution:** Pre-compute row → taskIds mapping.

```javascript
// Build once, update on task add/remove
const tasksByRow = new Map();  // row -> Set<taskId>

// O(visible_rows) instead of O(total_tasks)
const visibleTaskIds = createMemo(() => {
    const result = [];
    for (let row = startRow; row <= endRow; row++) {
        const rowTasks = tasksByRow.get(row);
        if (rowTasks) result.push(...rowTasks);
    }
    return result;
});
```

### 7.3 Debug Effect Removal

**Bar.jsx lines 480-487:**
```javascript
createEffect(() => {
    const id = t().id;
    const bg = computedBgColor();
    if (id === 'task-0') console.log(...);
});
```

This creates reactive subscriptions on EVERY Bar even though it only logs for task-0. Should be removed or gated behind DEBUG flag.

---

## 8. Migration Roadmap

### Phase 1: Core Rendering Parity

1. **Replace slot grid with timeline layout**
   - Use `_bar.x` directly instead of slot positions
   - Remove TOTAL_COLS/SLOT_WIDTH constants
   - Implement horizontal virtualization by X-range

2. **Enable real drag/resize**
   - Connect drag callbacks to `taskStore.updateBarPosition`
   - Add constraint resolution integration
   - Implement batch drag for dependents

3. **Add progress editing**
   - Add progress handle to TestBar
   - Connect to `taskStore.updateTask`

### Phase 2: 10K Task Optimization

1. **Test reactive pattern alternatives** (see Experiments Demo)
2. **Measure all patterns** with 10K tasks
3. **Adopt winning patterns** based on data

### Phase 3: Production Integration

1. Replace perf demo core with optimized minimal-test
2. Migrate to main Gantt.jsx

---

## References

- **Main component:** `src/components/GanttMinimalTest.jsx`
- **Experiment harness:** `src/entries/indexTest.jsx`
- **Full-featured bar:** `src/components/Bar.jsx`
- **Task rendering patterns:** `src/components/TaskLayer.jsx`
- **Fine-grained store:** `src/stores/taskStore.js`
- **Drag handling:** `src/hooks/useDrag.js`
