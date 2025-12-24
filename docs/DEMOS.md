# Gantt Demos Reference

Comprehensive reference for all demo pages. Last updated: 2025-12-23.

---

## Quick Start

```bash
# Development
pnpm run dev:solid
# Open http://localhost:5173/examples/

# Production (for benchmarking)
pnpm build:demo && npx serve dist-demo -l 5174
# Use clean URLs without .html extension (e.g., /examples/perf-isolate?bar=nochildren)
```

**Important:** When benchmarking with `serve`, use clean URLs. The `.html` extension causes redirects that strip query parameters.

---

## Demo Categories

### Feature Demos

| Demo | Component | Description |
|------|-----------|-------------|
| [gantt.html](../examples/gantt.html) | GanttDemo.jsx | Main interactive demo with full features |
| [subtask.html](../examples/subtask.html) | GanttProjectDemo.jsx | Parent/child task hierarchy (100 tasks) |
| [resource-groups.html](../examples/resource-groups.html) | GanttResourceGroupsDemo.jsx | Collapsible team resource groups |
| [constraint.html](../examples/constraint.html) | ConstraintDemo.jsx | FS/SS/FF/SF dependency constraints |
| [showcase.html](../examples/showcase.html) | ShowcaseDemo.jsx | Props and configuration showcase |

### Component Demos

| Demo | Component | Description |
|------|-----------|-------------|
| [bar.html](../examples/bar.html) | BarDemo.jsx | Task bar with drag handles, progress, resize |
| [arrow.html](../examples/arrow.html) | ArrowDemo.jsx | Dependency arrow rendering |

### Performance Testing

| Demo | Component | Created | Status |
|------|-----------|---------|--------|
| [perf-isolate.html](../examples/perf-isolate.html) | GanttPerfIsolate.jsx | Dec 22, 2025 | **Best-in-class** |
| [experiments.html](../examples/experiments.html) | GanttExperiments.jsx | Dec 21, 2025 | Active |
| [perf.html](../examples/perf.html) | GanttPerfDemo.jsx | Dec 10, 2025 | Foundational |
| [profiler.html](../examples/profiler.html) | GanttProfiler.jsx | ~Dec 17, 2025 | Supporting |

### Historical/Test

| Demo | Component | Created | Status |
|------|-----------|---------|--------|
| [minimal-test.html](../examples/minimal-test.html) | GanttMinimalTest.jsx | Dec 20, 2025 | Historical |
| [index-test.html](../examples/index-test.html) | IndexTest | - | Test harness |

---

## Performance Testing Demos

### perf-isolate.html - Best-in-class

**Created:** Dec 22, 2025 | **Component:** GanttPerfIsolate.jsx

Progressive feature isolation to find overhead sources. Start minimal, add features until performance degrades.

#### URL Parameters

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `bar` | minimal, text, handles, reactive, drag, events, full, experiments, nochildren, contained, willchange, combined | minimal | Bar variant |
| `grid` | 0, 1 | 0 | Show SVG grid |
| `headers` | 0, 1 | 0 | Show date headers |
| `headerOpt` | 0, 1 | 0 | Use DateHeadersOptimized |
| `resources` | 0, 1 | 0 | Show resource column |
| `arrows` | 0, 1 | 0 | Show dependency arrows (2D virtualized) |
| `test` | horizontal, vertical, both | - | Auto-scroll direction |

#### Bar Variants (12)

| # | Variant | Description |
|---|---------|-------------|
| 1 | minimal | Baseline div with inline position |
| 2 | text | + task name text |
| 3 | handles | + left/right resize divs |
| 4 | reactive | Reactive getters instead of direct props |
| 5 | drag | + useDrag hook |
| 6 | events | + context-based event handlers |
| 7 | full | + progress gradient background |
| 8 | experiments | createMemo pattern (GanttExperiments style) |
| 9 | **nochildren** | Click-position detection, no child divs **WINNER: 8.5% faster** |
| 10 | contained | + CSS containment |
| 11 | willchange | + will-change: transform |
| 12 | combined | nochildren + contain + will-change |

#### Example URLs

```
?bar=minimal                              # Baseline measurement
?bar=nochildren&grid=1&headers=1          # With features
?bar=nochildren&headers=1&arrows=1        # With arrows
?bar=nochildren&test=horizontal           # Auto-scroll benchmark
```

#### Results

See [perf-traces/ANALYSIS.md](../perf-traces/ANALYSIS.md) for benchmark data.

---

### experiments.html

**Created:** Dec 21, 2025 | **Component:** GanttExperiments.jsx

Reactive pattern and virtualization strategy comparison with interactive UI.

#### Bar Patterns (4)

| Pattern | Description | Result |
|---------|-------------|--------|
| **baseline** | Single createMemo batching all props | **WINNER: 5.5% faster** |
| noMemos | Direct store access, no memos | 2.6x more effect runs |
| splitMemo | Separate static/dynamic memos | Extra overhead |
| minimal | No handlers, no memos | Baseline measurement |

#### Virtualization Modes (9+)

| Mode | Description | Result |
|------|-------------|--------|
| **combined** | Single memo for X+Y filtering | **WINNER: 3% faster** |
| xySplit | Two-stage: row filter then X filter | 3% slower |
| smartCache | Cache row tasks, refill on Y change | - |
| splitEquals | Custom equality on ID arrays | - |
| untracked | Uses `untrack()` to prevent subscriptions | - |
| plainLookup | Access plain object instead of store | - |
| xBucket | Spatial index with X_BUCKET_SIZE | - |
| xBucketStart | Tasks only in START bucket | - |
| 2D | Row-first + bucket lookup | - |

#### Results

See [perf-traces/ANALYSIS.md](../perf-traces/ANALYSIS.md) and [docs/EXPERIMENTS.md](./EXPERIMENTS.md).

---

### perf.html

**Created:** Dec 10, 2025 | **Component:** GanttPerfDemo.jsx

Full-featured stress test with all UI layers and real dependencies.

#### Features

- Real-time FPS, frame timing, heap tracking
- 30-second stress tests (horizontal/vertical scroll)
- Configurable overscan, view modes
- Uses calendar.json data (200+ tasks)

#### Metrics Tracked

- FPS (RAF-based counter)
- Frame timing (worst frame, average in 60-frame window)
- Scroll events/sec
- Heap size (Chrome DevTools memory API)
- DOM stats (task bar count, arrow count)

---

### profiler.html

**Created:** ~Dec 17, 2025 | **Component:** GanttProfiler.jsx

Function-level call instrumentation and profiling.

#### Features

- Function timing instrumentation
- Call tree analysis (first 5 levels)
- Split-pane UI (Gantt + analysis panel)
- Automated H/V scroll tests with profiling

---

## Timeline

| Date | Milestone |
|------|-----------|
| Dec 10, 2025 | perf.html created - Initial performance testing |
| ~Dec 17, 2025 | profiler.html - Function instrumentation |
| Dec 20, 2025 | minimal-test.html - Slot-based baseline |
| Dec 21, 2025 | experiments.html - Major benchmarking (reactive patterns) |
| Dec 22, 2025 | perf-isolate.html - "perf-isolate success" |
| Dec 23, 2025 | Header optimization investigations |

---

## Current Best Practices

Based on benchmarking results:

| Category | Best Choice | Improvement |
|----------|-------------|-------------|
| Bar pattern | `nochildren` | 8.5% faster than `combined` |
| Reactive pattern | `baseline` (createMemo) | 5.5% faster than `noMemos` |
| Virtualization | `combined` (single memo) | 3% faster than `xySplit` |
| Headers | Original `DateHeaders` | "Optimizations" were slower |

See [perf-traces/ANALYSIS.md](../perf-traces/ANALYSIS.md) for details.

---

## Future Work

### Not Yet Benchmarked

| Target | Hypothesis | Priority |
|--------|------------|----------|
| Headers: Fixed slot pool | CSS transforms instead of DOM add/remove | Medium |
| Grid: Canvas rendering | Draw lines on canvas instead of SVG | Low |
| Custom equality everywhere | Prevent cascades from new object refs | Medium |

### Known Issues

| Issue | Status |
|-------|--------|
| ArrowLayerBatched | Disabled (21% regression), needs batching fix |
| Debug effects in Bar.jsx | Creates subscriptions, should be removed |

---

## Related Documentation

- [perf-traces/ANALYSIS.md](../perf-traces/ANALYSIS.md) - Current best practices and benchmarks
- [perf-traces/HISTORY.md](../perf-traces/HISTORY.md) - Investigation logs
- [docs/EXPERIMENTS.md](./EXPERIMENTS.md) - GanttExperiments details
- [docs/MINIMAL_TEST.md](./MINIMAL_TEST.md) - Historical slot-based approach
