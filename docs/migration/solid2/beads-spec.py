#!/usr/bin/env python3
"""Create the Solid 2.0 migration beads tree from docs/migration/solid2/PLAN.md.

Idempotent: ids are recorded in beads-map.json; existing keys are skipped.
Run from the repo root:  python3 docs/migration/solid2/beads-spec.py [--dry-run]
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MAP = os.path.join(HERE, "beads-map.json")
DRY = "--dry-run" in sys.argv
LABEL = "solid2"
PLAN = "docs/migration/solid2/PLAN.md"
DIG1 = "docs/migration/solid2/digest-t1.md"
DIG2 = "docs/migration/solid2/digest-t2.md"
GATE = "pnpm typecheck && pnpm lint && pnpm prettier-check && pnpm test && pnpm build && pnpm build:demo"

def bd(*args):
    if DRY:
        print("bd", " ".join(a if len(a) < 60 else a[:57] + "..." for a in args))
        return "dry-" + str(abs(hash(args)) % 10000)
    out = subprocess.run(["bd", *args], capture_output=True, text=True)
    if out.returncode != 0:
        print("FAILED:", args[:3], out.stderr.strip()[-400:], file=sys.stderr)
        sys.exit(1)
    return out.stdout.strip().splitlines()[-1].strip()

EPICS = [
 ("E0", 0, "Solid 2.0 migration — E0: decisions, rulebook, gates, dead code (on main, still 1.9)", None),  # exists
 ("E1", 0, "Solid 2.0 migration — E1: characterization tests on 1.9 (on main)",
  "Land, on main and green under solid-js 1.9.12, one test per showstopper/high hazard the audit found, so the runtime flip (E3) produces a precise, named list of what broke and each E4 fix has a red test to turn green. Tests use tests/helpers/settle() (a no-op on 1.9 that becomes flush() in E3.1) after every write, keep signal writes outside createRoot bodies, and land tests that are red on 1.9 because of a PRE-EXISTING bug as it.skip with a // TODO(E2.x) that the fixing issue removes.\n\nGate: pnpm test green on main; `git grep -n 'flush()' tests` returns only helpers; each new test file names in a header comment which digest chain (A–J3) it pins."),
 ("E2", 0, "Solid 2.0 migration — E2: reshape data flow on 1.9 (on main; pure refactors)",
  "Convert every write-then-read-back pipeline the tracer found (digest chains A, B, C, D, F, G, I, J1, J2, J3) into compute-then-apply, move the stores to draft/leaf semantics, thread drag geometry as data, derive scroll/virtualization state, and give the contexts null defaults — all while still on solid-js 1.9.12 where the synchronous runtime and the existing suite prove behaviour is unchanged. After E2 the runtime flip (E3) is mechanical.\n\nRules: producers return their computed values; consumers never read back state they just wrote; store existence guards move inside the draft; built-ins inside a store are replace-only; every callback handed across a component boundary has a block body. On 1.9 the store bodies still sit inside produce(...) — E3.1 removes the wrapper.\n\nGate per issue: " + GATE + "; pnpm dev smoke of examples/gantt.html (first paint has bars, view-mode switch regenerates columns, drag/resize/progress report final geometry), showcase.html, constraint.html, box-select.html, db.html (with pnpm dev:server). Timing acceptance is proved by the E1 tests after the flip, not on 1.9."),
 ("E3", 0, "Solid 2.0 migration — E3: the runtime flip to solid-js 2.0.0-rc.6 (branch solid-2)",
  "Create branch solid-2 from main after E2. Rehearse the flip in a throwaway worktree, then land it as two consecutive commits: Flip A (dependencies, vite/vitest/tsconfig, library, entries, tests — typecheck/lint/test/build green) and Flip B (demos + benchmarks mechanical sweep — build:demo green). Exact pins: solid-js 2.0.0-rc.6, @solidjs/web 2.0.0-rc.6, @solidjs/vite-plugin 3.0.0-next.38, @solid-primitives/raf 4.0.0-next.2 (devDep), jsdom.\n\nGate (E3.1): pnpm install (lockfile committed) && pnpm typecheck && pnpm lint && pnpm prettier-check && pnpm test (client jsdom + server node projects both green) && pnpm build (dist externalizes solid-js and @solidjs/web). build:demo and the demo pages may be red between E3.1 and E3.2 only."),
 ("E4", 0, "Solid 2.0 migration — E4: library correctness and diagnostics on 2.0 (branch solid-2)",
  "Turn the flip's red characterization tests green, remove every remaining write-guard/strict-read diagnostic in the library path, prove the <For keyed={false}> pooling contract, take the memo-laziness decision from measurements, and record the public API delta.\n\nGate: pnpm dev with the dev console open — examples/gantt.html, subtask.html, resource-groups.html, custom-columns.html, box-select.html, multi-select.html, export.html, filter-search.html, critical-path.html, db.html (+ pnpm dev:server) load with zero REACTIVE_WRITE_IN_OWNED_SCOPE / PRIMITIVE_IN_FORBIDDEN_SCOPE / CLEANUP_IN_FORBIDDEN_SCOPE / invalid-cleanup errors and zero STRICT_READ_UNTRACKED warnings during scroll, drag and expand/collapse; all E1 suites green; " + GATE + "."),
 ("E5", 1, "Solid 2.0 migration — E5: demos on 2.0 + smoke matrix (branch solid-2)",
  "Finish the demo tree on real 2.0 idioms (perf-harness timing semantics, feature-demo hygiene, @ts-nocheck stripped from component/feature/db demos per D8) and execute the 21-page smoke matrix with the dev console open.\n\nGate: pnpm build:demo green; every page in the matrix opened via pnpm dev (pnpm dev:all for db.html) with the listed interactions performed and zero Solid diagnostics in the console; results recorded in E5.3."),
 ("E6", 1, "Solid 2.0 migration — E6: performance re-baseline + built artifacts (branch solid-2)",
  "The entire recorded performance corpus (docs/PERFORMANCE.md, DEMOS.md, EXPERIMENTS.md, benchmarks/traces/ANALYSIS.md) was measured on solid-js 1.9.12 with <Index> pools and synchronous writes; deferred writes, eager memos and <For keyed={false}> change what is measured. Re-run the bench scripts against a fresh build:demo, date-stamp the old tables, append rc.6 tables, and refresh the committed dist-demo/ once as the final commit (existing 'chore(demo): refresh built artifacts' convention).\n\nGate: benchmarks/traces/runs contains fresh bench-*.json for the three scripts; docs tables date-stamped; the dist-demo commit contains only build output."),
 ("E7", 2, "Solid 2.0 migration — E7: docs, memory, merge, follow-ups",
  "Make every written contract match the 2.0 code (README install section and contracts, CLAUDE.md/AGENTS.md house rules, docs/*), rewrite the bd memory that encodes the 1.x store rule, merge solid-2 into main with a merge commit once the end-of-migration gate is green, and file the deliberate follow-ups (re-bump to newest RC/stable and relax pins; optional modernizations).\n\nGate: `git grep -nE 'solid-js/(web|store)|<Index|\\bonMount\\b|produce\\(|Context\\.Provider' README.md CLAUDE.md AGENTS.md docs` returns nothing except dated history sections and docs/migration/solid2/; pnpm prettier-check green; bd memories show the rewritten entries."),
]

# (key, epic, type, priority, effort, title, description, acceptance, design, deps)
ISSUES = [
 # ---------------- E0 ----------------
 ("E0.2", "E0", "task", 0, "S",
  "E0.2 Rulebook first: 'SolidJS 2.0 migration rules' section in CLAUDE.md + AGENTS.md; bd remember it",
  "Executing agents need the 2.0 rules while doing E1–E4, so they land before any code. Add an identical section to CLAUDE.md (near the top, after Project Overview) and AGENTS.md titled 'SolidJS 2.0 migration rules (in progress until E3 lands)' containing, verbatim from " + PLAN + " 'Working rules' and 'Runtime facts':\n"
  "1. Deferred writes: setters stage; reads return the committed value until the microtask flush or flush(); functional updaters compose against the staged value; store draft callbacks see staged state.\n"
  "2. Write guard: writes throw (REACTIVE_WRITE_IN_OWNED_SCOPE) in component bodies, memo bodies, effect COMPUTE phases and anything they call — untrack does NOT clear the owner. Store setters are exempt inside createRoot bodies; plain signal setters are NOT. Allowed: event handlers, timers, promise continuations, effect APPLY, onSettled bodies, { ownedWrite: true } signals.\n"
  "3. onSettled replaces onMount: untracked body; children-forbidden (no onCleanup, no primitive creation directly or via callees); must return undefined or a cleanup FUNCTION (a concise arrow returning a setter result or a Promise throws); flush() inside throws; never call a consumer callback synchronously from it (queueMicrotask).\n"
  "4. createEffect(compute, apply, {defer?}) only; compute returns plain values (never store proxies); apply may write and may return only a cleanup function; flush() inside apply is a silent no-op.\n"
  "5. flush() legality table: legal in event handlers/timers/promise continuations/test bodies; no-op in effect apply; throws in onSettled/createTrackedEffect. Sanctioned library site: useDrag mouseup only.\n"
  "6. Stores: single draft setter; delete draft[k] to remove (assigning undefined keeps the key); Set/Map/Date inside a store are not proxied (replace, never mutate; prefer a signal holding an immutable collection); leaf-mutate task._bar.x, never replace the task object; a memo returning a store sub-proxy never invalidates — bindings read their own leaf.\n"
  "7. Memos are eager; { lazy: true } also opts into autodisposal; loadingValue replaces the 1.x initial value.\n"
  "8. <Index> → <For keyed={false}> (same callback shape; the callback body now carries a strict-read label — store reads stay in JSX/memos).\n"
  "9. Context: <Ctx value> is the provider; use createContext<T | null>(null) for optional-provider APIs.\n"
  "10. Tests: settle() after every write; store writes may sit in createRoot bodies, signal writes may not; Vitest projects client=jsdom / server=node.\n"
  "11. Block bodies for every callback handed to onSettled/effect apply or crossing a component boundary (greppable: '=> set[A-Z]', '=> props.on[A-Z]').\n"
  "12. Producers return their computed values; consumers never read back state they just wrote; store existence guards move inside the draft. Do not 'fix' verified-safe code: functional updaters in one tick (selectionStore, useBoxSelect hit loop), batchMovePositions reading the draft, per-frame rAF drag loops.\n"
  "Then `bd remember --key solidjs-2-migration-rules \"<condensed rules>\"` so bd prime surfaces them in every session.",
  "CLAUDE.md and AGENTS.md carry the same rule text; `bd memories solid` lists solidjs-2-migration-rules; pnpm prettier-check green.",
  "Source text: " + PLAN + " sections 'Runtime facts' and 'Working rules'. Reference for agents: docs/migration/solid2/reference/CHEATSHEET.md (also ships as node_modules/solid-js/CHEATSHEET.md after E3) and reference/08-dev-diagnostics.md.",
  ["E0.1"]),
 ("E0.3", "E0", "chore", 0, "S",
  "E0.3 Gates see the config files; CI floor to Node 22 with typecheck/lint/test",
  "Every file the flip edits is invisible to every quality gate today (digest-t1 tooling critic). tsconfig.json:22 include += \"tests/**/*.tsx\", \"vitest.config.ts\"; package.json lint / prettier / prettier-check globs += \"config/vite/**/*.js\" \"vitest.config.ts\" \"eslint.config.mjs\" (run prettier --write on the newly covered files in the same commit). .github/workflows/publish.yml: node-version '22', drop the pnpm/action-setup `version: 9` pin so packageManager (pnpm@10.23.0) wins, add `pnpm typecheck`, `pnpm lint`, `pnpm test` steps before `pnpm build`. config/vite/solid.js:28: the top-level `output: { interop: 'auto' }` is not a Vite option — move it under build.rollupOptions.output or delete it. Optional (state it in the commit if done): consolidate the two onlyBuiltDependencies lists (package.json pnpm.onlyBuiltDependencies [better-sqlite3] and pnpm-workspace.yaml [esbuild]) into pnpm-workspace.yaml.",
  "pnpm lint and pnpm prettier-check traverse config/vite/*.js, vitest.config.ts and eslint.config.mjs and pass; pnpm typecheck passes with the widened include; publish.yml is valid YAML with node 22 and the three new steps; " + GATE + " green.",
  "Sites: tsconfig.json:22; package.json:30,32,33; .github/workflows/publish.yml (node 18, pnpm 9); config/vite/solid.js:28. Do NOT add server/** to tsconfig include here (unbounded strict-mode fallout; optional later).",
  ["E0.1"]),
 ("E0.4", "E0", "chore", 0, "M",
  "E0.4 Vitest projects (client jsdom / server node) + settle() and mountGantt() test helpers (on 1.9)",
  "Under @solidjs/vite-plugin, test.environment 'node' resolves Solid's SERVER build (inert writes), but tests/server/{routes,crud,adapter,schema}.test.ts need Node (better-sqlite3, drizzle migrate, Hono app.fetch). Fix the posture now, on 1.9, so the flip does not change it. vitest.config.ts: delete `environment: 'node'` and the hand-written `resolve.conditions`; add `test.projects = [{ extends: true, test: { name: 'client', environment: 'jsdom', include: ['tests/*.test.{ts,tsx}'] } }, { extends: true, test: { name: 'server', environment: 'node', include: ['tests/server/**/*.test.ts'] } }]` (root config stays condition-free); add jsdom (^25 or newer) as a devDependency. Add tests/helpers/settle.ts exporting `export function settle(): void {}` (E3.1 changes it to `export { flush as settle } from 'solid-js'`). Add tests/helpers/mountGantt.tsx: `mountGantt(props, { provider?: boolean, clientWidth?: number })` renders <Gantt> (optionally inside <GanttProvider>) with render() from 'solid-js/web' into a container attached to document.body, stubs clientWidth/clientHeight and SVG createSVGPoint/getScreenCTM (identity matrixTransform) on the container/svg, and returns { container, stores (window.__ganttTaskStore etc.), dispose }.",
  "pnpm test prints two projects (client: 14 suites, server: 4 suites), all green on solid-js 1.9.12; tests/helpers/settle.ts and mountGantt.tsx exist and typecheck; no test file imports flush.",
  "Reference: docs/migration/solid2/reference/v2/testing.mdx (projects shape) and reference/v2/plugin-options.mdx (test posture). vite-plugin-solid 2.11 also honours the jsdom posture on 1.9.",
  ["E0.3"]),
 ("E0.5", "E0", "chore", 1, "S",
  "E0.5 Delete dead code before migrating it",
  "Grep-verified dead code (digest lib-scroll-container, lib-gantt, tracer, demo critic): src/hooks/useGanttScroll.ts:45-48 and :75-90 (isScrolling signal, scrollTimeout, SCROLL_QUIET_MS, the effect that mutates closure vars/writes a signal/starts a timer inside a compute) — no reader anywhere; src/components/GanttContainer.tsx getSvgElement (:52,:193), scrollTimingSignal (:57,:198), resetWorstTiming (:58,:199-201), ScrollTiming interface (:39-44), the never-written scrollTiming signal (:93-98), svgRef (:83,:326), window.__ganttScrollDebug + ScrollDebugInfo (:13-37); src/components/Gantt.tsx:288 the duplicate `onMount(() => runSetup(effectiveTasks()))` (the effect at :290 already runs on mount; under 2.0 the pair would read uncommitted writes); src/components/ArrowLayer.tsx (no importer anywhere; only ArrowLayerBatched is mounted, by src/demo/GanttPerfIsolate.tsx:2015) plus any docs/examples references; src/demo/GanttSubtaskDemo.tsx (no entry file); dead imports ShowcaseDemo.tsx:6 `Show`, ArrowDemo.tsx:2 `createMemo`, ConstraintDemo.tsx:2 `onCleanup`, ShowcaseDemo.tsx:546 unused createGanttConfigStore call. Update ContainerAPILike (useGanttScroll.ts) accordingly.",
  "grep proves no remaining reference to each deleted symbol; " + GATE + " green; pnpm dev: gantt.html scrolls/drags and perf.html scrolls exactly as before.",
  "Decision D5 (E0.1). Keep the taskStore collapse API. package.json `files` publishes src, so deleting ArrowLayer.tsx is a published-content change — say so in the commit message.",
  ["E0.1"]),
 ("E0.6", "E0", "chore", 1, "S",
  "E0.6 Block-body sweep for boundary callbacks; defer onReady with queueMicrotask (1.9-neutral)",
  "rc.6 validates the return value of onSettled bodies and effect apply callbacks and throws on any non-undefined, non-function return, while setters still return the new value (digest demo critic, cross-cutting). Convert now, where it is a no-op: src/demo/ExportDemo.tsx:197 onReady, src/demo/BoxSelectDemo.tsx:141 and src/demo/MultiSelectDemo.tsx:123 onSelectionChange (concise arrows returning setSelectedIds(...)), src/demo/DbDemo.tsx:111 `onMount(() => refetch('Loaded'))` (returns a Promise → block body), src/components/Gantt.tsx:234 `onMount(() => props.onReady?.(api))` → `onMount(() => { queueMicrotask(() => props.onReady?.(api)); })` so the consumer callback never runs inside the (future) children-forbidden onSettled scope. Sweep the rest of src with the greps below and convert any other concise callback handed to onMount/createEffect or to a component prop.",
  "`grep -rnE '=> set[A-Z]|=> props\\.on[A-Z]' src` returns only reviewed non-boundary sites (list them in the issue); export.html, box-select.html, multi-select.html, db.html behave exactly as before.",
  "Digest: demo critic CROSS 'RETURN-VALUE VALIDATION IS A NEW, UNNAMED HAZARD CLASS'. Runtime: signals dist/dev.js:6232-6241 and :6282-6287.",
  ["E0.1"]),
 ("E0.7", "E0", "chore", 2, "M",
  "E0.7 Shared demo lifecycle helper (viewport/RAF/cleanup) + plain-closure latches for the perf harnesses",
  "Five perf demos copy-paste the same onMount + ResizeObserver + RAF/interval + onCleanup body and seven start/stop toggles read the signal they just wrote (digest demo critic CROSS). Create src/demo/shared/demoLifecycle.ts with `useViewportSize(getEl: () => HTMLElement | undefined)` (measure, ResizeObserver, window resize; ONE cleanup), `useRafLoop(tick)` (start/stop, cancels on cleanup) and `createLatch()` (a plain closure boolean as the synchronous truth plus a signal mirror for rendering). Replace the bodies at GanttMinimalTest.tsx:417/439, GanttExperiments.tsx:964/978, GanttPerfIsolate.tsx:1758/1769, GanttPerfDemo.tsx:269/276/298, GanttProfiler.tsx:165/177 (also cancelling the leaked RAFs at GanttMinimalTest:468, GanttPerfIsolate:1806 and GanttExperiments' stress loop) and the latches at GanttExperiments.tsx:898, src/entries/index-test.tsx:1947, GanttMinimalTest.tsx:340, GanttPerfDemo.tsx:110/161/211, GanttProfiler.tsx:83/87. On 1.9 the helper's internals still use onMount + onCleanup; E3.2 flips them to onSettled with a single returned cleanup — once, in one place.",
  "All five perf pages (perf, perf-isolate, experiments, index-test, minimal-test, profiler) render, resize and their stress/record buttons toggle exactly as before; grep shows no remaining copy of the ResizeObserver+RAF body outside the helper; " + GATE + " green.",
  "Note: the latch fix is a behavioural bug-fix (these toggles read committed state under 2.0), not a 2.0 requirement — it is here because the shared helper is the cheapest place to do it once.",
  ["E0.1"]),
 # ---------------- E1 ----------------
 ("E1.1", "E1", "task", 0, "M",
  "E1.1 First-paint mount characterization test (tests/gantt.mount.test.tsx)",
  "Pins chain A (blank chart on first paint), chain I (container handshake) and the context showstopper. Using tests/helpers/mountGantt: (1) bare <Gantt tasks={3 tasks on 2 resources with explicit 2025 start/end}> renders 3 `.bar` elements after settle(); for every task in the task store `_resourceIndex >= 0`, `_isHidden === false`, `_bar.x === dateStore.dateToX(task.start)` (not computed from `new Date()`), and `dateStore.dates().length > 0`; (2) the same inside <GanttProvider>; (3) an onSelectionChange spy receives a Set containing the clicked task id after a click + settle(); (4) onReady fires exactly once with an object exposing exportSvg. Header comment names the chains pinned.",
  "Test file exists in the client project and is green on 1.9; it asserts store state and DOM counts, not implementation details.",
  "Digest: tracer chain A, chain I; lib-gantt showstoppers a/b/c. If jsdom lacks an API the mount needs, stub it in mountGantt.tsx rather than skipping the case.",
  ["E0.4"]),
 ("E1.2", "E1", "task", 0, "M",
  "E1.2 Setup + date pipeline characterization (tests/ganttSetup.test.ts, tests/ganttDateStore.test.ts)",
  "Extend tests/ganttSetup.test.ts (keep the unowned makeStores() posture — signal writes inside createRoot throw in rc.6): after initializeTasks on fresh stores + settle(), assert dateStore.dates().length > 0, dateStore.ganttStart() <= earliest task start, ganttConfig.ganttStart() equals dateStore.ganttStart(), and every processed task has `_resourceIndex >= 0` and `_isHidden === false`. New tests/ganttDateStore.test.ts: setupDates(tasks) then settle() → dates non-empty and bounded by the tasks; changeViewMode('Month') then settle() → dates() regenerated at month granularity (column count changes, unit() === 'month'); extendTimeline('right') then settle() → dates().length grows and ganttEnd() moved. Any case that is red on 1.9 because of a pre-existing bug lands as it.skip('TODO(E2.1)').",
  "Both files green (or explicitly skipped with TODO(E2.x)) on 1.9 in the client project; each assertion is preceded by settle() after the write it observes.",
  "Digest: chains A and J1; lib-stores-config-date hazards at ganttDateStore.ts:193/195/237/247.",
  ["E0.4"]),
 ("E1.3", "E1", "task", 0, "S",
  "E1.3 taskStore characterization: removeTask deletes, same-turn create+position, gantt-6hx negative guard",
  "Add to tests/taskStore.test.ts: (1) after updateTasks([a,b]); removeTask('a'); settle(): `'a' in store.tasks === false`, Object.keys excludes 'a', taskCount() and getAllTasks().length agree; (2) same-turn `updateTasks([a]); updateBarPosition('a', { x: 50 }); settle()` → tasks['a']._bar.x === 50 (rc.6 would drop it because the guard reads committed state); (3) the gantt-6hx guard gains its negative half: a second memo on `store.tasks['t1']?.name` whose run count must stay 1 across updateBarPosition — landed as it.skip('TODO(E2.3)') because today's object replacement re-runs it; (4) restructure the three tests that write SIGNALS inside createRoot bodies (:322/:324 collapseTask/expandAllTasks, :346 and :362 setDraggingTaskId): create the store outside, keep only createMemo inside the root, perform writes from the test scope, settle() before each assertion.",
  "taskStore.test.ts green on 1.9 with the negative guard skipped; no signal setter is called inside a createRoot body; `git grep flush() tests` empty.",
  "Digest: lib-stores-task HAZ taskStore.ts:108/:134 and tests/taskStore.test.ts:98/:322; the negative guard is the only mechanism preventing someone porting the object-replacement shape into the draft.",
  ["E0.4"]),
 ("E1.4", "E1", "task", 0, "S",
  "E1.4 ganttConfigStore characterization (tests/ganttConfigStore.test.ts)",
  "New file. (1) inside createRoot: `const has = createMemo(() => cfg.expandedTasks().has('t1'))`; outside the root: toggleTaskExpansion('t1'); settle(); expect(has()).toBe(true); collapseTask('t1'); settle(); false — if this is red on 1.9 (the Set is mutated in place inside the store) land it as it.skip('TODO(E2.4)'). (2) setColumnWidth(w => w + 10) twice in one turn then settle() → +20 (pins updater composition through the setter shim). (3) updateOptions({ barHeight: 40, padding: 20 }) then settle() → both fields updated atomically and a memo over barHeight() ran once. (4) getConfig() returns plain values equal to the accessors.",
  "File green (or skipped with TODO(E2.4)) on 1.9 in the client project.",
  "Digest: lib-stores-config-date STRUCT (expandedTasks Set-in-store; makeSetter prev/return), chain J2.",
  ["E0.4"]),
 ("E1.5", "E1", "task", 1, "M",
  "E1.5 Virtualization cache-invalidation characterization (tests/useTaskVirtualization.test.ts)",
  "useTaskVirtualization.ts:70-96 and its copy TaskLayerMinimal.tsx:45-73 cache the resource grouping keyed on task COUNT; rc.6 coalesces a same-tick add+remove into one flush so the cache is permanently stale. Test at the hook level inside createRoot with real stores: run initializeTasks with tasks a,b on one resource; settle(); read pooledRegularTasks(); then in one turn removeTask('a') and updateTask('c', ...) (count unchanged); settle(); expect the pooled list to contain c and not a. Same for TaskLayerMinimal's grouping once E2.8 extracts the shared helper (add a second case then). Land as it.skip('TODO(E2.8)') if red on 1.9.",
  "Test present and green/skipped in the client project; it exercises the real hook (not a copy of its logic).",
  "Digest: lib-virtualization HAZ useTaskVirtualization.ts:78 and TaskLayerMinimal.tsx:53; chain G.",
  ["E0.4", "E1.1"]),
 ("E1.6", "E1", "task", 0, "L",
  "E1.6 Drag-end geometry characterization (tests/drag.test.tsx or hook-level fallback)",
  "Pins chains B, C, D (and DbDemo's H at its root). Preferred: tests/drag.test.tsx via mountGantt with onDateChange/onProgressChange/onResizeEnd spies: mousedown on a `.bar` (Bar.tsx role=button element), settle(), document mousemove (+40 clientX), settle(), mouseup, settle() — the useDrag rAF loop must be driven (stub requestAnimationFrame to run the callback synchronously or advance fake timers). Assert onDateChange receives the x/width the LAST move wrote; a progress drag reports the new progress; a keyboard resize (shift+ArrowRight on the focused bar) reports the new width and cascades successors from it; a summary-bar drag moves its descendants. Fallback if jsdom cannot host the SVG math even with the mountGantt stubs: tests/useBarDrag.test.ts driving useBarDrag's onDragMove/onDragEnd with a fake deps object and asserting the same contract. Cases that are red on 1.9 land as it.skip('TODO(E2.7)').",
  "A test that fails when onDragEnd re-reads the store instead of using the geometry the final move wrote (verify by temporarily forcing a stale read) and passes on the fix; green/skipped on 1.9.",
  "Digest: tracer chains B, C, D; lib-bars HAZ useBarDrag.ts:271/:281, Bar.tsx:302, SummaryBar.tsx:148; lib-hooks useDrag.ts:177/:224. Note: mousedown/mousemove/mouseup dispatched back-to-back in one task never reach a microtask checkpoint — settle() between dispatches is mandatory after the flip.",
  ["E0.4", "E1.1"]),
 ("E1.7", "E1", "task", 2, "S",
  "E1.7 ArrowLayerBatched dependency characterization (tests/arrowLayerBatched.test.tsx)",
  "The shipped Gantt mounts no arrow layer, but ArrowLayerBatched (mounted by GanttPerfIsolate and arrow.html) depends solely on a manual positionVersion counter and untracks its position reads (ArrowLayerBatched.tsx:123, :139-140), so under rc.6 the first eager memo run reads pre-flush state and never recovers. Test: mount ArrowLayerBatched against a taskStore populated in the same synchronous run with two dependent tasks; settle(); assert the rendered path count/positions are non-empty WITHOUT bumping positionVersion; then updateBarPosition on one task; settle(); assert the path changed. Land as it.skip('TODO(E4.4)') where red on 1.9.",
  "Test present in the client project; red (skipped) until E4.4 removes the manual protocol, green afterwards.",
  "Digest: lib-arrows HAZ ArrowLayerBatched.tsx:123; STRUCT 'both layers replace real store tracking with hand-rolled dependency protocols'.",
  ["E0.4"]),
 # ---------------- E2 ----------------
 ("E2.1", "E2", "bug", 0, "M",
  "E2.1 ganttDateStore compute-then-apply: parameterized generateDates; setupDates/changeViewMode/extendTimeline return the window",
  "Chains A and J1. src/stores/ganttDateStore.ts: generateDates (:201-216) reads the signals its callers just wrote — give it parameters `generateDates(start = ganttStart(), end = ganttEnd(), stepVal = step(), unitVal = unit())` so the public no-arg form still works; setupDates (:140-196) computes the window locally — including the alignment at :152 from the mode object (`start_of(start, unitOf(mode))`), not from the unit() memo — writes the signals from locals and RETURNS `{ ganttStart, ganttEnd, unit, step, columnWidth, dates }`; changeViewMode (:243-254) resolves the mode object, derives step/unit/columnWidth from it via dateUtils.parse_duration, stages setViewModeSignal, calls generateDates(ganttStart(), ganttEnd(), derivedStep, derivedUnit) and RETURNS the window; extendTimeline (:221-238) passes newStart/newEnd (and the already-captured stepVal/unitVal at :222-223) into generateDates. Consider `{ lazy: true }` on getAllDateInfos (:303) later (E4.5). Un-skip any E1.2 cases marked TODO(E2.1).",
  "Behaviour identical on 1.9 (dev smoke: gantt.html view-mode switch and timeline extension unchanged); ganttDateStore.test.ts green with no skips referencing E2.1; " + GATE + " green.",
  "Digest-t2 lib-stores-config-date HAZ ganttDateStore.ts:247, :193, :195, :237; tracer chain J1 FIX. Return type: export a DateWindow interface.",
  ["E0.5", "E1.2"]),
 ("E2.2", "E2", "bug", 0, "M",
  "E2.2 ganttSetup compute-then-apply: consume the returned window, compute the resource index map locally, single config write",
  "Chain A. src/utils/ganttSetup.ts: :66 `dateStore.setupDates(rawTasks)` → `const win = dateStore.setupDates(rawTasks)`; replace the five setter calls at :69-73 with one `ganttConfig.updateOptions({ ganttStart: win.ganttStart, ganttEnd: win.ganttEnd, unit: win.unit, step: win.step, columnWidth: win.columnWidth })`; build the `config` object at :75-84 from `win` (headerHeight/barHeight/padding still from ganttConfig — not written this turn); at :101-102 build the index map locally — `const normalized = normalizeResources(extracted); const display = computeDisplayResources(normalized, resourceStore.collapsedGroups()); const indexMap = new Map(display.map((r, i) => [r.id, i]))` — pass indexMap to processTasks and still call resourceStore.updateResources(extracted) purely to publish; document in the JSDoc that initializeTasks may only be invoked from an effect apply, an event handler or onSettled (every setter inside throws when reached from a compute). Optionally expose `initializeTasks(rawTasks, stores, ..., window?)` so Gantt can pass the window changeViewMode returned (E2.9). Un-skip E1.2 cases marked TODO(E2.2).",
  "Behaviour identical on 1.9; ganttSetup.test.ts asserts `_resourceIndex >= 0` / `_isHidden === false` for every task after a fresh initializeTasks; " + GATE + " green.",
  "Digest-t2 lib-stores-resource-selection HAZ ganttSetup.ts:101 and :66; tracer chain A FIX steps 1-3.",
  ["E2.1"]),
 ("E2.3", "E2", "bug", 0, "M",
  "E2.3 taskStore leaf semantics: guard inside the draft, leaf mutation, delete on remove, patchTask/setTaskProgress, batchMovePositions returns applied positions",
  "src/stores/taskStore.ts. updateBarPosition (:104-121): delete the committed-state guard `if (!tasks[id]) return;` at :108; the produce body becomes `const t = s[id]; if (!t?._bar) return; for (const k of Object.keys(position)) { const v = position[k]; if (v !== undefined) t._bar[k] = v; }` — leaf mutation, NO object replacement (measured on rc.6: this notifies only the changed leaf; the current `state[id] = {...task, _bar: {...}}` shape invalidates every leaf of every dragged task per mousemove). batchMovePositions (:155-173): mutate `t._bar.x = originalX + deltaX` per id and RETURN `Map<string, { x: number; width: number }>` of applied positions. removeTask (:134): `setTasks(produce(s => { delete s[id]; }))` (undefined-assignment keeps the key in rc.6). updateTask stays a whole-node replacement; add `patchTask(id, patch: Partial<ProcessedTask>)` (draft Object.assign) and `setTaskProgress(id, progress)`; switch src/hooks/useBarDrag.ts:250-255 to setTaskProgress. collapseAllTasks (:232-243): accept an optional explicit id list and prefer it over reading the map. Optional: `createTaskStore(initial?: ProcessedTask[])` so demos can be born populated (ShowcaseDemo). Keep updateTasks on reconcile. Un-skip the E1.3 negative gantt-6hx guard — it must pass (name memo runs once).",
  "tests/taskStore.test.ts fully green including the negative guard and the same-turn create+position case; dev smoke: drag/resize/progress on gantt.html and showcase.html unchanged; " + GATE + " green.",
  "Digest-t1 lib-stores-task summary + STRUCT 1-2; digest-t2 HAZ taskStore.ts:108, :134, :80. On 1.9 the bodies still sit inside produce(...); E3.1 deletes the wrapper. SummaryBar.tsx:63's memo over the _bar proxy stops invalidating once leaf mutation lands — E2.11 fixes it; land E2.11 right after this issue.",
  ["E1.3"]),
 ("E2.4", "E2", "bug", 0, "M",
  "E2.4 ganttConfigStore: expandedTasks as a signal-held immutable Set; draft-based void setters; unproxied-Date note",
  "src/stores/ganttConfigStore.ts. expandedTasks (:54 type, :146 creation, :172-210 mutators) is a Set held INSIDE createStore and mutated in place through produce — rc.6 does not proxy built-ins, so expand/collapse would notify nothing (Gantt.tsx:371 rowLayouts, useTaskVirtualization.ts:66/161). Per D6 move it out: `const [expandedTasks, setExpandedTasks] = createSignal<ReadonlySet<string>>(new Set(options.expandedTasks ?? []))`; toggle/expand/collapse/expandAll/collapseAll build a new Set and replace it; delete the committed-read guards at :186/:196 (replace-based updaters are idempotent); the public accessor keeps its type. makeSetter (:151-166): reads committed state for `prev` and returns the pre-write value — replace with `(v) => { setState(s => { s[key] = typeof v === 'function' ? v(s[key]) : v; }); }` returning void, and retype the 20 interface fields (:81-100) from Setter<T> to `ConfigSetter<T> = (v: T | ((prev: T) => T)) => void` (D13; no in-repo caller uses the return value). Document getConfig() (:260-281) as a committed snapshot. Add a comment in src/types.ts that ganttStart/ganttEnd/ignoredDates (GanttConfigState) and ProcessedTask._start/_end/_baseline* are unproxied Dates — replace, never mutate in place. Update consumers: src/utils/ganttSetup.ts (already via updateOptions after E2.2), src/demo/BarDemo.tsx:195, src/hooks/useBarConfig.ts. Un-skip E1.4 cases.",
  "tests/ganttConfigStore.test.ts fully green (expand/collapse memo re-runs; updater composition +20); subtask.html and resource-groups.html expand/collapse unchanged on 1.9; " + GATE + " green.",
  "Digest-t2 lib-stores-config-date HAZ ganttConfigStore.ts:161/:175, STRUCT-SITE :146/:151/:173/:175/:189/:199; critic MISSED :127 (Dates). Path setters at :163/:173/:187/:197/:206/:210 become draft callbacks now (they compile on 1.9 too).",
  ["E1.4"]),
 ("E2.5", "E2", "bug", 1, "S",
  "E2.5 resourceStore.collapseAll(ids?), committed-reader docs, TaskLayer click passes the resulting selection",
  "Chain G item 2 and chain E. src/stores/resourceStore.ts:129-132 collapseAll reads the getGroups() memo then writes — accept an optional explicit id list (mirror of taskStore.collapseAllTasks(ids?)). Document in JSDoc that isTaskCollapsed / isGroupCollapsed / isSelected / selectionCount answer about COMMITTED state and must not be used as a toggle-then-branch oracle in the same turn. src/components/TaskLayer.tsx:129-143 handleTaskClickWithSelection: compute the resulting selection as a local Set (from sel.selectedIds() + the intended mutation), apply it with one replace/add/toggle, and pass that local to props.onTaskClick (or invoke the callback from the selection effect) so consumers never need a same-turn read-back.",
  "Behaviour identical on 1.9; multi-select.html shift/ctrl click still selects; " + GATE + " green.",
  "Digest tracer chain E FIX (1) and chain G FIX (2)/(5). Do NOT change selectionStore's functional updaters — verified safe.",
  ["E0.5"]),
 ("E2.6", "E2", "bug", 0, "M",
  "E2.6 useGanttScroll takes the containerApi accessor; GanttContainer passes measured dimensions as data",
  "Showstopper (b) and chain I. src/hooks/useGanttScroll.ts: change the signature to `useGanttScroll(containerApi: Accessor<ContainerAPILike | null>)`; the body becomes four memos — `scrollLeft = createMemo(() => containerApi()?.scrollLeftSignal?.() ?? 0)`, scrollTop, viewportWidth (`?.containerWidthSignal?.() ?? containerApi()?.containerWidth ?? 0`), viewportHeight — and returns them; delete handleContainerReady (:50-98) and the mirror signals (:40-43). src/components/GanttContainer.tsx: seed `setViewportHeight(scrollAreaRef.clientHeight)` next to setContainerWidth at :172 so the mount path is not observer-dependent, and add plain numbers `containerWidth: scrollAreaRef.clientWidth, containerHeight: scrollAreaRef.clientHeight` to the object passed to props.onContainerReady (:187-198); document on the onContainerReady prop that it must not create reactive primitives (it will run inside onSettled). src/components/Gantt.tsx: `const scroll = useGanttScroll(containerApi)` at :248; handleContainerReady (:489-491) keeps only setContainerApi(api); the scrollTo:'today' path (:494-497) reads api.containerWidth (data) instead of api.getContainerWidth().",
  "Behaviour identical on 1.9 (virtualization ranges follow scroll; 'today' scroll lands one quarter in); useGanttScroll.ts is ~40 lines with no createEffect; " + GATE + " green.",
  "Digest-t1 lib-scroll-container STRUCT 1-3 and digest-t2 HAZ GanttContainer.tsx:172; tracer chain I FIX.",
  ["E0.5"]),
 ("E2.7", "E2", "bug", 0, "L",
  "E2.7 Gesture-commit boundary: geometry travels as data from onDragMove to onDragEnd; useDrag/useBoxSelect gate on plain locals",
  "Chains B, C, D, H, J3. src/hooks/useDrag.ts: add `let dragStateNow: DragState = 'idle'` next to rafId/pendingMove/dragData (:73-75), write it beside every setDragState (:183, :218), read it in every internal guard (:79, :84, :130, :155, :161, :177) and pass it to the callbacks; change the re-entrancy guard at :196 to `if (dragData) return;`; make isDragging `createMemo(() => dragState() !== 'idle')`. src/hooks/useBarDrag.ts: in each write branch record what was written — `data.lastGeom = { x, width }` at :149 (batch, from the map batchMovePositions returns), :164, :196-199, :208 and `data.finalProgress = newProgress` at :252; onDragEnd (:261-283) reports from data (`data.lastGeom ?? getBarPosition(id)` only when nothing moved) and calls `onResizeEnd(id, data.lastGeom)`; delete the comment at :270. Thread `onResizeEnd(taskId, geom?)` through src/contexts/GanttEvents.tsx, src/components/Bar.tsx:302 (pass `{ x: x(), width: newWidth }` from the keyboard handler at :300), src/components/TaskLayer.tsx:98 handleResizeEnd(taskId, geom) → src/utils/taskLayerConstraints.ts resolveResizeConstraints(taskId, ctx, geom) using geom instead of the getBarPosition read at :87. src/components/SummaryBar.tsx:146-150 passes the applied map from batchMovePositions into onDragEnd. src/components/Gantt.tsx handleDateChange (:467-476) forwards `{ x, width }` as a third onDateChange argument (additive public API, D13). src/hooks/useBoxSelect.ts: track passedThreshold/box in plain locals alongside active/startX (:94-98, :117-136) and read them at :135-136; keep the overlay signal for rendering only. Un-skip E1.6.",
  "tests/drag.test.tsx (or the hook-level fallback) fully green; dev smoke on 1.9: drag/resize/progress/keyboard/summary drags report the same values as before; " + GATE + " green.",
  "Digest tracer chains B, C, D FIX; lib-hooks STRUCT 1-3; lib-bars HAZ useBarDrag.ts:271/:281, Bar.tsx:302, SummaryBar.tsx:148. Do not change the per-frame loop (reads precede writes within a frame; rAF frames are separate tasks).",
  ["E2.3", "E1.6"]),
 ("E2.8", "E2", "bug", 1, "M",
  "E2.8 Virtualization derives: shared tracked grouping memo, pool counters via prev, explicit expandedTasks dependency",
  "Chain G. Extract `groupTasksByResource(tasks: TaskMap, keys: string[]): Map<string, ProcessedTask[]>` into src/utils; in src/hooks/useTaskVirtualization.ts:70-96 and src/components/TaskLayerMinimal.tsx:45-73 replace the count-keyed closure cache with `createMemo(() => { const t = props.taskStore?.tasks; if (!t) return new Map(); const keys = Object.keys(t); /* tracked via the store's ownKeys */ return untrack(() => groupTasksByResource(t, keys)); })`; the pool high-water counters (:201-232) become `createMemo((prev = 0) => Math.max(prev, needed + POOL_BUFFER))`-style derivations (on 1.9 use the fn's prev argument; no initial-value arg — E3.1 must not have to touch this); take an explicit dependency on props.ganttConfig?.expandedTasks() at :161 instead of the untracked isTaskExpanded calls. Measure examples/perf.html at 10K tasks (chrome-devtools-cli perf.mjs) before/after and record absolute mount and scroll-frame numbers in the issue; fallback if the tracked key set regresses >10%: a `structureVersion` signal bumped by updateTasks/updateTask/removeTask. Un-skip E1.5.",
  "tests/useTaskVirtualization.test.ts green; perf.html 10K scroll unchanged within noise (numbers recorded); TaskLayerMinimal has no private copy of the grouping; " + GATE + " green.",
  "Digest-t2 lib-virtualization HAZ useTaskVirtualization.ts:78, TaskLayerMinimal.tsx:53, ganttConfigStore.ts:171; STRUCT 'two closure caches and two pool counters are hidden mutable state inside memo computes'.",
  ["E2.3", "E2.4", "E1.5"]),
 ("E2.9", "E2", "bug", 0, "M",
  "E2.9 Gantt.tsx consumes the pipeline (still 1-arg effects on 1.9): runSetup input, plain prevViewMode, single-draft y-sync, block bodies",
  "Prepare Gantt.tsx so the E3.1 effect split is a pure syntax move. src/components/Gantt.tsx: runSetup (:266-275) takes the plain task array (and optionally the DateWindow from changeViewMode) and calls initializeTasks; the setup effect (:290-304) reads effectiveTasks()/collapsedGroups()/collapsedTasks() into locals first and calls runSetup with the local — no untrack wrappers needed after the split; the options effect (:307-310) calls ganttConfig.updateOptions(opts) from a local; the view-mode effect (:313-326): replace the prevViewMode SIGNAL with a plain `let prevViewMode`, call `const win = dateStore.changeViewMode(viewMode)` and pass win into runSetup so ganttSetup never re-reads the date store; the row-sync effect (:382-400): compute the `Map<taskId, y>` from rowLayouts() then apply it with ONE `taskStore.setBarYs(map)` draft write (new store method; skip entries whose draft y already matches); the selection effect (:184-188) reads `[...selectionStore.selectedIds()]` into a plain array and invokes props.onSelectionChange with a block body; scrollTo:'start' guard at :515 `firstTask?._bar?.x !== undefined`; onReady already deferred (E0.6).",
  "Behaviour identical on 1.9 (first paint, view-mode switch, expand/collapse row sync, selection callback); gantt.mount.test.tsx green; " + GATE + " green.",
  "Digest-t2 lib-gantt STRUCT-SITEs :266/:288/:290/:298/:302/:309/:316/:320/:321/:324/:382/:395; tracer chains A, F, J1. The split into (compute, apply) itself happens in E3.1 because the 2-arg form does not exist on 1.9.",
  ["E2.2", "E2.3", "E2.6"]),
 ("E2.10", "E2", "bug", 0, "S",
  "E2.10 Contexts with null defaults (GanttStores, GanttEvents); public contracts unchanged",
  "rc.6 useContext throws ContextNotFoundError for a default-less context; src/contexts/GanttStores.tsx:30 backs the bare <Gantt> path (Gantt.tsx:170 `useGanttStores() ?? {...}`) and src/contexts/GanttEvents.tsx:23 backs BarDemo/ShowcaseDemo's bare <Bar>. Change both to `createContext<T | null>(null)`; useGanttStores returns `useContext(GanttStoresContext) ?? undefined` so its public `GanttStores | undefined` signature (README.md:106) is unchanged; useGanttEvents keeps its no-op fallback for null. Document both contracts in src/index.ts exports (:26/:29). Harmless on 1.9.",
  "gantt.mount.test.tsx bare-mount case green; README.md:106 statement still true; " + GATE + " green.",
  "Digest-t1 lib-contexts-index STRUCT 1; library critic MISSED src/index.ts:26.",
  []),
 ("E2.11", "E2", "task", 1, "S",
  "E2.11 Proxy hygiene: ColumnPanel row memo, SummaryBar reads leaves, useGanttModals/ShowcaseDemo return plain copies",
  "src/components/ColumnPanel.tsx:202 `const task = firstTaskForResource(item.id)` and :211-220 read the task-store proxy inside <For> callback bodies (a strict-read scope in rc.6 → O(rows×tasks) STRICT_READ_UNTRACKED warnings; and the cells never update today): `const task = createMemo(() => firstTaskForResource(item.id))` per row and inline the cell expression into JSX (`col.render ? col.render(task(), item.id) : task()?.[col.key] ?? ''`); document on the exported ColumnDef that render() is called inside a tracking scope and must be pure. src/components/SummaryBar.tsx:63 memoises the raw _bar proxy — after E2.3's leaf mutation it stops invalidating; read the leaves directly (`() => props.taskStore.tasks[id]?._bar?.x` etc.) like Bar.tsx:175-187. src/hooks/useGanttModals.ts:47/52/57/62 return live store proxies into TaskDataPopup/TaskDataModal: return plain copies (`{ ...task }` on 1.9; E3.1 may switch to snapshot()) and give the two barPosition memos `{ equals: (a, b) => a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height }`. Same for src/demo/ShowcaseDemo.tsx:595-606 hoveredTask/modalTask.",
  "custom-columns.html cells update when a task changes (new behaviour, pre-existing bug fixed); summary bars still track drags on subtask.html; hover popup/modal unchanged; " + GATE + " green.",
  "Digest-t1 lib-chrome STRUCT 1; lib-bars STRUCT 4 (SummaryBar); lib-hooks STRUCT 6 (useGanttModals); library critic CROSS '<For> installs a strict-read scope'.",
  ["E2.3"]),
 ("E2.12", "E2", "bug", 1, "L",
  "E2.12 Demos with the write-config-then-re-read defect: ShowcaseDemo, ConstraintDemo, GanttPerfIsolate, DbDemo, BarDemo (on 1.9)",
  "One architectural defect filed as ~15 hazards (demo critic CROSS). ShowcaseDemo.tsx: give updateTaskA/updateTaskB (:665-693) an explicit patch parameter and call them with the new value from the seven handlers (:1084-1085, :1097-1098, :1115-1119, :1138-1142, :1188-1192, :1213-1217, :1775-1776 — the two 'locked' toggles currently invert drag behaviour one edit late); applyPreset (:807-875): one draft write per task (fields + _bar together; no getTask read-back); handleResizeEnd (:910) uses the geom argument from E2.7. ConstraintDemo.tsx: `updateTasks(key)` builds from the key explicitly and onChange (:777-779) passes e.target.value; rewrite resolveMovement (:90-275) as a pure planner over a local Map<taskId,{x,y}> seeded lazily from getBarPosition, returning the update set that handleMouseMove applies in one batch (removes the read-after-write at :251 and N notifications per pointer move). GanttPerfIsolate.tsx:1645-1648: build the cascade context with an overlay for the dragged task's new x/width BEFORE writing; mount <GanttEventsProvider> unconditionally (:2086). DbDemo.tsx: onDateChange (:146) consumes the third geometry argument from E2.7 (or, until then, calls flush() first — legal in the handler); record the `{ x, width }` used per patch (:219) and re-base lastX/lastWidth from those after the PATCH (:239-242) instead of re-reading the store; TaskForm.tsx: functional updaters at :254/:257/:263/:266 and untrack the top-level props read at :200. BarDemo.tsx:199 → taskStore.setTaskProgress; :462-529 debug overlay reads → thunks. Strip // @ts-nocheck from ShowcaseDemo, ConstraintDemo, DbDemo + src/demo/db/* (D8) and fix the fallout.",
  "showcase.html: every input immediately reflects in the bar (name/color/progress/locked); presets move bars; constraint.html cascades; perf-isolate ?bar=dragconst cascades with the new width; db.html (pnpm dev:all): a drag persists exactly the dropped dates and a reload matches; tsc passes without @ts-nocheck on the three files; " + GATE + " green.",
  "Digest-t2 demo-showcase HAZ #1-#10; demo-components HAZ ConstraintDemo.tsx:778/:251; demo-perf-isolate HAZ :1648; demo-db HAZ :196/:240; tracer chain H FIX.",
  ["E2.7", "E2.11"]),
 # ---------------- E3 ----------------
 ("E3.0", "E3", "chore", 0, "S",
  "E3.0 Flip rehearsal in a throwaway git worktree (no commit): tsc inventory + runtime spot checks",
  "In `git worktree add ../gantt-solid2-rehearsal -b rehearsal/solid2`, install the target set (solid-js@2.0.0-rc.6 @solidjs/web@2.0.0-rc.6 -D @solidjs/vite-plugin@3.0.0-next.38 @solid-primitives/raf@4.0.0-next.2 jsdom; remove vite-plugin-solid babel-preset-solid @solid-primitives/{memo,resize-observer,scheduled,scroll}), set jsxImportSource '@solidjs/web', swap the plugin import, run pnpm typecheck and paste the full error inventory (grouped by rule) into E3.1's notes. Verify and record: (a) `pnpm install` succeeds without a blocked build script for @solidjs/compiler (else add it to onlyBuiltDependencies or plan `compiler: 'babel'`); (b) a demo's `.js`-extension import of a `.ts` module (src/demo/BarDemo.tsx:3) resolves under the new plugin in pnpm dev; (c) `<For keyed={false}>` over a sparse `new Array(n)` renders holes as undefined rows and reuses row i in place (tiny scratch component); (d) `<Repeat count from>` exists and its callback receives a plain index; (e) under the client Vitest project the browser build resolves (no '[SERVER_WRITE]' warning; a createRoot+createMemo+store write+flush test observes the change). Delete the worktree afterwards.",
  "E3.1 notes contain the tsc inventory and the five verification results; no commit on any branch.",
  "Digest tooling-docs STRUCT 'PNPM 10 BUILD-SCRIPT APPROVAL', demo-components STRUCT '.js -> .ts extension rewrite', lib-virtualization STRUCT 'Pooling contract'.",
  ["E0.4", "E2.1", "E2.2", "E2.3", "E2.4", "E2.5", "E2.6", "E2.7", "E2.8", "E2.9", "E2.10", "E2.11", "E2.12"]),
 ("E3.1", "E3", "task", 0, "XL",
  "E3.1 Flip A (one commit on branch solid-2): dependencies, vite/vitest/tsconfig, library + entries + tests on solid-js 2.0.0-rc.6",
  "Create branch solid-2 from main. ONE commit containing: package.json — dependencies solid-js 2.0.0-rc.6 + @solidjs/web 2.0.0-rc.6 (exact); devDependencies @solidjs/vite-plugin 3.0.0-next.38, @solid-primitives/raf 4.0.0-next.2 (moved from dependencies), jsdom (if not already), optional @solidjs/diagnostics 2.0.0-rc.6; remove vite-plugin-solid, babel-preset-solid, @solid-primitives/{memo,resize-observer,scheduled,scroll}; engines.node '^20.19.0 || >=22.12.0'; lockfile committed. config/vite/solid.js + demo.js: `import solid from '@solidjs/vite-plugin'`; solid.js: `external: ['solid-js', '@solidjs/web']`, formats ['es'] (D3: drop umd and the globals map; package.json main/exports.require → the ES build). tsconfig.json: jsxImportSource '@solidjs/web'. Library + entries sweep: 'solid-js/web' → '@solidjs/web' (all 20 src/entries files, src/demo/GanttExperiments.tsx Dynamic import can wait for E3.2); 'solid-js/store' → 'solid-js' and delete produce()/unwrap wrappers (the draft bodies already exist — taskStore.ts, ganttConfigStore.ts); `import type { JSX } from '@solidjs/web'` at every JSX-type site (33; list from `git grep -n 'JSX' src`); <Index> → <For keyed={false}> at TaskLayer.tsx:217/:249 and TaskLayerMinimal.tsx:130 (callback shapes unchanged); onMount → onSettled with block bodies and ONE returned cleanup (GanttContainer.tsx:170 — hoist the ResizeObserver out of the `if (scrollAreaRef)` guard; Gantt.tsx:234 keeps the queueMicrotask body); split the Gantt.tsx effects into createEffect(compute, apply) — compute returns plain locals, apply calls runSetup / updateOptions / changeViewMode+runSetup ({ defer: true }) / setBarYs / onSelectionChange; createMemo(fn, initial, opts) → createMemo(fn, opts) at createVirtualViewport.ts:50/69/107/124 (rangeEquals tolerates undefined prev) and every other 2/3-arg createMemo (audit category createMemo-args, 41 sites incl. GanttExperiments.tsx:706/722 whose options were silently ignored on 1.9); remove batch(...) wrappers; on(...) → compute + { defer: true } (src/demo/db/TaskForm.tsx:231 — do here if the file is in the library sweep, else E3.2); tabIndex → tabindex (Bar.tsx:421, SummaryBar.tsx:193, TaskDataModal.tsx:72); reconcile at the store root stays `setTasks(reconcile(obj))`; <Ctx.Provider value> → <Ctx value> (GanttEvents.tsx:44/46, GanttStores.tsx:47/49); useGanttModals may switch plain copies to snapshot(). Tests: tests/helpers/settle.ts → `export { flush as settle } from 'solid-js'`; tests/taskStore.test.ts createComputed case → split createEffect; confirm no signal writes inside createRoot bodies remain (E1.3/E1.4 already restructured); tests/ganttSetup.test.ts + selectionStore.test.ts settle() after writes (E1 already did). vitest.config.ts: plugin import swap; keep the projects from E0.4.",
  "pnpm install && pnpm typecheck && pnpm lint && pnpm prettier-check && pnpm test (both projects green) && pnpm build (dist/ganttss.es.js externalizes solid-js and @solidjs/web — grep proves no renderer code inlined; no umd output); `git grep -nE \"solid-js/(web|store)|<Index|\\bonMount\\b|\\bbatch\\(|createComputed|\\bproduce\\(|\\.Provider|tabIndex\" src tests` returns hits only under src/demo and src/entries/index-test.tsx (E3.2); the E3.0 tsc inventory is fully resolved. build:demo may be red until E3.2.",
  "Digest-t1 tooling-docs summary (deps/externals/globals/tsconfig/vitest); lib-gantt STRUCT-SITEs for the effect split; entries batch STRUCT 'BUILD-CONFIG COUPLING'. Runtime references: docs/migration/solid2/reference/MIGRATION.md and reference/v2/from-solid-1.mdx.",
  ["E3.0"]),
 ("E3.2", "E3", "task", 0, "L",
  "E3.2 Flip B (next commit): demos + benchmarks mechanical sweep; build:demo green",
  "src/demo/shared/demoLifecycle.ts internals → onSettled with a single merged returned cleanup (ResizeObserver disconnect + cancelAnimationFrame + clearTimeout). <Index> → <For keyed={false}> at src/demo/DateHeadersOptimized.tsx:166/:203, GanttMinimalTest.tsx:672, GanttExperiments.tsx:1187, BarDemo.tsx:397, src/entries/index-test.tsx:2298/2307/2316/2325 (+ index-test.tsx:2343/2357 Provider, :14 store import). Remove the removed-symbol imports in every demo (Index, onMount, batch, produce, Show dead at ShowcaseDemo:6); Dynamic from '@solidjs/web' (GanttExperiments.tsx:10, index-test.tsx:2). ShowcaseDemo's 38 path setters + 7 object-merge setters → draft callbacks (`setTaskConfig(s => { s.name = v; })`; storePath is acceptable only there — flat primitive-field stores). GanttPerfIsolate.tsx:1516 produce → draft, :1580/:1644 batch removal, :7 Index import. benchmarks/profiler/index.js:71-82/:241 mix ESM exports with require() — use the module's own static imports; benchmarks/profiler/instrumentation/memoTracker.js:136 forwards a 1.x initial value → `{ loadingValue }` option; check benchmarks/constraint/earlyTerminationBench.ts (SMA-flagged createMemo args). Strip @ts-nocheck from files touched per D8 where cheap.",
  "pnpm build:demo green; every example page that is not a perf harness renders under pnpm dev; `git grep` sweep from E3.1 returns nothing in src; " + GATE + " green.",
  "Digest-t1 demo batches (showcase, perf-isolate, experiments, perf-profiler, entry-index-test, entries); demo critic BLOCKING items on Index inventory.",
  ["E3.1"]),
 # ---------------- E4 ----------------
 ("E4.1", "E4", "bug", 0, "S",
  "E4.1 Gesture-commit flush() (legal scope) before public drag callbacks; document the sanctioned flush sites",
  "Even with geometry threaded as data (E2.7), host apps receive onDateChange/onResizeEnd/onProgressChange in the mouseup stack and may read the exported stores. src/hooks/useDrag.ts handleMouseUp is a DOM event handler, where flush() is legal: `import { flush } from 'solid-js'` and call `flush()` immediately after the final pending onDragMove (:161-163), before onDragEnd (:177). Add a comment naming the three sanctioned flush() sites (useDrag mouseup, DbDemo onDateChange, test helpers) and the three-scope legality table.",
  "A host callback that reads taskStore.getBarPosition inside onDateChange observes the dropped position (add a case to tests/drag.test.tsx); no flush() exists inside any effect apply or onSettled body in src (`git grep -n 'flush(' src`).",
  "Digest library critic CROSS 'flush() LEGALITY IS SCOPE-DEPENDENT'.",
  ["E3.1"]),
 ("E4.2", "E4", "bug", 0, "M",
  "E4.2 Post-flip red→green sweep of the library path",
  "Run the E1 suites and the E4 dev-console gate pages on the flipped branch and fix what the flip exposed that E2 did not cover. Expected residue (small): GanttContainer onSettled cleanup shape and timer disposal (pendingUpdate at :113 cleared via onCleanup at component top level), Gantt.tsx onReady via queueMicrotask, changeViewMode window handoff into runSetup, any STRICT_READ_UNTRACKED from a store proxy leaking into an apply callback, any concise-arrow return in onSettled/apply, any remaining signal write reached from a compute. Un-skip every E1 case still marked TODO(E2.x)/TODO(E3).",
  "All E1 suites green with zero it.skip referencing E2/E3; the E4 gate pages show zero error/warn diagnostics for mount, scroll, drag, expand/collapse; " + GATE + " green.",
  "Use node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md (repair guide per diagnostic code) and docs/migration/solid2/reference/08-dev-diagnostics.md.",
  ["E3.2"]),
 ("E4.3", "E4", "task", 1, "M",
  "E4.3 Strict-read cleanup: component-body top-level reads become untrack() or getters",
  "Audit-listed top-level reactive reads (STRICT_READ warnings, some also genuinely non-reactive): src/components/Gantt.tsx:173/:263/:462; src/contexts/GanttStores.tsx:41-43 (props.options/props.resources — one-shot: untrack); src/components/Bar.tsx:195-205 (useBarDrag deps literal → getters where reactivity is wanted, untrack where the handler set is deliberately frozen); src/components/TaskLayer.tsx:197-198 (useBoxSelect deps → accessors; update useBoxSelect.ts:140/152); src/demo/GanttExperiments.tsx:554 and GanttMinimalTest.tsx:270 (Object.keys(store) at top level); src/entries/index-test.tsx:1283/1284/1505/1836 plus the V7d/e/f 'force memo evaluation' probes at :848/:903/:974 (meaningless in 2.0 and warn 340×/frame — delete or redesign); GanttPerfIsolate legacy variants that treat props.task as a plain object (6 sites; converge on the V8-V17 accessor shape).",
  "pnpm dev with the console open: gantt.html, perf-isolate.html?bar=full, experiments.html, index-test.html emit zero STRICT_READ_UNTRACKED warnings during a scroll and a drag; " + GATE + " green.",
  "Digest library critic MISSINGSITES (top-level reads list); demo-perf-isolate STRUCT 'Dead/broken variants'; entry-index-test STRUCT 'force memo evaluation probes'.",
  ["E4.2"]),
 ("E4.4", "E4", "bug", 2, "M",
  "E4.4 ArrowLayerBatched: real dependencies, per-instance caches, drop the positionVersion protocol",
  "Demo-mounted only (GanttPerfIsolate, arrow.html) but silently blank under rc.6. src/components/ArrowLayerBatched.tsx: move the module-level caches (:70-72) into component/memo state (return the invalidated caches as part of spatialIndex's value); delete `void props.positionVersion` (:123) and the untrack around the position reads (:139-140) so getBarPosition subscribes normally; remove the positionVersion prop and the triggerArrowUpdate protocol in src/demo/GanttPerfIsolate.tsx:1529/:1587; src/components/Arrow.tsx: re-benchmark the 'no createMemo' decision (header comment) under rc.6 and memoise generatePath if it wins. Un-skip E1.7.",
  "tests/arrowLayerBatched.test.tsx green; arrow.html and perf-isolate.html arrows follow drags without any manual version bump; " + GATE + " green.",
  "Digest-t2 lib-arrows HAZ ArrowLayerBatched.tsx:123 and STRUCT-SITEs :70/:105/:125/:168.",
  ["E4.2", "E1.7"]),
 ("E4.5", "E4", "decision", 2, "M",
  "E4.5 Memo laziness policy, measured (D7)",
  "rc.6 memos are eager and never autodispose unless { lazy: true }, which also opts into teardown-and-recompute when unobserved (churn for virtualized bars). Measure examples/perf.html at 10K tasks with chrome-devtools-cli perf.mjs (mount time, scroll frame time) for: (a) all eager (default); (b) lazy on the genuinely rarely-read memos only — src/hooks/useBarConfig.ts showExpectedProgress/ignoredPositions/readonlyProgress, src/stores/ganttDateStore.ts getAllDateInfos, TaskDataModal/TaskDataPopup formatters; (c) lazy on all seven useBarConfig memos. Record the numbers in this issue, apply only what measured better, and write the rule into CLAUDE.md (E7.1).",
  "Numbers for (a)/(b)/(c) recorded; the applied configuration is the measured winner; " + GATE + " green.",
  "Digest library critic CROSS '{ lazy: true } IS RECOMMENDED BY FOUR AUDITS BUT ONLY ONE STATES ITS SECOND EFFECT'.",
  ["E4.2"]),
 ("E4.6", "E4", "task", 1, "M",
  "E4.6 Diagnostics gate test (tests/diagnostics.gate.test.tsx)",
  "Turn the dev diagnostics into an automated gate. Use `DEV.diagnostics.capture()` from 'solid-js' (or, if the matchers load under Vitest 4.1, `@solidjs/diagnostics/vitest` + `captureArtifact` + `expect(artifact).toHaveNoDiagnostics()`), around: mountGantt with 50 tasks / 5 resources; a full drag gesture; expandTask/collapseTask on a summary task; options.viewMode switch; a custom-columns render. Assert no event with severity 'error' or 'warn' (allow NO_OWNER_EFFECT for unowned test stores; document any other allow-list entry with a reason). Register a helper `withDiagnostics(fn)` in tests/helpers.",
  "The test is green; temporarily reintroducing a write inside an effect compute (locally) makes it fail; the allow-list is empty or justified line by line.",
  "Reference: docs/migration/solid2/reference/08-dev-diagnostics.md (programmatic API) and node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md if the package is adopted.",
  ["E4.3", "E4.4"]),
 ("E4.7", "E4", "task", 1, "S",
  "E4.7 <For keyed={false}> pooling proof (tests/forPooling.test.tsx) + <Repeat> evaluation",
  "The pooled layers feed <For keyed={false}> SPARSE arrays (new Array(poolSize) with holes; useTaskVirtualization.ts:208/229) and rely on Index-style row reuse so Bar's document listeners survive a drag. Prove it: holes render as undefined rows; when the pooled array changes, row i is reused (same DOM node, no remount — track with a data attribute / mount counter); a drag in progress on a pooled bar survives a pool update. Then evaluate `<Repeat count={poolSize()}>` for TaskLayer and DateHeadersOptimized (store-backed positional pool; plain-index callback): record whether it is at parity and whether to adopt it (optional follow-up under E7.7).",
  "Test green in the client project; the Repeat verdict (adopt / defer) with numbers is recorded in this issue.",
  "Digest lib-virtualization STRUCT 'Pooling contract'; demo-experiments STRUCT on DateHeadersOptimized upperSlots identity churn; reference/v2/repeat-component.mdx.",
  ["E4.2"]),
 ("E4.8", "E4", "task", 1, "S",
  "E4.8 Public API delta record (CHANGELOG + docs/ARCHITECTURE.md)",
  "Record D13 in one place: GanttConfigStore setters are void-returning updater functions (ConfigSetter<T>); onResizeEnd(taskId, geom?) and onDateChange(taskId, dates, geom?) gained additive arguments; taskStore.patchTask / setTaskProgress / setBarYs / collapseAllTasks(ids?) and resourceStore.collapseAll(ids?) added; createTaskStore(initial?) if added; useGanttStores() still returns undefined outside a provider; ColumnDef.render is called inside a tracking scope and must be pure; TaskStore readers (getTask, getBarPosition, getAllTasks, taskCount, isTaskCollapsed) return committed state — read-after-write in one turn needs flush() (legal only in handlers/tests); peer runtime requirements (solid-js + @solidjs/web 2.0.0-rc.6, jsxImportSource '@solidjs/web'); packaging is ESM-only.",
  "CHANGELOG entry exists and ARCHITECTURE.md's public API section matches the code (spot-check three signatures).",
  "Digest library critic 'PUBLIC API CHANGES ARE SPREAD ACROSS bug ISSUES'.",
  ["E4.2"]),
 # ---------------- E5 ----------------
 ("E5.1", "E5", "task", 1, "M",
  "E5.1 Perf-harness semantics on 2.0: frame timing, splitEquals, closure-cache variants, unproxied dates",
  "Deferred writes push the scroll → signal → memo → DOM pipeline out of the RAF/scroll callback into the microtask flush, so every timing these harnesses record changes shape. Decide once (recommended): call flush() at the end of each harness RAF/interval tick (legal there) so DOM work stays inside the measured frame, and document it in docs/EXPERIMENTS.md. Resolve GanttExperiments.tsx:706/722 — the `{ equals: idsEqual }` object was silently swallowed as the initial value on 1.9, so 'splitEquals' never had custom equality; decide whether the experiment is 'custom equality' (keep) or 'ID staging without equality' (remove the option) and record it. Redesign or delete the closure-cache variants (:596-599 cachedVisibleTasks, :652-698 smartCache — mutable state inside memo computes, incompatible with lazy memos) and the index-test probes not already handled in E4.3. GanttMinimalTest.tsx:121: store dates as epoch numbers (unproxied Date note).",
  "experiments.html, index-test.html, minimal-test.html, perf.html, profiler.html run their stress modes with zero diagnostics; EXPERIMENTS.md states the timing decision; " + GATE + " green.",
  "Digest demo-experiments STRUCT 1-4; entry-index-test STRUCT 1-2; demo-perf-profiler STRUCT 1-2.",
  ["E3.2", "E4.3"]),
 ("E5.2", "E5", "task", 2, "S",
  "E5.2 Feature/main demo hygiene + strip @ts-nocheck from component/feature demos (D8)",
  "src/demo/CriticalPathDemo.tsx:112 read-modify-write toggle → `setCriticalPath(v => !v)`; :135 inline accessor inside the options object literal → per-key getter like FilterSearchDemo.tsx:189-194; src/demo/FilterSearchDemo.tsx:105 predicate → createMemo so options.filter identity is stable; verify CustomColumnsDemo.tsx renders under the new jsxImportSource. Strip // @ts-nocheck from ArrowDemo, BarDemo, BoxSelectDemo, MultiSelectDemo, CriticalPathDemo, FilterSearchDemo, ExportDemo, CustomColumnsDemo, Gantt*Demo and fix the fallout (perf harnesses keep it).",
  "pnpm typecheck passes with the pragmas removed; the listed pages load and interact with zero diagnostics; " + GATE + " green.",
  "Digest demo-features summary items (3)-(5); demo-main; decision D8.",
  ["E4.2"]),
 ("E5.3", "E5", "chore", 1, "M",
  "E5.3 Execute the 21-page demo smoke matrix with the dev console open; record results",
  "pnpm dev (and pnpm dev:server for db.html); open each page with DevTools console visible (optionally capture with chrome-devtools-cli) and tick: index.html (links resolve) · gantt.html (3+ bars on first paint at correct dates; drag/resize/progress log final geometry in onDateChange; view-mode switch re-lays out; keyboard move/resize) · subtask.html + resource-groups.html (expand/collapse, summary drag moves children) · showcase.html (every input reflects immediately; presets; locked toggles invert drag behaviour; arrows) · constraint.html (cascade) · bar.html · arrow.html · box-select.html (rect selects) · multi-select.html (bulk drag) · export.html (svg + png download) · filter-search.html · critical-path.html (toggle) · custom-columns.html (cells update on data change) · db.html (drag PATCH persists exact dates; reload matches; add/edit/delete task, resource, blocked time) · perf.html (10K scroll, drag mid-scroll) · perf-isolate.html (each ?bar= variant incl. dragconst) · experiments.html · index-test.html · minimal-test.html · profiler.html. Zero Solid error/warn diagnostics on every page.",
  "The matrix with per-page results is pasted into this issue; every row passes; any failure spawned a fix issue before this closes.",
  "Digest tooling-docs / demo batches; " + PLAN + " E5.3.",
  ["E5.1", "E5.2", "E4.6", "E4.7", "E4.1"]),
 # ---------------- E6 ----------------
 ("E6.1", "E6", "chore", 2, "M",
  "E6.1 Performance re-baseline on rc.6 against a fresh build:demo",
  "`pnpm build:demo && npx serve dist-demo -l 5174 &` then benchmarks/scripts/run-comprehensive.sh, run-virt.sh, run-virt-comprehensive.sh (they drive perf.mjs at http://localhost:5174/examples/experiments?variant=..&virt=..&test=..) plus perf.mjs on examples/perf. Date-stamp every existing results table as 'measured on solid-js 1.9.12' (docs/PERFORMANCE.md:13-20, 292-300, 385-393, 524-529; docs/DEMOS.md:121-126, 130-140, 202-208; docs/EXPERIMENTS.md:33-44; benchmarks/traces/ANALYSIS.md:9-16, 178-254) and append rc.6 tables; next to the 'Index-based headers are slower' finding (ANALYSIS.md:110/:300, DEMOS.md:76) note that the harness now measures <For keyed={false}> and deferred DOM writes.",
  "benchmarks/traces/runs contains fresh bench-*.json for the three scripts; docs tables date-stamped and extended; " + GATE + " green.",
  "Digest tooling critic CROSS 'THE 1.9 PERFORMANCE CORPUS AND THE COMMITTED ARTIFACTS ARE ONE DELIVERABLE'. Remember the `serve` URL rule in CLAUDE.md (no .html extension).",
  ["E5.3", "E4.5"]),
 ("E6.2", "E6", "chore", 1, "S",
  "E6.2 chore(demo): refresh built artifacts (dist-demo on solid-js 2.0)",
  "Final code commit of the branch: `pnpm build:demo`, `git add -A dist-demo`, remove the stale hash-named chunks the build no longer emits (see bd memory 'when-checked-in-build-artifacts-dist-demo-aren'), commit exactly 'chore(demo): refresh built artifacts' with nothing else staged (convention: 20bd2e6, 2e9d8bd, 4a0633e).",
  "The commit touches only dist-demo/; `npx serve dist-demo -l 5174` serves pages built on rc.6 (grep the chunk for '@solidjs/web' runtime markers or the absence of the 1.9 runtime).",
  "Decision D12.",
  ["E6.1"]),
 # ---------------- E7 ----------------
 ("E7.1", "E7", "task", 1, "M",
  "E7.1 CLAUDE.md + AGENTS.md final pass: promote the rulebook, fix drift, document test posture and diagnostics gate",
  "Promote the E0.2 section from 'in progress' to the house rules; add the memo-laziness rule from E4.5 and the sanctioned flush sites; document the Vitest projects, settle()/flush(), the createRoot signal/store rule, mountGantt and the diagnostics gate; fix pre-existing drift: CLAUDE.md lines naming .js/.jsx files that are .ts/.tsx (96-99, 105-113, 116-126, 143, 154-156, 188-191), 'Only one test file exists' (:50), the `perf-traces/` links (should be benchmarks/traces/), DateHeadersOptimized path (src/demo), the taskStore 'createStore({}) instead of createSignal(Map)' note (still true; add the leaf-mutation rule), the DB-demo drag-PATCH paragraph (now consumes the geometry payload). Mirror the rules verbatim into AGENTS.md.",
  "Both files read correctly against the migrated code; `git grep -nE 'solid-js/(web|store)|<Index|\\bonMount\\b|produce\\(' CLAUDE.md AGENTS.md` empty; pnpm prettier-check green.",
  "Digest tooling-docs STRUCT 'PRE-EXISTING DOC/CODE DRIFT'.",
  ["E5.3", "E4.5"]),
 ("E7.2", "E7", "task", 1, "S",
  "E7.2 README: install section, contracts, timing note, packaging",
  "README.md has no install section: add `pnpm add ganttss solid-js@2.0.0-rc.6 @solidjs/web@2.0.0-rc.6`, the tsconfig `jsxImportSource: '@solidjs/web'` requirement, and a resolve.dedupe note (both runtimes must be the host app's instance). Keep :106 (useGanttStores returns undefined outside a provider — still true); rewrite :108 (config setters are void updaters; readers return committed state until the microtask flush); document the additive onDateChange/onResizeEnd geometry arguments and that the package is ESM-only (D3).",
  "README matches E4.8's API delta; a new user following the README can mount <Gantt> on Solid 2.0.",
  "Digest tooling critic MISSED README.md:5; D3/D4.",
  ["E4.8"]),
 ("E7.3", "E7", "task", 2, "M",
  "E7.3 docs/* sweep for Solid 2.0",
  "docs/ARCHITECTURE.md: rewrite the ganttConfigStore section (:398-431 — it still documents 21 signals; now a store with draft setters, expandedTasks signal, updateOptions single draft, getConfig committed snapshot; rename the local `snapshot` example since snapshot is a solid-js export), :365 updateTasks via reconcile(v, 'id'), :379 Set inventory (safe signal-held vs the fixed store-held one), :67 provider. docs/PERFORMANCE.md:407 'wrap position updates in untrack()' → the split-effect pattern (untrack does not permit writes in 2.0); :421 untrack sample → note that untrack around a proxy lookup leaves leaf reads tracked. docs/MINIMAL_TEST.md:54/76 Index → For keyed={false}. docs/DATABASE.md:136-145 drag-PATCH algorithm (geometry payload; :17 names a vite.config.ts that does not exist). docs/DEMOS.md, docs/EXPERIMENTS.md (timing decision from E5.1), docs/RFC-undo-redo.md:57-118 (provider API claims re-checked), docs/AUDIT.md references, benchmarks/traces/ANALYSIS.md:300 path.",
  "`git grep -nE 'solid-js/(web|store)|<Index|\\bonMount\\b|produce\\(|Context\\.Provider|untrack\\(\\(\\) => .*update' docs README.md` returns only dated history lines and docs/migration/solid2/; pnpm prettier-check green.",
  "Digest tooling-docs summary + critic MISSED docs items.",
  ["E6.1", "E4.8"]),
 ("E7.4", "E7", "chore", 2, "S",
  "E7.4 bd memory rewrite for the 2.0 store model",
  "`bd forget solidjs-createstore-produce-state-id-newobj-never-wrap` (it prescribes the 1.x object-replacement hack) and `bd remember` the 2.0 rule: leaf-mutate inside the draft (task._bar.x = v); never replace the task object (invalidates every leaf per mousemove); a memo returning a store sub-proxy never invalidates in 2.0 either, so bindings read their own leaf (Bar.tsx pattern); removeTask uses delete draft[id]; built-ins inside a store are replace-only. Finalize the E0.2 rulebook memory (remove 'in progress').",
  "`bd memories solid` shows the rewritten entries and no reference to produce.",
  "",
  ["E4.2"]),
 ("E7.5", "E7", "chore", 1, "S",
  "E7.5 Merge solid-2 into main (merge commit) after the end-of-migration gate",
  "End-of-migration gate on the branch: clean `pnpm install` on Node 22; " + GATE + "; both Vitest projects green including gantt.mount, drag, ganttDateStore, ganttConfigStore, useTaskVirtualization, arrowLayerBatched, forPooling and diagnostics.gate; dist/ganttss.es.js externalizes both runtimes; smoke matrix (E5.3) passed; bench scripts completed against the refreshed dist-demo; `git grep` sweeps for removed APIs return nothing outside dated docs and docs/migration/solid2/. Then `git merge --no-ff solid-2` into main, push, keep the branch until E7.6.",
  "main contains the migration with per-issue commits preserved; the gate output is pasted into this issue.",
  "Decision D2.",
  ["E6.2", "E7.1", "E7.2", "E7.3", "E7.4"]),
 ("E7.6", "E7", "task", 2, "S",
  "E7.6 Follow-up: re-bump to the newest Solid 2.0 RC / stable and relax pins",
  "When a newer solid-js / @solidjs/web / @solidjs/vite-plugin / @solid-primitives/raf (/ @solidjs/diagnostics) set is published: bump all together (one commit), read the RC changelog for guard/API changes (rc-to-rc changes have altered write-guard semantics before), re-run the E7.5 gate + smoke matrix + bench scripts, refresh dist-demo, and only at 2.0.0 stable relax solid-js/@solidjs/web to caret ranges and decide peerDependencies (E7.7). Check the `next` dist-tags rather than `latest` (they lag).",
  "Versions bumped together; full gate green; pins relaxed only at stable.",
  "Decision D1.",
  ["E7.5"]),
 ("E7.7", "E7", "decision", 3, "S",
  "E7.7 Optional modernizations — each becomes its own issue only when wanted",
  "Not required by the migration; listed so they are visible and never folded into a required issue: (a) peerDependencies for solid-js/@solidjs/web + devDependencies mirror (D4); (b) a self-contained IIFE bundle for global-script consumers (D3); (c) `<Repeat count from>` for the TaskLayer/DateHeaders pools if E4.7 measured parity; (d) rowLayouts as the y source of truth (delete the y-sync effect; useBoxSelect/svgExport consult the layout map) (D10); (e) DbDemo on action()/createOptimisticStore/refresh (D9); (f) gitignore dist-demo and require a local build for the bench scripts (D12); (g) Vitest browser mode (Playwright) for drag tests if jsdom stubs prove brittle; (h) normalize the 11 examples/*.html .jsx entry URLs to .tsx; (i) remove @ts-nocheck from the perf harnesses; (j) add the diagnostics gate to CI on pull requests.",
  "Each item either has its own bd issue or an explicit 'not doing' note here.",
  "",
  ["E7.5"]),
]

def main():
    m = json.load(open(MAP)) if os.path.exists(MAP) else {}
    def save():
        if not DRY:
            json.dump(m, open(MAP, "w"), indent=1, sort_keys=True)
    # epics
    for key, prio, title, desc in EPICS:
        if key in m:
            continue
        if desc is None:
            print("missing pre-created epic", key, file=sys.stderr); sys.exit(1)
        m[key] = bd("create", "--silent", "--type=epic", f"--priority={prio}", "-l", LABEL,
                    "--title", title, "--description", desc)
        save(); print("epic", key, "->", m[key])
    # children
    for key, epic, typ, prio, effort, title, desc, acc, design, deps in ISSUES:
        if key in m:
            continue
        notes = f"Plan key {key} · effort {effort} · plan: {PLAN} · audit: {DIG1}, {DIG2} · label solid2"
        args = ["create", "--silent", f"--type={typ}", f"--priority={prio}", "-l", LABEL,
                "--parent", m[epic], "--title", title, "--description", desc,
                "--acceptance", acc, "--notes", notes]
        if design:
            args += ["--design", design]
        m[key] = bd(*args); save(); print("issue", key, "->", m[key])
    # dependencies: child -> prerequisite (bd forbids epic->task edges; children are
    # attached via --parent), plus epic -> previous epic for the high-level order.
    edges = []
    for key, epic, *_rest in ISSUES:
        deps = _rest[-1]
        for d in deps:
            edges.append((m[key], m[d]))
    order = [e[0] for e in EPICS]
    for prev, nxt in zip(order, order[1:]):
        edges.append((m[nxt], m[prev]))
    done_key = "__deps_done__"
    if not m.get(done_key):
        ok = 0
        for a, b in edges:
            r = subprocess.run(["bd", "dep", "add", a, b], capture_output=True, text=True) if not DRY else None
            if r is None or r.returncode == 0:
                ok += 1
            elif "already" not in (r.stderr + r.stdout).lower():
                print("dep add failed:", a, b, (r.stderr or r.stdout).strip()[-200:], file=sys.stderr)
        m[done_key] = True; save()
        print("wired", ok, "of", len(edges), "dependencies")
    print(json.dumps({k: v for k, v in m.items() if not k.startswith("__")}, indent=1, sort_keys=True))

if __name__ == "__main__":
    main()
