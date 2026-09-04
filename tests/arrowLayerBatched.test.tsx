/**
 * Characterization — `<ArrowLayerBatched>`'s dependency protocol on 1.9 (E1.7).
 *
 * WHERE THIS COMPONENT IS ACTUALLY MOUNTED (checked, not inherited from the
 * issue text). `rg ArrowLayerBatched src examples` finds exactly one live
 * mount: `GanttPerfIsolate.tsx:22/:2018`. `examples/arrow.html` does NOT mount
 * it — `src/entries/arrow.tsx` → `ArrowDemo.tsx:4` imports `Arrow` — and
 * `GanttMinimalTest.tsx:19` is a commented-out import. The shipped `<Gantt>`
 * renders no arrow layer at all.
 *
 * THE PROTOCOL. The component `untrack`s every position read
 * (`ArrowLayerBatched.tsx:140-141`) and `void`s a `positionVersion` prop
 * (`:124`) as its only declared position dependency. In its one real mount the
 * counter IS load-bearing: GanttPerfIsolate's mock store leaf-writes
 * (`state[id].startHours = updates.x / hw`, `:1531-1536`) and repaints solely
 * through `triggerArrowUpdate = () => setPositionVersion(v => v + 1)` (`:1546`,
 * called at `:1605/:1673`); its `getBarPosition` further multiplies by the
 * `hourWidth()` SIGNAL (`:1556-1563`), which the same `untrack` freezes.
 *
 * Drive the component from the library `taskStore` instead — which nothing
 * mounts it with — and the counter stops being load-bearing, for a reason that
 * is an accident of the STORE's write shape rather than a dependency of this
 * component. `spatialIndex` also calls `taskCount()` (`:96-99`), a NON-untracked
 * `Object.keys(store.tasks)`; the store proxy's `ownKeys` trap calls
 * `trackSelf`, so the memo subscribes to the store ROOT's `$SELF` node, and
 * `setProperty` fires `$SELF` on every write to the root object. Today's
 * `updateBarPosition` writes the root — it replaces the whole task object
 * inside `produce` (`taskStore.ts:110-120`) — so moving a bar happens to
 * invalidate the index even though nothing in the memo subscribed to a
 * position. The suite asserts that root notification directly (test 4) instead
 * of asserting it in prose.
 *
 * WHICH ISSUE FLIPS WHAT. E2.13 (`gantt-b4m.13`) does the 1.9-compatible half
 * of E4.4 and now BLOCKS E2.3 in the plan: drop the `untrack` at `:139-140`,
 * drop `void props.positionVersion` at `:123`, move the module caches into
 * component state. E2.3 (`gantt-b4m.3`) then makes `updateBarPosition` a leaf
 * mutation. E4.4 (`gantt-avv.4`) finally removes the `positionVersion` prop and
 * GanttPerfIsolate's `triggerArrowUpdate` protocol.
 *
 *   1-2  arrows appear over the real `taskStore` with `positionVersion` never
 *        passed at all. Stay green through E2.13/E2.3/E4.4.
 *   3    the real `taskStore.updateBarPosition` repaints. GREEN today (measured
 *        un-skipped, not assumed) and deliberately NOT skipped: it is the only
 *        executed coupling between the production store's mutator and this
 *        component. It stays green iff E2.13 lands before E2.3 — see the case.
 *   4    why 3 passes: production `updateBarPosition` notifies the store ROOT
 *        (1 re-run of a `taskCount()`-shaped computation), a leaf mutation
 *        notifies only `_bar` (0 re-runs). E2.3 drops the 1 to 0.
 *   5-6  the leaf write shape E2.3 introduces: stale render, rescued only by a
 *        `positionVersion` bump. Both flip at E2.13.
 *   7    the other half of the `untrack`: a SIGNAL-derived position (the
 *        `hourWidth()` shape of the only real mount) is frozen too, with no
 *        store write anywhere. Flips at E2.13.
 *   8    the module-level caches are shared across instances, so a second mount
 *        can hand its paths to the first one. Flips at E2.13.
 *
 * MANDATORY PROP: finite `endRow`. `endRow()` defaults to `Infinity` (`:88`)
 * and `batchedPaths` loops `for (let row = sr - 3; row <= er + 3; row++)`
 * (`:182`), which never terminates once there are relationships and positioned
 * tasks. Every mount below passes an explicit viewport.
 *
 * MODULE-LEVEL CACHES: `arrowPathCache` / `cachedResult` / `lastVisibleSet`
 * (`:71-73`) are module scope and therefore shared by every mount in this file.
 * They are reset at the top of each `spatialIndex` run that has both
 * relationships and tasks (`:127-129`), and the only case that mounts against
 * an empty store asserts an empty render (`batchedPaths` returns before reading
 * them, `:171`), so no test inherits another's cache by accident. Test 8 makes
 * the sharing itself the assertion, and runs last.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { render } from 'solid-js/web';
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
 * `rowHeight()` is 38 (`ArrowLayerBatched.tsx:89`), so `t1` sits on row 0 and
 * `t2` on row 1 — 38px apart, past `ALIGNMENT_THRESHOLD` (8), so the FS start
 * anchor is 'bottom' and the end anchor 'left' (`arrowBatchPaths.ts:41-57`).
 *   start offset  = clamp(0.1, 0.9, (to.x - curve - from.x) / from.width) = 0.9
 *   start point   = (from.x + 0.9 * 80, from.y + 30) = (172, 30) | (272, 30)
 *   end point     = (to.x, to.y + 0.5 * 30)          = (400, 53) | (500, 53)
 *   vertical start → L-shape `M<sx>,<sy>V<ey>H<ex>`  (`generateLinePath`)
 *   'left' head, size 5 → `M<ex-5>,<ey-5>L<ex>,<ey>L<ex-5>,<ey+5>`
 *
 * `*_SHIFTED` is the same pair with SHIFT (100) added to every x — the shape a
 * viewport rescale produces in test 7, where `to` moves as well.
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
    /** Reactive counter for the manual protocol; omitted = prop stays undefined. */
    positionVersion?: () => number;
    /** Reactive right edge; omitted = a constant 5000. Read by `batchedPaths` only. */
    endX?: () => number;
}

/** Every layer mounted by a test, disposed in `afterEach` (test 8 mounts two). */
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
                    positionVersion={options.positionVersion?.()}
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
 * LEAF mutation E2.3 (`gantt-b4m.3`) rewrites `updateBarPosition` into
 * (`PLAN.md:128`: `t._bar[k] = position[k]`). `setProperty` runs on the `_bar`
 * node; the root `$SELF` stays silent.
 *
 * The other write shape — today's whole-object replacement at a root key — is
 * NOT re-implemented here: the cases that need it call the production
 * `taskStore.updateBarPosition` directly (tests 3 and 4), so there is no copy
 * of a production body in this file to rot when E2.3 rewrites it.
 *
 * Only `tasks`, `getTask` and `getBarPosition` are wired to the local store;
 * the spread supplies the rest of the `TaskStore` interface, none of which
 * `<ArrowLayerBatched>` touches.
 *
 * Why not drive the replacement half through `taskStore.updateTask` instead?
 * Measured: it would not demonstrate anything. `updateTask` is `setTasks(id,
 * taskData)` (`taskStore.ts:99-101`), and a path setter whose previous value
 * and new value are both wrappable non-arrays takes `mergeStoreNode(prev,
 * value)` — a key-wise merge INTO the existing task node. The root `$SELF`
 * never fires. Only `produce`'s setter trap, which calls `setProperty` on the
 * root directly, moves the root node.
 */
interface ProbeStore {
    store: TaskStore;
    mutateTaskBarX: (id: string, x: number) => void;
}

function createProbeStore(tasks: ProcessedTask[]): ProbeStore {
    const seed: Record<string, ProcessedTask | undefined> = {};
    for (const task of tasks) seed[task.id] = task;
    const [state, setState] =
        createStore<Record<string, ProcessedTask | undefined>>(seed);

    const store: TaskStore = {
        ...createTaskStore(),
        tasks: state,
        getTask: (id) => state[id],
        getBarPosition: (id) => {
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
        setState(
            produce((draft) => {
                const task = draft[id];
                if (task?._bar) task._bar.x = x;
            }),
        );
    };

    return { store, mutateTaskBarX };
}

/**
 * A `TaskStore` whose bar positions are derived from a SIGNAL and never
 * written to the store at all — the shape of the only real mount
 * (`GanttPerfIsolate.tsx:1556-1563`: `x: task.startHours * hourWidth()`).
 * `setShift` is the analogue of a viewport resize.
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
 * Re-runs of a computation shaped exactly like `taskCount()`
 * (`ArrowLayerBatched.tsx:96-99`) across `write()` — i.e. how many times the
 * store ROOT notified. 0 means the component's index would not rebuild.
 */
function countRootNotifications(store: TaskStore, write: () => void): number {
    let runs = 0;
    const dispose = createRoot((disposeRoot) => {
        createComputed(() => {
            const count = Object.keys(store.tasks).length;
            runs++;
            return count;
        });
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

    it('picks up tasks written after mount, with no positionVersion bump', () => {
        const taskStore = createTaskStore();
        const layer = mountLayer({ taskStore, relationships: RELATIONSHIPS });

        // tc === 0 ⇒ spatialIndex returns `empty` (:113-120) and batchedPaths
        // bails at `positions.size === 0` (:171) before touching the module
        // caches — but taskCount() has already subscribed to the store root.
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
     * The assertion E1.7 was filed for. It PASSES on solid-js 1.9 (measured by
     * running it un-skipped, not assumed), so it is landed EXECUTED: skipping
     * it would leave this file with no running coupling between the production
     * store's mutator and this component at all, and a green skip pins nothing.
     *
     * It passes for a reason the component does not own — `updateBarPosition`
     * replaces the whole task object at a root key inside `produce`
     * (`taskStore.ts:110-120`), the root `$SELF` fires, `taskCount()`
     * invalidates, the index rebuilds and repeats its untracked position reads.
     * Test 4 asserts exactly that. The component's own declared dependency
     * (`void props.positionVersion`, `:124`) contributes nothing: the prop is
     * never passed here.
     *
     * TODO(E2.13 / gantt-b4m.13): this is the case that ORDER protects. E2.13
     * gives the component real position dependencies on 1.9 and the plan now
     * records it as blocking E2.3, so on the planned order this stays green
     * throughout — and green for the right reason afterwards.
     * TODO(E2.3 / gantt-b4m.3): if E2.3 lands first, this goes RED on `main`,
     * still on 1.9. That is the tripwire, not a regression in the test: it says
     * the demo-mounted arrow layer is drawing positions it never subscribed to.
     */
    it('updateBarPosition repaints the arrow with no positionVersion bump', () => {
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
     * claim in a comment: the SAME logical move notifies the store root when it
     * is written as a whole-object replacement (production `updateBarPosition`
     * today) and does not when it is written as a leaf mutation (the shape E2.3
     * introduces). `taskCount()` is subscribed to the root and to nothing else,
     * so 1 vs 0 is the whole difference between tests 3 and 5.
     *
     * TODO(E2.3 / gantt-b4m.3): the first expectation drops to 0. E2.13 does
     * not touch the store, so it leaves both numbers alone.
     */
    it('updateBarPosition notifies the store root; a leaf mutation does not', () => {
        const taskStore = createTaskStore();
        taskStore.updateTasks(seedTasks());
        settle();

        const rootRuns = countRootNotifications(taskStore, () =>
            taskStore.updateBarPosition('t1', { x: MOVED_X }),
        );
        expect(rootRuns).toBe(1);
        expect(taskStore.getBarPosition('t1')?.x).toBe(MOVED_X);

        const probe = createProbeStore(seedTasks());
        const leafRuns = countRootNotifications(probe.store, () =>
            probe.mutateTaskBarX('t1', MOVED_X),
        );
        expect(leafRuns).toBe(0);
        // Same destination, so the two writes really are the same move.
        expect(probe.store.getBarPosition('t1')?.x).toBe(MOVED_X);
    });

    /**
     * The accident, stated negatively. A leaf write to `t1._bar.x` notifies the
     * `_bar` node only, so `taskCount()`'s root subscription never fires,
     * `spatialIndex` never re-runs, and the untracked reads at `:140-141` are
     * never repeated: the rendered arrow keeps pointing at the old position
     * with no error and no warning.
     *
     * TODO(E2.13 / gantt-b4m.13): once the `untrack` is dropped and
     * `getBarPosition` subscribes, the stale expectation below flips to
     * LINE_FROM_200 (the store readback above stays as it is).
     */
    it('a leaf mutation of _bar.x leaves the rendered arrow stale', () => {
        const probe = createProbeStore(seedTasks());
        const layer = mountLayer({
            taskStore: probe.store,
            relationships: RELATIONSHIPS,
        });
        expect(layer.lines()).toBe(LINE_FROM_100);

        probe.mutateTaskBarX('t1', MOVED_X);
        settle();

        // The store really did move the bar ...
        expect(probe.store.getBarPosition('t1')?.x).toBe(MOVED_X);
        // ... and the render did not notice.
        expect(layer.lines()).toBe(LINE_FROM_100);
        expect(layer.heads()).toBe(HEAD);
    });

    /**
     * …and the manual protocol is what rescues it: bumping `positionVersion`
     * invalidates `spatialIndex` through `void props.positionVersion` (`:124`),
     * which re-runs the untracked position reads. This is the contract
     * `GanttPerfIsolate.triggerArrowUpdate` (`:1546/:1605`) depends on.
     *
     * TODO(E2.13 / gantt-b4m.13): drops `void props.positionVersion`, so the
     * mid-test stale expectation flips to LINE_FROM_200 and the bump stops
     * being what repaints. E4.4 (`gantt-avv.4`) then removes the prop and
     * GanttPerfIsolate's protocol outright, and this case goes with them.
     */
    it('bumping positionVersion after a leaf mutation repaints the arrow', () => {
        const probe = createProbeStore(seedTasks());
        const [positionVersion, setPositionVersion] = createSignal(0);
        const layer = mountLayer({
            taskStore: probe.store,
            relationships: RELATIONSHIPS,
            positionVersion,
        });
        expect(layer.lines()).toBe(LINE_FROM_100);

        probe.mutateTaskBarX('t1', MOVED_X);
        settle();
        expect(probe.store.getBarPosition('t1')?.x).toBe(MOVED_X);
        expect(layer.lines()).toBe(LINE_FROM_100);

        setPositionVersion((v) => v + 1);
        settle();

        expect(layer.lines()).toBe(LINE_FROM_200);
        expect(layer.heads()).toBe(HEAD);
    });

    /**
     * The other half of the `untrack` at `:140-141`, and the half the only real
     * mount actually depends on: positions derived from a SIGNAL, with no store
     * write anywhere. GanttPerfIsolate computes `x: task.startHours *
     * hourWidth()` (`:1556-1563`), so a viewport resize goes stale for the same
     * reason a leaf mutation does — and the store-root accident cannot rescue
     * it, because nothing writes the store.
     *
     * TODO(E2.13 / gantt-b4m.13): the stale expectation flips to LINE_SHIFTED
     * and the `positionVersion` bump becomes unnecessary; E4.4
     * (`gantt-avv.4`) then removes the prop this case passes.
     */
    it('a signal-derived position change leaves the arrow stale until the counter bumps', () => {
        const probe = createShiftProbeStore(seedTasks());
        const [positionVersion, setPositionVersion] = createSignal(0);
        const layer = mountLayer({
            taskStore: probe.store,
            relationships: RELATIONSHIPS,
            positionVersion,
        });
        expect(layer.lines()).toBe(LINE_FROM_100);

        probe.setShift(SHIFT);
        settle();

        // Both bars have moved as far as the store is concerned ...
        expect(probe.store.getBarPosition('t1')?.x).toBe(FROM_BAR.x + SHIFT);
        expect(probe.store.getBarPosition('t2')?.x).toBe(TO_BAR.x + SHIFT);
        // ... and the render is frozen at the pre-resize geometry.
        expect(layer.lines()).toBe(LINE_FROM_100);
        expect(layer.heads()).toBe(HEAD);

        setPositionVersion((v) => v + 1);
        settle();

        expect(layer.lines()).toBe(LINE_SHIFTED);
        expect(layer.heads()).toBe(HEAD_SHIFTED);
    });
});

describe('ArrowLayerBatched — module-level caches are shared by every instance', () => {
    /**
     * `cachedResult` / `lastVisibleSet` (`:72-73`) are module scope, and
     * `batchedPaths` returns `cachedResult` whenever the visible index SET is
     * unchanged (`:206-211`) — a set of relationship INDICES, which says
     * nothing about which store produced them. Two concurrent mounts over
     * different stores therefore collide: B's `spatialIndex` run leaves
     * `lastVisibleSet = {0}` and `cachedResult = [B's paths]`, and the next
     * `batchedPaths` re-run in A (viewport props only — `spatialIndex` does not
     * read `endX`) hands A the paths B computed.
     *
     * This test runs LAST because it deliberately leaves the module caches
     * holding a foreign result.
     *
     * TODO(E2.13 / gantt-b4m.13): moves the caches into component state, after
     * which A keeps rendering LINE_FROM_100 and this expectation flips.
     */
    it("a second mount's cached paths leak into the first mount's render", () => {
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

        // Re-run A's `batchedPaths` only: `endX` is read at `:176`, well after
        // `spatialIndex()`, so A's own positions are never re-read.
        setEndX(4999);
        settle();

        // A's store never moved ...
        expect(first.store.getBarPosition('t1')?.x).toBe(FROM_BAR.x);
        // ... yet A now renders B's arrow.
        expect(layerA.lines()).toBe(LINE_FROM_200);
        expect(layerB.lines()).toBe(LINE_FROM_200);
    });
});
