# Gantt Experiments - Reactive Pattern Testing

## Purpose

The Experiments demo (`examples/experiments.html`) is a performance testing harness for evaluating different SolidJS reactive patterns. The goal is to find the optimal patterns for rendering 10,000+ tasks at 60fps.

**Core Principle: MEASURE EVERYTHING**

No assumptions about which pattern is optimal. Every alternative must be:
1. Hypothesized (what we think will be faster and why)
2. Tested (A/B comparison with controlled variables)
3. Measured (FPS, frame time, subscription counts)
4. Validated (data proves or disproves the hypothesis)

---

## Quick Start

```bash
pnpm run dev:solid
# Open http://localhost:5173/examples/experiments.html
```

1. Select a **Bar variant** (TestBar reactive pattern)
2. Select a **Visible variant** (task filtering strategy)
3. Click **V-Scroll**, **H-Scroll**, or **Both** to run stress test
4. Compare FPS/frame times across variants

---

## TestBar Variants

These variants test different approaches to accessing task data from the store.

### baseline
**Current GanttMinimalTest pattern**

```javascript
const t = createMemo(() => ({
    color: task?.color,
    name: task?.name,
    width: bar?.width,
    // ... all properties in one memo
}));
```

- Single `createMemo` batching all task properties
- One reactive dependency tracking point
- Creates new object on every memo evaluation

### noMemos
**Direct store access, no memoization**

```javascript
const color = () => getTask()?.color ?? '#3b82f6';
const name = () => getTask()?.name ?? '';
// ... each property is a separate accessor
```

- **Hypothesis**: Store proxy overhead may be negligible vs memo tracking overhead
- Multiple store accesses per render
- No memo creation/equality checking overhead

### splitMemo
**Bar.jsx pattern - separate static and dynamic memos**

```javascript
const staticProps = createMemo(() => ({
    color, name, id, locked  // Rarely change
}));

const dynamicProps = createMemo(() => ({
    width, height, pw  // Change during drag
}));
```

- **Hypothesis**: Separating rarely-changing props from frequently-changing improves perf
- Static props memo only updates when static data changes
- Dynamic props memo updates during drag without triggering static re-renders

### directTask
**Task passed as prop, reduced store lookups**

```javascript
const t = createMemo(() => {
    const task = getTask();  // Already a store proxy
    return { /* all props */ };
});
```

- **Hypothesis**: Reduces per-component store access overhead
- Task object passed directly instead of ID + lookup
- Same memo pattern as baseline but different data flow

### customEquality
**Memo with custom equals function**

```javascript
const t = createMemo(() => ({...}), undefined, {
    equals: (prev, next) => {
        return prev.color === next.color &&
               prev.name === next.name &&
               // ... deep equality check
    }
});
```

- **Hypothesis**: Avoid downstream updates from object reference changes
- Prevents cascade when memo creates new object with same values
- Trade-off: equality check cost vs cascade prevention

### minimal
**Absolute minimum for baseline measurement**

```javascript
<div style={{...}}>
    {getTask()?.name ?? ''}
</div>
```

- No memos, no event handlers, no drag
- Pure render baseline
- Useful for isolating rendering cost from reactive overhead

---

## Visible Tasks Variants

These variants test different strategies for filtering which tasks to render.

### standard
**Single memo for both X and Y**

```javascript
const visibleTasks = createMemo(() => {
    const sr = rowOffset();   // Creates dependency on row
    const sc = colOffset();   // Creates dependency on col
    // ... filter and return visible tasks
});
```

- Current GanttMinimalTest pattern
- **Issue**: Horizontal scroll triggers row filtering recalculation
- **Issue**: Vertical scroll triggers column filtering recalculation

### xySplit
**Separate memos for row and column ranges**

```javascript
const visibleRowRange = createMemo(() => ({
    start: rowOffset(),
    end: rowOffset() + visibleRows()
}));

const visibleColRange = createMemo(() => ({
    start: colOffset(),
    end: colOffset() + visibleCols()
}));

const visibleTasks = createMemo(() => {
    const rows = visibleRowRange();  // Only updates on V-scroll
    const cols = visibleColRange();  // Only updates on H-scroll
    // ... combine and filter
});
```

- **Hypothesis**: Horizontal scroll shouldn't trigger row recalc
- **Hypothesis**: Vertical scroll shouldn't trigger column recalc
- Better for diagonal scrolling stress test

### spatialIndex
**Pre-computed row -> taskIds mapping**

```javascript
const tasksByRow = createMemo(() => {
    const map = new Map();
    for (let i = 0; i < tasks.length; i++) {
        const row = Math.floor(i / TOTAL_COLS);
        if (!map.has(row)) map.set(row, []);
        map.get(row).push(i);
    }
    return map;
});

const visibleTasks = createMemo(() => {
    for (let r = startRow; r < endRow; r++) {
        const rowTasks = tasksByRow().get(r);
        // ... O(visible_rows) instead of O(total_tasks)
    }
});
```

- **Hypothesis**: O(visible_rows) lookup faster than O(total_tasks) iteration
- Pre-computed index built once (or on task add/remove)
- Especially important at 10K+ tasks

---

## Running Experiments

### Stress Test Modes

| Mode | Description | What It Tests |
|------|-------------|---------------|
| V-Scroll | Auto-scroll vertically at 100px/frame | Row filtering, Y-axis memos |
| H-Scroll | Auto-scroll horizontally at 150px/frame | Column filtering, X-axis memos |
| Both | Diagonal scrolling both axes | Combined filtering, xySplit benefit |

### Metrics

| Metric | Target | Meaning |
|--------|--------|---------|
| FPS | 60 | Frames per second (higher = better) |
| Worst | <16.7ms | Worst frame time in last 60 frames |
| Avg | <16.7ms | Average frame time in last 60 frames |

### Recording Results

After each 10-second stress test, results are logged to console:

```javascript
// Example output:
{
    barVariant: "baseline",
    visibleVariant: "standard",
    fps: 58,
    worst: "18.2",
    avg: "14.1"
}
```

---

## Measurement Methodology

### Test Environment

Record before each session:
- CPU model and speed
- RAM available
- Browser + version
- Number of tasks
- Screen resolution

### Test Protocol

1. **Cold render**: Reload page, measure time to first paint
2. **Warm baseline**: Let page idle for 5 seconds
3. **V-Scroll test**: Run 10 seconds, record FPS/worst/avg
4. **H-Scroll test**: Run 10 seconds, record FPS/worst/avg
5. **Both test**: Run 10 seconds, record FPS/worst/avg
6. **Change variant**, repeat steps 3-5

### Decision Matrix

After measuring all alternatives:

```
For each pattern:
  If variant outperforms baseline by >10%:
    Adopt variant
  Else if variant equals baseline (+/- 5%):
    Prefer simpler implementation
  Else:
    Keep baseline
```

---

## Adding New Variants

### TestBar Variant

1. Add component to `src/components/GanttExperiments.jsx`:

```javascript
function TestBarNewPattern(props) {
    // ... your pattern implementation
}
```

2. Register in `BAR_VARIANTS`:

```javascript
const BAR_VARIANTS = {
    // ...existing
    newPattern: {
        component: TestBarNewPattern,
        description: 'Brief hypothesis'
    },
};
```

### Visible Tasks Variant

1. Add hook function:

```javascript
function useVisibleTasksNewPattern(tasks, allTaskIds, rowOffset, colOffset, visibleRows, visibleCols) {
    return createMemo(() => {
        // ... your filtering pattern
    });
}
```

2. Register in `VISIBLE_VARIANTS`:

```javascript
const VISIBLE_VARIANTS = {
    // ...existing
    newPattern: {
        fn: useVisibleTasksNewPattern,
        description: 'Brief hypothesis'
    },
};
```

---

## Results Template

```markdown
## Test Results - [Date]

### Environment
- CPU:
- RAM:
- Browser:
- Tasks:
- Resolution:

### Bar Variants (visible=standard)

| Variant | V-Scroll FPS | H-Scroll FPS | Both FPS | Worst | Avg |
|---------|--------------|--------------|----------|-------|-----|
| baseline | | | | | |
| noMemos | | | | | |
| splitMemo | | | | | |
| directTask | | | | | |
| customEquality | | | | | |
| minimal | | | | | |

### Visible Variants (bar=baseline)

| Variant | V-Scroll FPS | H-Scroll FPS | Both FPS | Worst | Avg |
|---------|--------------|--------------|----------|-------|-----|
| standard | | | | | |
| xySplit | | | | | |
| spatialIndex | | | | | |

### Winner Combinations

| Category | Winner | Improvement |
|----------|--------|-------------|
| Bar pattern | | % |
| Visible strategy | | % |
| Combined | | % |
```

---

## References

- **Main component**: `src/components/GanttExperiments.jsx`
- **Entry point**: `src/entries/experiments.jsx`
- **Demo page**: `examples/experiments.html`
- **Documentation**: `docs/MINIMAL_TEST.md`
- **Related**: `src/entries/indexTest.jsx` (original variant testing harness)
