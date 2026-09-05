/**
 * E4.6 — the dev-diagnostics gate.
 *
 * The automated form of "open every demo in Chrome and check the console is
 * clean". SolidJS 2.0 reports every dev-mode violation it can detect —
 * untracked strict reads (`STRICT_READ_UNTRACKED`), writes inside an owned
 * scope (`REACTIVE_WRITE_IN_OWNED_SCOPE`, which also throws), lifecycle
 * misuse in `onSettled` (`CLEANUP_IN_FORBIDDEN_SCOPE`,
 * `PRIMITIVE_IN_FORBIDDEN_SCOPE`, `SETTLED_CLEANUP_UNOWNED`), unowned effects
 * (`NO_OWNER_EFFECT`) — on a structured channel, and
 * `tests/helpers/diagnostics.ts` taps it.
 *
 * Everything the flip fixed comes back as a diagnostic here if it regresses,
 * whatever else stays green. The rest of the suite asserts VALUES; this file
 * asserts that the values were produced without the runtime complaining on
 * the way.
 *
 * ── Scope ────────────────────────────────────────────────────────────────
 * One chart of 50 tasks over 5 resources, driven through the gestures that
 * touch the most reactive surface:
 *
 *   1. mount            — component bodies, every store's construction,
 *                         `onSettled` / `onContainerReady`, first paint
 *   2. drag             — `useDrag`'s rAF loop, `useBarDrag`'s store writes,
 *                         the sanctioned `flush()` in `handleMouseUp`
 *   3. expand/collapse  — `ganttConfigStore`'s expandedTasks signal, the
 *                         `rowLayouts` memo, the `_bar.y` sync effect
 *   4. view-mode switch — the `props.options` effects, `changeViewMode`,
 *                         `runSetup`, and the timeline re-derivation
 *   5. dispose          — teardown of every owner the mount created
 *
 * plus a second mount with custom `columns`, which swaps `ResourceColumn`
 * for `ColumnPanel` — a different tree, with per-row render callbacks that
 * read task state.
 *
 * Every phase is pinned to an OBSERVABLE effect before its diagnostics are
 * asserted (a bar that moved, a chart that grew, a column header that
 * rendered). A gesture that quietly did nothing emits no diagnostics either,
 * and would make this file a very convincing no-op.
 *
 * ── The one tolerated diagnostic ─────────────────────────────────────────
 * `KNOWN_OPEN` holds it, and it is subtracted ONCE from the phase named —
 * see the comment on the constant. Everything else, in every phase, must be
 * silent.
 *
 * ── Assertion severity ───────────────────────────────────────────────────
 * `error` and `warn` fail; `info` does not. That is the package's own advice
 * (`DiagnosticSeverity` in `@solidjs/signals`: "budget/assertion consumers
 * should treat only warn/error as failures"). The only `info` today is the
 * depth-2 `ASYNC_WATERFALL` advisory, which needs the attribution engine
 * switched on to fire at all.
 *
 * `NO_OWNER_EFFECT` is pre-authorised by the issue for unowned test-local
 * stores. Nothing here creates one — every store is built inside the mounted
 * component, and the positive control below builds its effect in a
 * `createRoot` — so it is deliberately NOT allow-listed. If a future test in
 * this file needs an unowned store, allow it there, not globally.
 *
 * ── Why the phases share one test ────────────────────────────────────────
 * They share one mount, so they are one `it` with an assert-and-clear
 * between phases: the failure message names the phase, and the file spends
 * one mount instead of five. `mountGantt` allows only one live chart at a
 * time anyway (it publishes `window.__gantt*`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { mountGantt, type MountedGantt } from './helpers/mountGantt';
import { settle } from './helpers/settle';
import {
    startDiagnostics,
    withDiagnostics,
    formatDiagnostics,
    type DiagnosticRecord,
    type DiagnosticSession,
} from './helpers/diagnostics';
import type { ColumnDef } from '../src/components/ColumnPanel';
import type { GanttTask, ProcessedTask } from '../src/types';

/**
 * Diagnostics this gate knowingly tolerates, keyed by phase. Each entry is
 * subtracted AT MOST ONCE from that phase's events, so a second instance —
 * or the same code in another phase — still fails.
 *
 * `view-mode switch` → `STRICT_READ_UNTRACKED`:
 *   `src/components/Gantt.tsx:349`, the apply of the deferred view-mode
 *   effect, reads the `effectiveTasks()` memo directly:
 *
 *       (viewMode) => {
 *           ...
 *           const tasks = effectiveTasks();      // <- strict read
 *           if (tasks && tasks.length > 0) runSetup(tasks);
 *       }
 *
 *   An effect's apply is a strict-read scope in 2.0, so the one-shot read
 *   warns. It is a genuine library defect, not a test artefact: the fix is
 *   `untrack(() => effectiveTasks())` (the read is deliberately one-shot —
 *   the effect already tracks `props.options?.viewMode` and must not also
 *   re-run on every task edit). It fires only on a view-mode CHANGE, which
 *   is why the mount-time strict-read cleanup (E4.3) did not catch it.
 *
 *   `src/components/Gantt.tsx` belongs to a sibling agent this wave, so it
 *   is not fixed here. DELETE THIS ENTRY once the read is untracked — the
 *   subtraction is "at most once", so the gate stays green either way, but
 *   a stale entry means tolerating a diagnostic that no longer exists.
 */
const KNOWN_OPEN: Readonly<Record<string, readonly string[]>> = {
    'view-mode switch': ['STRICT_READ_UNTRACKED'],
};

const RESOURCES = ['R1', 'R2', 'R3', 'R4', 'R5'] as const;

const day = (n: number): string =>
    `${new Date(Date.UTC(2025, 0, 6 + n)).toISOString().slice(0, 10)} 08:00`;

/**
 * 50 tasks over 5 resources: 5 summaries (one per resource) with 3 children
 * each, and 30 leaf tasks chained FS within their resource so the arrow
 * layer and the constraint engine both have work to do. 5 + 15 + 30 = 50.
 */
function buildTasks(): GanttTask[] {
    const tasks: GanttTask[] = [];

    RESOURCES.forEach((resource, r) => {
        const parentId = `s${r + 1}`;
        tasks.push({
            id: parentId,
            name: `Summary ${r + 1}`,
            start: day(r * 2),
            end: day(r * 2 + 6),
            type: 'summary',
            // `parallel` is what makes expand/collapse visible at all:
            // `calculateExpandedRowHeight` returns the plain row height for
            // the default `sequential` layout, so a sequential expansion
            // changes no geometry and the phase would assert nothing.
            subtaskLayout: 'parallel',
            resource,
        });
        for (let c = 0; c < 3; c++) {
            tasks.push({
                id: `${parentId}c${c + 1}`,
                name: `Child ${r + 1}.${c + 1}`,
                start: day(r * 2 + c * 2),
                end: day(r * 2 + c * 2 + 1),
                progress: 25 * c,
                parentId,
                resource,
            });
        }
    });

    for (let i = 0; i < 30; i++) {
        const resource = RESOURCES[i % RESOURCES.length]!;
        const previous =
            i >= RESOURCES.length ? `t${i - RESOURCES.length}` : null;
        tasks.push({
            id: `t${i}`,
            name: `Task ${i}`,
            start: day(10 + i),
            end: day(12 + i),
            progress: (i * 7) % 100,
            resource,
            ...(previous
                ? { dependencies: [{ id: previous, type: 'FS' as const }] }
                : {}),
        });
    }

    return tasks;
}

const TASKS = buildTasks();

/** The bar the drag phase grabs — a leaf with an FS successor. */
const DRAGGED_ID = 't0';
/** The summary the expand/collapse phase toggles. It has three children. */
const EXPANDED_ID = 's1';

const COLUMNS: ColumnDef[] = [
    { key: 'resource', label: 'Resource', width: 90 },
    {
        key: 'task',
        label: 'Task',
        width: 140,
        render: (task: ProcessedTask | undefined) => task?.name ?? '-',
    },
    {
        key: 'progress',
        label: '%',
        width: 60,
        render: (task: ProcessedTask | undefined) => task?.progress ?? 0,
    },
];

const mouse = (type: string, clientX: number, clientY: number): MouseEvent =>
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });

/** Structurally identical to the DOM's FrameRequestCallback. */
type RafCallback = (time: number) => void;

interface FrameQueue {
    drain: () => void;
    restore: () => void;
}

/**
 * Manual requestAnimationFrame queue. `useDrag`'s rafLoop reschedules itself
 * while a drag is live, so a synchronous stub recurses forever and the real
 * (async) one fires after the mount is disposed. `drain()` runs exactly the
 * callbacks pending when it was called.
 */
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

/** `error`/`warn` events, minus at most one of each code `KNOWN_OPEN` names. */
function failing(events: DiagnosticRecord[], phase = ''): DiagnosticRecord[] {
    const budget = new Map<string, number>();
    for (const code of KNOWN_OPEN[phase] ?? []) {
        budget.set(code, (budget.get(code) ?? 0) + 1);
    }
    const out: DiagnosticRecord[] = [];
    for (const event of events) {
        if (event.severity !== 'error' && event.severity !== 'warn') continue;
        const left = budget.get(event.code) ?? 0;
        if (left > 0) {
            budget.set(event.code, left - 1);
            continue;
        }
        out.push(event);
    }
    return out;
}

let mounted: MountedGantt | undefined;
let session: DiagnosticSession | undefined;
let frames: FrameQueue | undefined;

afterEach(() => {
    try {
        mounted?.dispose();
        mounted = undefined;
    } finally {
        session?.stop();
        session = undefined;
        frames?.restore();
        frames = undefined;
    }
});

describe('dev diagnostics gate', () => {
    it('drives mount, drag, expand/collapse, a view-mode switch and dispose without a diagnostic', () => {
        frames = captureFrames();
        session = startDiagnostics();

        // If solid-js ever resolves to its production build under Vitest the
        // structured channel disappears and this whole file silently passes.
        // Pin the channel so that arrives as a named failure instead.
        expect(session.source).toBe('DEV');

        const expectClean = (phase: string): void => {
            expect(
                formatDiagnostics(failing(session!.take(), phase)),
                phase,
            ).toEqual([]);
        };

        // ── 1. mount ────────────────────────────────────────────────────
        const [viewMode, setViewMode] = createSignal('Day');
        mounted = mountGantt({
            tasks: TASKS,
            // A getter keeps `props.options` reactive through mountGantt's
            // spread, which is what makes the view-mode phase below a real
            // prop change rather than a poke at the store.
            get options() {
                return {
                    viewMode: viewMode(),
                    renderMode: 'detailed',
                    criticalPath: true,
                };
            },
            disableTaskClickModal: true,
        });
        settle();

        expect(
            mounted.container.querySelectorAll('.bar-wrapper[data-id]').length,
        ).toBeGreaterThan(0);
        expectClean('mount');

        // ── 2. drag ─────────────────────────────────────────────────────
        const bar = mounted.container.querySelector(
            `.bar-wrapper[data-id="${DRAGGED_ID}"]`,
        );
        expect(bar).not.toBe(null);

        const columnWidth = mounted.stores.ganttConfig.columnWidth();
        const startX = mounted.stores.taskStore.tasks[DRAGGED_ID]!._bar.x;
        const delta = 4 * columnWidth;

        bar!.dispatchEvent(mouse('mousedown', 500, 20));
        settle();
        document.dispatchEvent(mouse('mousemove', 500 + delta / 2, 20));
        settle();
        // One applied frame, so the rAF path runs mid-gesture instead of
        // collapsing into the mouseup.
        frames.drain();
        settle();
        document.dispatchEvent(mouse('mousemove', 500 + delta, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', 500 + delta, 20));
        settle();

        expect(mounted.stores.taskStore.tasks[DRAGGED_ID]!._bar.x).not.toBe(
            startX,
        );
        expectClean('drag');

        // ── 3. expand / collapse ────────────────────────────────────────
        // Observed through the chart's own height rather than through the
        // store: expanding a summary re-runs `rowLayouts`, which grows that
        // resource's row and therefore the content wrapper.
        const chartHeight = (): number => {
            const el =
                mounted!.container.querySelector<HTMLElement>('.gantt-content');
            return Number.parseFloat(el?.style.height ?? '');
        };
        const collapsedHeight = chartHeight();
        expect(collapsedHeight).toBeGreaterThan(0);

        mounted.stores.ganttConfig.expandTask(EXPANDED_ID);
        settle();
        expect(chartHeight()).toBeGreaterThan(collapsedHeight);
        expectClean('expand');

        mounted.stores.ganttConfig.collapseTask(EXPANDED_ID);
        settle();
        expect(chartHeight()).toBe(collapsedHeight);
        expectClean('collapse');

        // ── 4. view-mode switch ─────────────────────────────────────────
        const chartWidth = (): number => {
            const el =
                mounted!.container.querySelector<HTMLElement>('.gantt-content');
            return Number.parseFloat(el?.style.width ?? '');
        };
        const dayColumnWidth = mounted.stores.dateStore.columnWidth();
        const dayWidth = chartWidth();
        setViewMode('Week');
        settle();
        // Both the timeline and the DOM it drives moved: a switch that only
        // rewrote a store field would leave the grid width alone.
        expect(mounted.stores.dateStore.columnWidth()).not.toBe(dayColumnWidth);
        expect(chartWidth()).not.toBe(dayWidth);
        expectClean('view-mode switch');

        // ── 5. dispose ──────────────────────────────────────────────────
        mounted.dispose();
        mounted = undefined;
        settle();
        expectClean('dispose');
    });

    it('renders the custom-columns panel without a diagnostic', () => {
        const run = withDiagnostics(() => {
            const m = mountGantt({
                tasks: TASKS,
                columns: COLUMNS,
                options: { renderMode: 'detailed' },
            });
            settle();
            return m;
        });
        mounted = run.result;

        expect(run.source).toBe('DEV');
        // The panel really rendered: one header cell per column, and body
        // cells carrying the render callbacks' output.
        expect(
            mounted.container.querySelectorAll('.column-panel-header-cell')
                .length,
        ).toBe(COLUMNS.length);
        expect(
            mounted.container.querySelectorAll('.column-panel-cell').length,
        ).toBeGreaterThan(0);
        expect(formatDiagnostics(failing(run.events))).toEqual([]);
    });

    it('positive control: the capture really sees a strict read', () => {
        // Without this, "no diagnostics" is indistinguishable from "the
        // channel is dead" — a renamed export, a production resolution, a
        // capture that was never registered. This reproduces exactly the
        // shape of the library defect `KNOWN_OPEN` documents: a reactive
        // read in an effect's APPLY, a strict-read scope in 2.0.
        let disposeRoot = (): void => {};
        const run = withDiagnostics(() => {
            createRoot((dispose) => {
                disposeRoot = dispose;
                const [n] = createSignal(0);
                createEffect(
                    () => n(),
                    () => {
                        void n();
                    },
                );
            });
            settle();
        });
        disposeRoot();

        expect(run.source).toBe('DEV');
        expect(run.events.map((e) => e.code)).toEqual([
            'STRICT_READ_UNTRACKED',
        ]);
        expect(run.events[0]!.kind).toBe('strict-read');
        expect(run.events[0]!.severity).toBe('warn');
    });
});
