/**
 * Behaviour tests for `useTaskVirtualization`. They drive the REAL hook
 * inside a `createRoot`, wired to the real task/config/resource stores.
 *
 * These began (E1.5) as characterization tests for two independent
 * invalidation defects, both closed by E2.8:
 *
 *   1. `tasksByResource` wrapped EVERY store read in `untrack` — the key
 *      scan and the whole grouping loop — so `visibleTaskIds` subscribed to
 *      nothing in `taskStore` at all, only to `displayResources()` and the
 *      four viewport props. A `taskStore` write on its own moved nothing.
 *   2. Even when something else forced a re-run, the grouping was cached on
 *      task COUNT, so a same-count key swap served a stale Map — one still
 *      holding the store proxy captured for a since-deleted task.
 *
 * The fix makes the grouping a tracked memo: `Object.keys(tasks)` is read in
 * the memo's tracked scope, which subscribes it to the store's key-set node
 * (bumped only on a key add/remove), while the per-task leaf reads stay
 * inside `untrack` in `groupTasksByResource`. Both halves of the invalidation
 * block below therefore assert the CORRECTED values, and the three
 * "TODAY on 1.9" tests that pinned the stale ones are gone.
 *
 * `TaskLayerMinimal` no longer carries a private copy of the grouping — it
 * calls the same `groupTasksByResource` helper — so the cases here cover
 * both call sites' shared behaviour.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, createSignal, merge } from 'solid-js';
import {
    useTaskVirtualization,
    type TaskVirtualization,
    type TaskVirtualizationProps,
} from '../src/hooks/useTaskVirtualization';
import { createTaskStore, type TaskStore } from '../src/stores/taskStore';
import {
    createGanttConfigStore,
    type GanttConfigStore,
} from '../src/stores/ganttConfigStore';
import {
    createResourceStore,
    type ResourceStore,
} from '../src/stores/resourceStore';
import type { RowLayout } from '../src/utils/rowLayoutCalculator';
import type {
    ProcessedTask,
    NormalizedConstraints,
    ResourceInput,
} from '../src/types';
import { settle } from './helpers/settle';

// Same fixture builder as tests/taskStore.test.ts, plus a resource — the
// grouping key, without which a task is unreachable from any row.
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
        resource: 'R1',
        ...overrides,
    };
}

interface Harness {
    taskStore: TaskStore;
    resourceStore: ResourceStore;
    ganttConfig: GanttConfigStore;
    virt: TaskVirtualization;
}

const disposers: (() => void)[] = [];

afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
});

/**
 * Build the stores and the hook under one owner.
 *
 * Two ordering facts are baked in on purpose:
 *  - the tasks are written BEFORE the hook is created, because
 *    `visibleTaskIds` takes no dependency on `taskStore` and would
 *    otherwise compute an empty list forever (that is the third skip);
 *  - the writes sit inside the `createRoot` body, which migration rule 10
 *    permits for store writes. Every signal write (`updateResources`,
 *    the reactive `endRow` below) stays in the test body.
 *
 * `merge` — not a spread — merges `extra`, so a caller can hand in a
 * getter-backed reactive prop the way JSX does.
 */
function createHarness(
    resources: ResourceInput[],
    tasks: ProcessedTask[],
    extra: Partial<TaskVirtualizationProps> = {},
    configOptions: Parameters<typeof createGanttConfigStore>[0] = {},
): Harness {
    return createRoot((dispose) => {
        disposers.push(dispose);
        const taskStore = createTaskStore();
        const resourceStore = createResourceStore(resources);
        const ganttConfig = createGanttConfigStore(configOptions);
        taskStore.updateTasks(tasks);
        const props = merge(
            { taskStore, ganttConfig, resourceStore, startRow: 0, endRow: 10 },
            extra,
        );
        return {
            taskStore,
            resourceStore,
            ganttConfig,
            virt: useTaskVirtualization(props),
        };
    });
}

// `pooledRegularTasks` is a SPARSE pool (`new Array(max + POOL_BUFFER)`),
// so always drop the holes before asserting on contents.
function pooledIds(virt: TaskVirtualization): string[] {
    return virt
        .pooledRegularTasks()
        .filter((t): t is ProcessedTask => t !== undefined)
        .map((t) => t.id);
}

function pooledSummaries(virt: TaskVirtualization): string[] {
    return virt
        .pooledSummaryIds()
        .filter((id): id is string => id !== undefined);
}

describe('useTaskVirtualization — pool contents', () => {
    it('pools the tasks present when the hook is created', () => {
        const { virt } = createHarness(['R1'], [makeTask('a'), makeTask('b')]);

        expect(pooledIds(virt)).toEqual(['a', 'b']);
        expect(virt.splitTaskIds()).toEqual({
            regularIds: ['a', 'b'],
            summaryIds: [],
            expandedIds: [],
        });
    });

    it('sizes each pool to its bucket count plus POOL_BUFFER (5)', () => {
        const { virt } = createHarness(['R1'], [makeTask('a'), makeTask('b')]);

        // 2 regular tasks + 5 buffer slots; no summaries, so 0 + 5.
        expect(virt.pooledRegularTasks()).toHaveLength(7);
        expect(virt.pooledSummaryIds()).toHaveLength(5);
    });

    it('grows the pool to the high-water mark and never shrinks it', () => {
        // A reactive `endRow`, the way JSX props behave, so the viewport
        // can narrow without touching either store.
        const [endRow, setEndRow] = createSignal(2);
        const { virt } = createHarness(
            ['R1', 'R2'],
            [
                makeTask('a'),
                makeTask('b', { resource: 'R2' }),
                makeTask('c', { resource: 'R2' }),
            ],
            {
                get endRow() {
                    return endRow();
                },
            },
        );

        expect(pooledIds(virt)).toEqual(['a', 'b', 'c']);
        expect(virt.pooledRegularTasks()).toHaveLength(8);

        setEndRow(1);
        settle();

        // Contents shrink to row 0 only...
        expect(pooledIds(virt)).toEqual(['a']);
        // ...but the pool keeps its 3-task high-water size, so pooled rows
        // are reused in place instead of being torn down mid-drag.
        expect(virt.pooledRegularTasks()).toHaveLength(8);
    });
});

describe('useTaskVirtualization — viewport filtering', () => {
    it('only emits tasks whose resource row falls in [startRow, endRow)', () => {
        const { virt } = createHarness(
            ['R1', 'R2', 'R3'],
            [
                makeTask('a'),
                makeTask('b', { resource: 'R2' }),
                makeTask('c', { resource: 'R3' }),
            ],
            { startRow: 1, endRow: 2 },
        );

        expect(pooledIds(virt)).toEqual(['b']);
    });

    it('applies the X filter with a 200px margin on both edges', () => {
        // Window [1000, 2000] widens to [800, 2200]: a task survives when
        // bar.x + bar.width >= sx - 200 && bar.x <= ex + 200.
        const { virt } = createHarness(
            ['R1'],
            [
                makeTask('left-out', {
                    _bar: { x: 0, y: 0, width: 100, height: 30 },
                }),
                makeTask('left-edge', {
                    _bar: { x: 700, y: 0, width: 100, height: 30 },
                }),
                makeTask('inside', {
                    _bar: { x: 1000, y: 0, width: 100, height: 30 },
                }),
                makeTask('right-edge', {
                    _bar: { x: 2200, y: 0, width: 10, height: 30 },
                }),
                makeTask('right-out', {
                    _bar: { x: 2201, y: 0, width: 10, height: 30 },
                }),
            ],
            { startX: 1000, endX: 2000 },
        );

        expect(pooledIds(virt)).toEqual(['left-edge', 'inside', 'right-edge']);
    });

    it('skips the X filter entirely when endX is Infinity (the default)', () => {
        const { virt } = createHarness(
            ['R1'],
            [
                makeTask('far', {
                    _bar: { x: 99999, y: 0, width: 10, height: 30 },
                }),
            ],
        );

        expect(pooledIds(virt)).toEqual(['far']);
    });
});

describe('useTaskVirtualization — grouping and bucketing', () => {
    it('drops hidden tasks before they ever reach a bucket', () => {
        const { virt } = createHarness(
            ['R1'],
            [makeTask('visible'), makeTask('hidden', { _isHidden: true })],
        );

        expect(pooledIds(virt)).toEqual(['visible']);
    });

    it('groups a task with no resource under "Unassigned"', () => {
        // Only "Unassigned" is a display row, so the resource-less task is
        // the visible one and the R1 task is not.
        const { virt } = createHarness(
            ['Unassigned'],
            [makeTask('orphan', { resource: undefined }), makeTask('onR1')],
        );

        expect(pooledIds(virt)).toEqual(['orphan']);
    });

    it('routes summary/project types to summaryIds and skips children in simple mode', () => {
        const { virt, ganttConfig } = createHarness(
            ['R1'],
            [
                makeTask('sum', { type: 'summary', _children: ['kid'] }),
                makeTask('proj', { type: 'project' }),
                makeTask('plain'),
                makeTask('kid', { parentId: 'sum' }),
            ],
        );
        expect(ganttConfig.renderMode()).toBe('simple');

        expect(virt.splitTaskIds()).toEqual({
            regularIds: ['plain'],
            summaryIds: ['sum', 'proj'],
            expandedIds: [],
        });
        expect(pooledIds(virt)).toEqual(['plain']);
        expect(pooledSummaries(virt)).toEqual(['sum', 'proj']);
        expect(virt.pooledSummaryIds()).toHaveLength(7);
    });
});

describe('useTaskVirtualization — grouping cache invalidation', () => {
    it('picks up a new task once resourceStore.updateResources() invalidates displayResources', () => {
        const { virt, taskStore, resourceStore } = createHarness(
            ['R1'],
            [makeTask('a'), makeTask('b')],
        );
        expect(pooledIds(virt)).toEqual(['a', 'b']);

        taskStore.updateTask('c', makeTask('c'));
        settle();
        resourceStore.updateResources(['R1']);
        settle();

        expect(pooledIds(virt)).toEqual(['a', 'b', 'c']);
    });

    // CAUSE 1 — the `taskStore` dependency edge the old `untrack` deleted.
    it('reflects a same-turn remove+add that leaves the task count unchanged', () => {
        const { virt, taskStore } = createHarness(
            ['R1'],
            [makeTask('a'), makeTask('b')],
        );
        expect(pooledIds(virt)).toEqual(['a', 'b']);

        taskStore.removeTask('a');
        taskStore.updateTask('c', makeTask('c'));
        settle();

        // The store itself is correct: same count, different key set.
        expect(taskStore.taskCount()).toBe(2);
        expect(taskStore.getTask('a')).toBeUndefined();

        // And so is the hook, with no resourceStore write to pull it along:
        // the grouping memo's tracked `Object.keys` rides the store's key-set
        // node, which the delete+add bumped.
        expect(pooledIds(virt)).toEqual(['b', 'c']);
        expect(virt.splitTaskIds().regularIds).toEqual(['b', 'c']);
    });

    // CAUSE 2 — the grouping cache that was keyed on the task COUNT. Here the
    // memo is forced to re-run by `displayResources()` as well, so this fails
    // for the count cache alone even if the dependency edge were restored.
    it('rebuilds the grouping on a same-count key swap even when displayResources changes', () => {
        const { virt, taskStore, resourceStore } = createHarness(
            ['R1'],
            [makeTask('a'), makeTask('b')],
        );
        expect(pooledIds(virt)).toEqual(['a', 'b']);

        taskStore.removeTask('a');
        taskStore.updateTask('c', makeTask('c'));
        settle();
        resourceStore.updateResources(['R1']);
        settle();

        // Assert BOTH derives: `pooledRegularTasks` filters holes, so a
        // `regularIds` that still carried the dangling 'a' would pool as
        // ['b', 'c'] and pass on the pooled line alone.
        expect(pooledIds(virt)).toEqual(['b', 'c']);
        expect(virt.splitTaskIds().regularIds).toEqual(['b', 'c']);
    });

    // CAUSE 1 again, isolated from the count cache: a `taskStore` write on
    // its own must move the pool.
    it('picks up tasks written after the hook was created, with no resourceStore write', () => {
        const { virt, taskStore } = createHarness(['R1'], []);
        expect(pooledIds(virt)).toEqual([]);

        taskStore.updateTasks([makeTask('a'), makeTask('b')]);
        settle();

        expect(pooledIds(virt)).toEqual(['a', 'b']);
        expect(virt.splitTaskIds().regularIds).toEqual(['a', 'b']);
    });

    // The third deleted edge: `splitTaskIds` used to ask
    // `ganttConfig.isTaskExpanded(id)` from INSIDE its `untrack`, so
    // expanding a parent moved nothing until some unrelated dependency
    // fired. It now reads `expandedTasks()` in its tracked scope — one
    // dependency covering the whole (immutable) Set.
    it('re-splits when ganttConfig.expandedTasks changes, with no store write', () => {
        const { virt, ganttConfig } = createHarness(
            ['R1'],
            [
                makeTask('parent', { _children: ['kid'] }),
                makeTask('kid', { parentId: 'parent' }),
            ],
            {},
            { renderMode: 'detailed' },
        );
        expect(virt.splitTaskIds()).toEqual({
            regularIds: ['parent', 'kid'],
            summaryIds: [],
            expandedIds: [],
        });

        ganttConfig.toggleTaskExpansion('parent');
        settle();

        // 'parent' moves to expandedIds, and 'kid' leaves regularIds because
        // ExpandedTaskContainer draws it now.
        expect(virt.splitTaskIds()).toEqual({
            regularIds: [],
            summaryIds: [],
            expandedIds: ['parent'],
        });
    });
});

describe('useTaskVirtualization — getTaskPosition', () => {
    function withLayouts(rowLayouts?: Map<string, RowLayout>): Harness {
        return createHarness(['R1'], [makeTask('a')], { rowLayouts });
    }

    it('returns null when no rowLayouts are supplied', () => {
        expect(withLayouts().virt.getTaskPosition('a')).toBeNull();
    });

    it('returns null for an unknown task id', () => {
        const { virt } = withLayouts(new Map([['R1', { y: 10, height: 40 }]]));
        expect(virt.getTaskPosition('nope')).toBeNull();
    });

    it('returns null when the task resource has no row layout', () => {
        const { virt } = withLayouts(new Map([['R9', { y: 10, height: 40 }]]));
        expect(virt.getTaskPosition('a')).toBeNull();
    });

    it('collapses the row layout to its content box in simple mode', () => {
        const { virt } = withLayouts(
            new Map([
                ['R1', { y: 10, height: 40, contentY: 14, contentHeight: 32 }],
            ]),
        );
        expect(virt.getTaskPosition('a')).toEqual({
            y: 14,
            height: 32,
            contentY: 14,
            contentHeight: 32,
            isExpanded: false,
        });
    });

    // The other side of the same branch — the only non-simple render mode
    // the config store accepts is 'detailed' (ganttConfigStore.ts:9), and
    // `isSimpleMode()` is a bare `=== 'simple'`. Asserting the values here
    // is what pins the simple-mode collapse above as a real branch rather
    // than the only thing the hook can return.
    it('prefers the per-task position over the row box in detailed render mode', () => {
        const rowLayout: RowLayout = {
            y: 10,
            height: 40,
            contentY: 14,
            contentHeight: 32,
            taskPositions: new Map([
                ['a', { y: 21, height: 18, isExpanded: true }],
            ]),
        };
        const { virt } = createHarness(
            ['R1'],
            [makeTask('a'), makeTask('b')],
            { rowLayouts: new Map([['R1', rowLayout]]) },
            { renderMode: 'detailed' },
        );

        // 'a' has an entry: y/height come from it and `isExpanded` is
        // carried through, while the row's own content box rides along
        // untouched (contentY/contentHeight are NOT collapsed onto y/height
        // the way simple mode does it).
        expect(virt.getTaskPosition('a')).toEqual({
            y: 21,
            height: 18,
            contentY: 14,
            contentHeight: 32,
            taskPositions: rowLayout.taskPositions,
            isExpanded: true,
        });

        // 'b' has no entry, so the row layout comes back BY REFERENCE —
        // not a copy, and with no `isExpanded` key at all.
        expect(virt.getTaskPosition('b')).toBe(rowLayout);
        expect(virt.getTaskPosition('b')).not.toHaveProperty('isExpanded');
    });
});
