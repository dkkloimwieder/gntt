import { describe, it, expect, vi } from 'vitest';
import { initializeTasks } from '../src/utils/ganttSetup';
import { createTaskStore } from '../src/stores/taskStore';
import { createGanttConfigStore } from '../src/stores/ganttConfigStore';
import { createGanttDateStore } from '../src/stores/ganttDateStore';
import { createResourceStore } from '../src/stores/resourceStore';
import * as dateUtils from '../src/utils/dateUtils';
import { settle } from './helpers/settle';
import type { GanttTask } from '../src/types';

// The stores are built UNOWNED on purpose — no `createRoot` wrapper. Migration
// rule 10: store writes may sit inside a createRoot body, plain signal writes
// may not, and `createGanttDateStore` / `createResourceStore` are signal-based,
// so wrapping this factory would make every setter throw
// REACTIVE_WRITE_IN_OWNED_SCOPE once the runtime flips. Solid 1.9 logs one
// "computations created outside a createRoot" warning per memo here; that noise
// is expected and is never asserted on.
function makeStores() {
    return {
        taskStore: createTaskStore(),
        ganttConfig: createGanttConfigStore({}),
        dateStore: createGanttDateStore({}),
        resourceStore: createResourceStore([]),
    };
}

const t = (id: string, resource: string): GanttTask => ({
    id,
    name: id,
    start: '2025-01-01 08:00',
    end: '2025-01-01 16:00',
    resource,
});

// Same shape as `t`, but with the dates spelled out — the date-pipeline block
// below needs tasks that actually span different days.
const span = (
    id: string,
    resource: string,
    start: string,
    end: string,
): GanttTask => ({ id, name: id, start, end, resource });

describe('initializeTasks — resource extraction signal', () => {
    it('extracts resources from tasks on first run when no explicit resources', () => {
        const stores = makeStores();
        initializeTasks([t('a', 'R1'), t('b', 'R2')], stores);
        settle();
        expect(stores.resourceStore.resources().map((r) => r.id)).toEqual([
            'R1',
            'R2',
        ]);
    });

    it('re-extracts resources on subsequent runs (filter use case)', () => {
        const stores = makeStores();
        // Initial set: 3 resources
        initializeTasks(
            [t('a', 'R1'), t('b', 'R2'), t('c', 'R3')],
            stores,
            true,
            false, // hasExplicitResources = false
        );
        settle();
        expect(stores.resourceStore.resources().map((r) => r.id)).toEqual([
            'R1',
            'R2',
            'R3',
        ]);
        // Filter narrows the task set to just R2
        initializeTasks([t('b', 'R2')], stores, true, false);
        settle();
        expect(stores.resourceStore.resources().map((r) => r.id)).toEqual([
            'R2',
        ]);
    });

    it('preserves explicit resources when hasExplicitResources=true', () => {
        const stores = makeStores();
        stores.resourceStore.updateResources([
            { id: 'R1', type: 'resource' },
            { id: 'R2', type: 'resource' },
            { id: 'R3', type: 'resource' },
        ]);
        settle();
        // Pass tasks for only R1 — explicit resources stay intact.
        initializeTasks([t('a', 'R1')], stores, true, true);
        settle();
        expect(stores.resourceStore.resources().map((r) => r.id)).toEqual([
            'R1',
            'R2',
            'R3',
        ]);
    });

    it('clears resources to empty on empty input when not explicit', () => {
        const stores = makeStores();
        initializeTasks([t('a', 'R1')], stores, true, false);
        settle();
        expect(stores.resourceStore.resources()).toHaveLength(1);
        initializeTasks([], stores, true, false);
        settle();
        expect(stores.resourceStore.resources()).toHaveLength(0);
    });

    it('keeps explicit resources untouched on empty input', () => {
        const stores = makeStores();
        stores.resourceStore.updateResources([{ id: 'R1', type: 'resource' }]);
        settle();
        initializeTasks([], stores, true, true);
        settle();
        expect(stores.resourceStore.resources()).toHaveLength(1);
    });
});

describe('initializeTasks — relationships and tasks', () => {
    it('returns relationships derived from dependencies', () => {
        const stores = makeStores();
        const tasks: GanttTask[] = [
            t('a', 'R1'),
            { ...t('b', 'R1'), dependencies: [{ id: 'a' }] },
        ];
        const result = initializeTasks(tasks, stores);
        settle();
        expect(result.relationships).toHaveLength(1);
        expect(result.relationships[0]).toMatchObject({ from: 'a', to: 'b' });
    });

    it('clears the task store on empty input', () => {
        const stores = makeStores();
        initializeTasks([t('a', 'R1')], stores);
        settle();
        expect(stores.taskStore.taskCount()).toBeGreaterThan(0);
        initializeTasks([], stores);
        settle();
        expect(stores.taskStore.taskCount()).toBe(0);
    });
});

// CHARACTERIZATION BLOCK — solid-js 1.9 (SolidJS 2.0 migration, epic E1.2).
//
// `initializeTasks` is chain A of the audit, and it is a read-back pipeline
// from end to end (src/utils/ganttSetup.ts:64-101):
//
//   1. dateStore.setupDates(rawTasks)      — stages ganttStart/ganttEnd/dates
//   2. ganttConfig.setGanttStart(dateStore.ganttStart()) ... x5 — READS BACK
//      the five values step 1 just wrote
//   3. `config` is built from those same accessors and handed to processTasks,
//      which is what turns a date into `_bar.x`
//   4. resourceStore.updateResources(extracted), then
//      resourceStore.resourceIndexMap() — READS BACK the map derived from the
//      resources just written, and that map is what gives a task its
//      `_resourceIndex` / `_isHidden`
//
// On 1.9 each setter runs the update cascade synchronously, so every read-back
// sees fresh state and all of this holds. Under SolidJS 2.0's deferred writes
// steps 2-4 would read the PREVIOUS values: an empty `dates()`, a `ganttStart`
// still at the `new Date()` default, and an empty resourceIndexMap giving every
// task `_resourceIndex === -1` / `_isHidden === true` — which
// useTaskVirtualization then drops, i.e. a blank chart. These assertions are
// what turns that into a named regression when the runtime flips in E3; the
// fixes are E2.1 (compute-then-apply in ganttDateStore) and E2.2 (config sync).
describe('initializeTasks — the date pipeline commits before it is read (chain A)', () => {
    const EARLY = span('a', 'R1', '2025-01-01 08:00', '2025-01-01 16:00');
    const MID = span('c', 'R1', '2025-01-03 08:00', '2025-01-04 16:00');
    const LATE = span('b', 'R2', '2025-01-05 08:00', '2025-01-08 16:00');

    // Hand-derived from the three fixtures plus the Day mode's declared '7d'
    // padding, NOT snapshotted from a run: earliest start 2025-01-01 08:00
    // minus 7d, floored to midnight, is 2024-12-25; latest end 2025-01-08
    // 16:00 plus 7d is 2025-01-15 16:00 (never floored). The columns are one
    // calendar day apart while `current < end`: Dec 25-31 (7) + Jan 1-15 (15).
    const WINDOW_START = new Date(2024, 11, 25);
    const WINDOW_END = new Date(2025, 0, 15, 16, 0);
    const WINDOW_COLUMNS = 22;

    it('commits a date window bounding the tasks and mirrors it into the config store', () => {
        const stores = makeStores();
        initializeTasks([EARLY, LATE, MID], stores);
        settle();

        const { dateStore, ganttConfig } = stores;

        // The window exists, is the one the fixtures imply, and contains them.
        expect(dateStore.dates()).toHaveLength(WINDOW_COLUMNS);
        expect(dateStore.ganttStart().getTime()).toBe(WINDOW_START.getTime());
        expect(dateStore.ganttEnd().getTime()).toBe(WINDOW_END.getTime());
        expect(dateStore.ganttStart().getTime()).toBeLessThanOrEqual(
            dateUtils.parse(EARLY.start).getTime(),
        );
        expect(dateStore.ganttEnd().getTime()).toBeGreaterThanOrEqual(
            dateUtils.parse(LATE.end!).getTime(),
        );

        // The config store's own defaults for these two are `new Date()`
        // (ganttConfigStore.ts:127-128), so pinning them to the fixture-derived
        // window is what proves ganttSetup.ts:69-70 ran AND read back a
        // committed value. Compared by value, not identity, so the assertion
        // survives E2.2 collapsing the five setters into one updateOptions().
        expect(ganttConfig.ganttStart().getTime()).toBe(WINDOW_START.getTime());
        expect(ganttConfig.ganttEnd().getTime()).toBe(WINDOW_END.getTime());
        expect(ganttConfig.ganttStart().getTime()).toBe(
            dateStore.ganttStart().getTime(),
        );
        expect(ganttConfig.ganttEnd().getTime()).toBe(
            dateStore.ganttEnd().getTime(),
        );
        // unit/step/columnWidth are NOT asserted here: in Day mode the date
        // store's values ('day', 1, 45) are byte-for-byte the config store's
        // own defaults, so any comparison between the two stores holds with
        // ganttSetup.ts:71-73 deleted. They are pinned in the next case, on a
        // view mode where the two disagree.
    });

    it('mirrors unit/step/columnWidth from a date store whose view mode differs from the config defaults', () => {
        // Quarter Hour declares step '15min' and columnWidth 30, so the date
        // store reports unit 'minute', step 15, columnWidth 30 — all three
        // different from createGanttConfigStore({})'s defaults of 'day', 1, 45.
        // That is what makes these three real tripwires for ganttSetup.ts:71-73
        // (and for E2.2's planned collapse into one updateOptions() call):
        // drop any one setter and the config keeps its own default.
        const stores = {
            taskStore: createTaskStore(),
            ganttConfig: createGanttConfigStore({}),
            dateStore: createGanttDateStore({ viewMode: 'Quarter Hour' }),
            resourceStore: createResourceStore([]),
        };
        const { dateStore, ganttConfig, taskStore } = stores;

        // The starting point: the config store on its own defaults.
        expect(ganttConfig.unit()).toBe('day');
        expect(ganttConfig.step()).toBe(1);
        expect(ganttConfig.columnWidth()).toBe(45);

        initializeTasks([EARLY, LATE, MID], stores);
        settle();

        expect(dateStore.viewMode().name).toBe('Quarter Hour');
        expect(ganttConfig.unit()).toBe('minute');
        expect(ganttConfig.step()).toBe(15);
        expect(ganttConfig.columnWidth()).toBe(30);

        // Quarter Hour pads by '6h' and does NOT floor to midnight for a
        // sub-day unit: 2025-01-01 08:00 - 6h = 02:00.
        expect(ganttConfig.ganttStart().getTime()).toBe(
            new Date(2025, 0, 1, 2, 0).getTime(),
        );

        // Those five values are the `config` snapshot handed to processTasks,
        // so the bars are laid out in 15-minute columns: EARLY starts 6h =
        // 24 columns after the window start, and runs 8h = 32 columns wide.
        const early = taskStore.getTask(EARLY.id)!;
        expect(early._bar.x).toBe(24 * 30);
        expect(early._bar.width).toBe(32 * 30);
    });

    it('gives every task a resource row and a bar positioned against the committed window', () => {
        const stores = makeStores();
        initializeTasks([EARLY, LATE, MID], stores);
        settle();

        const { dateStore, ganttConfig, resourceStore, taskStore } = stores;

        // Row order is first-appearance order of `task.resource` in rawTasks,
        // not alphabetical.
        const indexMap = resourceStore.resourceIndexMap();
        expect([...indexMap.entries()]).toEqual([
            ['R1', 0],
            ['R2', 1],
        ]);

        const tasks = taskStore.getAllTasks();
        expect(tasks).toHaveLength(3);

        const rowPitch = ganttConfig.barHeight() + ganttConfig.padding();
        for (const task of tasks) {
            // -1 / hidden is what an empty resourceIndexMap would produce.
            expect(task._resourceIndex).toBeGreaterThanOrEqual(0);
            expect(task._resourceIndex).toBe(indexMap.get(task.resource!));
            expect(task._isHidden).toBe(false);

            // `_bar.x` came from the config snapshot; `dateToX` reads the date
            // store live. They agree only because the write committed first.
            expect(task._bar.x).toBe(dateStore.dateToX(task._start));
            expect(task._bar.y).toBe(
                task._resourceIndex * rowPitch + ganttConfig.padding() / 2,
            );
        }

        // Different start dates really do land on different columns, so the
        // check above is not vacuously comparing zeroes — and each x is pinned
        // to a hand-derived literal, so `dateToX` and `computeX` cannot drift
        // together into agreeing on a wrong value. `dateUtils.diff` rounds to
        // two decimals, so e.g. EARLY is (7d 8h -> 7.33) * 45 = 329.85.
        const xs = tasks.map((task) => task._bar.x);
        expect(new Set(xs).size).toBe(3);
        expect(taskStore.getTask(EARLY.id)!._bar.x).toBe(329.85);
        expect(taskStore.getTask(MID.id)!._bar.x).toBe(419.85);
        expect(taskStore.getTask(LATE.id)!._bar.x).toBe(509.85);
        // Row 0 and row 1 with barHeight 30 / padding 18.
        expect(taskStore.getTask(EARLY.id)!._bar.y).toBe(9);
        expect(taskStore.getTask(LATE.id)!._bar.y).toBe(57);
    });

    it('re-runs against an earlier task set, moving the window and repositioning existing bars', () => {
        const stores = makeStores();
        const { dateStore, taskStore } = stores;

        initializeTasks([MID, LATE], stores);
        settle();
        // MID starts 2025-01-03 08:00; -7d floored is 2024-12-27.
        expect(dateStore.ganttStart().getTime()).toBe(
            new Date(2024, 11, 27).getTime(),
        );
        const lateXBefore = taskStore.getTask(LATE.id)!._bar.x;
        expect(lateXBefore).toBe(419.85);

        // EARLY starts two days before MID, so the padded window start moves
        // back by exactly two day columns.
        initializeTasks([EARLY, MID, LATE], stores);
        settle();

        expect(dateStore.ganttStart().getTime()).toBe(WINDOW_START.getTime());
        const lateXAfter = taskStore.getTask(LATE.id)!._bar.x;
        expect(lateXAfter).toBe(509.85);
        expect(lateXAfter).toBe(lateXBefore + 2 * 45);
        expect(lateXAfter).toBe(
            dateStore.dateToX(taskStore.getTask(LATE.id)!._start),
        );
    });

    it('resets the date window to today ± padding on empty input, WITHOUT re-syncing the config store', () => {
        // `setupDates([])` reads `today()` at call time. Freeze the clock so a
        // run that straddles local midnight cannot compare a window built
        // before midnight against a `today()` evaluated after it.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2025, 5, 15, 10, 30, 0));
        try {
            const stores = makeStores();
            const { dateStore, ganttConfig, taskStore } = stores;

            initializeTasks([EARLY, LATE, MID], stores);
            settle();
            expect(ganttConfig.ganttStart().getTime()).toBe(
                WINDOW_START.getTime(),
            );

            initializeTasks([], stores);
            settle();

            expect(taskStore.taskCount()).toBe(0);
            // setupDates([]) falls back to today ± the Day mode's '7d'
            // padding: 2025-06-15 ± 7d, the start floored to midnight.
            expect(dateStore.ganttStart().getTime()).toBe(
                new Date(2025, 5, 8).getTime(),
            );
            expect(dateStore.ganttEnd().getTime()).toBe(
                new Date(2025, 5, 22).getTime(),
            );
            expect(dateStore.dates()).toHaveLength(14);
            expect(dateStore.dates()[0]!.getTime()).toBe(
                new Date(2025, 5, 8).getTime(),
            );

            // The empty branch returns before the config sync, so ganttConfig
            // is left pointing at the OLD window. Pinned as current behaviour,
            // not endorsed — the two stores disagree until the next non-empty
            // run.
            expect(ganttConfig.ganttStart().getTime()).toBe(
                WINDOW_START.getTime(),
            );
            expect(ganttConfig.ganttStart().getTime()).not.toBe(
                dateStore.ganttStart().getTime(),
            );
        } finally {
            vi.useRealTimers();
        }
    });
});
