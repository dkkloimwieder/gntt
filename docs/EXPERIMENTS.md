# Gantt Experiments - Reactive Pattern Testing

## Purpose

The Experiments demo (`examples/experiments.html`) is a performance testing harness for evaluating different SolidJS reactive patterns. The goal is to find optimal patterns for rendering 10,000+ tasks at 60fps.

**Core Principle: MEASURE EVERYTHING**

For benchmark results and current best practices, see [perf-traces/ANALYSIS.md](../perf-traces/ANALYSIS.md).

---

## Quick Start

```bash
pnpm dev
# Open http://localhost:5173/examples/experiments.html
```

1. Select a **Bar variant** (TestBar reactive pattern)
2. Select a **Visible variant** (task filtering strategy)
3. Click **V-Scroll**, **H-Scroll**, or **Both** to run stress test
4. Compare FPS/frame times across variants

---

## Available Variants

### Bar Variants

| Variant | Description | Result |
|---------|-------------|--------|
| **baseline** | Single createMemo batching all props | **Winner** (5.5% faster) |
| noMemos | Direct store access, no memos | 2.6x more effect runs |
| splitMemo | Separate static/dynamic memos | Extra overhead |
| minimal | No memos, no handlers | Baseline measurement |

### Visible Tasks Variants

| Variant | Description | Result |
|---------|-------------|--------|
| **combined** | Single memo for X+Y filtering | **Winner** |
| xySplit | Separate X and Y memos | 3% slower |
| spatialIndex | Pre-computed row->taskIds map | Good for 10K+ |

---

## Stress Test Modes

| Mode | Description | What It Tests |
|------|-------------|---------------|
| V-Scroll | Auto-scroll vertically at 100px/frame | Row filtering, Y-axis memos |
| H-Scroll | Auto-scroll horizontally at 150px/frame | Column filtering, X-axis memos |
| Both | Diagonal scrolling both axes | Combined filtering |

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

2. Register in `VISIBLE_VARIANTS`.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/components/GanttExperiments.jsx` | Main component |
| `src/entries/experiments.jsx` | Entry point |
| `examples/experiments.html` | Demo page |
| `perf-traces/ANALYSIS.md` | Benchmark results |
| `perf-traces/HISTORY.md` | Investigation logs |
