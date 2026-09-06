# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Gantt chart library built with SolidJS using reactive stores and fine-grained reactivity.

The library provides drag & drop task management, dependency visualization, constraint enforcement (FS/SS/FF/SF), and theme support.

## SolidJS 2.0 rules

This repo runs **SolidJS 2.0**: `solid-js` and `@solidjs/web` at `2.0.0-rc.6`, compiled by `@solidjs/vite-plugin` 3.0.0-next.39 with `jsxImportSource: '@solidjs/web'`. The E0–E7 migration flipped in E3, so the rules below are no longer a checklist for a port that has yet to happen — they describe how this code already works, and every new or refactored site must be written this way. Reactivity, stores and control flow import from `solid-js`; DOM APIs (`render`, `Dynamic`, `Portal`, the `JSX` type) import from `@solidjs/web`. The 1.x subpath entry points no longer exist. Node is `^20.19 || >=22.12`, and the published package is ESM-only.

Source of truth: `docs/migration/solid2/PLAN.md` — sections "Runtime facts that shape every issue", "Working rules", and the D1–D13 decision table. Per-site rewrites for the 820 audited sites: `docs/migration/solid2/digest-t1.md` and `docs/migration/solid2/digest-t2.md`. API reference: `docs/migration/solid2/reference/CHEATSHEET.md` and `reference/08-dev-diagnostics.md`.

1. **Deferred writes.** Setters stage the write; reads return the committed value until the microtask flush or an explicit `flush()`. Functional updaters compose against the staged value, and store draft callbacks see staged state — the outer store proxy does not.
2. **Write guard.** Writes throw `REACTIVE_WRITE_IN_OWNED_SCOPE` (dev) inside component bodies, memo bodies, effect *compute* phases and anything they call — `untrack` does **not** clear the owner. Store setters are exempt inside `createRoot` bodies; plain signal setters are **not**. Allowed write sites: event handlers, timers, promise continuations, effect *apply*, `onSettled` bodies, and signals created with `{ ownedWrite: true }`.
3. **`onSettled` is the mount hook.** Its body is untracked and children-forbidden (no `onCleanup`, no primitive creation, directly or via a callee); it must return `undefined` or a cleanup *function* — a concise arrow returning a setter result or a Promise throws. `flush()` inside it throws. Never call a consumer callback (`onReady`, `onContainerReady`) synchronously from it; defer with `queueMicrotask`.
4. **Split effects only.** `createEffect(compute, apply, { defer? })` is the only form. `compute` tracks and must return plain values, never store proxies; `apply` is untracked, may write, and may return only a cleanup function. When `apply` has to run on *every* tracked change, `compute` must return a **fresh** value — an equal return is swallowed. `flush()` inside apply is a silent no-op.
5. **`flush()` legality table.** Legal in event handlers, timers, promise continuations and test bodies · silent no-op in effect apply · throws in `onSettled` and `createTrackedEffect`. The only sanctioned library site is `useDrag.handleMouseUp` (`src/hooks/useDrag.ts`), where the final drag move must commit before `onDragEnd` re-reads the geometry. Do not add another.
6. **Stores.** One draft setter: `setX((s) => { s.k = v; })`. Path setters and object-merge forms are gone and **silently no-op** if you write them — that is the failure mode that broke the showcase demo. `storePath` is the compat helper, `snapshot` replaces the 1.x unwrap, and `reconcile(v, key='id')` returns a draft function. `delete draft[k]` removes a key — assigning `undefined` keeps it. `Set`/`Map`/`Date` inside a store are **not** proxied: replace them, never mutate in place, and prefer a signal holding an immutable collection (as `ganttConfigStore.expandedTasks` and `taskStore.collapsedTasks` now do). Leaf-mutate `task._bar.x`, never replace the task object. A memo returning a store sub-proxy never invalidates, so bindings must read their own leaf.
7. **Memos are eager, and stay eager (D7, measured in E4.5).** A memo recomputes on every source change whether or not anything reads it. `createMemo(fn, { lazy: true })` changes two things you will notice: the compute at creation is skipped (repaid on the first read, which also clears the lazy flag for good), and auto-dispose is turned on — the memo is torn down when its last tracked subscriber leaves, and again on every flush after an *ownerless* read (event handler, timer, rAF, promise continuation, **an effect's apply phase**, `untrack` at a root), so a lazy memo read only from such scopes recomputes once per tick it is read in. With a live tracked subscriber (JSX, another memo, an effect compute) a lazy memo recomputes exactly as often as an eager one — the probe on the 10K experiments page counted identical recomputes per scroll step for both. Use `{ lazy: true }` only for a memo that spends time with **zero** tracked subscribers (behind a `<Show>`, a closed popup), is never read from an ownerless scope while unsubscribed, and is not read by an eager memo in its creation tick (no lint or diagnostic checks that last one — read the wrapper chain). No library memo with a live consumer qualifies today, so none is lazy — the one that formally qualifies, `createVirtualViewport.yRange`, has no reader at all and is slated for deletion; the only `{ lazy: true }` in the tree is the demo-only probe switch in `src/demo/GanttExperiments.tsx`. A memo created with no owner gets the same auto-dispose lifecycle without asking. `loadingValue` replaces the 1.x initial value; `createMemo(fn, options)` is the only form. `tests/memoLaziness.test.ts` pins these semantics.
8. **Control flow.** Index-keyed lists are `<For keyed={false}>` — the callback body carries a strict-read label, so store reads stay in JSX or in a memo.
9. **Context.** The context object is itself the provider: `<Ctx value={...}>`. A default-less context makes `useContext` throw, so optional-provider APIs use `createContext<T | null>(null)`.
10. **Tests.** `settle()` (`tests/helpers/settle.ts`) re-exports `flush`; call it after every write, before reading anything back. Store writes may sit in `createRoot` bodies; plain signal writes may not. Vitest runs two projects: `client` = jsdom over `tests/**/*.test.{ts,tsx}` minus `tests/server/**`, `server` = node over `tests/server/**/*.test.ts`. Component suites mount through `tests/helpers/mountGantt.tsx`, which models the layout jsdom does not, allows one live mount at a time, and throws if a previous mount was never disposed.
11. **Block bodies.** Every callback handed to `onSettled` or to an effect's apply, or crossing a component boundary, gets a block body. Grep for candidates with `grep -rnE '=> set[A-Z]|=> props\.on[A-Z]' src` — most hits are inline JSX event handlers, which rule 2 declares legal write sites; only the ones handed to a lifecycle primitive or across a component boundary are violations.
12. **Data flow.** Producers return their computed values; consumers never read back state they just wrote; store existence guards move inside the draft. Do **not** "fix" what the audit verified safe: functional updaters within one tick (`selectionStore`, the `useBoxSelect` hit loop), `batchMovePositions` reading the draft, and per-frame rAF drag loops (each frame is a separate task).

**Diagnostics gate.** The 2.0 dev build reports these mistakes as console diagnostics rather than as failures, so a green `pnpm test` does not clear them — a browser does. Two codes matter here: `REACTIVE_WRITE_IN_OWNED_SCOPE` (error; rule 2) and `STRICT_READ_UNTRACKED` (warn — a reactive read in a component body, an effect apply or an `onSettled` body). The library path is clean and every demo page loads console-clean apart from the app's own fixture-validation warnings; **adding a diagnostic is a regression**. Fix a strict read either by moving it where it should track (JSX, a memo, an effect compute) or, when it is a deliberate one-shot, by wrapping it in `untrack(() => ...)`, which clears the label. `src/utils/diagnostics.ts` and `setDiagnosticHandler()` are a separate, app-level channel for data-validation messages and are unrelated to the runtime's own diagnostics.

## Essential Commands

### Build & Development
- `pnpm dev` - Start demo server at http://localhost:5173/examples/
- `pnpm build` - Build production bundle
- `pnpm build:demo` - Build demo pages to `dist-demo/`
- `pnpm generate:calendar` - Generate test calendar data (see Performance Testing below)
- `pnpm generate:topology` - Generate topology test data

### Serving Built Demos for Benchmarking

When benchmarking with built demos (not dev server), use `npx serve dist-demo`:

```bash
pnpm build:demo
npx serve dist-demo -l 5174 &
```

**IMPORTANT: URL format issue with `serve`**

The `serve` package redirects `.html` URLs to clean URLs, **stripping query parameters** in the process:

```bash
# ❌ WRONG - serve redirects and loses query params
http://localhost:5174/examples/perf-isolate.html?bar=nochildren&test=horizontal
# → 301 redirects to /examples/perf-isolate (params lost!)

# ✅ CORRECT - use clean URLs without .html
http://localhost:5174/examples/perf-isolate?bar=nochildren&test=horizontal
```

This affects all benchmark URLs. Always omit the `.html` extension when using `serve`.

### Code Quality
- `pnpm typecheck` - `tsc --noEmit` over `src/`, `tests/`, `benchmarks/constraint/`
- `pnpm lint` - ESLint over the same set plus `server/` and the Vite configs
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

Run one project with `pnpm exec vitest run --project client`. Do **not**
write `pnpm test -- --project client`: the extra `--` makes vitest ignore the
flag and silently run both projects.

**The full gate is** `pnpm typecheck && pnpm lint && pnpm prettier-check &&
pnpm test && pnpm build && pnpm build:demo`. It does not cover the runtime
diagnostics gate above — that needs a browser.

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

**Performance Note:** The `taskStore` uses SolidJS `createStore({})` instead of `createSignal(Map)` to enable path-level dependency tracking. This allows dragging a task to only update that specific task's Bar component and connected Arrows, achieving 60 FPS with 10K+ tasks. Under Solid 2.0 that tracking only survives **leaf mutation**: write `task._bar.x = n` inside a draft, never replace the task object, or every subscriber to every other field of that task re-runs (rule 6).

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

## Performance Testing

The SolidJS implementation includes a task generator for performance testing with realistic calendar data.

### Quick Start
```bash
pnpm generate:calendar          # Generate 200 tasks
pnpm dev                        # Start dev server
# Open http://localhost:5173/examples/perf.html
```

### Task Generator

Located at `src/scripts/generateCalendar.ts`, generates `src/data/generated/calendar.json`.
It is TypeScript, so run it through `tsx` (or the `pnpm generate:calendar` script)
rather than bare `node`.

**Features:**
- Cross-resource dependency chains (tasks in a group span different resources A-Z)
- No overlap per resource (concurrency = 1)
- Workday-aware scheduling (08:00-17:00, rolls over to next day)
- Mixed FS/SS dependencies with configurable lag
- Seeded random for reproducible results

**CLI Options:**
```bash
pnpm exec tsx src/scripts/generateCalendar.ts --help
pnpm exec tsx src/scripts/generateCalendar.ts --tasks=300 --seed=54321 --ss=30
pnpm exec tsx src/scripts/generateCalendar.ts --tasks=10000 --resources=100 --dense  # Stress test
```

| Option | Default | Description |
|--------|---------|-------------|
| `--tasks=N` | 200 | Total number of tasks |
| `--seed=N` | 12345 | Random seed for reproducibility |
| `--ss=N` | 20 | Percentage of SS (Start-to-Start) dependencies |
| `--minGroup=N` | 5 | Minimum tasks per dependency group |
| `--maxGroup=N` | 20 | Maximum tasks per dependency group |
| `--start=DATE` | 2025-01-01 | Start date (YYYY-MM-DD) |
| `--resources=N` | 26 | Number of resources (A-Z, AA, AB, etc.) |
| `--dense` | false | Dense mode: tightly packed tasks for stress testing |
| `--arrowDensity=N` | 20 | Percentage of tasks with dependencies (dense mode) |
| `--maxRowDistance=N` | 2 | Max row distance for dependencies (dense mode) |

**Generated Data Structure:**
```javascript
{
  id: "task-1",
  name: "G1-1",              // Group 1, Task 1
  start: "2025-01-01 08:00", // Workday-aware
  end: "2025-01-01 16:00",
  progress: 87,
  color: "#3b82f6",
  color_progress: "#3b82f6cc",
  dependencies: "task-0" | { id, type: "SS", lag: 2 },
  resource: "E"              // A-Z, no overlap on same resource
}
```

**Key Files:**
- `src/utils/taskGenerator.ts` - Shared generation logic
- `src/scripts/generateCalendar.ts` - CLI script
- `src/data/generated/calendar.json` - Generated test data
- `src/demo/GanttPerfDemo.tsx` - Performance test UI

### Perf-Isolate (Feature Isolation Testing)

For progressive performance testing, use the perf-isolate harness:

```bash
pnpm dev
# Open http://localhost:5173/examples/perf-isolate.html?bar=nochildren&test=horizontal
```

**URL Parameters:**
| Param | Values | Description |
|-------|--------|-------------|
| `bar` | nochildren, combined, minimal, etc. | Bar component variant |
| `grid` | 0, 1 | Show SVG grid |
| `headers` | 0, 1 | Show date headers |
| `resources` | 0, 1 | Show resource column |
| `test` | horizontal, vertical, both | Auto-scroll stress test |

**Example:** Test headers overhead:
```bash
# Baseline (no headers)
?bar=nochildren&test=horizontal

# With headers
?bar=nochildren&headers=1&test=horizontal
```

See `benchmarks/traces/ANALYSIS.md` for current best practices and benchmark results.

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

1. Clone and run `pnpm i` (Node `^20.19 || >=22.12`)
2. Run `pnpm dev` to start the development server
3. Open http://localhost:5173/examples/ to see the demo hub
4. Edit source files in `src/` - Vite automatically reloads
5. Keep the browser console open — the Solid 2.0 dev build reports
   reactivity mistakes there, not in `pnpm test` (see the diagnostics gate)

## Code Style

- ESM only, `import`/`export`; no CommonJS and no UMD output
- TypeScript throughout `src/`, `tests/`, `server/`, `benchmarks/constraint/`
- 4-space indentation, single quotes
- ESLint + Prettier configured (`pnpm lint`, `pnpm prettier-check`)
- TSX for SolidJS components, compiled with `jsxImportSource: '@solidjs/web'`
- `Array.prototype.at` does not typecheck — `tsconfig` targets `lib: ES2021`

---

## Browser Automation & Performance Profiling

> **🚨 CRITICAL: NEVER KILL CHROME**
>
> **NEVER run `pkill chrome`, `pkill -f chrome`, or any command that kills Chrome processes.**
> The user may have important work open in their browser. Browser conflicts should be resolved by:
> 1. Using `--browserUrl=http://127.0.0.1:9222` to connect to existing browser
> 2. Using `--isolated` flag to run a separate browser instance
> 3. Asking the user to close Chrome manually if needed

This project uses the `chrome-devtools-cli` skill for browser automation and performance analysis.

**Skill location:** `~/.claude/skills/chrome-devtools-cli/`

---

## Quick Reference

| Task | Command |
|------|---------|
| Performance profile | `node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url>` |
| Benchmark (5 runs) | `node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url> --iterations 5` |
| Click then profile | `node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url> --click "#btn"` |
| Multi-step workflow | `node ~/.claude/skills/chrome-devtools-cli/scripts/workflow.mjs <workflow.json>` |

---

## Performance Profiling

**Always use `perf.mjs` for performance work.** It handles Chrome automatically.

### Single Profile

```bash
# Basic profile (5 seconds)
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com

# Longer duration
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --duration 10000

# Click element first, then profile
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --click "#load-button" --duration 5000

# Save results to file
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --output /tmp/perf.json
```

### Benchmarking (Multiple Iterations)

```bash
# Run 5 iterations, report mean/median/min/max/stddev
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --iterations 5

# With warmup runs (discarded before measuring)
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --iterations 10 --warmup 2

# Benchmark a user interaction
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --click "#submit-btn" --iterations 5 --duration 3000

# Save full benchmark data
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --iterations 5 --output /tmp/benchmark.json
```

### What perf.mjs Does

1. Starts Chrome in **normal mode** (not headless) — required for accurate rendering
2. Navigates to URL and waits for load
3. Clicks element if `--click` specified
4. Captures CPU profile, rendering stats, metrics
5. For benchmarks: reloads page between iterations
6. Reports statistics (mean, median, stddev, etc.)

---

## Multi-Step Workflows

For navigate → interact → screenshot flows, use `workflow.mjs`:

```bash
cat > /tmp/workflow.json << 'EOF'
{
  "url": "https://example.com",
  "headless": false,
  "steps": [
    { "action": "snapshot" },
    { "action": "click", "uid": "login-btn" },
    { "action": "fill", "uid": "email-input", "value": "user@example.com" },
    { "action": "fill", "uid": "password-input", "value": "password123" },
    { "action": "click", "uid": "submit-btn" },
    { "action": "wait", "text": "Dashboard" },
    { "action": "screenshot", "path": "/tmp/logged-in.png" }
  ]
}
EOF

node ~/.claude/skills/chrome-devtools-cli/scripts/workflow.mjs /tmp/workflow.json
```

### Workflow Actions

| Action | Parameters | Example |
|--------|------------|---------|
| `navigate` | `url` | `{ "action": "navigate", "url": "https://..." }` |
| `snapshot` | `verbose` (optional) | `{ "action": "snapshot" }` |
| `click` | `uid` | `{ "action": "click", "uid": "btn-id" }` |
| `fill` | `uid`, `value` | `{ "action": "fill", "uid": "input-id", "value": "text" }` |
| `hover` | `uid` | `{ "action": "hover", "uid": "menu-id" }` |
| `press-key` | `key` | `{ "action": "press-key", "key": "Enter" }` |
| `screenshot` | `path`, `fullPage` | `{ "action": "screenshot", "path": "/tmp/shot.png" }` |
| `wait` | `text`, `timeout` | `{ "action": "wait", "text": "Success" }` |
| `eval` | `expression` | `{ "action": "eval", "expression": "document.title" }` |
| `sleep` | `duration` (ms) | `{ "action": "sleep", "duration": 2000 }` |
| `perf-trace` | `duration` | `{ "action": "perf-trace", "duration": 5000 }` |

### Getting Element UIDs

First run snapshot to see available element UIDs:

```bash
# Start Chrome if not running
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --duration 1000

# Then get snapshot (Chrome stays open on port 9222)
node ~/.claude/skills/chrome-devtools-cli/scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 snapshot
```

---

## Common Mistakes — DO NOT DO THESE

### ❌ WRONG: Killing Chrome processes

```bash
# WRONG - NEVER DO THIS - destroys user's browser session
pkill chrome
pkill -f chrome
pkill -9 -f "chrome.*remote-debugging"
```

**✅ RIGHT:** Handle browser conflicts properly:

```bash
# Option A: Connect to existing browser
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 navigate https://example.com

# Option B: Use isolated instance
node scripts/workflow.mjs workflow.json --isolated

# Option C: Ask user to close Chrome manually
```

---

### ❌ WRONG: Using headless mode for performance

```bash
# WRONG - headless has no real rendering, metrics are meaningless
node scripts/devtools.mjs --headless navigate https://example.com
node scripts/devtools.mjs --headless perf-start
```

**✅ RIGHT:** Use `perf.mjs` which runs Chrome in normal mode automatically.

---

### ❌ WRONG: Multiple devtools.mjs commands without --browserUrl

```bash
# WRONG - each command spawns a NEW browser instance
node scripts/devtools.mjs navigate https://example.com   # Browser 1
node scripts/devtools.mjs click btn-submit               # Browser 2 (blank!)
node scripts/devtools.mjs screenshot                      # Browser 3 (blank!)
```

**✅ RIGHT:** Use `workflow.mjs` for multi-step, or `--browserUrl`:

```bash
# Option A: workflow.mjs (preferred)
node scripts/workflow.mjs /tmp/my-workflow.json

# Option B: persistent browser
node scripts/perf.mjs https://example.com --duration 1000  # starts Chrome
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 click btn-submit
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 screenshot
```

---

### ❌ WRONG: Manually starting Chrome for perf.mjs

```bash
# WRONG - unnecessary, perf.mjs handles this
google-chrome --remote-debugging-port=9222 &
node scripts/perf.mjs https://example.com
```

**✅ RIGHT:** Just run perf.mjs, it starts Chrome automatically:

```bash
node scripts/perf.mjs https://example.com
```

---

### ❌ WRONG: Using profile.mjs for simple traces

```bash
# WRONG - profile.mjs is low-level and requires manual Chrome setup
node scripts/profile.mjs capture --url https://example.com
```

**✅ RIGHT:** Use perf.mjs:

```bash
node scripts/perf.mjs https://example.com
```

---

## Files in the Skill

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `perf.mjs` | Performance profiling & benchmarking | **Any performance work** |
| `workflow.mjs` | Multi-step browser automation | Navigate → interact → screenshot flows |
| `devtools.mjs` | Single browser commands | Only with `--browserUrl` for one-off commands |
| `profile.mjs` | Low-level CDP profiling | Advanced use only |

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "Chrome not found" | Chrome not installed | `apt install google-chrome-stable` |
| "ECONNREFUSED 9222" | Chrome not running | Let `perf.mjs` handle it, or start manually |
| "Cannot find module" | npm install not run | `cd ~/.claude/skills/chrome-devtools-cli && npm install` |
| Blank screenshots | Commands used separate browsers | Use `workflow.mjs` or `--browserUrl` |
| No rendering metrics | Used `--headless` | Use `perf.mjs` (never headless for perf) |

---

## Example: Full Performance Audit

```bash
# 1. Single profile to identify issues
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --duration 10000

# 2. Benchmark to get stable measurements
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --iterations 5 --warmup 1

# 3. Profile a specific interaction
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --click "#load-data" --iterations 5

# 4. Save results for comparison
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --iterations 5 --output /tmp/baseline.json

# ... make changes ...

node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --iterations 5 --output /tmp/after-fix.json
```
