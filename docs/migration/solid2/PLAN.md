# Plan: migrate `ganttss` to SolidJS 2.0 (rc.6) — as a tree of beads epics/issues

## Context

The repo runs solid-js 1.9.12 with vite-plugin-solid 2.11. The user wants it on the latest SolidJS 2 release candidate, delivered as beads epics/issues. The latest RC is **2.0.0-rc.6** (published 2026-09-02; the user guessed rc.5). Solid 2.0 is a new reactive core (`@solidjs/signals`) with a new package layout and behavioural changes that hit this codebase directly, so the migration is a data-flow refactor first and a syntax sweep second.

**Deliverable of executing this plan:** create the beads tree below (8 epics, 48 child issues, dependencies wired) and save the audit artifacts. Implementation then proceeds issue by issue (one issue → one commit → one push).

How this plan was built: package/version facts verified on npm; official MIGRATION.md, all 2.0 RFCs, CHEATSHEET, v2 docs reference pages and per-RC changelogs read; rc.6 runtime read and executed by auditors; a 26-agent read-only audit of every file (820 sites, 135 write-then-read hazards, 12 traced call chains, 3 completeness critics); three independent design passes each adversarially reviewed. Artifacts (copy into the repo in E0.1 — the scratchpad is session-scoped):

```
/tmp/claude-1000/-home-kaalin-dev-chart-gantt/a6939ae3-1834-408e-95b3-4628bab01656/scratchpad/
  audit-result.json   full per-file audit (820 sites, rewrites, hazards)
  digest-t1.md        batch summaries + structural concerns + critics + tracer chains A–J3
  digest-t2.md        every high-severity hazard + structural site with concrete rewrite
  design-result.json  the three design plans + reviews
  sma-report.txt      official solid-migration-assistant output (advisory, 72 sites)
  docs/               MIGRATION.md, RFC 01–09, CHEATSHEET.md, v2/*.mdx reference pages
  pkgs/               unpacked solid-js / @solidjs/web / @solidjs/signals / vite-plugin rc.6
```

## Target versions (verified 2026-09-03)

| Package | Now | Target | Notes |
|---|---|---|---|
| solid-js | ^1.9.12 | **2.0.0-rc.6** (exact) | exports only `.`/`./refresh`; stores from root; ships `CHEATSHEET.md` + `skills/reactivity-diagnostics/SKILL.md` |
| @solidjs/web | — | **2.0.0-rc.6** (exact) | new: `render`, `Dynamic`, `dynamic`, `Portal`, `isServer`, JSX namespace |
| @solidjs/vite-plugin | — | **3.0.0-next.38** (exact) | replaces vite-plugin-solid; default import; native OXC compiler (`compiler:'babel'` fallback); Node ^20.19||>=22.12; official templates pin .38 (`next` tag lags at .35) |
| vite-plugin-solid, babel-preset-solid | present | remove | shim / unused |
| @solid-primitives/raf | ^2.3.4 (dep) | 4.0.0-next.2 (**devDep**) | demo-only importer; `createRAF` tuple unchanged; pulls utils 7.0.0-next.4 |
| @solid-primitives/memo, resize-observer, scheduled, scroll | present | remove | never imported |
| jsdom | — | ^25 (template pin; newer fine) | client Vitest posture |
| @solidjs/diagnostics | — | 2.0.0-rc.6 (optional devDep) | `captureArtifact`, Vitest matchers `toHaveNoDiagnostics` |
| @solidjs/testing-library | — | 1.0.0-beta.3 (optional) | beta.3 fixed the npm peer range |

Pin the RC line exactly; caret only at 2.0.0 stable (E7.6). All `@solidjs/*` must share one `rc.N`.

## Runtime facts that shape every issue (verified against the published rc.6 build)

1. **Deferred writes.** Signal/store writes stage until the microtask flush or `flush()`; reads return the committed value. Functional updaters compose against the staged value; store draft callbacks see staged state; the outer store proxy does not.
2. **Write guard** (`REACTIVE_WRITE_IN_OWNED_SCOPE` throws in dev): writes inside component bodies, memo bodies, effect *compute* phases and anything they call — `untrack` does **not** clear the owner. Store setters are exempt inside `createRoot` bodies; **plain signal setters are not** (tests must write outside the root body). Allowed: event handlers, timers, promise continuations, effect *apply*, `onSettled` bodies, `{ ownedWrite: true }` signals.
3. **`onSettled`** replaces `onMount`: body is *untracked*; children-forbidden (no `onCleanup`, no primitive creation directly or via callees); must return `undefined` or a cleanup function (a concise arrow returning a setter result or a Promise throws); `flush()` inside throws. Never call a consumer callback synchronously from it — defer with `queueMicrotask`.
4. **`createEffect(compute, apply, {defer?})`** is the only form (the 1-arg overload is a type error since rc.5). Apply is untracked, may write, may return only a cleanup function; `flush()` inside apply is a silent no-op; reading a store proxy in apply warns `STRICT_READ_UNTRACKED` — compute returns plain values.
5. **`flush()`** is legal only in event handlers, timers, promise continuations and test bodies.
6. **Stores:** single draft setter; path setters/`produce`/`unwrap` removed (`storePath` compat helper, `snapshot`); `delete draft[k]` (assigning `undefined` keeps the key); `reconcile(v, key='id')` returns a draft fn; Set/Map/Date inside stores are **not proxied** (replace, never mutate; signal-held immutable Sets are fine). Leaf mutation `draft[id]._bar.x = v` notifies only `_bar.x` subscribers (measured) — faster than the 1.x object-replacement hack; a memo returning the `_bar` proxy still never invalidates, so Bar's per-leaf reads stay load-bearing.
7. **Memos** eager by default; `{ lazy: true }` also opts into autodisposal; `loadingValue` replaces the 1.x initial value; `createMemo(fn, options)` only.
8. **Control flow:** `<Index>` → `<For keyed={false}>` (same callback shape, but the callback body now carries a strict-read label); `<Repeat count from>` is the store-backed pool primitive; `Show/Match` element children unchanged.
9. **Context:** `<Ctx value>` is the provider; default-less context makes `useContext` throw — use `createContext<T | null>(null)` for optional-provider APIs. `Gantt.tsx` mounts `GanttEventsProvider` itself; `GanttStores` is the library-path showstopper.
10. **JSX/DOM:** `import type { JSX } from '@solidjs/web'`; `jsxImportSource: '@solidjs/web'`; `tabIndex` → `tabindex` (3 sites); ref callbacks unowned.
11. **Vitest:** `environment:'node'` makes the plugin resolve the *server* build (inert writes). Reactive suites need jsdom; `tests/server/*` need node → Vitest 4 `test.projects`, include globs `tests/*.test.{ts,tsx}` and `tests/server/**`.
12. **Build:** externals/globals re-keyed to `@solidjs/web`; neither runtime ships a global build so the UMD output is decorative (decision); `output:{interop}` at top level is ignored; `dist-demo/` is committed and served by the bench scripts.

## Codebase findings the issues are built on (from the audit; digest has file:line detail)

- **Blank first paint (chain A):** `ganttSetup.initializeTasks` writes the date store then reads five accessors back, and writes resources then reads `resourceIndexMap()` back (empty Map → every task `_isHidden`). Same shape in `setupDates`/`changeViewMode`/`extendTimeline` (`generateDates` reads its own just-written signals).
- **Mount throws:** `useGanttScroll.handleContainerReady` creates six effects inside the `onContainerReady` callback that fires from `onMount`→`onSettled`. `GanttStores` default-less context throws for bare `<Gantt>`.
- **Stores:** `taskStore` uses `produce`, path setters, `setTasks(id, undefined)` (no longer deletes), a committed-state guard before the draft, and the gantt-6hx object replacement (slow). `ganttConfigStore` holds a Set inside the store mutated in place (silent no-op), a `makeSetter` shim that reads committed state (broken `prev`/return), 20 public `Setter<T>` types.
- **Gesture-commit boundary (chains B/C/D/H):** `useDrag.handleMouseUp` runs the final `onDragMove` (writes) then `onDragEnd` (re-reads) in one stack → drop position, progress, resize cascade and DbDemo's persisted PATCH are one frame stale. `useDrag` guards read their own staged signal.
- **Virtualization:** grouping caches keyed on task *count* go permanently stale under coalesced flushes (two copies); `ColumnPanel` reads store proxies in `<For>` callback bodies (STRICT_READ storm + pre-existing non-reactivity).
- **Gantt.tsx:** six single-function effects that write from compute (`untrack` does not help), duplicate `onMount` initializer, `prevViewMode` signal as re-entrancy bookkeeping, `onReady`/`onSelectionChange` consumer callbacks fired from owned scopes.
- **Demos:** ShowcaseDemo (38 path setters + write-config-then-re-read mirrors), ConstraintDemo (recursive solver interleaving reads/writes), DbDemo (store scraping across flush boundaries), five perf harnesses with the same copy-pasted `onMount+ResizeObserver+RAF+onCleanup` body and seven self-reading latches; most demo files are `// @ts-nocheck`.
- **Dead code:** `useGanttScroll` isScrolling machinery, dead ContainerAPI surface (`getSvgElement`, `scrollTimingSignal`, `resetWorstTiming`, `__ganttScrollDebug`), `ArrowLayer.tsx` (no importer; only `ArrowLayerBatched` is mounted, by a demo), `GanttSubtaskDemo.tsx` (no entry). The shipped `Gantt` mounts no arrow layer at all.
- **Tooling gaps:** tsconfig include and lint/prettier globs omit config files; `publish.yml` pins Node 18 / pnpm 9; no CI typecheck/test.

## Decisions (recorded in E0.1; every later issue cites it)

| # | Decision | Recommendation |
|---|---|---|
| D1 | RC version pins | Exact pins for solid-js, @solidjs/web, @solidjs/vite-plugin, @solid-primitives/raf, diagnostics; relax to caret only at 2.0.0 stable (E7.6). Add `engines.node: "^20.19.0 || >=22.12.0"`. |
| D2 | Branching | E0–E2 (1.9-compatible, each green) land on `main`; create `solid-2` after E2; E3–E7 land there one commit per issue; merge with a merge commit (not squash) when the end-of-migration gate is green. `release` branch untouched until E7.6. |
| D3 | UMD | Drop `umd` (ESM only; `main`/`exports.require` → ES build; README note). Self-contained IIFE bundle only as optional follow-up (E7.7) if a consumer asks. |
| D4 | peerDependencies | Not in this migration (E7.7 optional). Keep exact pins in `dependencies`; README gets a `resolve.dedupe` note. |
| D5 | Dead code | Delete isScrolling, dead ContainerAPI surface, duplicate `onMount` initializer, `ArrowLayer.tsx`, `GanttSubtaskDemo.tsx`. **Keep** the taskStore collapse API (public `TaskStore` type; `collapsedTasks()` is read by Gantt/ganttSetup) and give `collapseAllTasks` an explicit id-list parameter. |
| D6 | `expandedTasks` | Signal-held immutable `ReadonlySet<string>` (matches `collapsedTasks`/`collapsedGroups`/`selectedIds`); public option/accessor types unchanged. |
| D7 | Memo laziness | Eager by default; `{ lazy: true }` only for measured rarely-read memos (E4.5). |
| D8 | `@ts-nocheck` | Strip from component/feature/db demos as each is touched; perf harnesses keep it (smoke matrix verifies them). |
| D9 | DbDemo | Migration scope = correct persistence via the new geometry payload + `flush()` at the top of `onDateChange`; actions/optimistic-store rewrite is optional E7.7. |
| D10 | Row-sync (`_bar.y` write-back) | Keep as a split effect with one draft write (E3.2); "rowLayouts as y source of truth" is optional follow-up. |
| D11 | Testing tools | Vitest projects + `render` from `@solidjs/web` + `DEV.diagnostics.capture()`; `@solidjs/diagnostics` matchers if they load under Vitest 4.1; `@solidjs/testing-library` not required. |
| D12 | dist-demo | Keep tracked; refresh once as the final commit (existing convention). |
| D13 | Public API delta (documented in E4.7/E7.2) | `GanttConfigStore` setters become void-returning updater functions (no in-repo caller uses the return value); `onResizeEnd(taskId, geom?)`, `onDateChange(taskId, dates, geom?)` gain additive args; `taskStore.patchTask`, `setTaskProgress`, `collapseAllTasks(ids?)`, `resourceStore.collapseAll(ids?)`, `createTaskStore(initial?)`; `useGanttStores()` keeps returning `undefined` outside a provider; `ColumnDef.render` must be pure. |

## Working rules (go into CLAUDE.md/AGENTS.md in E0.2, before any code)

- Producers return their computed values; consumers never read back state they just wrote; store existence guards move inside the draft.
- Every write lives in an event handler, an `onSettled` body, or the apply half of a split effect; compute returns plain values, never store proxies.
- `flush()` legality table: legal (handlers/timers/promises/tests) · no-op (effect apply) · throws (`onSettled`/`createTrackedEffect`). Sanctioned library sites: `useDrag` mouseup only.
- Tests: `settle()` helper (no-op on 1.9, `flush` after the flip) after every write; store writes may sit in `createRoot` bodies, signal writes may not.
- Every callback handed to `onSettled`/effect apply or crossing a component boundary gets a block body (`=> set[A-Z]`, `=> props.on[A-Z]` are greppable violations).
- Built-ins inside a store are replace-only; prefer a signal holding an immutable collection.
- Consumer callbacks (`onReady`, `onContainerReady`) are never invoked synchronously from `onSettled`; defer with `queueMicrotask`.
- Do not "fix" what is verified safe: functional updaters in one tick (`selectionStore`, `useBoxSelect` hit loop), `batchMovePositions` reading the draft, per-frame drag loops (rAF frames are separate tasks).

## Epic tree

Keys are plan-local; bd ids are assigned at creation. Types use bd's set (`epic|task|bug|feature|chore|decision`). Priority 0 = critical. Effort S/M/L/XL. Per-commit gate for every issue unless stated: `pnpm typecheck && pnpm lint && pnpm prettier-check && pnpm test && pnpm build && pnpm build:demo`.

### E0 — Decisions, rulebook, gates, dead code (on `main`, still 1.9) — P0

Gate: per-commit gate green on 1.9; `pnpm dev` smoke of gantt.html / perf.html / showcase.html unchanged.

- **E0.1** `decision` P0 S — **Decision record + audit artifacts.** Record D1–D13 with rationale in the issue body; copy the scratchpad artifacts (audit-result.json, digest-t1/t2.md, design-result.json, sma-report.txt) into `docs/migration/solid2/` (or attach via `bd update --design`) so later sessions can execute from them. No code change. *Accept:* every decision has a chosen option; artifacts committed.
- **E0.2** `task` P0 S — **Rulebook first: "SolidJS 2.0 migration rules" section in CLAUDE.md and AGENTS.md; `bd remember` the rulebook.** Content = Working rules above + the flush table + the createRoot signal/store asymmetry + `onSettled` constraints + built-ins-in-store + `<For>` strict-read + split-effect pattern + test posture. Mark it "in progress until E3". *Accept:* both files carry identical rule text; `bd memories solid` shows the new entry.
- **E0.3** `chore` P0 S — **Gates see the config files; CI floor.** tsconfig `include` += `tests/**/*.tsx`, `vitest.config.ts`; lint/prettier/prettier-check globs += `config/vite/**/*.js`, `vitest.config.ts`, `eslint.config.mjs` (run prettier on them in the same commit); `publish.yml`: `node-version: '22'`, drop the pnpm `version: 9` pin (packageManager wins), add `pnpm typecheck`, `pnpm lint`, `pnpm test` before build; move the misplaced top-level `output: { interop: 'auto' }` in `config/vite/solid.js:28` under `build.rollupOptions.output` (or delete). Optional in same issue: consolidate `onlyBuiltDependencies` into `pnpm-workspace.yaml`. *Accept:* lint/prettier traverse the config files; CI workflow YAML valid; gate green.
- **E0.4** `chore` P0 M — **Vitest projects + `settle()` helper (on 1.9).** `vitest.config.ts`: remove `environment:'node'` and the hand-written `resolve.conditions`; `test.projects = [{extends:true, test:{name:'client', environment:'jsdom', include:['tests/*.test.{ts,tsx}']}}, {extends:true, test:{name:'server', environment:'node', include:['tests/server/**/*.test.ts']}}]`; add `jsdom` devDep; `tests/helpers/settle.ts` exporting a no-op `settle()` (becomes `flush` in E3.1); `tests/helpers/mountGantt.tsx` (render `<Gantt>` optionally inside `<GanttProvider>` into a container, returns stores/dispose; stubs `clientWidth`, `createSVGPoint`, `getScreenCTM`). *Accept:* `pnpm test` prints both projects, all 18 suites green on 1.9.
- **E0.5** `chore` P1 S — **Delete dead code.** `useGanttScroll.ts:45-48,75-90` (isScrolling + timer, `SCROLL_QUIET_MS`); `GanttContainer.tsx` `getSvgElement`, `scrollTimingSignal`, `resetWorstTiming`, `ScrollTiming`, `svgRef`, `window.__ganttScrollDebug`/`ScrollDebugInfo`; `Gantt.tsx:288` duplicate `onMount(() => runSetup(...))`; `src/components/ArrowLayer.tsx` (no importer) and its `examples`/docs references; `src/demo/GanttSubtaskDemo.tsx` (no entry); dead imports (`ShowcaseDemo.tsx:6 Show`, `ArrowDemo.tsx:2 createMemo`, `ConstraintDemo.tsx:2 onCleanup`, `ShowcaseDemo.tsx:546` unused `createGanttConfigStore`). *Accept:* grep proves no remaining reference; gate green; dev smoke unchanged.
- **E0.6** `chore` P1 S — **Block-body sweep + `onReady` deferral (1.9-neutral).** Convert concise callbacks that return a value: `ExportDemo.tsx:197`, `BoxSelectDemo.tsx:141`, `MultiSelectDemo.tsx:123`, `DbDemo.tsx:111` (`onMount(() => refetch())` → block), `Gantt.tsx:234` (`onMount(() => { queueMicrotask(() => props.onReady?.(api)); })`). *Accept:* `grep -rnE "=> set[A-Z]|=> props\.on[A-Z]" src` returns only reviewed sites.
- **E0.7** `chore` P2 M — **Shared demo lifecycle helper + plain latches.** `src/demo/shared/demoLifecycle.ts`: `useViewportSize(getEl)` (measure + ResizeObserver + window resize, single cleanup), `useRafLoop(tick)`, `createLatch()` (closure boolean + signal mirror). Replace the five copy-pasted bodies (`GanttMinimalTest.tsx:417/439`, `GanttExperiments.tsx:964/978`, `GanttPerfIsolate.tsx:1758/1769`, `GanttPerfDemo.tsx:269/276/298`, `GanttProfiler.tsx:165/177`; cancel the leaked RAFs at MinimalTest:468, PerfIsolate:1806, Experiments stress loop) and the seven self-reading latches (`GanttExperiments.tsx:898`, `index-test.tsx:1947`, `GanttMinimalTest.tsx:340`, `GanttPerfDemo.tsx:110/161/211`, `GanttProfiler.tsx:83/87`). On 1.9 the helper still uses `onMount+onCleanup`; E3.2 flips its internals once. *Accept:* perf pages render and stress buttons toggle exactly as before.

### E1 — Characterization tests on 1.9 (on `main`) — P0

Gate: `pnpm test` green on main; tests that are red on 1.9 because of a pre-existing bug land as `it.skip` with `// TODO(E2.x)` and are un-skipped by the fixing issue; `git grep flush() tests` returns only helpers.

- **E1.1** `task` P0 M — **First-paint mount test** (`tests/gantt.mount.test.tsx`): bare `<Gantt>` with 3 tasks/2 resources renders 3 bars after `settle()`; every task `_resourceIndex >= 0`, `_isHidden === false`, `_bar.x === dateStore.dateToX(start)`; `dates().length > 0`; with `<GanttProvider>` too; `onSelectionChange` spy receives a Set after a click; `onReady` fires once with an api object. Deps: E0.4.
- **E1.2** `task` P0 M — **Setup + date pipeline** (`tests/ganttSetup.test.ts` extend, new `tests/ganttDateStore.test.ts`): after `initializeTasks` + `settle()`: `ganttConfig.ganttStart() === dateStore.ganttStart()`, resource index map populated, `changeViewMode('Month')` regenerates `dates()` at month step; `extendTimeline('right')` appends. Deps: E0.4.
- **E1.3** `task` P0 S — **taskStore**: `removeTask` removes the key (`'a' in tasks === false`, `taskCount()` agrees); same-turn `updateTasks([a]); updateBarPosition('a',{x:50})` lands; the gantt-6hx guard gains its negative half (memo on `tasks['t1'].name` run count stays 1 across `updateBarPosition`, landed `it.skip` until E2.3); signal writes moved outside `createRoot` bodies. Deps: E0.4.
- **E1.4** `task` P0 S — **ganttConfigStore** (`tests/ganttConfigStore.test.ts`): memo over `expandedTasks().has('t1')` re-runs on toggle (skip until E2.4 if red on 1.9); `setColumnWidth(w => w + 10)` twice → +20; `updateOptions` atomic. Deps: E0.4.
- **E1.5** `task` P1 M — **Virtualization invalidation** (`tests/useTaskVirtualization.test.ts`): same-tick `removeTask('a'); updateTask('b')` (count unchanged) changes `pooledRegularTasks()` after `settle()` (skip until E2.8 if red); TaskLayerMinimal shares the helper. Deps: E0.4, E1.1.
- **E1.6** `task` P0 L — **Drag-end geometry** (`tests/drag.test.tsx` via `mountGantt` with jsdom SVG stubs; fallback `tests/useBarDrag.test.ts` at hook level): mousedown → mousemove(+40px) → mouseup with `settle()` between dispatches; `onDateChange` receives the final x/width the last move wrote; progress drag reports the new progress; keyboard resize cascade uses the new width. Deps: E0.4, E1.1.
- **E1.7** `task` P2 S — **ArrowLayerBatched dependency** (`tests/arrowLayerBatched.test.tsx`): mounted against a store populated in the same run, positions appear after `settle()` without a `positionVersion` bump (skip until E4.4). Deps: E0.4.

### E2 — Reshape data flow on 1.9 (on `main`; pure refactors, behaviour identical) — P0

Gate: per-commit gate + dev smoke (gantt.html first paint, view-mode switch, drag/resize/progress; showcase, constraint, box-select, db with `pnpm dev:server`). Timing-related acceptance is proved by E1 tests after the flip, not on 1.9.

- **E2.1** `bug` P0 M — **ganttDateStore compute-then-apply.** `generateDates(start = ganttStart(), end = ganttEnd(), stepVal = step(), unitVal = unit())`; `setupDates` computes the window locally (including `start_of(start, unitFor(mode))` at :152 from the mode object, not the `unit()` memo), writes signals from locals and **returns** `{ ganttStart, ganttEnd, unit, step, columnWidth, dates }`; `changeViewMode` derives step/unit/columnWidth from the resolved mode object, passes them to `generateDates`, returns the window; `extendTimeline` passes `newStart/newEnd`. Public no-arg `generateDates()` keeps working. Sites: :140-196, :201-216, :221-238, :243-254. Deps: E0.5.
- **E2.2** `bug` P0 M — **ganttSetup compute-then-apply.** Consume the window returned by `setupDates` for :69-73 and :75-84 (one `ganttConfig.updateOptions({...})` write instead of five setters); build the resource index map locally from `extracted` (`normalizeResources` → `computeDisplayResources(_, collapsedGroups())` → index loop) and pass it to `processTasks` (:101-109); still call `updateResources` purely to publish; document that `initializeTasks` may only run from an effect apply, handler or `onSettled`. Add a pure `buildSetupInput(rawTasks, stores)` if it clarifies. Deps: E2.1.
- **E2.3** `bug` P0 M — **taskStore leaf semantics.** `updateBarPosition`: delete the committed guard at :108; draft body `const t = s[id]; if (!t?._bar) return; for (const k of keys) if (position[k] !== undefined) t._bar[k] = position[k];` (leaf mutation, no object replacement); `batchMovePositions` mutates `_bar.x` and **returns** `Map<id,{x,width}>`; `removeTask` → `delete s[id]`; `updateTask` stays a replacement but add `patchTask(id, patch)` (draft `Object.assign`) and `setTaskProgress(id, p)`; `collapseAllTasks(ids?)` uses the passed list; `updateTasks` keeps `reconcile`. On 1.9 these still sit inside `produce(...)`; E3.1 removes the wrapper. Un-skip E1.3's negative guard. Update `useBarDrag.ts:250-255` to `setTaskProgress`. Deps: E1.3.
- **E2.4** `bug` P0 M — **ganttConfigStore.** `expandedTasks` → `createSignal<ReadonlySet<string>>` replaced immutably (toggle/expand/collapse/expandAll/collapseAll at :172-210; drop the committed-read guards at :186/:196); `makeSetter` → `(v) => setState(s => { s[key] = typeof v === 'function' ? v(s[key]) : v; })` returning void, interface retyped from `Setter<T>` to `ConfigSetter<T>`; `getConfig()` documented as a committed snapshot; note in `types.ts` that `ganttStart/ganttEnd/ignoredDates` and `ProcessedTask` dates are unproxied (replace, never mutate). Update consumers (`ganttSetup`, `BarDemo.tsx:195`, `useBarConfig`). Un-skip E1.4. Deps: E1.4.
- **E2.5** `bug` P1 S — **resourceStore/selectionStore/TaskLayer click.** `resourceStore.collapseAll(ids?)`; document `isTaskCollapsed`/`isGroupCollapsed`/`isSelected`/`selectionCount` as committed-state readers (not toggle oracles); `TaskLayer.tsx:129-143` computes the resulting selection as a local Set and passes it to `props.onTaskClick`/invokes after the write (chain E). Deps: E0.5.
- **E2.6** `bug` P0 M — **useGanttScroll inversion.** `useGanttScroll(containerApi: Accessor<ContainerAPILike | null>)` with four memos (`containerApi()?.scrollLeftSignal?.() ?? 0` etc.); delete `handleContainerReady`; `GanttContainer` passes measured `containerWidth/containerHeight` numbers on the api object and seeds `setViewportHeight` next to `setContainerWidth` at :172; `Gantt.tsx:248/490-491` adapt; document that `onContainerReady` must not create primitives. Deps: E0.5.
- **E2.7** `bug` P0 L — **Gesture-commit boundary: geometry as data.** `useDrag`: `let dragStateNow` mirror written beside every `setDragState`, all internal guards read it (:79/:84/:130/:155/:161/:177), re-entrancy guard at :196 tests `dragData`; `isDragging = createMemo(() => dragState() !== 'idle')`; `onDragMove` records `data.lastGeom`/`data.finalProgress` in `useBarDrag` write branches (:149/:164/:196-199/:208/:252); `onDragEnd` (:271/:281) reports from `data`, falling back to the store only when nothing moved; `onResizeEnd(taskId, geom?)` threaded `Bar.tsx:302` → `TaskLayer.tsx:98` → `resolveResizeConstraints(taskId, ctx, geom)` (drop the `getBarPosition` read at `taskLayerConstraints.ts:87`); `SummaryBar.tsx:146-150` passes the map returned by `batchMovePositions`; `Gantt.handleDateChange` forwards `{x,width}` as a third `onDateChange` argument; `useBoxSelect` tracks `passedThreshold` in a plain local (:117-136). Un-skip E1.6. Deps: E2.3, E1.6.
- **E2.8** `bug` P1 M — **Virtualization derives.** Extract `groupTasksByResource(tasks, keys)` to `src/utils`; both `useTaskVirtualization.ts:70-96` and `TaskLayerMinimal.tsx:45-73` become tracked memos (`Object.keys(tasks)` tracked, leaf reads under `untrack`); pool high-water counters via memo `prev`; explicit `expandedTasks()` dependency at :161. Measure perf.html 10K mount (record absolute numbers; fallback: a `structureVersion` signal bumped by the store mutators). Un-skip E1.5. Deps: E2.3, E2.4.
- **E2.9** `bug` P0 M — **Gantt.tsx consumes the pipeline (still 1-arg effects on 1.9).** `runSetup(tasks)` only from effects' bodies that will become apply (no `untrack` needed after the flip); replace `prevViewMode` signal with a plain `let`; view-mode effect calls `changeViewMode` and passes the returned window into `runSetup`; row-sync becomes one `taskStore.setBarYs(Map)` draft write (skip entries whose draft y matches); `scrollTo:'start'` guard `!== undefined` at :515; selection effect returns a plain array. Deps: E2.2, E2.3, E2.6.
- **E2.10** `bug` P0 S — **Contexts with null defaults.** `GanttStores.tsx:30` and `GanttEvents.tsx:23` → `createContext<T | null>(null)`; `useGanttStores` returns `useContext(Ctx) ?? undefined` (public type unchanged); `useGanttEvents` keeps the no-op fallback; `index.ts:26/29` contracts documented. Harmless on 1.9. Deps: none.
- **E2.11** `task` P1 S — **Proxy hygiene.** `ColumnPanel.tsx:202/211`: row-level `createMemo` + inline cell expression (fixes the pre-existing non-reactive cells); document `ColumnDef.render` purity; `SummaryBar.tsx:63` reads leaves instead of memoising the `_bar` proxy; `useGanttModals.ts:47/52/57/62` return plain copies (`{...task}`; `snapshot` after the flip) and `equals` on x/y/width for the position memos; `ShowcaseDemo.tsx:595-606` same. Deps: E2.3.
- **E2.12** `bug` P1 L — **Demos with the same defect (config written then re-read to mirror).** ShowcaseDemo: `updateTaskA/B(patch)` explicit patches from the seven handlers (:1084-1217, :1775), `applyPreset` as one draft write per task (:807-875), `handleResizeEnd(taskId, geom)` (:910); ConstraintDemo: `updateTasks(key)` explicit + `resolveMovement` as a pure planner over a local `Map<id,{x,y}>` applied once (:90-275, :777); GanttPerfIsolate: cascade overlay before the write (:1645-1648), mount `GanttEventsProvider` unconditionally (:2086); DbDemo: consume the `onDateChange` geometry payload (or `flush()` first — legal in the handler), record `{x,width}` used per patch and re-base from them (:195-242), functional `TaskForm` updaters (:254/:257/:263/:266), `untrack` the top-level read at `TaskForm.tsx:200`; `BarDemo.tsx:199` → `setTaskProgress`, :462 thunks. Strip `@ts-nocheck` from Showcase/Constraint/Db files (D8). Deps: E2.7, E2.11.
- **E2.13** `bug` P0 S — **ArrowLayerBatched real dependencies, BEFORE E2.3.** *(Added 2026-09-04 during execution, from measured probes in the E1 scout wave — not in the original tree.)* `ArrowLayerBatched.tsx` works today only **by accident**: `taskCount()` (:95-99) does a non-`untrack`ed `Object.keys(store.tasks)` and so subscribes to the store root, and today's `updateBarPosition` replaces the whole task object, so `setProperty` notifies the root and `spatialIndex` re-runs. The per-arrow position reads at :139-141 are `untrack`ed and `props.positionVersion` is `void`ed, so neither contributes a dependency. The moment **E2.3** switches to leaf mutation that edge disappears and arrows silently stop following drags — on `main`, on 1.9, before any flip; the shipped `Gantt` mounts no arrow layer, so nothing surfaces it until E5.3. Do the 1.9-compatible half of E4.4 first: drop the `untrack` at :139-140, drop `void props.positionVersion` at :123, move the module caches (:70-72) into component/memo state. Leaves for E4.4: removing the `positionVersion` prop and the `triggerArrowUpdate` protocol from `GanttPerfIsolate.tsx:1529/:1587`, the `Arrow.tsx` re-benchmark, and un-skipping E1.7. Deps: E1.3. **Blocks E2.3.**

### E3 — The flip (branch `solid-2`) — P0

Gate for E3.1: `pnpm install` (lockfile committed) && typecheck && lint && prettier-check && `pnpm test` (both projects green) && `pnpm build` (dist externalizes `solid-js` and `@solidjs/web`, no renderer code inlined). `build:demo` and the demo pages are allowed to be red until E3.2, which must be the next commit.

- **E3.0** `chore` P0 S — **Rehearsal in a throwaway worktree (no commit).** Install the target set; flip `jsxImportSource`; capture the full `tsc` error inventory into E3.1's notes; verify: native compiler installs (else add `@solidjs/compiler` to `onlyBuiltDependencies`, or `compiler:'babel'`), the plugin resolves demos' `.js`-extension imports of `.ts` files, `<For keyed={false}>` reads sparse holes as `undefined` and reuses row i, `<Repeat>` exists with a plain-index callback, vitest projects resolve the browser build in the client project (`SERVER_WRITE` warning absent). Deps: E2.* complete, E0.4.
- **E3.1** `task` P0 XL — **Flip A: runtime, tooling, library, entries, tests (one commit).** package.json (D1 pins; remove vite-plugin-solid, babel-preset-solid, four primitives; raf → devDeps 4.0.0-next.2; add @solidjs/web, jsdom (if not already), optional diagnostics); `config/vite/solid.js` + `demo.js`: `import solid from '@solidjs/vite-plugin'`, `external: ['solid-js','@solidjs/web']`, drop `umd` (D3) and the globals map; tsconfig `jsxImportSource: '@solidjs/web'`; library sweep: `solid-js/web` → `@solidjs/web` (20 entry files + `Dynamic` users), `solid-js/store` → `solid-js` (drop `produce`/`unwrap`; draft bodies already exist), `import type { JSX } from '@solidjs/web'` (33 sites), `<Index>` → `<For keyed={false}>` (TaskLayer :217/:249, TaskLayerMinimal :130), `onMount` → `onSettled` with block bodies and single returned cleanups (`GanttContainer.tsx:170`, `Gantt.tsx:234`), split the six `Gantt.tsx` effects into `(compute, apply)` (compute returns plain values; apply calls `runSetup`/`updateOptions`/`changeViewMode`/`setBarYs`/`onSelectionChange`; `{defer:true}` for the view-mode effect), `createMemo(fn, init, opts)` → `createMemo(fn, opts)` (`createVirtualViewport.ts` ×4, others per audit), remove `batch` (`useGanttScroll` gone; others), `on(...)` → compute + `{defer:true}` (`TaskForm.tsx:231`), `createComputed` → split effect (tests), `tabIndex` → `tabindex` (Bar:421, SummaryBar:193, TaskDataModal:72), `reconcile` at root (`setTasks(reconcile(obj))`), `Ctx.Provider` → `<Ctx value>` (GanttEvents:44, GanttStores:47, index-test:2343/2357); tests: `settle` = `flush`, `createComputed` test → effect, signal writes outside `createRoot` bodies (`taskStore.test.ts:322/346/362`, `selectionStore.test.ts:66-99`), `flush()` after `initializeTasks` in `ganttSetup.test.ts`. *Accept:* gate above; `git grep -nE "solid-js/(web|store)|<Index|\\bonMount\\b|\\bbatch\\(|createComputed|\\bproduce\\(|\\.Provider|tabIndex" src tests` returns only demo files. Deps: E3.0.
- **E3.2** `task` P0 L — **Flip B: demos + benchmarks mechanical sweep (next commit).** Shared helper internals → `onSettled` with one merged cleanup; `<Index>` sites in `DateHeadersOptimized.tsx:166/203`, `GanttMinimalTest.tsx:672`, `GanttExperiments.tsx:1187`, `BarDemo.tsx:397`, `index-test.tsx:2298-2325`; removed-symbol imports in every demo (`Index`, `onMount`, `batch`, `produce`, `Show` dead); ShowcaseDemo's 38 path setters + 7 object-merge setters → draft callbacks (flat primitive stores; `storePath` acceptable there only); `GanttPerfIsolate.tsx:1516` produce → draft, :1580/:1644 batch removal; `benchmarks/profiler/index.js` ESM (`require` → static imports), `memoTracker.js:136` initial value → `{ loadingValue }`; check `benchmarks/constraint/earlyTerminationBench.ts` (SMA-flagged createMemo args). *Accept:* `pnpm build:demo` green; every non-`@ts-nocheck` page renders. Deps: E3.1.

### E4 — Library correctness and diagnostics on 2.0 (branch) — P0/P1

Gate: `pnpm dev` with the console open: gantt, subtask, resource-groups, custom-columns, box-select, multi-select, export, filter-search, critical-path, db (+`dev:server`) load with zero `REACTIVE_WRITE_IN_OWNED_SCOPE` / `PRIMITIVE_IN_FORBIDDEN_SCOPE` / cleanup errors and zero `STRICT_READ_UNTRACKED` warnings during scroll/drag/expand; E1 tests green.

- **E4.1** `bug` P0 S — **Gesture-commit `flush()` (legal) before public callbacks.** `useDrag.handleMouseUp`: `flush()` after the final `onDragMove`, before `onDragEnd`; document the three sanctioned flush sites. Deps: E3.1.
- **E4.2** `bug` P0 M — **Post-flip red→green sweep of the library.** Run E1 suites + smoke; fix whatever the flip exposed that E2 did not cover (expected small: `GanttContainer` cleanup shape, `Gantt.tsx` `onReady` via `queueMicrotask`, `changeViewMode` window handoff). Deps: E3.1.
- **E4.3** `task` P1 M — **Strict-read cleanup.** Top-level reactive reads → `untrack` (one-shot) or getters: `Gantt.tsx:173/263/462`, `GanttStores.tsx:41-43`, `Bar.tsx:195-205` (deps literal → getters), `TaskLayer.tsx:197-198` (`useBoxSelect` deps as accessors), `GanttExperiments.tsx:554`, `GanttMinimalTest.tsx:270`, `index-test.tsx:1283/1284/1505/1836` and the V7d/e/f probes (:848/:903/:974 — delete or redesign), GanttPerfIsolate legacy variants' `props.task` shape (6 sites). Deps: E4.2.
- **E4.4** `bug` P2 M — **ArrowLayerBatched (demo-mounted) real dependencies.** Move module caches (:70-72) into component/memo state; drop `void props.positionVersion` (:123) and the `untrack` at :139-140 so `getBarPosition` subscribes; delete the `triggerArrowUpdate` protocol in GanttPerfIsolate (:1529/:1587); un-skip E1.7. Deps: E4.2.
- **E4.5** `decision` P2 M — **Memo laziness measured (D7).** Measure perf.html 10K mount and scroll frame time with chrome-devtools-cli for: all eager; `lazy` on `useBarConfig` rarely-read memos (`showExpectedProgress`, `ignoredPositions`, `readonlyProgress`), `getAllDateInfos`, modal/popup formatters; record numbers; apply only what measured better. Deps: E4.2.
- **E4.6** `task` P1 M — **Diagnostics gate test.** `tests/diagnostics.gate.test.tsx`: `DEV.diagnostics.capture()` (or `@solidjs/diagnostics` matchers) around mount (50 tasks/5 resources), a full drag, expand/collapse, view-mode switch, custom columns; assert no `error`/`warn` events (allow `NO_OWNER_EFFECT` for unowned test stores). Deps: E4.3, E4.4.
- **E4.7** `task` P1 S — **`<For keyed={false}>` pooling proof + Repeat evaluation.** `tests/forPooling.test.tsx`: holes render as `undefined` rows; row i is reused (no remount) when the pooled array changes; a drag survives pool reuse. Record whether `<Repeat count from>` should replace the pools (optional E7.7). Deps: E4.2.
- **E4.8** `task` P1 S — **API delta record.** Document D13 changes in `docs/ARCHITECTURE.md` + a CHANGELOG entry (types: `ConfigSetter`, `onResizeEnd(taskId, geom?)`, `onDateChange` third arg, `patchTask`, `setTaskProgress`, `collapseAllTasks(ids?)`, `collapseAll(ids?)`, `useGanttStores`, `ColumnDef.render` purity, TaskStore readers are committed-state). Deps: E4.2.

### E5 — Demos on 2.0 + smoke matrix (branch) — P1

Gate: `pnpm build:demo` green; every page in the matrix opened with the console visible; zero diagnostics.

- **E5.1** `task` P1 M — **Perf-harness semantics.** Decide harness timing (recommended: `flush()` at the end of each RAF/interval tick so DOM work stays inside the measured frame; document in EXPERIMENTS.md); resolve the `splitEquals` question (`GanttExperiments.tsx:706/722` — options were silently ignored on 1.9); redesign or delete the closure-cache variants (`:596-599`, `:652-698`) and `index-test` probes; `GanttMinimalTest.tsx:121` dates as epoch numbers (unproxied Date note). Deps: E3.2, E4.3.
- **E5.2** `task` P2 S — **Feature/main demo hygiene.** `CriticalPathDemo.tsx:112` → `setCriticalPath(v => !v)`, `:135` per-key getter; `FilterSearchDemo.tsx:105` predicate memo; strip `@ts-nocheck` from component/feature demos (D8); `CustomColumnsDemo` verified. Deps: E4.2.
- **E5.3** `chore` P1 M — **Smoke matrix** (all 21 examples; record results in the issue): index (links) · gantt (bars on first paint at correct dates; drag/resize/progress log final geometry; view-mode switch; keyboard) · subtask + resource-groups (expand/collapse) · showcase (presets, locked toggles invert drag, arrows) · constraint (cascade) · bar · arrow · box-select · multi-select (bulk drag) · export (svg/png) · filter-search · critical-path · custom-columns (cells update) · db + `dev:server` (drag PATCH persists exact dates; reload matches) · perf (10K scroll, drag mid-scroll) · perf-isolate (each `?bar=` variant incl. dragconst) · experiments · index-test · minimal-test · profiler. Deps: E5.1, E5.2, E4.6, E4.7.

### E6 — Performance re-baseline + built artifacts (branch) — P1

- **E6.1** `chore` P2 M — **Re-baseline on rc.6.** `pnpm build:demo && npx serve dist-demo -l 5174` then `benchmarks/scripts/run-comprehensive.sh`, `run-virt.sh`, `run-virt-comprehensive.sh` (+ perf.mjs on perf.html); date-stamp every 1.9.12 table (PERFORMANCE.md, DEMOS.md, EXPERIMENTS.md, ANALYSIS.md) and append rc.6 tables; note the `Index`→`For` and flush-timing caveats next to affected findings. Deps: E5.3, E4.5.
- **E6.2** `chore` P1 S — **`chore(demo): refresh built artifacts`.** Rebuild, remove stale hashed chunks, commit only `dist-demo/` (existing convention; see bd memory on dist-demo churn). Deps: E6.1.

### E7 — Docs, memory, follow-ups — P2

- **E7.1** `task` P1 M — **CLAUDE.md + AGENTS.md final pass**: promote the E0.2 section from "in progress" to the house rules; fix file-name drift (.js/.jsx → .ts/.tsx lists, `perf-traces/` → `benchmarks/traces/`, "no test runner" line, DateHeadersOptimized path); test posture (projects, settle, createRoot rule); diagnostics gate. Deps: E5.3.
- **E7.2** `task` P1 S — **README**: install section (`pnpm add ganttss solid-js@2.0.0-rc.6 @solidjs/web@2.0.0-rc.6`, `jsxImportSource`, `resolve.dedupe` note), `useGanttStores` contract (unchanged), setter/reader timing note, ESM-only packaging, callback signatures. Deps: E4.8.
- **E7.3** `task` P2 M — **docs/* sweep**: ARCHITECTURE (config store section :398-431, `updateTasks` via reconcile, Set inventory safe/broken table, provider), PERFORMANCE (:407 untrack-write advice → split effect; :421 untrack sample), MINIMAL_TEST (`Index`), DATABASE (drag-PATCH algorithm + `vite.config.ts` reference), DEMOS, EXPERIMENTS, RFC-undo-redo (provider API claims), AUDIT. Deps: E6.1, E4.8.
- **E7.4** `chore` P2 S — **bd memory rewrite**: replace `solidjs-createstore-produce-state-id-newobj-never-wrap` with the 2.0 rule (leaf-mutate in the draft; never replace the task object; Bar reads leaves; a memo over the `_bar` proxy never invalidates) and finalize the E0.2 rulebook memory. Deps: E4.2.
- **E7.5** `chore` P1 S — **Merge `solid-2` into `main`** (merge commit) after the end-of-migration gate; keep the branch until E7.6. Deps: E6.2, E7.1.
- **E7.6** `task` P2 S — **Re-bump follow-up**: when a newer RC or 2.0.0 stable ships, bump the whole set together, re-run the full gate + smoke + bench, relax pins to caret at stable, read the RC changelog for guard changes. Deps: E7.5.
- **E7.7** `decision` P3 S — **Optional modernizations (each its own issue when wanted):** peerDependencies (D4); self-contained IIFE bundle (D3); `<Repeat>` pools (E4.7 result); rowLayouts as y source of truth (D10); DbDemo on `action()`/`createOptimisticStore` (D9); gitignore dist-demo; Vitest browser mode for drag tests; `.jsx` example URLs → `.tsx`; `@ts-nocheck` removal from perf harnesses. Deps: E7.5.

## Sequencing and critical path

E0.1 → E0.2 → E0.3 → E0.4 → E0.5 → E1.1..E1.6 → E2.1 → E2.2 → E2.13 → E2.3 → E2.4 → E2.6 → E2.7 → E2.9 → E2.12 → **E3.0 → E3.1 → E3.2** → E4.2 → E4.1 → E4.3 → E4.6 → E5.3 → E6.1 → E6.2 → E7.5.
Parallel after E0: E0.6/E0.7; E1.x among themselves; E2.5/E2.8/E2.10/E2.11 alongside E2.6/E2.7; after E4.2: E4.4/E4.5/E4.7/E4.8, E5.1/E5.2, E7.2/E7.4.

Why this order: the two fail-closed defects (blank first paint, persisted stale geometry) are data-flow shapes, not syntax, so they are fixed on 1.9 where the synchronous runtime and the existing suite verify them; the flip then becomes mechanical and bisectable; characterization tests written before the flip turn the flip's test summary into a named regression list; docs rules land first because executing agents need them while doing E2–E4.

Rough effort: E0 ~2d · E1 ~3d · E2 ~7d · E3 ~3d · E4 ~4d · E5 ~3d · E6 ~1.5d · E7 ~2d ≈ 5 engineer-weeks; ~3.5 weeks on the critical path with parallel demo/docs work.

## Verification

Per issue: the per-commit gate above (+ the issue's own acceptance). From E3.1: `pnpm test` must list both projects (client jsdom: 14 existing + new suites; server node: 4).
End of migration (before E6.2 and again on the merge commit): clean install on Node 22; full gate; `dist/ganttss.es.js` externalizes both runtimes; smoke matrix (E5.3) with zero diagnostics; bench scripts complete against fresh `dist-demo`; `git grep` sweeps for removed APIs return nothing outside dated doc history.

## Creating the beads tree (what executing this plan does)

1. `bd create --type=epic` ×8 (E0–E7) with the epic goal + gate as description; record ids.
2. Children with `bd create --type=<task|bug|chore|decision> --priority=N --parent=<epic-id> --title="..." --description="<Do/Accept text + file:line sites from the digest>"`; use parallel subagents (bd prime tip) — ~46 issues.
3. `bd dep add <child> <prerequisite>` for every Deps entry; epics depend on their children (gantt-6jw convention) so `bd ready` surfaces only unblocked work.
4. Verify with `bd ready` (should show E0.1, E0.6, E0.7, E2.10 first) and `bd blocked`.
5. Then implementation, one issue per session-chunk: claim → implement → gate → `bd close` → commit → push.

## Beads ids (created 2026-09-04; label `solid2`)

Regenerate/extend with `python3 docs/migration/solid2/beads-spec.py` (idempotent; map in `beads-map.json`).

| Plan key | bd id |
|---|---|
| E0 | `gantt-ola` |
| E0.1 | `gantt-ola.1` |
| E0.2 | `gantt-ola.2` |
| E0.3 | `gantt-ola.3` |
| E0.4 | `gantt-ola.4` |
| E0.5 | `gantt-ola.5` |
| E0.6 | `gantt-ola.6` |
| E0.7 | `gantt-ola.7` |
| E1 | `gantt-rci` |
| E1.1 | `gantt-rci.1` |
| E1.2 | `gantt-rci.2` |
| E1.3 | `gantt-rci.3` |
| E1.4 | `gantt-rci.4` |
| E1.5 | `gantt-rci.5` |
| E1.6 | `gantt-rci.6` |
| E1.7 | `gantt-rci.7` |
| E2 | `gantt-b4m` |
| E2.1 | `gantt-b4m.1` |
| E2.2 | `gantt-b4m.2` |
| E2.3 | `gantt-b4m.3` |
| E2.4 | `gantt-b4m.4` |
| E2.5 | `gantt-b4m.5` |
| E2.6 | `gantt-b4m.6` |
| E2.7 | `gantt-b4m.7` |
| E2.8 | `gantt-b4m.8` |
| E2.9 | `gantt-b4m.9` |
| E2.10 | `gantt-b4m.10` |
| E2.11 | `gantt-b4m.11` |
| E2.12 | `gantt-b4m.12` |
| E2.13 | `gantt-b4m.13` |
| E3 | `gantt-5rc` |
| E3.0 | `gantt-5rc.1` |
| E3.1 | `gantt-5rc.2` |
| E3.2 | `gantt-5rc.3` |
| E4 | `gantt-avv` |
| E4.1 | `gantt-avv.1` |
| E4.2 | `gantt-avv.2` |
| E4.3 | `gantt-avv.3` |
| E4.4 | `gantt-avv.4` |
| E4.5 | `gantt-avv.5` |
| E4.6 | `gantt-avv.6` |
| E4.7 | `gantt-avv.7` |
| E4.8 | `gantt-avv.8` |
| E5 | `gantt-g22` |
| E5.1 | `gantt-g22.1` |
| E5.2 | `gantt-g22.2` |
| E5.3 | `gantt-g22.3` |
| E6 | `gantt-l03` |
| E6.1 | `gantt-l03.1` |
| E6.2 | `gantt-l03.2` |
| E7 | `gantt-b4z` |
| E7.1 | `gantt-b4z.1` |
| E7.2 | `gantt-b4z.2` |
| E7.3 | `gantt-b4z.3` |
| E7.4 | `gantt-b4z.4` |
| E7.5 | `gantt-b4z.5` |
| E7.6 | `gantt-b4z.6` |
| E7.7 | `gantt-b4z.7` |

Start with `bd ready` → `gantt-ola.1` (E0.1). Epics depend on the previous epic; children depend on their prerequisites; `bd blocked` shows the rest.
