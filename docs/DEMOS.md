# Gantt demos

Start Vite with `pnpm dev`, then open [the demo hub](http://localhost:5173/examples/).
If you want to run the database demo, run `pnpm db:setup` and use `pnpm dev:all` to start both servers.
See the [database guide](./DATABASE.md) for setup and data details.

`pnpm build:demo` builds the three browser benchmark pages into `dist-demo/`.
Use `pnpm preview:demo` to serve that build at port 4173.
For the automated benchmark commands that use port 5174, follow the [benchmark runner guide](../benchmarks/traces/README.md).

## Feature demos

| Page | What to try |
|---|---|
| [gantt.html](../examples/gantt.html) | Move or resize tasks with finish-to-start scheduling constraints. |
| [subtask.html](../examples/subtask.html) | Expand parent tasks and compare sequential, parallel, and mixed layouts. |
| [resource-groups.html](../examples/resource-groups.html) | Collapse teams and expand their resource rows. |
| [constraint.html](../examples/constraint.html) | Compare dependency types and absolute constraints. |
| [showcase.html](../examples/showcase.html) | Change task bar, connector, and constraint options. |
| [db.html](../examples/db.html) | Create, edit, and delete events. Drag a bar to save new dates. |
| [multi-select.html](../examples/multi-select.html) | Use Ctrl or Command to toggle a task, Shift to select a range, and drag the selection. |
| [box-select.html](../examples/box-select.html) | Drag a selection box from empty grid space. |
| [critical-path.html](../examples/critical-path.html) | Toggle highlighting on the longest dependency chain. |
| [custom-columns.html](../examples/custom-columns.html) | Inspect custom name, owner, and progress columns. |
| [filter-search.html](../examples/filter-search.html) | Search for task names and apply preset filters. |
| [export.html](../examples/export.html) | Download all or part of the chart as SVG or 2× PNG. |
| [bar.html](../examples/bar.html) | Drag and resize standalone task bars. |
| [arrow.html](../examples/arrow.html) | Compare dependency connector shapes and routing. |

## Performance demos

| Page | What it measures |
|---|---|
| [perf.html](../examples/perf.html) | Full chart rendering, scrolling, and task-layer modes. |
| [perf-isolate.html](../examples/perf-isolate.html) | Rendering cost of individual chart features. |
| [experiments.html](../examples/experiments.html) | [Bar reactivity and visible-task filtering variants](./EXPERIMENTS.md). |
| [profiler.html](../examples/profiler.html) | Function calls and timings during manual recording or automated scrolling. |
| [minimal-test.html](../examples/minimal-test.html) | [A fixed-slot grid](./MINIMAL_TEST.md) that uses real browser scrolling. |
| [index-test.html](../examples/index-test.html) | Reuse of bar components as different tasks enter fixed slots. |

### Full chart performance

`perf.html` loads the tracked calendar fixture.
Use **Reload** to reprocess it, or **H-Scroll** and **V-Scroll** to run a 30-second scroll test.
The **Benchmark** button starts a separate recording. Stop it before using **Export JSON**.

The Render readout measures from the fixture update until a timer after two animation frames.
Its value includes scheduling time. Look at a browser trace for script, layout, and paint costs.
The heap readout requires a browser that exposes `performance.memory`.

The Arrows selector and arrow count do not measure an on-screen arrow renderer in the current full chart.
Use the isolation harness with `arrows=1` for that comparison.
The full chart captures overscan settings at mount. The buffer sliders do not change a running chart's viewport.

### Feature isolation

Open [perf-isolate.html with horizontal scrolling](http://localhost:5173/examples/perf-isolate.html?bar=nochildren&test=horizontal).
Add `grid=1`, `headers=1`, `resources=1`, or `arrows=1` to measure the cost of each feature.

| Parameter | Values and behavior |
|---|---|
| `bar` | `minimal` by default. See the variants below. |
| `grid`, `resources`, `arrows` | Set to `1` to enable the feature. |
| `headers` | Set to `1` to show date headers. The constraint fixture also turns them on. |
| `headerOpt` | Set to `1` to use `DateHeadersOptimized` when headers are visible. |
| `context` | Set to `1` to add the event context. The `events` and `full` bar variants always use it. |
| `test` | `horizontal`, `vertical`, or `both`. The page scrolls until you leave it. |
| `data` | `calendar` by default. Use `constraint` for a fixture with scheduling constraints. |
| `topology` | `breadth`, `depth`, `balanced`, or `debug`. Takes precedence over `data`. |
| `hours` | Timeline hours to fit horizontally. The page selects a scale from average task duration by default. |

The isolation harness uses its row and day lookup for virtualization.
Use [the Experiments demo](./EXPERIMENTS.md) to compare virtualization modes.

| Bar variants | What they add |
|---|---|
| `minimal`, `text`, `handles` | Inline position, task text, and resize handle elements. |
| `reactive`, `drag`, `events`, `full` | Reactive getters, drag hook, event context, and the progress gradient. |
| `experiments` | A single memo for bar data. |
| `nochildren`, `contained`, `willchange`, `combined` | Pointer-position hit areas with optional CSS containment and `will-change`. |
| `hoverpopup`, `clickmodal` | Hover and click detail surfaces. |
| `dragbase`, `dragfunc`, `dragconst` | No drag handlers, drag that changes positions, and drag with constraints. |

Compare runs under the same workload. The [benchmark archive](../benchmarks/traces/ANALYSIS.md) records measurements from earlier builds.
