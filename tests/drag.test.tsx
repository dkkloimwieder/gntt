/**
 * E1.6 — drag-end geometry characterization (chains B, C, D).
 *
 * These are CHARACTERIZATION tests: they pin what a gesture does on
 * solid-js 1.9 so the 2.0 flip (E3) produces a named regression list rather
 * than a mystery. Nothing here is a statement about what the library
 * *should* do — several assertions below pin behaviour that is arguably
 * wrong (a stationary press still reports a date change; a left-edge resize
 * drags the right edge with it; a keyboard resize never cascades its FS
 * successor; a summary move is reported through `onResizeEnd` and never
 * through `onDateChange`; a drag reports the geometry from BEFORE the
 * gesture as soon as the store stops writing synchronously).
 *
 * Why they are flip-sensitive: every one of them depends on the store write
 * made by the LAST `onDragMove` being visible to `onDragEnd`, which runs in
 * the same synchronous stack (`useDrag.handleMouseUp`, useDrag.ts:160-177).
 * On 1.9 store writes apply immediately, so `useBarDrag`'s "read directly
 * from store to avoid reactive timing issues" re-read at useBarDrag.ts:271
 * happens to return the geometry the move just wrote. Under 2.0's deferred
 * writes it returns the pre-gesture value instead.
 *
 * MATCHED PAIRS. Two behaviours cannot be characterized by a single test,
 * because today's answer is the wrong one. Each is written twice: a GREEN
 * test asserting the current (wrong) value, so the suite fails loudly at the
 * moment it changes, and a SKIPPED test asserting the contract, ready to be
 * un-skipped by the issue named in its title. Exactly one of each pair can
 * hold at a time. They are the drag-end report (green here, skipped at the
 * bottom of the file) and the keyboard-resize cascade (both in `keyboard
 * gestures`). Nothing else in this file is skipped.
 *
 * Every delta in this file is chosen so that a plausible wrong
 * implementation produces a DIFFERENT number, not the same one — see
 * RESIZE_COLUMNS, PRESS_FRACTION and HOOK_DRAG_DELTA. Each of those carries
 * a `not.toBe` guard that goes red if the fixture ever drifts back onto a
 * value where the readings coincide.
 *
 * Mechanics (all measured, see the E1.6 scout brief):
 *   - mousedown goes on the element, mousemove/mouseup on `document` —
 *     that is where useDrag registers them (useDrag.ts:224-225).
 *   - `mountGantt`'s getScreenCTM is the identity at scroll 0, so a
 *     dispatched clientX is the svg x. Absolute coordinates are meaningful
 *     (the progress drag consumes `startSvgX` absolutely).
 *   - requestAnimationFrame is replaced by a MANUAL queue for the whole
 *     file. useDrag's rafLoop reschedules itself while dragging, so a
 *     synchronous rAF stub would recurse forever; a queue that is drained
 *     explicitly gives deterministic intermediate frames and stops stray
 *     callbacks from firing after a test has disposed its mount.
 *   - `settle()` is a no-op on 1.9. It is called after every write so the
 *     suite is already shaped for E3.1, which turns it into `flush`.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';
import { mountGantt, type MountedGantt } from './helpers/mountGantt';
import { settle } from './helpers/settle';
import { createTaskStore, type TaskStore } from '../src/stores/taskStore';
import { useBarDrag } from '../src/hooks/useBarDrag';
import type { DragState } from '../src/hooks/useDrag';
import type {
    BarPosition,
    GanttTask,
    NormalizedConstraints,
    ProcessedTask,
} from '../src/types';

/**
 * t1 is the dragged bar. t2 is its FS successor on another resource, so a
 * t1 drag batch-moves it (`onCollectDependents`). p1 is a summary whose two
 * children live in the store but — in the default `renderMode: 'simple'` —
 * render no bars of their own, which is exactly the shape a summary drag
 * has to move through `batchMovePositions`.
 */
const TASKS: GanttTask[] = [
    {
        id: 't1',
        name: 'Task 1',
        start: '2025-01-06 08:00',
        end: '2025-01-08 16:00',
        progress: 40,
        resource: 'R1',
    },
    {
        id: 't2',
        name: 'Task 2',
        start: '2025-01-09 08:00',
        end: '2025-01-10 16:00',
        resource: 'R2',
        dependencies: [{ id: 't1', type: 'FS' }],
    },
    {
        id: 'p1',
        name: 'Parent',
        start: '2025-01-13 08:00',
        end: '2025-01-17 16:00',
        type: 'summary',
        resource: 'R3',
    },
    {
        id: 'c1',
        name: 'Child 1',
        start: '2025-01-13 08:00',
        end: '2025-01-14 16:00',
        parentId: 'p1',
        resource: 'R3',
    },
    {
        id: 'c2',
        name: 'Child 2',
        start: '2025-01-15 08:00',
        end: '2025-01-17 16:00',
        parentId: 'p1',
        resource: 'R3',
    },
];

const INITIAL_PROGRESS = 40;

/**
 * Where the progress drag presses, as a fraction of the bar width. It MUST
 * differ from `INITIAL_PROGRESS / 100`: useBarDrag consumes `startSvgX`
 * absolutely (`clamp(startSvgX + deltaX, barX, barX + barWidth)`,
 * useBarDrag.ts:216-220), and pressing exactly on the progress marker would
 * make that indistinguishable from an implementation that added deltaX to
 * the marker instead. 0.2 separates them: the release lands at 75% under the
 * absolute reading and at 95% under the marker-relative one.
 */
const PRESS_FRACTION = 0.2;
/** Where the progress drag releases, as a fraction of the bar width. */
const RELEASE_FRACTION = 0.75;

/**
 * Resize drags move a NON-integral number of columns on purpose. Both resize
 * branches round the DELTA (`Math.round(move.deltaX / colWidth) * colWidth`,
 * useBarDrag.ts:169-170 and :202-203); a drag of a whole number of columns
 * produces the same width under a hypothetical no-snap implementation, so it
 * pins nothing. 2.25 columns rounds to 2 in both directions
 * (`Math.round(2.25) === 2`, `Math.round(-2.25) === -2`).
 */
const RESIZE_COLUMNS = 2.25;
/** What `RESIZE_COLUMNS` collapses to once the delta is snapped. */
const RESIZE_SNAPPED_COLUMNS = 2;

interface DateChange {
    id: string;
    start: Date;
    end: Date;
    /** The additive third argument: the pixel rect the dates came from. */
    position?: { x: number; width: number };
}

const mouse = (type: string, clientX: number, clientY: number): MouseEvent =>
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });

const key = (k: string, shiftKey = false): KeyboardEvent =>
    new KeyboardEvent('keydown', {
        key: k,
        shiftKey,
        bubbles: true,
        cancelable: true,
    });

/**
 * A manual requestAnimationFrame queue. `drain()` runs the callbacks that
 * were pending when it was called — callbacks scheduled BY those callbacks
 * (useDrag's rafLoop reschedules itself, useDrag.ts:84-86) land in the next
 * batch instead of recursing.
 */
interface FrameQueue {
    drain: () => void;
    restore: () => void;
}

/** Structurally identical to the DOM's FrameRequestCallback. */
type RafCallback = (time: number) => void;

function captureFrames(): FrameQueue {
    const pending = new Map<number, RafCallback>();
    let nextId = 1;
    const originalRequest = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = (cb: RafCallback): number => {
        const id = nextId++;
        pending.set(id, cb);
        return id;
    };
    globalThis.cancelAnimationFrame = (id: number): void => {
        pending.delete(id);
    };

    return {
        drain: () => {
            const batch = [...pending.values()];
            pending.clear();
            for (const cb of batch) cb(0);
        },
        restore: () => {
            globalThis.requestAnimationFrame = originalRequest;
            globalThis.cancelAnimationFrame = originalCancel;
        },
    };
}

let mounted: MountedGantt | undefined;
let frames: FrameQueue;
let disposeHook: (() => void) | undefined;

beforeEach(() => {
    frames = captureFrames();
});

afterEach(() => {
    // mountGantt refuses a second live mount, and useDrag keeps document
    // listeners until its owner is disposed, so both have to be torn down
    // before the next test dispatches anything. The rAF stub is global, so
    // it is restored even if a disposer throws — otherwise it would leak
    // into whatever file vitest loads next.
    try {
        disposeHook?.();
        disposeHook = undefined;
        mounted?.dispose();
        mounted = undefined;
    } finally {
        frames.restore();
    }
});

const barOf = (m: MountedGantt, id: string): Element => {
    const el = m.container.querySelector(`.bar-wrapper[data-id="${id}"]`);
    expect(el).not.toBe(null);
    return el as Element;
};

const handleOf = (m: MountedGantt, id: string, handle: string): Element => {
    const el = m.container.querySelector(
        `.bar-wrapper[data-id="${id}"] .${handle}`,
    );
    expect(el).not.toBe(null);
    return el as Element;
};

const barPos = (m: MountedGantt, id: string): { x: number; width: number } => {
    const bar = m.stores.taskStore.tasks[id]?._bar;
    expect(bar).toBeDefined();
    return { x: bar!.x, width: bar!.width };
};

/** The x a bar lands on after `snapToGrid` (barCalculations.ts:192-206). */
const snapped = (x: number, columnWidth: number): number =>
    Math.round(x / columnWidth) * columnWidth;

describe('bar drag — the geometry that reaches the consumer', () => {
    it('commits the LAST move and reports that geometry, not the intermediate one', () => {
        const changes: DateChange[] = [];
        mounted = mountGantt({
            tasks: TASKS,
            onDateChange: (id, range, position) => {
                changes.push({
                    id,
                    start: range.start,
                    end: range.end,
                    position,
                });
            },
        });
        settle();

        const { ganttConfig, dateStore } = mounted.stores;
        const columnWidth = ganttConfig.columnWidth();
        const before = barPos(mounted, 't1');

        // Two distinct moves, the first one actually applied by a frame, so
        // the store visibly holds the intermediate geometry before the
        // gesture ends. Without the drained frame both assertions below
        // would hold trivially.
        const firstDelta = 2 * columnWidth;
        const finalDelta = 5 * columnWidth;
        const expectedMid = snapped(before.x + firstDelta, columnWidth);
        const expectedFinal = snapped(before.x + finalDelta, columnWidth);
        expect(expectedMid).not.toBe(expectedFinal);

        barOf(mounted, 't1').dispatchEvent(mouse('mousedown', 500, 20));
        settle();
        document.dispatchEvent(mouse('mousemove', 500 + firstDelta, 20));
        settle();
        frames.drain();
        settle();
        expect(barPos(mounted, 't1').x).toBe(expectedMid);

        document.dispatchEvent(mouse('mousemove', 500 + finalDelta, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', 500 + finalDelta, 20));
        settle();

        const after = barPos(mounted, 't1');
        expect(after.x).toBe(expectedFinal);
        expect(after.width).toBe(before.width);

        // One report, carrying the FINAL move's geometry. Gantt converts
        // {x, width} to dates (Gantt.tsx:487-494), so the dates are read
        // back through the same date store the component used.
        expect(changes).toHaveLength(1);
        expect(changes[0]!.id).toBe('t1');
        expect(changes[0]!.start.getTime()).toBe(
            dateStore.xToDate(expectedFinal).getTime(),
        );
        expect(changes[0]!.end.getTime()).toBe(
            dateStore.xToDate(expectedFinal + after.width).getTime(),
        );
        // The discriminator: reporting the frame that ran mid-gesture would
        // produce this instead.
        expect(changes[0]!.start.getTime()).not.toBe(
            dateStore.xToDate(expectedMid).getTime(),
        );
        // D13: the same geometry also arrives as pixels, so a consumer that
        // needs them does not re-read a store write that may still be staged.
        expect(changes[0]!.position).toEqual({
            x: expectedFinal,
            width: before.width,
        });
    });

    it('batch-moves the dragged bar’s dependents by the same snapped delta', () => {
        mounted = mountGantt({ tasks: TASKS });
        settle();

        const columnWidth = mounted.stores.ganttConfig.columnWidth();
        const before = barPos(mounted, 't1');
        const successorBefore = barPos(mounted, 't2');

        const delta = 5 * columnWidth;
        barOf(mounted, 't1').dispatchEvent(mouse('mousedown', 500, 20));
        settle();
        document.dispatchEvent(mouse('mousemove', 500 + delta, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', 500 + delta, 20));
        settle();

        // batchMovePositions applies `originalX + deltaX` to every collected
        // dependent, where deltaX is the SNAPPED delta of the dragged bar —
        // so the successor keeps its (unsnapped) offset from t1.
        const snappedDelta = snapped(before.x + delta, columnWidth) - before.x;
        expect(barPos(mounted, 't1').x).toBe(before.x + snappedDelta);
        expect(barPos(mounted, 't2').x).toBeCloseTo(
            successorBefore.x + snappedDelta,
            9,
        );
        expect(barPos(mounted, 't2').width).toBe(successorBefore.width);
    });

    it('suppresses the click after a drag but not after a stationary press — and reports a date change either way', () => {
        const clicks: string[] = [];
        const changes: DateChange[] = [];
        mounted = mountGantt({
            tasks: TASKS,
            disableTaskClickModal: true,
            onTaskClick: (id) => {
                clicks.push(id);
            },
            onDateChange: (id, range) => {
                changes.push({ id, start: range.start, end: range.end });
            },
        });
        settle();

        const columnWidth = mounted.stores.ganttConfig.columnWidth();
        const wrapper = barOf(mounted, 't1');
        const before = barPos(mounted, 't1');

        // Stationary press: no move handler ever runs, but useDrag still
        // calls onDragEnd, so useBarDrag reports the unchanged geometry.
        // That report is a pre-existing quirk (chain B), pinned here.
        wrapper.dispatchEvent(mouse('mousedown', 400, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', 400, 20));
        settle();
        wrapper.dispatchEvent(mouse('click', 400, 20));
        settle();

        expect(clicks).toEqual(['t1']);
        expect(changes).toHaveLength(1);
        expect(changes[0]!.start.getTime()).toBe(
            mounted.stores.dateStore.xToDate(before.x).getTime(),
        );
        expect(barPos(mounted, 't1').x).toBe(before.x);

        // Drag past useBarDrag's 3px threshold (useBarDrag.ts:115-119):
        // didDrag flips and handleClick swallows the click.
        const delta = 3 * columnWidth;
        wrapper.dispatchEvent(mouse('mousedown', 400, 20));
        settle();
        document.dispatchEvent(mouse('mousemove', 400 + delta, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', 400 + delta, 20));
        settle();
        wrapper.dispatchEvent(mouse('click', 400 + delta, 20));
        settle();

        expect(clicks).toEqual(['t1']);
        expect(changes).toHaveLength(2);
        expect(barPos(mounted, 't1').x).toBe(
            snapped(before.x + delta, columnWidth),
        );
    });
});

describe('resize drags', () => {
    it('right-edge resize widens the bar and reports the new width', () => {
        const changes: DateChange[] = [];
        const resizeEnds: string[] = [];
        mounted = mountGantt({
            tasks: TASKS,
            onDateChange: (id, range) => {
                changes.push({ id, start: range.start, end: range.end });
            },
            onResizeEnd: (id) => {
                resizeEnds.push(id);
            },
        });
        settle();

        const { ganttConfig, dateStore } = mounted.stores;
        const columnWidth = ganttConfig.columnWidth();
        const before = barPos(mounted, 't1');

        const delta = RESIZE_COLUMNS * columnWidth;
        handleOf(mounted, 't1', 'handle-right').dispatchEvent(
            mouse('mousedown', 600, 20),
        );
        settle();
        document.dispatchEvent(mouse('mousemove', 600 + delta, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', 600 + delta, 20));
        settle();

        // dragging_right snaps the DELTA, not the resulting edge
        // (useBarDrag.ts:200-208), so x is untouched and the width grows by
        // whole columns from its unsnapped starting value. A 2.25-column
        // drag therefore widens the bar by exactly 2 columns — the second
        // assertion is what makes the first one mean "snapped": it excludes
        // the reading in which the raw delta is added.
        const after = barPos(mounted, 't1');
        expect(after.x).toBe(before.x);
        expect(after.width).toBe(
            before.width + RESIZE_SNAPPED_COLUMNS * columnWidth,
        );
        expect(after.width).not.toBe(before.width + delta);

        expect(changes).toHaveLength(1);
        expect(changes[0]!.id).toBe('t1');
        expect(changes[0]!.start.getTime()).toBe(
            dateStore.xToDate(before.x).getTime(),
        );
        expect(changes[0]!.end.getTime()).toBe(
            dateStore.xToDate(before.x + after.width).getTime(),
        );
        expect(resizeEnds).toEqual(['t1']);
    });

    it('left-edge resize re-snaps x after sizing the bar, dragging the RIGHT edge with it', () => {
        const changes: DateChange[] = [];
        const resizeEnds: string[] = [];
        mounted = mountGantt({
            tasks: TASKS,
            onDateChange: (id, range) => {
                changes.push({ id, start: range.start, end: range.end });
            },
            onResizeEnd: (id) => {
                resizeEnds.push(id);
            },
        });
        settle();

        const { ganttConfig, dateStore } = mounted.stores;
        const columnWidth = ganttConfig.columnWidth();
        const before = barPos(mounted, 't1');
        const rightEdgeBefore = before.x + before.width;
        // The whole point of this test only exists because the bar does not
        // start on a column boundary. Guard it, or the right-edge assertion
        // below silently becomes a tautology.
        expect(snapped(before.x, columnWidth)).not.toBe(before.x);

        const delta = -RESIZE_COLUMNS * columnWidth;
        handleOf(mounted, 't1', 'handle-left').dispatchEvent(
            mouse('mousedown', 400, 20),
        );
        settle();
        document.dispatchEvent(mouse('mousemove', 400 + delta, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', 400 + delta, 20));
        settle();

        // dragging_left takes BOTH x and width from the same snapped delta
        // (useBarDrag.ts:169-173) — so far consistent — and then re-snaps x
        // alone against the grid (`newX = snapToGrid(newX, ...)`, :180)
        // while leaving the width untouched. Since `originalX + snappedDelta`
        // is off-grid by exactly as much as `originalX` was, that second snap
        // silently drags the RIGHT edge by `snapped(originalX) - originalX`.
        // Pinned, not endorsed.
        const after = barPos(mounted, 't1');
        expect(after.x).toBe(snapped(before.x + delta, columnWidth));
        // Width from the SNAPPED delta (2 columns), not the raw 2.25.
        expect(after.width).toBe(
            before.width + RESIZE_SNAPPED_COLUMNS * columnWidth,
        );
        expect(after.width).not.toBe(before.width - delta);
        // The right edge does not merely "move" — it lands exactly where the
        // extra snap of the original x put it.
        expect(after.x + after.width).toBeCloseTo(
            snapped(before.x, columnWidth) + before.width,
            9,
        );
        expect(after.x + after.width).not.toBeCloseTo(rightEdgeBefore, 9);

        expect(changes).toHaveLength(1);
        expect(changes[0]!.start.getTime()).toBe(
            dateStore.xToDate(after.x).getTime(),
        );
        expect(changes[0]!.end.getTime()).toBe(
            dateStore.xToDate(after.x + after.width).getTime(),
        );
        expect(resizeEnds).toEqual(['t1']);
    });
});

describe('progress drag', () => {
    it('reports the NEW progress, derived from the release point', () => {
        const reported: Array<[string, number]> = [];
        mounted = mountGantt({
            tasks: TASKS,
            onProgressChange: (id, progress) => {
                reported.push([id, progress]);
            },
        });
        settle();

        const { taskStore } = mounted.stores;
        const before = barPos(mounted, 't1');
        expect(taskStore.tasks['t1']!.progress).toBe(INITIAL_PROGRESS);

        // useBarDrag consumes startSvgX ABSOLUTELY (useBarDrag.ts:209-220):
        // the release x is clamped into the bar and turned into a percentage
        // of its width, so both coordinates have to sit inside the bar. The
        // press deliberately sits at 20% while the bar is 40% done, so the
        // absolute reading and the marker-relative one give different
        // answers — see PRESS_FRACTION.
        const pressX = before.x + before.width * PRESS_FRACTION;
        const releaseX = before.x + before.width * RELEASE_FRACTION;
        const expectedProgress = Math.round(
            ((releaseX - before.x) / before.width) * 100,
        );
        expect(expectedProgress).not.toBe(INITIAL_PROGRESS);
        // What an implementation that started from the progress MARKER and
        // added deltaX would report instead. If this ever equals
        // expectedProgress the test has stopped discriminating.
        const markerRelativeProgress = Math.round(
            ((before.width * (INITIAL_PROGRESS / 100) + (releaseX - pressX)) /
                before.width) *
                100,
        );
        expect(markerRelativeProgress).not.toBe(expectedProgress);

        handleOf(mounted, 't1', 'handle-progress').dispatchEvent(
            mouse('mousedown', pressX, 20),
        );
        settle();
        document.dispatchEvent(mouse('mousemove', releaseX, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', releaseX, 20));
        settle();

        expect(taskStore.tasks['t1']!.progress).toBe(expectedProgress);
        // The report comes from `deps.taskInfo()` — a fresh read of the task
        // memo — so it only carries the new value because the move's write
        // is already visible when onDragEnd runs (useBarDrag.ts:280-282).
        expect(reported).toEqual([['t1', expectedProgress]]);
        expect(barPos(mounted, 't1')).toEqual(before);
    });
});

describe('keyboard gestures', () => {
    it('ArrowRight moves the bar one column and reports the new x unsnapped', () => {
        const changes: DateChange[] = [];
        mounted = mountGantt({
            tasks: TASKS,
            onDateChange: (id, range) => {
                changes.push({ id, start: range.start, end: range.end });
            },
        });
        settle();

        const { ganttConfig, dateStore } = mounted.stores;
        const columnWidth = ganttConfig.columnWidth();
        const before = barPos(mounted, 't1');

        barOf(mounted, 't1').dispatchEvent(key('ArrowRight'));
        settle();

        // Bar.handleKeyDown adds one column to the CURRENT x without
        // snapping (Bar.tsx:306-311) — a keyboard move and a mouse drag of
        // the same distance therefore land on different pixels.
        const after = barPos(mounted, 't1');
        expect(after.x).toBe(before.x + columnWidth);
        expect(after.x).not.toBe(snapped(before.x + columnWidth, columnWidth));
        expect(after.width).toBe(before.width);

        expect(changes).toHaveLength(1);
        expect(changes[0]!.start.getTime()).toBe(
            dateStore.xToDate(after.x).getTime(),
        );
        expect(changes[0]!.end.getTime()).toBe(
            dateStore.xToDate(after.x + after.width).getTime(),
        );
    });

    it('shift+ArrowRight resizes from the right edge and reports the new width', () => {
        const changes: DateChange[] = [];
        const resizeEnds: string[] = [];
        mounted = mountGantt({
            tasks: TASKS,
            onDateChange: (id, range) => {
                changes.push({ id, start: range.start, end: range.end });
            },
            onResizeEnd: (id) => {
                resizeEnds.push(id);
            },
        });
        settle();

        const { ganttConfig, dateStore } = mounted.stores;
        const columnWidth = ganttConfig.columnWidth();
        const before = barPos(mounted, 't1');
        const successorBefore = barPos(mounted, 't2');

        barOf(mounted, 't1').dispatchEvent(key('ArrowRight', true));
        settle();

        const after = barPos(mounted, 't1');
        expect(after.x).toBe(before.x);
        expect(after.width).toBe(before.width + columnWidth);

        // The successor's behaviour is the sibling test below (it cascades
        // now that the geometry reaches the engine as data). This test owns
        // only the resized bar and the report; it still pins that the
        // successor is not RESIZED by the cascade, which only moves x.
        expect(barPos(mounted, 't2').width).toBe(successorBefore.width);

        expect(changes).toHaveLength(1);
        expect(changes[0]!.id).toBe('t1');
        expect(changes[0]!.start.getTime()).toBe(
            dateStore.xToDate(before.x).getTime(),
        );
        expect(changes[0]!.end.getTime()).toBe(
            dateStore.xToDate(before.x + after.width).getTime(),
        );
        expect(resizeEnds).toEqual(['t1']);
    });

    // Un-skipped by E2.7 (gantt-b4m.7). Two gates in `resolveConstraints`
    // used to make this impossible, and neither was a timing problem:
    // its "no position change" early-out compared the proposal against
    // `getBarPosition(taskId)` — the very read the proposal came from — and
    // past that it only computed cascade updates when the X moved, which a
    // resize never does. Both are right for a MOVE and wrong for a RESIZE,
    // so the resize path now has its own entry (`resolveResizeCascade`) that
    // takes the new rect as a VALUE, threaded Bar → TaskLayer →
    // resolveResizeConstraints. Its matched twin above lost the two
    // assertions that pinned the successor standing still.
    it('shift+ArrowRight cascades successors from the new width', () => {
        mounted = mountGantt({ tasks: TASKS });
        settle();

        const columnWidth = mounted.stores.ganttConfig.columnWidth();
        const successorBefore = barPos(mounted, 't2');
        const before = barPos(mounted, 't1');
        // PRECONDITION, not the pinned behaviour: t2 starts with ~30px of
        // slack after t1's right edge, and one column of growth (45px) eats
        // all of it. Without this the FS relationship would still be
        // satisfied after the resize and a cascade would be optional.
        const resizedRightEdge = before.x + before.width + columnWidth;
        expect(successorBefore.x).toBeGreaterThan(before.x + before.width);
        expect(resizedRightEdge).toBeGreaterThan(successorBefore.x);

        barOf(mounted, 't1').dispatchEvent(key('ArrowRight', true));
        settle();

        const after = barPos(mounted, 't1');
        expect(after.width).toBe(before.width + columnWidth);
        // The FS contract, as a value and not a threshold: the successor's
        // start lands exactly on the predecessor's new end. Asserted twice —
        // once against the measured post-resize geometry, once against the
        // number predicted from the pre-gesture geometry alone.
        expect(barPos(mounted, 't2').x).toBeCloseTo(after.x + after.width, 9);
        expect(barPos(mounted, 't2').x).toBeCloseTo(resizedRightEdge, 9);
        expect(barPos(mounted, 't2').width).toBe(successorBefore.width);
    });
});

describe('summary bar drag', () => {
    it('moves the summary and its descendants, reports no date change, and fires onResizeEnd', () => {
        const changes: string[] = [];
        const resizeEnds: string[] = [];
        const resizeGeometry: Array<{ x: number; width: number }> = [];
        mounted = mountGantt({
            tasks: TASKS,
            onDateChange: (id) => {
                changes.push(id);
            },
            onResizeEnd: (id, geometry) => {
                resizeEnds.push(id);
                if (geometry) resizeGeometry.push(geometry);
            },
        });
        settle();

        const columnWidth = mounted.stores.ganttConfig.columnWidth();
        const summaryBefore = barPos(mounted, 'p1');
        const firstChildBefore = barPos(mounted, 'c1');
        const secondChildBefore = barPos(mounted, 'c2');

        const wrapper = mounted.container.querySelector(
            '.summary-bar-wrapper[data-id="p1"]',
        );
        expect(wrapper).not.toBe(null);
        // In renderMode 'simple' the children render no bars of their own
        // (splitTaskIds skips every task with a parentId) — they move only
        // through the summary's batch.
        expect(
            mounted.container.querySelector('.bar-wrapper[data-id="c1"]'),
        ).toBe(null);

        const delta = 5 * columnWidth;
        wrapper!.dispatchEvent(mouse('mousedown', 700, 110));
        settle();
        document.dispatchEvent(mouse('mousemove', 700 + delta, 110));
        settle();
        document.dispatchEvent(mouse('mouseup', 700 + delta, 110));
        settle();

        const snappedDelta =
            snapped(summaryBefore.x + delta, columnWidth) - summaryBefore.x;
        expect(snappedDelta).not.toBe(0);
        expect(barPos(mounted, 'p1').x).toBe(summaryBefore.x + snappedDelta);
        expect(barPos(mounted, 'c1').x).toBeCloseTo(
            firstChildBefore.x + snappedDelta,
            9,
        );
        expect(barPos(mounted, 'c2').x).toBeCloseTo(
            secondChildBefore.x + snappedDelta,
            9,
        );
        // Widths are untouched: batchMovePositions only writes x.
        expect(barPos(mounted, 'p1').width).toBe(summaryBefore.width);
        expect(barPos(mounted, 'c2').width).toBe(secondChildBefore.width);

        // SummaryBar has no onDateChange at all (SummaryBar.tsx:145-150):
        // a summary move is never reported as one, and its commit reaches
        // the consumer through onResizeEnd instead. Pre-existing gap
        // (digest chain D), pinned so the flip does not hide it.
        expect(changes).toEqual([]);
        expect(resizeEnds).toEqual(['p1']);
        // …and it carries the summary's own rect, taken from the map
        // `batchMovePositions` returns rather than read back off the store.
        expect(resizeGeometry).toHaveLength(1);
        expect(resizeGeometry[0]!.x).toBe(summaryBefore.x + snappedDelta);
        expect(resizeGeometry[0]!.width).toBe(summaryBefore.width);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// The acceptance criterion: does onDragEnd use the geometry the final move
// WROTE, or does it re-read the store?
//
// On 1.9 those two are the same value, so a full mount cannot tell them
// apart — the re-read at useBarDrag.ts:271 gives the right answer by luck.
// The only discriminating harness is a store double that DEFERS its writes,
// i.e. the "temporarily forced stale read" the criterion asks for. It is
// built at hook level because a mounted <Gantt> owns its task store and
// there is no seam to inject one.
// ═══════════════════════════════════════════════════════════════════════════

const HOOK_BAR_X = 0;
const HOOK_BAR_WIDTH = 100;

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
        _bar: { x: HOOK_BAR_X, y: 0, width: HOOK_BAR_WIDTH, height: 30 },
        dependencies: [],
        constraints,
        ...overrides,
    };
}

const HOOK_COLUMN_WIDTH = 20;
/**
 * Deliberately NOT a whole number of columns (2.5 of them), so the committed
 * x below can only be produced by snapToGrid: `Math.round(50 / 20) * 20`.
 */
const HOOK_DRAG_DELTA = 50;
/** Where snapToGrid puts the bar: 3 columns, not the raw 50px. */
const HOOK_SNAPPED_X = 60;

interface DeferredHarness {
    /** The store the drag writes through — every write is queued. */
    taskStore: TaskStore;
    /** Apply the queued writes. Deliberately NOT called settle(). */
    commit: () => void;
    /** The geometry each onDateChange call reported. */
    reported: Array<{ x: number; width: number }>;
    /** The progress each onProgressChange call reported. */
    progressReports: number[];
    /** Which taskStore method each queued write came from, in order. */
    writes: string[];
    /** Run the whole gesture: press at 100, release at 100 + delta. */
    drag: (delta: number, state?: DragState) => void;
    /** The committed geometry of the dragged bar. */
    committed: () => { x: number; width: number };
}

/**
 * useBarDrag driven against a store whose writes are queued instead of
 * applied. Geometry accessors read the REAL store, so they report the
 * committed value — which is what `onDragEnd`'s re-read sees too.
 */
function mountDeferredDrag(): DeferredHarness {
    const real = createTaskStore();
    real.updateTask('t1', makeTask('t1'));
    // The FIXTURE must be committed before the gesture starts — a mounted
    // chart seeds its store many turns before a mousedown. Without this the
    // bar would still be invisible at `onDragStart`, and the gesture would
    // capture width 0 as its original geometry, testing the harness rather
    // than the hook. Only the DRAG's writes are meant to stay uncommitted.
    settle();

    const queued: Array<() => void> = [];
    const writes: string[] = [];
    const taskStore: TaskStore = {
        ...real,
        updateBarPosition: (id, position) => {
            writes.push('updateBarPosition');
            queued.push(() => real.updateBarPosition(id, position));
        },
        updateTask: (id, taskData) => {
            writes.push('updateTask');
            queued.push(() => real.updateTask(id, taskData));
        },
        setTaskProgress: (id, progress) => {
            writes.push('setTaskProgress');
            queued.push(() => real.setTaskProgress(id, progress));
        },
        batchMovePositions: (originals, deltaX) => {
            writes.push('batchMovePositions');
            queued.push(() => real.batchMovePositions(originals, deltaX));
            // The real store builds this off its DRAFT and returns it — the
            // whole point being that the caller cannot read the result back.
            // The double owes the same contract: report what the queued
            // write will apply, while the committed store still says
            // otherwise.
            const applied = new Map<string, BarPosition>();
            for (const [id, { originalX }] of originals) {
                const bar = real.getBarPosition(id);
                if (bar) applied.set(id, { ...bar, x: originalX + deltaX });
            }
            return applied;
        },
    };

    const reported: Array<{ x: number; width: number }> = [];
    const progressReports: number[] = [];
    const { drag, dispose } = createRoot((d) => ({
        drag: useBarDrag({
            taskStore,
            handlers: {
                // FIDELITY, not decoration: a mounted chart ALWAYS supplies
                // this (TaskLayer.tsx:102-123 passes handleCollectDependents
                // unconditionally) and collectDependentTasks seeds `visited`
                // with the dragged task itself (constraintEngine.ts:957-965),
                // so `dependentOriginals` is never empty and a bar move
                // always writes through `batchMovePositions`. The
                // `updateBarPosition` fallback at useBarDrag.ts:153-165 is
                // dead code for `dragging_bar` in the real component; a
                // harness that drove it would characterize a path E2.7 could
                // "fix" while the shipped one stayed broken. The test below
                // asserts which branch actually ran.
                onCollectDependents: (taskId) => new Set([taskId]),
                onDateChange: (_id, position) => {
                    reported.push(position);
                },
                onProgressChange: (_id, progress) => {
                    progressReports.push(progress);
                },
            },
            taskInfo: () => ({
                id: 't1',
                progress: real.getTask('t1')?.progress ?? 0,
            }),
            x: () => real.getBarPosition('t1')?.x ?? 0,
            y: () => 0,
            width: () => real.getBarPosition('t1')?.width ?? 0,
            columnWidth: () => HOOK_COLUMN_WIDTH,
            ignoredPositions: () => [],
            minWidth: () => HOOK_COLUMN_WIDTH,
        }),
        dispose: d,
    }));
    disposeHook = dispose;

    return {
        taskStore,
        commit: () => {
            queued.splice(0).forEach((write) => write());
        },
        reported,
        progressReports,
        writes,
        drag: (delta: number, state: DragState = 'dragging_bar') => {
            // startDrag is called directly: the event is never dispatched,
            // so currentTarget/target are null and useDrag falls through to
            // identity coordinates (useDrag.ts:115). mousemove/mouseup still
            // go through the real document listeners it registered.
            drag.startDrag(mouse('mousedown', 100, 0), state, {
                taskId: 't1',
            });
            settle();
            document.dispatchEvent(mouse('mousemove', 100 + delta, 0));
            settle();
            document.dispatchEvent(mouse('mouseup', 100 + delta, 0));
            settle();
        },
        committed: () => {
            const position = real.getBarPosition('t1');
            expect(position).not.toBe(null);
            return { x: position!.x, width: position!.width };
        },
    };
}

describe('drag-end geometry against a deferred-write store', () => {
    // Un-skipped by E2.7 (gantt-b4m.7). The store here NEVER commits — the
    // harness queues every write and `commit()` is not called — so nothing
    // the drag wrote is readable from the store at any point in the gesture.
    // Passing therefore proves the report comes from the drag data
    // (`data.lastGeom`, recorded by the batch-move branch out of the map
    // `batchMovePositions` returns) and not from `getBarPosition`, which
    // still answers with the pre-gesture rect. No flush can rescue this
    // shape, which is exactly why it is the one that pins the design.
    it('onDateChange reports the geometry the FINAL move wrote', () => {
        const harness = mountDeferredDrag();

        harness.drag(HOOK_DRAG_DELTA);

        expect(harness.reported).toEqual([
            { x: HOOK_SNAPPED_X, width: HOOK_BAR_WIDTH },
        ]);
    });

    // The other two write branches, against the same never-committing store.
    // A mounted chart cannot tell these apart — `useDrag.handleMouseUp`
    // flushes before `onDragEnd`, so a store re-read happens to give the
    // same answer — which is exactly why they are pinned here instead.
    it('a right-edge resize reports the width the move wrote', () => {
        const harness = mountDeferredDrag();

        harness.drag(HOOK_DRAG_DELTA, 'dragging_right');

        expect(harness.writes).toEqual(['updateBarPosition']);
        expect(harness.reported).toEqual([
            { x: HOOK_BAR_X, width: HOOK_BAR_WIDTH + HOOK_SNAPPED_X },
        ]);
        // Still uncommitted: the report cannot have come from the store.
        expect(harness.committed()).toEqual({
            x: HOOK_BAR_X,
            width: HOOK_BAR_WIDTH,
        });
    });

    it('a progress drag reports the progress the move wrote', () => {
        const harness = mountDeferredDrag();

        // Release past the bar's right edge, so the clamp pins progress at
        // 100 — distinct from the fixture's committed 0 either way.
        harness.drag(HOOK_DRAG_DELTA, 'dragging_progress');

        expect(harness.writes).toEqual(['setTaskProgress']);
        expect(harness.progressReports).toEqual([100]);
    });
});
