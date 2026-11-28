# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Gantt chart library built with SolidJS using reactive stores and fine-grained reactivity.

The library provides drag & drop task management, dependency visualization, constraint enforcement (FS/SS/FF/SF), and theme support.

## SolidJS 2.0 rules

The project uses SolidJS 2.0.4, `@solidjs/web` 2.0.4, and `@solidjs/vite-plugin` 3.0.1.
Import reactivity, stores, and control flow from `solid-js`. Import DOM APIs and JSX types from `@solidjs/web`.
Set `jsxImportSource` to `@solidjs/web`. The package exports ES modules and requires Node 22.12 or later.

The installed `node_modules/solid-js/CHEATSHEET.md` describes the current runtime.
The RC migration plan and its measurements are in `docs/migration/solid2/PLAN.md`.

1. **Deferred writes.** Setters stage the write; reads return the committed value until the microtask flush or an explicit `flush()`. Functional updaters compose against the staged value, and store draft callbacks see staged state — the outer store proxy does not.
2. **Write guard.** Writes throw `REACTIVE_WRITE_IN_OWNED_SCOPE` (dev) inside component bodies, memo bodies, effect *compute* phases and anything they call — `untrack` does **not** clear the owner. The guard covers both store and signal setters inside `createRoot` bodies. Allowed write sites: event handlers, timers, promise continuations, effect *apply*, `onSettled` bodies, and signals created with `{ ownedWrite: true }`.
3. **`onSettled` is the mount hook.** Its body is untracked and children-forbidden (no `onCleanup`, no primitive creation, directly or via a callee); it must return `undefined` or a cleanup *function* — a concise arrow returning a setter result or a Promise throws. `flush()` inside it throws. Never call a consumer callback (`onReady`, `onContainerReady`) synchronously from it; defer with `queueMicrotask`.
4. **Split effects only.** `createEffect(compute, apply, { defer? })` is the only form. `compute` tracks and must return plain values, never store proxies; `apply` is untracked, may write, and may return only a cleanup function. The apply callback runs each time compute reruns, including when it returns the same value. To skip equal values, track a memo. `flush()` inside apply is a silent no-op.
5. **`flush()` legality table.** Legal in event handlers, timers, promise continuations and test bodies · silent no-op in effect apply · throws in `onSettled` and `createTrackedEffect`. The only sanctioned library site is `useDrag.handleMouseUp` (`src/hooks/useDrag.ts`), where the final drag move must commit before `onDragEnd` re-reads the geometry. Do not add another.
6. **Stores.** One draft setter: `setX((s) => { s.k = v; })`. Path setters and object-merge forms are gone and **silently no-op** if you write them — that is the failure mode that broke the showcase demo. `storePath` is the compat helper, `snapshot` replaces the 1.x unwrap, and `reconcile(v, key='id')` returns a draft function. `delete draft[k]` removes a key — assigning `undefined` keeps it. `Set`/`Map`/`Date` inside a store are **not** proxied: replace them, never mutate in place, and prefer a signal holding an immutable collection (as `ganttConfigStore.expandedTasks` and `taskStore.collapsedTasks` now do). Leaf-mutate `task._bar.x`, never replace the task object. A memo returning a store sub-proxy never invalidates, so bindings must read their own leaf.
7. **Memos are eager, and stay eager (D7, measured in E4.5).** A memo recomputes on every source change whether or not anything reads it. `createMemo(fn, { lazy: true })` changes two things you will notice: the compute at creation is skipped (repaid on the first read, which also clears the lazy flag for good), and auto-dispose is turned on — the memo is torn down when its last tracked subscriber leaves, and again on every flush after an *ownerless* read (event handler, timer, rAF, promise continuation, **an effect's apply phase**, `untrack` at a root), so a lazy memo read only from such scopes recomputes once per tick it is read in. With a live tracked subscriber (JSX, another memo, an effect compute) a lazy memo recomputes exactly as often as an eager one — the probe on the 10K experiments page counted identical recomputes per scroll step for both. Use `{ lazy: true }` only for a memo that spends time with **zero** tracked subscribers (behind a `<Show>`, a closed popup), is never read from an ownerless scope while unsubscribed, and is not read by an eager memo in its creation tick (no lint or diagnostic checks that last one — read the wrapper chain). No library memo qualifies today, so none is lazy; the only `{ lazy: true }` in the tree is the demo-only probe switch in `src/demo/GanttExperiments.tsx`. A memo created with no owner gets the same auto-dispose lifecycle without asking. `loadingValue` replaces the 1.x initial value; `createMemo(fn, options)` is the only form. `tests/memoLaziness.test.ts` pins these semantics.
8. **Control flow.** Index-keyed lists are `<For keyed={false}>` — the callback body carries a strict-read label, so store reads stay in JSX or in a memo.
9. **Context.** The context object is itself the provider: `<Ctx value={...}>`. A default-less context makes `useContext` throw, so optional-provider APIs use `createContext<T | null>(null)`.
10. **Tests.** `settle()` (`tests/helpers/settle.ts`) re-exports `flush`; call it after every write, before reading anything back. Create owned observers inside `createRoot`. Write to stores and signals from the test body. Vitest runs two projects: `client` = jsdom over `tests/**/*.test.{ts,tsx}` minus `tests/server/**`, `server` = node over `tests/server/**/*.test.ts`. Component suites mount through `tests/helpers/mountGantt.tsx`, which models the layout jsdom does not, allows one live mount at a time, and throws if a previous mount was never disposed.
11. **Block bodies.** Every callback handed to `onSettled` or to an effect's apply, or crossing a component boundary, gets a block body. Grep for candidates with `grep -rnE '=> set[A-Z]|=> props\.on[A-Z]' src` — most hits are inline JSX event handlers, which rule 2 declares legal write sites; only the ones handed to a lifecycle primitive or across a component boundary are violations.
12. **Data flow.** Producers return their computed values; consumers never read back state they just wrote; store existence guards move inside the draft. Do **not** "fix" what the audit verified safe: functional updaters within one tick (`selectionStore`, the `useBoxSelect` hit loop), `batchMovePositions` reading the draft, and per-frame rAF drag loops (each frame is a separate task).

**Diagnostics gate.** `tests/diagnostics.gate.test.tsx` captures Solid dev warnings and errors through `OBSERVE.diagnostics.capture()` in jsdom.
It covers chart mounts, a drag, expand and collapse, a view-mode change, and disposal.
It includes a deliberately invalid read to make sure that the test can observe diagnostics.
For demo changes, also exercise the affected pages in a browser and look for runtime warnings and errors.
A deliberate one-shot read can use `untrack`. Move an ongoing reactive read to JSX, a memo, or an effect's compute phase.
`src/utils/diagnostics.ts` reports application data validation separately.

## Essential Commands

### Build & Development
- `pnpm dev` - Start demo server at http://localhost:5173/examples/
- `pnpm build` - Build production bundle
- `pnpm build:demo` - Build demo pages to `dist-demo/`
- `pnpm generate:calendar` - Generate test calendar data (see Performance Testing below)
- `pnpm generate:topology` - Generate topology test data

### Serving built demos

`pnpm build:demo` builds the three browser benchmark pages into `dist-demo/`.
`pnpm preview:demo` serves them at port 4173.
The automated browser scripts expect port 5174. See the [benchmark runner guide](benchmarks/traces/README.md).

### Code Quality
- `pnpm typecheck` - Run `tsc --noEmit` on the files in `tsconfig.json`
- `pnpm lint` - Oxlint over source, tests, server, constraint benchmarks, and Vite/Vitest configs
- `pnpm prettier` - Format code
- `pnpm prettier-check` - Check formatting without modifying

### Testing

`pnpm test` runs Vitest once; `pnpm test:watch` keeps it open. The suite is
`tests/` — component, store, and pure-function suites plus `tests/server/`
for the SQLite-backed API. `vitest.config.ts` defines two projects:

| Project | Environment | Include |
|---------|-------------|---------|
| `client` | jsdom | `tests/**/*.test.{ts,tsx}` minus `tests/server/**` |
| `server` | node | `tests/server/**/*.test.ts` |

Both include globs are anchored at the repo root on purpose: an unanchored
default would also sweep any git worktree parked under `.claude/` and run
every suite once per worktree.

Helpers live in `tests/helpers/`: `settle()` re-exports Solid 2.0's `flush`
(call it after every write — see rule 10), and `mountGantt()` mounts a real
`<Gantt>` with the layout jsdom does not model.

Run the jsdom suites with `pnpm exec vitest run --project client`.
For the SQLite API suites, use `pnpm exec vitest run --project server`.

Run `pnpm typecheck && pnpm lint && pnpm prettier-check && pnpm test && pnpm build && pnpm build:demo`.
The tests include a jsdom diagnostics check. Use a real browser for affected demo routes and browser layout behavior.

## Architecture

### Directory Structure

```
gantt/
├── src/
│   ├── index.ts                # Public entry point — the package's whole API
│   ├── types.ts                # Shared task/constraint types
│   ├── components/             # Production UI components (Gantt, Bar, Arrow, Grid, etc.)
│   ├── demo/                   # Demo-only components (not shipped in npm package)
│   ├── stores/                 # Reactive stores (task, config, date, resource, selection)
│   ├── utils/                  # Utilities (barCalculations, constraintEngine, etc.)
│   ├── hooks/                  # useDrag, useBarDrag, useBoxSelect, useGanttScroll, ...
│   ├── contexts/               # GanttEvents, GanttStores
│   ├── entries/                # Entry points for each demo
│   ├── scripts/                # CLI tools (generateCalendar.ts, generateTopology.ts)
│   ├── data/
│   │   ├── fixtures/           # Static test fixtures
│   │   └── generated/          # CLI-generated test data
│   └── styles/                 # CSS
├── examples/                   # Demo HTML files
│   ├── index.html              # Demo hub
│   ├── gantt.html              # Main demo
│   ├── subtask.html            # Subtask demo (parent tasks with children)
│   ├── resource-groups.html    # Collapsible resource groups demo
│   ├── perf.html               # Performance test (200+ tasks)
│   ├── perf-isolate.html       # Feature isolation for benchmarking
│   └── ...                     # Component demos (arrow, bar, constraint, etc.)
├── benchmarks/
│   ├── scripts/                # Shell scripts for running benchmarks
│   ├── constraint/             # Constraint system benchmarks
│   ├── profiler/               # Runtime profiling infrastructure
│   └── traces/                 # Performance trace analysis and history
├── tests/
│   ├── helpers/                # settle(), mountGantt()
│   ├── server/                 # node-project suites (SQLite/Drizzle/Hono)
│   └── *.test.{ts,tsx}         # client-project suites
├── server/                     # DB demo backend (never shipped in the bundle)
├── docs/
│   ├── ARCHITECTURE.md         # Detailed architecture documentation
│   ├── SUBTASKS.md             # Subtask feature documentation
│   ├── DATABASE.md             # DB-backed demo: schema, REST, drag-PATCH
│   ├── PERFORMANCE.md          # Performance optimization history
│   └── migration/solid2/       # SolidJS 2.0 plan, audit digests, API reference
└── [config files]
```

### SolidJS Architecture

The SolidJS implementation uses reactive stores for state management:

**Stores:**
- `taskStore.ts` - Task data and operations (uses `createStore` for fine-grained reactivity)
- `ganttConfigStore.ts` - Configuration (view mode, dimensions, features)
- `ganttDateStore.ts` - Timeline calculations and date utilities
- `resourceStore.ts` - Resource groups with collapse/expand state
- `selectionStore.ts` - Multi-select state

The task store tracks fields within each task. Update `task._bar.x` inside a draft to preserve the task's identity and avoid invalidating unrelated field reads. See rule 6.

**Components:**
- `Gantt.tsx` - Main container component
- `GanttContainer.tsx` - Scroll container with sticky headers
- `Bar.tsx` / `BarMinimal.tsx` - Task bars with drag/resize/progress handles
- `SummaryBar.tsx` - Parent/summary task bars (simplified Bar)
- `Arrow.tsx` - Dependency visualization (single arrow)
- `ArrowLayerBatched.tsx` - Batched arrow rendering for performance
- `Grid.tsx` - Background grid and time scale
- `DateHeaders.tsx` - Month/day header rows
- `TaskLayer.tsx` / `TaskLayerMinimal.tsx` - Orchestrates task bar rendering
- `ResourceColumn.tsx` - Resource names column
- `ColumnPanel.tsx` - Configurable left-hand column panel (`ColumnDef`)
- `ExpandedTaskContainer.tsx` - Parent task with subtasks (see [SUBTASKS.md](docs/SUBTASKS.md))
- `SubtaskBar.tsx` - Individual subtask bars
- `TaskDataModal.tsx` / `TaskDataPopup.tsx` - Task detail surfaces

**Utilities:**
- `barCalculations.ts` - Position/size calculations from dates
- `constraintEngine.ts` - Dependency constraint enforcement (FS/SS/FF/SF)
- `absoluteConstraints.ts` - Absolute (calendar-anchored) constraint checks
- `criticalPath.ts` - Critical-path computation
- `hierarchyProcessor.ts` - Task hierarchy building and traversal
- `rowLayoutCalculator.ts` - Variable row heights for expanded subtasks
- `createVirtualViewport.ts` - Simple 2D viewport virtualization
- `resourceProcessor.ts` - Resource normalization and group display logic
- `taskProcessor.ts` - Task normalization and dependency parsing
- `taskGenerator.ts` - Test data generation
- `subtaskGenerator.ts` - Generates test data with subtasks
- `dateUtils.ts` - Date parsing, formatting, and calculations
- `ganttSetup.ts` - One-shot store seeding from props
- `svgExport.ts` - SVG/PNG export
- `diagnostics.ts` - Routable validation warnings (`setDiagnosticHandler`)
- `defaults.ts` - Default view mode configurations

See `docs/ARCHITECTURE.md` for detailed documentation.

## Performance testing

Start `pnpm dev` and open [perf.html](http://localhost:5173/examples/perf.html) to exercise the full chart.
The page loads the tracked fixture at `src/data/generated/calendar.json`.
Use [the demo guide](docs/DEMOS.md) for the other harnesses and supported URL parameters.
Use [the benchmark runner guide](benchmarks/traces/README.md) for production builds and repeatable browser traces.

### Generate a calendar fixture

The generator replaces `src/data/generated/calendar.json`.
Use a scratch checkout if you need to keep the tracked fixture intact.

```bash
pnpm generate:calendar --help
pnpm generate:calendar --tasks=300 --seed=54321 --ss=30
pnpm generate:calendar --tasks=10000 --resources=100 --dense
```

The default fixture uses workday scheduling and mixed finish-to-start and start-to-start dependencies.
Dense mode packs tasks onto resource rows and supports `--arrowDensity=N` and `--maxRowDistance=N`.
Dependencies are arrays of objects with a predecessor ID, a type, and an optional lag in hours.
See [generateCalendar.ts](src/scripts/generateCalendar.ts) for the accepted options.

## DB-backed Demo

`examples/db.html` is the only demo backed by a real database — Node +
SQLite + Drizzle + Hono. Everything else uses inline fixtures or
generators. The chart library does not import any server code; the
server lives entirely under `server/` and never ships in the npm bundle.

**Two processes, both required for `db.html`:**
- Vite on `:5173` (the usual `pnpm dev`)
- Hono on `:3001` (`pnpm dev:server`)
- Vite proxies `/api/*` → `:3001`, so the browser sees same-origin.
- Run both at once with `pnpm dev:all`.

**Setup:**
```bash
pnpm db:setup    # data/gantt.db, migrations, seed from calendar.json
pnpm dev:all
# http://localhost:5173/examples/db.html
```

**Layout:**
```
server/
├── index.ts           # Hono entry (:3001)
├── db/
│   ├── schema.ts      # Drizzle: tasks, resources, dependencies, blocked_time
│   ├── client.ts      # better-sqlite3 → drizzle()
│   ├── adapter.ts     # row ↔ GanttTask shape; sole import-seam used by routes
│   ├── migrate.ts
│   └── seed.ts
├── routes/            # bootstrap | tasks | resources | blocked
└── migrations/
src/demo/DbDemo.tsx + src/demo/db/   # demo-only UI (api client, modal, forms)
data/gantt.db                        # gitignored; recreated by db:setup
```

**Constraints worth remembering:**
- The adapter is the only file in `server/` that knows the `GanttTask`
  shape. Routes and tests use it; the demo never imports from `server/`.
- `tasks.constraints` is a JSON blob (the frontend's `TaskConstraints`
  shape — many optional fields).
- `blocked_time` is flat metadata; the chart's constraint engine does
  not consult it. Bars are absolute calendar time.
- Drag persistence does NOT re-fetch (would snap-back on day-rounded
  dates). Instead it snapshots each bar's `_bar.x` and `_bar.width`,
  computes per-task pixel deltas after drag, and PATCHes in parallel.
  Move/resize-end/resize-start are disambiguated by which delta is
  non-zero. See `DbDemo.tsx` and `docs/DATABASE.md` for the algorithm.

Full schema + REST surface + algorithm details are in
[`docs/DATABASE.md`](docs/DATABASE.md).

## Development Workflow

1. Install the Node and pnpm versions in the [contributor prerequisites](README.md#development), then run `pnpm install`
2. Run `pnpm dev` to start the development server
3. Open http://localhost:5173/examples/ to see the demo hub
4. Edit source files in `src/` - Vite automatically reloads
5. Keep the browser console open when exercising a changed demo. The jsdom tests cover a subset of runtime diagnostics.

## Code Style

- ESM only, `import`/`export`; no CommonJS and no UMD output
- TypeScript throughout `src/`, `tests/`, `server/`, `benchmarks/constraint/`
- 4-space indentation, single quotes
- Oxlint + Prettier configured (`pnpm lint`, `pnpm prettier-check`)
- TSX for SolidJS components, compiled with `jsxImportSource: '@solidjs/web'`
- TypeScript targets ES2022 and includes `Array.prototype.at`.

---

## Browser automation and performance profiling

Keep the user's Chrome processes open. Use an isolated browser profile for automation.
A dev-server browser session is suitable for testing interactions and diagnostics.
For timing comparisons, build the benchmark pages and use the same browser mode, viewport, fixture, and controls for every run.

The shell benchmark scripts use the external `chrome-devtools-cli` tool.
The project does not install it. If it is available, its commands live in `~/.claude/skills/chrome-devtools-cli/scripts/`.
`perf.mjs` starts or connects to a headed Chrome session for measurements.
Run one profiler at a time because the matrix and paired scripts share its debugging port.

```bash
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs --help
node ~/.claude/skills/chrome-devtools-cli/scripts/workflow.mjs --help
```

See the [benchmark runner guide](benchmarks/traces/README.md) for exact URLs and commands.
See the [benchmark archive](benchmarks/traces/ANALYSIS.md) for the recorded results and their original workloads.
