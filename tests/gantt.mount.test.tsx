/**
 * E1.1 — first-paint behaviour of a mounted `<Gantt>` on solid-js 2.0.
 *
 * Originally a CHARACTERIZATION suite written on 1.9 so the flip to SolidJS
 * 2.0 (E3) would arrive as a named regression list; the flip landed and every
 * chain below is repaired, so these now assert the shipped contract.
 *
 * Everything geometric is pinned as a MEASURED ABSOLUTE (see `EXPECTED`),
 * never as a re-derivation of the formula the implementation uses. Relative
 * assertions — "t1 is left of t2", "t1 and t3 are the same width" — were
 * tried first and thrown out: `computeX` is linear in `ganttStart` so a
 * window collapsed onto `new Date()` preserves the ordering exactly, and
 * `computeWidth` never reads `ganttStart` at all, so equal-duration bars have
 * equal widths under any window. Those assertions could not fail for the
 * regression this file exists to catch.
 *
 * Chains pinned (see docs/migration/solid2/PLAN.md and digest-t1/digest-t2):
 *
 *   chain A — blank first paint. `ganttSetup.initializeTasks` used to write
 *     the date store and then read five accessors back (`ganttStart`,
 *     `ganttEnd`, `unit`, `step`, `columnWidth`), and to write the resource
 *     list and then read `resourceIndexMap()` back. Under 2.0's deferred
 *     writes both read-backs return the value from BEFORE the write: bars
 *     would be positioned against the `new Date()` defaults and every task
 *     would fall to `_resourceIndex === -1` / `_isHidden === true` — a blank
 *     chart. The tripwires here are the absolute window (`dates().length`,
 *     `ganttStart`, `ganttEnd`), the absolute `_bar` geometry, `_bar.x ===
 *     dateToX(_start)` (which re-reads the window off the LIVE store at
 *     assert time, so it reds on its own when only the store side of the
 *     read-back goes stale and the stored geometry is still the measured
 *     one), the
 *     `_resourceIndex`/`_isHidden` row assertions, and the rendered
 *     `.bar-wrapper[data-id]` set. Repaired by E2.1 + E2.2.
 *
 *   chain I — the container handshake. `GanttContainer`'s mount callback
 *     constructs a `ResizeObserver` and calls `onContainerReady`, and
 *     `useGanttScroll.handleContainerReady` used to create six
 *     `createEffect`s inside that callback. Under `onSettled`'s
 *     children-forbidden body (GanttContainer.tsx:142) that throws and the
 *     mount dies. Every case in this file mounting at all is the tripwire.
 *     Repaired by E2.6.
 *
 *   chain J2 — the config mirror. `initializeTasks` copies the date store's
 *     `unit`/`step`/`columnWidth` into the config store. On the default Day
 *     fixture that copy is INVISIBLE: both stores independently default to
 *     `'day'` / `1` / `DEFAULT_COLUMN_WIDTH`, so comparing them would hold
 *     with the five setter calls deleted. The load-bearing case is therefore
 *     the `viewMode: 'Month'` one below, where the date store derives
 *     `'month'` / `1` / `120` from the view mode and the config store's own
 *     defaults are still `'day'` / `1` / `45`. Repaired by E2.2 + E2.4.
 *
 *   lib-gantt showstoppers —
 *     (a) `GanttStores.tsx:30` builds a default-less
 *         `createContext<GanttStores>()`. In 2.0 `useContext` on such a
 *         context THROWS rather than returning `undefined`, which kills the
 *         bare `<Gantt tasks={...} />` form specifically. The bare/provider
 *         pair of cases exists so that failure can be told apart from a
 *         general mount failure. A third case gives the provider a view mode
 *         `<Gantt>` was not told about, so "provider used" is distinguishable
 *         from "provider silently ignored" — `Gantt.tsx:171` is
 *         `provided ?? own` and publishes whichever it picked, so nothing
 *         else in this file can tell the two apart. Repaired by E2.10.
 *     (b) `onReady` is a consumer callback fired out of a lifecycle scope.
 *         E0.6 already deferred it with `queueMicrotask` behind a disposal
 *         guard; the "not yet at mount, exactly once after one microtask"
 *         case pins that deferral so the `onSettled` rewrite did not quietly
 *         drop it, and nothing later can.
 *     (c) `onSelectionChange` used to be invoked from a `createEffect`'s
 *         tracked body. E3.2 split that effect, so the call now lives in the
 *         untracked apply half; the mount-time empty-Set call and the
 *         synchronous post-click call pinned below both had to survive the
 *         split.
 *
 * Deliberately absent: `it.skip`. Every chain above was a deferred-write
 * hazard under `@solidjs/signals`; all of them were repaired by E2.x before
 * the flip, so the whole file must be green on 2.0.0-rc.6.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountGantt, type MountedGantt } from './helpers/mountGantt';
import { settle } from './helpers/settle';
import type { GanttAPI } from '../src/components/Gantt';
import type { GanttTask, ProcessedTask } from '../src/types';

/**
 * Three tasks over two resources, with explicit 2025 start AND end.
 *
 * `end` is not optional in practice: `setupDates` derives `ganttEnd` from the
 * task list, and a missing `end` parses to an Invalid Date that propagates to
 * an empty `dates()` with no throw at all. The dates are also kept within a
 * few days of each other so no bar is culled by the `xRange` window before it
 * reaches the DOM.
 */
const TASKS: GanttTask[] = [
    {
        id: 't1',
        name: 'T1',
        start: '2025-01-01 08:00',
        end: '2025-01-03 16:00',
        resource: 'R1',
    },
    {
        id: 't2',
        name: 'T2',
        start: '2025-01-02 08:00',
        end: '2025-01-05 16:00',
        resource: 'R2',
    },
    {
        id: 't3',
        name: 'T3',
        start: '2025-01-06 08:00',
        end: '2025-01-08 16:00',
        resource: 'R1',
    },
];

/**
 * First-appearance order of `task.resource` — `resourceProcessor` numbers the
 * swimlanes in the order the task list mentions them, not alphabetically, and
 * that number is both `_resourceIndex` and the bar's row.
 */
const RESOURCE_ROWS = ['R1', 'R2'] as const;

/**
 * Every number below was MEASURED against a real mount (originally on
 * solid-js 1.9.12, re-verified on 2.0.0-rc.6) — none of it is recomputed
 * here from the formula under test.
 *
 * How each falls out, for the reader who needs to re-derive one by hand after
 * a deliberate fixture change (do NOT put these derivations in an assertion —
 * that is exactly the self-consistency trap this table replaces):
 *   window   Day mode pads `7d` either side of the task bounds and aligns the
 *            start to midnight: 2025-01-01 − 7d → 2024-12-25 00:00, and
 *            2025-01-08 16:00 + 7d → 2025-01-15 16:00. 22 whole-day columns
 *            fit in that half-open window.
 *   x / w    `diff()` rounds to 2 decimals and multiplies by columnWidth 45,
 *            so t1 sits at 7.33 d × 45 = 329.85 and spans 2.33 d × 45
 *            (the trailing `…001` is the IEEE-754 product, pinned as-is).
 *   y        row × (barHeight 30 + padding 18) + padding / 2 → 9 and 57.
 *
 * `diff()` corrects for the timezone offset delta (dateUtils.ts:226-228) and
 * the dates are built with local-time constructors, so this table is
 * timezone- and DST-independent; it is not dependent on today's date either,
 * because the window is derived from the fixture, not from `new Date()`.
 */
const EXPECTED = {
    dateCount: 22,
    ganttStart: new Date(2024, 11, 25, 0, 0, 0, 0),
    ganttEnd: new Date(2025, 0, 15, 16, 0, 0, 0),
    unit: 'day',
    step: 1,
    columnWidth: 45,
    barHeight: 30,
    padding: 18,
    bars: {
        t1: { row: 0, x: 329.85, y: 9, width: 104.85000000000001 },
        t2: { row: 1, x: 374.85, y: 57, width: 149.85 },
        t3: { row: 0, x: 554.85, y: 9, width: 104.85000000000001 },
    } as Record<string, { row: number; x: number; y: number; width: number }>,
};

/**
 * The same mount with `options: { viewMode: 'Month' }`, measured the same
 * way. The point of this second table is that the config store's OWN
 * defaults ('day' / 1 / 45) differ from every value in it, so the
 * config-mirror assertions have something to fail against.
 */
const EXPECTED_MONTH = {
    dateCount: 5,
    ganttStart: new Date(2024, 10, 1, 0, 0, 0, 0),
    unit: 'month',
    step: 1,
    columnWidth: 120,
    x: { t1: 244.8, t2: 249.60000000000002, t3: 265.2 } as Record<
        string,
        number
    >,
};

let mounted: MountedGantt | undefined;

afterEach(() => {
    mounted?.dispose();
    mounted = undefined;
});

/**
 * Ids of the bars that actually carry a task. An unused pool slot still
 * renders a `<Bar>`, but its `t()` memo falls back to a default task whose id
 * is `''`, so only a non-empty `data-id` means a painted task.
 */
const paintedIds = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll<HTMLElement>('.bar-wrapper[data-id]'))
        .map((el) => el.dataset['id'])
        .filter((id): id is string => id !== undefined && id !== '')
        .sort();

const wrapperFor = (root: HTMLElement, id: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(`.bar-wrapper[data-id="${id}"]`);
    expect(el).not.toBe(null);
    return el!;
};

/**
 * The whole of chain A, read back off the stores the mounted chart published.
 * Shared by the bare and the `<GanttProvider>` case so any divergence between
 * the two forms shows up as a diff rather than as two hand-written variants.
 */
const expectChainAHolds = (m: MountedGantt): void => {
    const { taskStore, ganttConfig, dateStore } = m.stores;

    // The date window was committed before anything read it back. Pinned in
    // absolute terms: a `new Date()`-defaulted window produces an empty
    // `dates()` (generateDates loops `while (current < end)`), and any
    // regression that moves the window CONSISTENTLY — in the store and in
    // the config snapshot alike, e.g. a changed DEFAULT_COLUMN_WIDTH or a
    // changed padding — is invisible to every relative assertion but red
    // here.
    expect(dateStore.dates().length).toBe(EXPECTED.dateCount);
    expect(dateStore.ganttStart().getTime()).toBe(
        EXPECTED.ganttStart.getTime(),
    );
    expect(dateStore.ganttEnd().getTime()).toBe(EXPECTED.ganttEnd.getTime());
    expect(dateStore.dates()[0]!.getTime()).toBe(EXPECTED.ganttStart.getTime());
    expect(dateStore.unit()).toBe(EXPECTED.unit);
    expect(dateStore.step()).toBe(EXPECTED.step);
    expect(dateStore.columnWidth()).toBe(EXPECTED.columnWidth);

    // …and the config store mirrors it, which is what `initializeTasks`
    // hands to `computeX` as `config` (chain J2). ganttStart/ganttEnd are
    // real tripwires here — the config store defaults them to `new Date()`,
    // so a dropped `setGanttStart` shows up immediately. unit/step/
    // columnWidth are NOT: on the Day fixture both stores default to the
    // same 'day' / 1 / 45, so the copy is unobservable. They are pinned
    // absolutely anyway (a default change is a named failure, not a silent
    // one), and the case that actually exercises the copy is the
    // `viewMode: 'Month'` one below.
    expect(ganttConfig.ganttStart().getTime()).toBe(
        EXPECTED.ganttStart.getTime(),
    );
    expect(ganttConfig.ganttEnd().getTime()).toBe(EXPECTED.ganttEnd.getTime());
    expect(ganttConfig.unit()).toBe(EXPECTED.unit);
    expect(ganttConfig.step()).toBe(EXPECTED.step);
    expect(ganttConfig.columnWidth()).toBe(EXPECTED.columnWidth);
    expect(ganttConfig.barHeight()).toBe(EXPECTED.barHeight);
    expect(ganttConfig.padding()).toBe(EXPECTED.padding);

    const tasks = taskStore.getAllTasks();
    expect(tasks.map((t: ProcessedTask) => t.id).sort()).toEqual([
        't1',
        't2',
        't3',
    ]);

    for (const task of tasks) {
        const want = EXPECTED.bars[task.id]!;

        // The resource index map was populated before the tasks were placed.
        // An empty map gives -1 / hidden / y = -1000 and a blank chart.
        expect(task._resourceIndex).toBe(want.row);
        expect(task._isHidden).toBe(false);

        // Absolute geometry, measured — not `row * (barHeight + padding) +
        // padding / 2`, which is `computeY`'s own body and stays true of a
        // wrong implementation.
        expect(task._bar.x).toBe(want.x);
        expect(task._bar.y).toBe(want.y);
        expect(task._bar.width).toBe(want.width);

        // Independently: the stored x still agrees with a LIVE date-store
        // read. Not redundant with the absolute above. That one pins the
        // number `initializeTasks` computed from its config SNAPSHOT
        // (ganttSetup.ts:75-84); this one re-reads ganttStart/unit/step/
        // columnWidth off the store at assert time. A 2.0 read-back that
        // goes stale on only one of those two paths reds exactly one of
        // these two lines — measured: perturbing `dateToX` alone leaves
        // every absolute green and reds only this.
        expect(task._bar.x).toBe(dateStore.dateToX(task._start));
    }
};

/**
 * `TaskLayer` renders POOLED `<Index>` arrays that grow to the high-water
 * task count plus a fixed buffer and never shrink, so the DOM holds far more
 * `.bar` elements than there are tasks. Today: 8 regular slots + 5 summary
 * slots = 13 `.bar`.
 *
 * The buffer itself is deliberately NOT asserted — it is a private perf-tuning
 * constant (`POOL_BUFFER`, useTaskVirtualization.ts:20, not exported) and
 * bumping it is not a regression. Both pools add the SAME buffer to their own
 * high-water count, and this fixture has no summary tasks, so the difference
 * between the two pool sizes is exactly the task count whatever the buffer is
 * — and collapses to 0 on a blank chart.
 */
const slotCounts = (
    root: HTMLElement,
): { regular: number; summary: number; bars: number; wrappers: number } => ({
    regular: root.querySelectorAll('.bar-wrapper[data-id]').length,
    summary: root.querySelectorAll('.summary-bar-wrapper').length,
    bars: root.querySelectorAll('.bar').length,
    wrappers: root.querySelectorAll('.bar-wrapper').length,
});

describe('<Gantt> first paint (chain A, chain I)', () => {
    it('paints exactly one bar per task, bare', () => {
        mounted = mountGantt({ tasks: TASKS });
        settle();

        expect(mounted.container.querySelector('.gantt-container')).not.toBe(
            null,
        );
        expect(paintedIds(mounted.container)).toEqual(['t1', 't2', 't3']);

        // One swimlane per resource, in first-appearance order.
        expect(
            Array.from(
                mounted.container.querySelectorAll('.resource-cell'),
            ).map((cell) => cell.querySelector('.resource-name')?.textContent),
        ).toEqual([...RESOURCE_ROWS]);

        // Pooling artefact, pinned on purpose: `.bar` counts SLOTS, not
        // tasks (13 today). A blank chart still renders both buffers, so a
        // test that counted `.bar` against 3 (as the issue text originally
        // proposed) would pass against the very regression this file exists
        // to catch, and one that counted it against 13 would go red on a
        // POOL_BUFFER bump that breaks nothing.
        const slots = slotCounts(mounted.container);
        expect(slots.regular - slots.summary).toBe(TASKS.length);
        expect(slots.bars).toBe(slots.regular + slots.summary);
        expect(slots.wrappers).toBe(slots.regular + slots.summary);
    });

    it('gives every task a row and a bar placed on the committed timeline, bare', () => {
        mounted = mountGantt({ tasks: TASKS });
        settle();

        expectChainAHolds(mounted);
    });

    it('paints and places identically inside <GanttProvider>', () => {
        mounted = mountGantt({ tasks: TASKS }, { provider: true });
        settle();

        expect(paintedIds(mounted.container)).toEqual(['t1', 't2', 't3']);
        expectChainAHolds(mounted);
    });

    it('uses the surrounding <GanttProvider> stores rather than building its own', () => {
        // `<Gantt>` is handed NO `options`, so the stores it would build for
        // itself are a Day timeline ('day' / 1 / 45, window 2024-12-25). The
        // provider's are a Month timeline. Since `Gantt.tsx:171` publishes
        // whichever set it picked, these month-only values are the only
        // evidence in the suite that the context was actually consulted.
        mounted = mountGantt(
            { tasks: TASKS },
            { provider: true, providerOptions: { viewMode: 'Month' } },
        );
        settle();

        const { dateStore, ganttConfig, taskStore } = mounted.stores;
        expect(dateStore.unit()).toBe(EXPECTED_MONTH.unit);
        expect(dateStore.columnWidth()).toBe(EXPECTED_MONTH.columnWidth);
        expect(dateStore.dates().length).toBe(EXPECTED_MONTH.dateCount);
        expect(dateStore.ganttStart().getTime()).toBe(
            EXPECTED_MONTH.ganttStart.getTime(),
        );
        expect(ganttConfig.columnWidth()).toBe(EXPECTED_MONTH.columnWidth);

        // The chart still paints, on the provider's timeline.
        expect(paintedIds(mounted.container)).toEqual(['t1', 't2', 't3']);
        for (const task of taskStore.getAllTasks()) {
            expect(task._bar.x).toBe(EXPECTED_MONTH.x[task.id]);
        }
    });

    it('mirrors the date store view-mode geometry into the config store', () => {
        // The Day fixture cannot see this copy: `createGanttConfigStore`
        // defaults to 'day' / 1 / DEFAULT_COLUMN_WIDTH, the same values
        // `createGanttDateStore` derives from the Day view mode, so
        // `ganttConfig.unit() === dateStore.unit()` holds with
        // `initializeTasks`' five setter calls deleted. Under Month the
        // date store derives 'month' / 1 / 120 while the config store still
        // starts at 'day' / 1 / 45, so only a real read-back makes these
        // pass.
        mounted = mountGantt({ tasks: TASKS, options: { viewMode: 'Month' } });
        settle();

        const { dateStore, ganttConfig } = mounted.stores;
        expect(dateStore.unit()).toBe(EXPECTED_MONTH.unit);
        expect(dateStore.step()).toBe(EXPECTED_MONTH.step);
        expect(dateStore.columnWidth()).toBe(EXPECTED_MONTH.columnWidth);

        expect(ganttConfig.unit()).toBe(EXPECTED_MONTH.unit);
        expect(ganttConfig.step()).toBe(EXPECTED_MONTH.step);
        expect(ganttConfig.columnWidth()).toBe(EXPECTED_MONTH.columnWidth);
        expect(ganttConfig.ganttStart().getTime()).toBe(
            EXPECTED_MONTH.ganttStart.getTime(),
        );
    });

    it('positions each painted bar at its stored x', () => {
        mounted = mountGantt({ tasks: TASKS });
        settle();

        for (const task of mounted.stores.taskStore.getAllTasks()) {
            const want = EXPECTED.bars[task.id]!;
            const wrapper = wrapperFor(mounted.container, task.id);

            // Absolute: the painted transform, not just "some transform".
            expect(wrapper.style.transform).toBe(
                `translate(${want.x}px, ${want.y}px)`,
            );
            expect(wrapper.style.width).toBe(`${want.width}px`);

            // …and it is THIS task's geometry, not a neighbour's. Bar.tsx
            // reads `_bar.x`/`_bar.width` straight off the task object, so a
            // pooled `<Index>` binding the wrong task to a slot shows up
            // here even when every individual number is a legal one.
            expect(wrapper.style.transform).toBe(
                `translate(${task._bar.x}px, ${task._bar.y}px)`,
            );
            expect(wrapper.style.width).toBe(`${task._bar.width}px`);
        }
    });
});

describe('<Gantt> consumer callbacks at first paint', () => {
    it('calls onSelectionChange once at mount with an empty Set', () => {
        const onSelectionChange = vi.fn<(ids: Set<string>) => void>();
        mounted = mountGantt({ tasks: TASKS, onSelectionChange });
        settle();

        // Fired from the compute half of Gantt.tsx's selection effect, before
        // any interaction. Consumers see an empty Set first, always.
        expect(onSelectionChange).toHaveBeenCalledTimes(1);
        const first = onSelectionChange.mock.calls[0]![0];
        expect(first).toBeInstanceOf(Set);
        expect(first.size).toBe(0);
    });

    it('reports a clicked task through onSelectionChange, synchronously', () => {
        const onSelectionChange = vi.fn<(ids: Set<string>) => void>();
        mounted = mountGantt({ tasks: TASKS, onSelectionChange });
        settle();
        const callsBeforeClick = onSelectionChange.mock.calls.length;

        wrapperFor(mounted.container, 't2').dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
        settle();

        const calls = onSelectionChange.mock.calls;
        expect(calls.length).toBe(callsBeforeClick + 1);
        const latest = calls[calls.length - 1]![0];
        expect(latest).toBeInstanceOf(Set);
        expect([...latest]).toEqual(['t2']);

        // …and the selection reaches the painted bar, not just the callback.
        expect(
            wrapperFor(mounted.container, 't2').getAttribute('aria-selected'),
        ).toBe('true');
        expect(
            wrapperFor(mounted.container, 't1').getAttribute('aria-selected'),
        ).toBe(null);
    });

    it('fires onReady one microtask after mount, exactly once, with the export api', async () => {
        const onReady = vi.fn<(api: GanttAPI) => void>();
        mounted = mountGantt({ tasks: TASKS, onReady });
        settle();

        // Deferred by `queueMicrotask` (E0.6) so the consumer never runs
        // inside the mount scope: nothing yet on the synchronous path.
        expect(onReady).not.toHaveBeenCalled();

        await Promise.resolve();
        expect(onReady).toHaveBeenCalledTimes(1);

        const api = onReady.mock.calls[0]![0];
        expect(typeof api.exportSvg).toBe('function');
        expect(typeof api.exportSvgBlob).toBe('function');
        expect(typeof api.exportPng).toBe('function');

        // Once means once — not once per effect re-run.
        await Promise.resolve();
        await Promise.resolve();
        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('does not fire onReady when the chart is disposed within the same tick', async () => {
        const onReady = vi.fn<(api: GanttAPI) => void>();
        const local = mountGantt({ tasks: TASKS, onReady });
        settle();
        local.dispose();

        await Promise.resolve();
        expect(onReady).not.toHaveBeenCalled();
    });
});
