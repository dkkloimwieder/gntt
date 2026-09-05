/**
 * `<ArrowLayerBatched>`'s dependency protocol — rewritten by E2.13
 * (`gantt-b4m.13`) from the E1.7 characterization it replaces, then trimmed by
 * E4.4 (`gantt-avv.4`), which deleted the `positionVersion` prop and
 * `GanttPerfIsolate`'s `triggerArrowUpdate` counter outright. Nothing here
 * passes a counter any more, because there is no counter to pass.
 *
 * WHERE THIS COMPONENT IS ACTUALLY MOUNTED (checked, not inherited from the
 * issue text). `rg ArrowLayerBatched src examples` finds exactly one live
 * mount: `GanttPerfIsolate.tsx:22/:2017`. `examples/arrow.html` does NOT mount
 * it — `src/entries/arrow.tsx` → `ArrowDemo.tsx:4` imports `Arrow` — and
 * `GanttMinimalTest.tsx:19` is a commented-out import. The shipped `<Gantt>`
 * renders no arrow layer at all.
 *
 * WHAT E1.7 PINNED, AND WHY IT HAD TO CHANGE. The component used to `untrack`
 * every position read and `void` a `positionVersion` prop as its only declared
 * position dependency, so it subscribed to no position at all. It repainted
 * anyway, for a reason it did not own: `spatialIndex` also calls `taskCount()`
 * (`:128-131`), a NON-untracked `Object.keys(store.tasks)` whose `ownKeys` trap
 * calls `trackSelf`, subscribing the memo to the store ROOT's `$SELF` node —
 * and `updateBarPosition` used to replace the whole task object at a root key
 * inside `produce`, which fired `$SELF`. E2.3 (`gantt-b4m.3`) turned that
 * write into a leaf mutation (`t._bar[k] = v`), which fires `_bar` and never
 * the root — so the old component's arrows would have silently frozen.
 *
 * WHAT THIS SUITE PINS NOW. The reads at `:168-169` are tracked, so whatever
 * `getBarPosition` touches — store leaves, or a scale SIGNAL, the shape the one
 * real mount uses (`GanttPerfIsolate.tsx:1546-1557`: `x: task.startHours *
 * hourWidth()`) — is a real dependency of `spatialIndex`. Every case below is
 * therefore written against the LEAF write shape, so it says the same thing
 * before and after E2.3 landed:
 *
 *   1-2  arrows appear over the real `taskStore` with no manual invalidation
 *        of any kind.
 *   3    the production `taskStore.updateBarPosition` repaints — the only
 *        executed coupling between the shipped mutator and this component.
 *        Was green under object replacement and stayed green under E2.3's
 *        leaf write.
 *   4    the mechanism, measured: a `getBarPosition`-shaped computation re-runs
 *        for the leaf write — through the production mutator and through a
 *        bare `_bar.x` mutation alike — while a `taskCount()`-shaped one
 *        re-runs for neither. The component subscribes to the former.
 *   5    the acceptance probe: a bare `s.t1._bar.x = …` leaf mutation re-runs
 *        `spatialIndex` (counted through the store's reader) and moves the
 *        rendered path.
 *   6    a SIGNAL-derived position change repaints with no store write and no
 *        counter — the viewport-rescale half of the old `untrack`, and the
 *        exact path `GanttPerfIsolate`'s deleted `onMeasure` bump covered.
 *   7    the per-arrow path cache and the visible-set diff are per-instance:
 *        a second mount over a second store cannot hand the first one its
 *        paths.
 *   8    what is LEFT of `taskCount()`: a root key no relationship names still
 *        rebuilds the index. Added in review round 2 — without it, stubbing
 *        `taskCount()` to a constant leaves the suite green.
 *   9    the reuse short-circuit: an unchanged visible set returns `prev` by
 *        identity, so the `<For>` row is not re-created. Also round 2 — the
 *        reviewer measured that disabling reuse entirely was invisible here.
 *
 * DELETED BY E4.4: the case that pinned `positionVersion` as inert (bumping it
 * re-read nothing and repainted nothing). It existed to make the prop's removal
 * a decision rather than an accident; the prop is gone, so it is too.
 *
 * MANDATORY PROP: finite `endRow`. `endRow()` defaults to `Infinity` (`:120`)
 * and `batchedPaths` loops `for (let row = sr - 3; row <= er + 3; row++)`
 * (`:215`), which never terminates once there are relationships and positioned
 * tasks. Every mount below passes an explicit viewport.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createEffect, createRoot, createSignal, createStore } from 'solid-js';
import { render } from '@solidjs/web';
import { ArrowLayerBatched } from '../src/components/ArrowLayerBatched';
import { createTaskStore, type TaskStore } from '../src/stores/taskStore';
import { settle } from './helpers/settle';
import type {
    BarPosition,
    NormalizedConstraints,
    ProcessedTask,
    Relationship,
} from '../src/types';

// Minimal valid ProcessedTask — same builder as tests/taskStore.test.ts.
function makeTask(
    id: string,
    overrides: Partial<ProcessedTask> = {},
): ProcessedTask {
    const constraints: NormalizedConstraints = { locked: false };
    return {
        id,
        name: `task ${id}`,
        start: '2025-01-01 08:00',
        end: '2025-01-01 16:00',
        _start: new Date('2025-01-01T08:00:00'),
        _end: new Date('2025-01-01T16:00:00'),
        _index: 0,
        _resourceIndex: 0,
        _isHidden: false,
        _children: [],
        _depth: 0,
        _bar: { x: 0, y: 0, width: 100, height: 30 },
        dependencies: [],
        constraints,
        ...overrides,
    };
}

const FROM_BAR: BarPosition = { x: 100, y: 0, width: 80, height: 30 };
const TO_BAR: BarPosition = { x: 400, y: 38, width: 80, height: 30 };
const MOVED_X = 200;
const SHIFT = 100;

/**
 * Expected path strings, derived by hand from the fixture geometry so the
 * assertions do not merely re-run `generateArrow` against itself.
 *
 * `rowHeight()` is 38 (`ArrowLayerBatched.tsx:121`), so `t1` sits on row 0 and
 * `t2` on row 1 — 38px apart, past `ALIGNMENT_THRESHOLD` (8), so the FS start
 * anchor is 'bottom' and the end anchor 'left' (`arrowBatchPaths.ts:41-57`).
 *   start offset  = clamp(0.1, 0.9, (to.x - curve - from.x) / from.width) = 0.9
 *   start point   = (from.x + 0.9 * 80, from.y + 30) = (172, 30) | (272, 30)
 *   end point     = (to.x, to.y + 0.5 * 30)          = (400, 53) | (500, 53)
 *   vertical start → L-shape `M<sx>,<sy>V<ey>H<ex>`  (`generateLinePath`)
 *   'left' head, size 5 → `M<ex-5>,<ey-5>L<ex>,<ey>L<ex-5>,<ey+5>`
 *
 * `*_SHIFTED` is the same pair with SHIFT (100) added to every x — the shape a
 * viewport rescale produces in test 6, where `to` moves as well.
 */
const LINE_FROM_100 = 'M172,30V53H400';
const LINE_FROM_200 = 'M272,30V53H400';
const HEAD = 'M395,48L400,53L395,58';
const LINE_SHIFTED = 'M272,30V53H500';
const HEAD_SHIFTED = 'M495,48L500,53L495,58';

const RELATIONSHIPS: Relationship[] = [
    { from: 't1', to: 't2', type: 'FS', lag: 0 },
];

const seedTasks = (fromX = FROM_BAR.x): ProcessedTask[] => [
    makeTask('t1', { _bar: { ...FROM_BAR, x: fromX } }),
    makeTask('t2', { _bar: { ...TO_BAR }, _index: 1 }),
];

interface MountedLayer {
    /** Both batched paths, in render order: [lines, heads] per style group. */
    paths: () => SVGPathElement[];
    /** `d` of the lines path of the single style group, or null if unrendered. */
    lines: () => string | null;
    /** `d` of the heads path of the single style group, or null if unrendered. */
    heads: () => string | null;
    dispose: () => void;
}

interface MountOptions {
    taskStore: TaskStore;
    relationships: Relationship[];
    /** Reactive right edge; omitted = a constant 5000. Read by `batchedPaths` only. */
    endX?: () => number;
}

/** Every layer mounted by a test, disposed in `afterEach` (test 7 mounts two). */
const openLayers: MountedLayer[] = [];

function mountLayer(options: MountOptions): MountedLayer {
    const host = document.body.appendChild(document.createElement('div'));
    const disposeRoot = render(
        () => (
            <svg>
                <ArrowLayerBatched
                    taskStore={options.taskStore}
                    relationships={options.relationships}
                    startRow={0}
                    endRow={10}
                    startX={0}
                    endX={options.endX?.() ?? 5000}
                />
            </svg>
        ),
        host,
    );
    const paths = (): SVGPathElement[] =>
        Array.from(host.querySelectorAll('path'));
    const layer: MountedLayer = {
        paths,
        lines: () => paths()[0]?.getAttribute('d') ?? null,
        heads: () => paths()[1]?.getAttribute('d') ?? null,
        dispose: () => {
            disposeRoot();
            host.remove();
        },
    };
    openLayers.push(layer);
    return layer;
}

/**
 * A `TaskStore` backed by a local `createStore`, offering the bar move as the
 * LEAF mutation E2.3 (`gantt-b4m.3`) rewrote `updateBarPosition` into
 * (`taskStore.ts:116-123`: `task._bar[key] = v` inside the draft). The write
 * lands on the `_bar` node; the root `$SELF` stays silent — which is precisely
 * why the component has to subscribe to the leaf.
 *
 * The production mutator is not re-implemented here: the cases that want it
 * call `taskStore.updateBarPosition` directly (tests 3 and 4), so there is no
 * copy of a production body in this file to rot.
 *
 * `barPositionReads` counts `getBarPosition` calls, i.e. `spatialIndex` runs
 * that got past the `taskCount() === 0` bail — two calls per run per
 * relationship. That is how tests 5 and 8 observe memo invalidation instead of
 * inferring it from the DOM.
 *
 * Only `tasks`, `getTask` and `getBarPosition` are wired to the local store;
 * the spread supplies the rest of the `TaskStore` interface, none of which
 * `<ArrowLayerBatched>` touches.
 */
interface ProbeStore {
    store: TaskStore;
    mutateTaskBarX: (id: string, x: number) => void;
    /**
     * Add a task at a NEW root key. `setProperty` notifies that key's node and
     * the store root's `$SELF`; when the key is one no relationship mentions,
     * `$SELF` is the only edge that can reach `spatialIndex` — which is what
     * test 8 uses to isolate `taskCount()`.
     */
    addTask: (task: ProcessedTask) => void;
    barPositionReads: () => number;
}

function createProbeStore(tasks: ProcessedTask[]): ProbeStore {
    const seed: Record<string, ProcessedTask | undefined> = {};
    for (const task of tasks) seed[task.id] = task;
    const [state, setState] =
        createStore<Record<string, ProcessedTask | undefined>>(seed);
    let reads = 0;

    const store: TaskStore = {
        ...createTaskStore(),
        tasks: state,
        getTask: (id) => state[id],
        getBarPosition: (id) => {
            reads++;
            const task = state[id];
            if (!task || !task._bar) return null;
            return {
                x: task._bar.x,
                y: task._bar.y,
                width: task._bar.width,
                height: task._bar.height,
                index: task._index,
            };
        },
    };

    const mutateTaskBarX = (id: string, x: number): void => {
        setState((draft) => {
            const task = draft[id];
            if (task?._bar) task._bar.x = x;
        });
    };

    const addTask = (task: ProcessedTask): void => {
        setState((draft) => {
            draft[task.id] = task;
        });
    };

    return { store, mutateTaskBarX, addTask, barPositionReads: () => reads };
}

/**
 * A `TaskStore` whose bar positions are derived from a SIGNAL and never
 * written to the store at all — the shape of the only real mount
 * (`GanttPerfIsolate.tsx:1546-1557`: `x: task.startHours * hourWidth()`).
 * `setShift` is the analogue of a viewport resize. No store write happens
 * anywhere here, so the store-root edge cannot rescue this case: only a
 * tracked read of `getBarPosition` can.
 */
interface ShiftProbeStore {
    store: TaskStore;
    shift: () => number;
    setShift: (px: number) => void;
}

function createShiftProbeStore(tasks: ProcessedTask[]): ShiftProbeStore {
    const seed: Record<string, ProcessedTask | undefined> = {};
    for (const task of tasks) seed[task.id] = task;
    const [state] =
        createStore<Record<string, ProcessedTask | undefined>>(seed);
    const [shift, setShift] = createSignal(0);

    const store: TaskStore = {
        ...createTaskStore(),
        tasks: state,
        getTask: (id) => state[id],
        getBarPosition: (id) => {
            const task = state[id];
            if (!task || !task._bar) return null;
            return {
                x: task._bar.x + shift(),
                y: task._bar.y,
                width: task._bar.width,
                height: task._bar.height,
                index: task._index,
            };
        },
    };

    return { store, shift, setShift: (px) => setShift(px) };
}

/**
 * Re-runs of a computation shaped like one of the component's two reads,
 * across `write()`. `read` is either `() => store.getBarPosition(id)` (the
 * tracked position read at `ArrowLayerBatched.tsx:168-169`) or
 * `() => Object.keys(store.tasks).length` (`taskCount()`, `:131-134`).
 */
function countReruns(read: () => unknown, write: () => void): number {
    let runs = 0;
    const dispose = createRoot((disposeRoot) => {
        createEffect(
            () => {
                read();
                runs++;
            },
            () => {},
        );
        return disposeRoot;
    });
    const before = runs;
    write();
    settle();
    const after = runs;
    dispose();
    return after - before;
}

afterEach(() => {
    while (openLayers.length > 0) openLayers.pop()!.dispose();
});

describe('ArrowLayerBatched — arrows appear without the manual protocol', () => {
    it('renders both batched paths for a store populated before mount', () => {
        const taskStore = createTaskStore();
        taskStore.updateTasks(seedTasks());
        settle();

        const layer = mountLayer({ taskStore, relationships: RELATIONSHIPS });

        // One style group ('' dasharray, '' stroke) ⇒ exactly two <path>s.
        expect(layer.paths()).toHaveLength(2);
        expect(layer.lines()).toBe(LINE_FROM_100);
        expect(layer.heads()).toBe(HEAD);
    });

    it('picks up tasks written after mount, with no manual invalidation', () => {
        const taskStore = createTaskStore();
        const layer = mountLayer({ taskStore, relationships: RELATIONSHIPS });

        // tc === 0 ⇒ spatialIndex returns `empty()` (:149-157) and batchedPaths
        // bails at `positions.size === 0` (:205) — but taskCount() has already
        // subscribed to the store root, so the load below invalidates it.
        expect(layer.paths()).toHaveLength(0);

        taskStore.updateTasks(seedTasks());
        settle();

        expect(layer.paths()).toHaveLength(2);
        expect(layer.lines()).toBe(LINE_FROM_100);
        expect(layer.heads()).toBe(HEAD);
    });
});

describe('ArrowLayerBatched — what actually invalidates the spatial index', () => {
    /**
     * The only executed coupling between the shipped store's mutator and this
     * component, and the case that ORDER protected: E2.13 landed before E2.3
     * so this stayed green across the store rewrite.
     *
     * It was green under both write shapes for the same reason — the memo
     * subscribes to `_bar.x` through `getBarPosition`. Object replacement
     * notified the task node, the leaf mutation E2.3 shipped notifies the
     * `_bar.x` node, and the memo is subscribed to both. Nothing invalidates
     * the layer by hand.
     */
    it('updateBarPosition repaints the arrow with no manual invalidation', () => {
        const taskStore = createTaskStore();
        taskStore.updateTasks(seedTasks());
        settle();

        const layer = mountLayer({ taskStore, relationships: RELATIONSHIPS });
        expect(layer.lines()).toBe(LINE_FROM_100);

        taskStore.updateBarPosition('t1', { x: MOVED_X });
        settle();

        // The write landed in the store ...
        expect(taskStore.getBarPosition('t1')?.x).toBe(MOVED_X);
        // ... and the rendered path followed it.
        expect(layer.lines()).toBe(LINE_FROM_200);
        expect(layer.heads()).toBe(HEAD);
    });

    /**
     * The mechanism behind test 3, as an executed measurement rather than a
     * claim in a comment. Both of the component's reads are exercised against
     * the leaf write, reached two ways:
     *
     *   getBarPosition-shaped ← production updateBarPosition   → 1 re-run
     *   getBarPosition-shaped ← bare `_bar.x` leaf mutation    → 1 re-run
     *   taskCount-shaped      ← bare `_bar.x` leaf mutation    → 0 re-runs
     *
     * The first two are what made test 3 survive E2.3; the third is the edge
     * the component used to ride on, measured as absent for a leaf write.
     * The production store's root-notification count is deliberately NOT
     * asserted: it was 1 before E2.3 and is 0 now, and nothing here depends
     * on it.
     */
    it('the position read re-runs for a leaf write; taskCount does not', () => {
        const taskStore = createTaskStore();
        taskStore.updateTasks(seedTasks());
        settle();

        const productionRuns = countReruns(
            () => taskStore.getBarPosition('t1'),
            () => taskStore.updateBarPosition('t1', { x: MOVED_X }),
        );
        expect(productionRuns).toBe(1);
        expect(taskStore.getBarPosition('t1')?.x).toBe(MOVED_X);

        const probe = createProbeStore(seedTasks());
        const leafRuns = countReruns(
            () => probe.store.getBarPosition('t1'),
            () => probe.mutateTaskBarX('t1', MOVED_X),
        );
        expect(leafRuns).toBe(1);
        // Same destination, so the two writes really are the same move.
        expect(probe.store.getBarPosition('t1')?.x).toBe(MOVED_X);

        const rootProbe = createProbeStore(seedTasks());
        const rootRuns = countReruns(
            () => Object.keys(rootProbe.store.tasks).length,
            () => rootProbe.mutateTaskBarX('t1', MOVED_X),
        );
        expect(rootRuns).toBe(0);
    });

    /**
     * E2.13's acceptance probe. A bare leaf mutation of `t1._bar.x` — the write
     * shape E2.3 gave `updateBarPosition`, with nothing else touched — must
     * re-run `spatialIndex` and move the rendered path, with nothing
     * invalidating the layer by hand.
     *
     * The re-run is counted, not inferred: `barPositionReads()` only advances
     * inside `spatialIndex`, two reads per run for this one relationship.
     */
    it('a bare leaf mutation of _bar.x re-runs the index and repaints', () => {
        const probe = createProbeStore(seedTasks());
        const layer = mountLayer({
            taskStore: probe.store,
            relationships: RELATIONSHIPS,
        });
        expect(layer.lines()).toBe(LINE_FROM_100);

        const readsBefore = probe.barPositionReads();
        expect(readsBefore).toBeGreaterThan(0);

        probe.mutateTaskBarX('t1', MOVED_X);
        settle();

        // The memo re-ran, re-reading both endpoints. Counted before the
        // store readback below, which goes through the same counter.
        expect(probe.barPositionReads()).toBe(readsBefore + 2);
        // The store moved the bar ...
        expect(probe.store.getBarPosition('t1')?.x).toBe(MOVED_X);
        // ... and the render followed.
        expect(layer.lines()).toBe(LINE_FROM_200);
        expect(layer.heads()).toBe(HEAD);
    });

    /**
     * The other half of the old `untrack`, and the half the only real mount
     * actually depends on: positions derived from a SIGNAL, with no store write
     * anywhere. GanttPerfIsolate computes `x: task.startHours * hourWidth()`
     * (`:1556-1563`), so a viewport resize used to go stale for the same reason
     * a leaf mutation did — and the store-root accident could never have
     * rescued it, because nothing writes the store. The tracked read picks it
     * up with no counter in sight.
     */
    it('a signal-derived position change repaints with no counter', () => {
        const probe = createShiftProbeStore(seedTasks());
        const layer = mountLayer({
            taskStore: probe.store,
            relationships: RELATIONSHIPS,
        });
        expect(layer.lines()).toBe(LINE_FROM_100);

        probe.setShift(SHIFT);
        settle();

        // Both bars moved as far as the store is concerned ...
        expect(probe.store.getBarPosition('t1')?.x).toBe(FROM_BAR.x + SHIFT);
        expect(probe.store.getBarPosition('t2')?.x).toBe(TO_BAR.x + SHIFT);
        // ... and the render followed the rescale.
        expect(layer.lines()).toBe(LINE_SHIFTED);
        expect(layer.heads()).toBe(HEAD_SHIFTED);
    });

    /**
     * What is LEFT of `taskCount()` (`ArrowLayerBatched.tsx:128-131`) once the
     * position reads are tracked — measured, because the answer is "almost
     * nothing" and the E2.13 review caught that no case here could see it.
     *
     * `taskCount()` is a non-untracked `Object.keys(store.tasks)`; the `ownKeys`
     * trap calls `trackSelf`, subscribing `spatialIndex` to the store ROOT's
     * `$SELF` node. Every other root-key event now reaches the memo without it:
     * a tracked `state[id]` read subscribes to that key even when the key is
     * MISSING (solid-js 1.9 `store.ts` `get` trap: no existing node + a listener
     * ⇒ `getDataNode(nodes, property, value)()`), which is why test 2's
     * empty-store-then-load case, and any add/remove of a task a relationship
     * NAMES, stay green with `taskCount()` stubbed to a constant.
     *
     * The one edge only `$SELF` still carries is a root key this layer never
     * looks at. Its rendered output is identical — the drawn positions did not
     * move — so this case pins the MECHANISM (`getBarPosition` re-read ⇒ the
     * index really was rebuilt) and not a pixel. That is deliberate: without it,
     * replacing `taskCount()`'s body with `const taskCount = () => 1;` leaves
     * the whole suite green, and E4.4 would delete a live subscription blind.
     *
     * E4.4 (bd gantt-avv.4) kept `taskCount()`, so this case stays. If a
     * later change deletes `taskCount()`, delete this test in the same
     * commit — it exists to make that deletion a decision, not an accident.
     */
    it('adding a task no relationship references still rebuilds the index', () => {
        const probe = createProbeStore(seedTasks());
        const layer = mountLayer({
            taskStore: probe.store,
            relationships: RELATIONSHIPS,
        });
        expect(layer.lines()).toBe(LINE_FROM_100);

        const readsBefore = probe.barPositionReads();
        expect(readsBefore).toBe(2);

        // t3 is in no relationship, so nothing this memo READS changes; only
        // the store root's key set does.
        probe.addTask(makeTask('t3', { _index: 2 }));
        settle();

        // The index rebuilt anyway: both endpoints were re-read.
        expect(probe.barPositionReads()).toBe(readsBefore + 2);
        // And it rebuilt to the same drawing, because nothing drawn moved.
        expect(layer.lines()).toBe(LINE_FROM_100);
        expect(layer.heads()).toBe(HEAD);
    });
});

describe('ArrowLayerBatched — the visible-set reuse short-circuit', () => {
    /**
     * `batchedPaths` returns its previous value BY IDENTITY when the index
     * generation and the visible set are both unchanged (`:240-247`), so a
     * scroll tick that reveals no new arrow leaves `createMemo`'s value equal
     * by `===`, the `<For>` never re-runs, and the two `<path>` nodes are never
     * torn down. That is the short-circuit main got from its module-level
     * `cachedResult`, and the E2.13 review measured that nothing pinned it:
     * `const reusable = undefined` (never reuse) left the suite green.
     *
     * DOM node identity is the observable, because it is the thing the reuse
     * exists to buy. The second half is the control: a viewport change that
     * DOES churn the visible set tears the row down and builds a new one, so
     * `toBe(linesNode)` above is discriminating and not merely true of a
     * component that never re-renders at all.
     */
    it('an unchanged visible set keeps the same <path> nodes; a changed one does not', () => {
        const probe = createProbeStore(seedTasks());
        const [endX, setEndX] = createSignal(5000);
        const layer = mountLayer({
            taskStore: probe.store,
            relationships: RELATIONSHIPS,
            endX,
        });
        expect(layer.lines()).toBe(LINE_FROM_100);
        const linesNode = layer.paths()[0];
        const headsNode = layer.paths()[1];
        expect(linesNode).toBeDefined();

        // Viewport tick with both bars still in view: `batchedPaths` re-runs
        // (it reads `endX`), recomputes the same visible set, and must hand
        // back `prev`.
        setEndX(4999);
        settle();
        expect(layer.paths()[0]).toBe(linesNode);
        expect(layer.paths()[1]).toBe(headsNode);
        expect(layer.lines()).toBe(LINE_FROM_100);

        // Control: churn the visible set to empty and back. Same memo, same
        // index generation, but a real regroup — new nodes.
        setEndX(50);
        settle();
        expect(layer.paths()).toHaveLength(0);

        setEndX(5000);
        settle();
        expect(layer.lines()).toBe(LINE_FROM_100);
        expect(layer.paths()[0]).not.toBe(linesNode);
    });
});

describe('ArrowLayerBatched — caches are per-instance', () => {
    /**
     * The caches used to be module scope: `cachedResult` / `lastVisibleSet`
     * were returned whenever the visible index SET was unchanged — a set of
     * relationship INDICES, which says nothing about which store produced them
     * — and `arrowPathCache` was keyed by the same indices. Two concurrent
     * mounts over different stores therefore collided, and B's paths appeared
     * in A's render.
     *
     * They now ride on the memos themselves: the per-arrow path cache on the
     * `spatialIndex` generation that produced it, the visible-set diff on
     * `batchedPaths`' own `prev`. Both leak paths are exercised:
     *   phase 1 — A re-runs `batchedPaths` only (viewport prop), which is where
     *             the shared `cachedResult` used to be handed over;
     *   phase 2 — A's visible SET churns to empty and back, forcing a real
     *             regroup, which is where the shared `arrowPathCache` used to
     *             be consulted.
     */
    it("a second mount's paths do not leak into the first mount's render", () => {
        const first = createProbeStore(seedTasks());
        const [endX, setEndX] = createSignal(5000);
        const layerA = mountLayer({
            taskStore: first.store,
            relationships: RELATIONSHIPS,
            endX,
        });
        expect(layerA.lines()).toBe(LINE_FROM_100);

        // An independent mount over an independent store whose only arrow
        // starts 100px further right — same relationship index (0), so the
        // visible-set diff cannot tell the two apart.
        const second = createProbeStore(seedTasks(MOVED_X));
        const layerB = mountLayer({
            taskStore: second.store,
            relationships: RELATIONSHIPS,
        });
        expect(layerB.lines()).toBe(LINE_FROM_200);

        // Phase 1: re-run A's `batchedPaths` only — `endX` is read at `:212`,
        // well after `spatialIndex()`, so A's own positions are never re-read.
        // That is also the perf contract: viewport props (scroll) must not
        // rebuild the index, which is the only place the tracked position
        // reads live.
        const readsBefore = first.barPositionReads();
        setEndX(4999);
        settle();
        expect(first.barPositionReads()).toBe(readsBefore);

        // A's store never moved, and A still renders A's arrow.
        expect(first.store.getBarPosition('t1')?.x).toBe(FROM_BAR.x);
        expect(layerA.lines()).toBe(LINE_FROM_100);
        expect(layerB.lines()).toBe(LINE_FROM_200);

        // Phase 2: churn A's visible set (both bars right of the viewport ⇒
        // nothing visible) and back, forcing a regroup off the path cache.
        setEndX(50);
        settle();
        expect(layerA.paths()).toHaveLength(0);

        setEndX(5000);
        settle();
        expect(layerA.lines()).toBe(LINE_FROM_100);
        expect(layerA.heads()).toBe(HEAD);
        expect(layerB.lines()).toBe(LINE_FROM_200);
    });
});
