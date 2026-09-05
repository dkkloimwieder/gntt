/**
 * TaskLayer virtualization: tasks-by-resource grouping + viewport row/X
 * filtering + pooled `<For keyed={false}>` arrays + per-task position lookup.
 *
 * Extracted from TaskLayer.tsx so the component file focuses on
 * composition + JSX. The reactive primitives (createMemo) are recreated on
 * every TaskLayer mount, which is the right behavior — everything here is
 * per-instance.
 *
 * Every derive below is a memo whose whole state is its return value: there
 * is no mutable state inside a compute, so a compute that re-runs cannot
 * observe a leftover from an earlier pass. The pool high-water marks ride the
 * memo's `prev` argument instead of closure counters, and the grouping is a
 * tracked memo rather than a count-keyed cache. The one dependency it takes
 * on `taskStore` is the key set; see `groupTasksByResource`.
 */
import { createMemo, untrack, type Accessor } from 'solid-js';
import { DEFAULT_BAR_HEIGHT } from '../constants';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { ResourceStore } from '../stores/resourceStore';
import type { ProcessedTask } from '../types';
import { groupTasksByResource } from '../utils/groupTasksByResource';
import type { RowLayout } from '../utils/rowLayoutCalculator';

// Pool sizing: maintain a pool slightly larger than visible count so
// scroll doesn't keep growing/shrinking the DOM. Pool only grows.
const POOL_BUFFER = 5;

// Stands in for an absent config store so the expansion lookup below always
// has a Set to ask. Never mutated.
const NO_EXPANDED_TASKS: ReadonlySet<string> = new Set<string>();

interface DisplayResource {
    id: string;
    type: 'resource' | 'group';
}

export interface TaskPosition extends RowLayout {
    isExpanded?: boolean;
}

export interface TaskVirtualizationProps {
    taskStore?: TaskStore;
    ganttConfig?: GanttConfigStore;
    resourceStore?: ResourceStore;
    startRow?: number;
    endRow?: number;
    startX?: number;
    endX?: number;
    rowLayouts?: Map<string, RowLayout>;
}

export interface TaskVirtualization {
    splitTaskIds: Accessor<{
        regularIds: string[];
        summaryIds: string[];
        expandedIds: string[];
    }>;
    pooledRegularTasks: Accessor<(ProcessedTask | undefined)[]>;
    pooledSummaryIds: Accessor<(string | undefined)[]>;
    getTaskPosition: (taskId: string) => TaskPosition | null;
}

export function useTaskVirtualization(
    props: TaskVirtualizationProps,
): TaskVirtualization {
    const displayResources = (): DisplayResource[] =>
        props.resourceStore?.displayResources() || [];
    const startRow = (): number => props.startRow ?? 0;
    const endRow = (): number => props.endRow ?? displayResources().length;
    const startX = (): number => props.startX ?? 0;
    const endX = (): number => props.endX ?? Infinity;

    const isSimpleMode = (): boolean =>
        props.ganttConfig?.renderMode?.() === 'simple';

    // Group tasks by resource. TRACKED on exactly one store node: the
    // `Object.keys` read below goes through the store's `ownKeys` trap, which
    // subscribes this memo to the key-set node — bumped only on a key add or
    // remove, never on the `_bar.x` leaf writes a drag emits. Per-task leaf
    // reads stay untracked inside the helper, so the dependency count is O(1)
    // in the task count rather than O(N).
    //
    // This replaces a closure cache keyed on the task COUNT, which served a
    // permanently stale Map after a same-tick remove+add — and which never
    // ran at all, because the key scan used to sit under `untrack` too and so
    // left this derive with no dependency on `taskStore` whatsoever.
    const tasksByResource = createMemo((): Map<string, ProcessedTask[]> => {
        const tasksObj = props.taskStore?.tasks;
        if (!tasksObj) return new Map();
        return groupTasksByResource(tasksObj, Object.keys(tasksObj));
    });

    // FLAT VIRTUALIZATION with both row AND X filtering.
    // Returns IDs (strings) so <For>/<Index> keep stable references —
    // critical for keeping document event listeners alive during drag.
    const visibleTaskIds = createMemo((): string[] => {
        const result: string[] = [];
        const resList = displayResources();
        const grouped = tasksByResource();
        const startIdx = startRow();
        const endIdx = endRow();
        const sx = startX();
        const ex = endX();

        for (let i = startIdx; i < endIdx && i < resList.length; i++) {
            const item = resList[i];
            if (!item || item.type === 'group') continue;

            const resourceTaskList = grouped.get(item.id);
            if (!resourceTaskList) continue;

            // untrack to prevent O(n) per-task subscriptions while
            // reading store proxies' _bar.
            untrack(() => {
                if (ex === Infinity) {
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        const t = resourceTaskList[j];
                        if (t) result.push(t.id);
                    }
                } else {
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        const task = resourceTaskList[j];
                        if (!task) continue;
                        const bar = task._bar;
                        if (
                            !bar ||
                            (bar.x + bar.width >= sx - 200 && bar.x <= ex + 200)
                        ) {
                            result.push(task.id);
                        }
                    }
                }
            });
        }
        return result;
    });

    // Split visible tasks into 3 buckets:
    //   expandedIds — parents-with-subtasks-currently-expanded
    //   summaryIds  — project-level summary bars
    //   regularIds  — normal task bars
    // Simple mode skips expansion logic entirely.
    const splitTaskIds = createMemo(() => {
        const simpleMode = isSimpleMode();
        const visibleIds = visibleTaskIds();
        // TRACKED, and read out here on purpose. The old code called
        // `ganttConfig.isTaskExpanded(id)` from inside the `untrack` below, so
        // expanding or collapsing a parent moved nothing until some other
        // dependency happened to fire. `expandedTasks` is a signal over an
        // IMMUTABLE Set (D6), so every mutator replaces it: one dependency
        // covers the whole expansion state, whatever its size.
        const expandedTasks =
            props.ganttConfig?.expandedTasks?.() ?? NO_EXPANDED_TASKS;

        return untrack(() => {
            const regularIds: string[] = [];
            const summaryIds: string[] = [];
            const expandedIds: string[] = [];
            const tasksObj = props.taskStore?.tasks ?? {};

            for (const taskId of visibleIds) {
                const task = tasksObj[taskId] as ProcessedTask | undefined;
                if (!task) continue;

                const parentId = task.parentId;
                const taskType = task.type;
                const children = task._children;

                if (simpleMode) {
                    if (parentId) continue;
                    if (taskType === 'summary' || taskType === 'project') {
                        summaryIds.push(taskId);
                    } else {
                        regularIds.push(taskId);
                    }
                    continue;
                }

                const hasSubtasks = children && children.length > 0;

                if (hasSubtasks && expandedTasks.has(taskId)) {
                    expandedIds.push(taskId);
                } else if (taskType === 'summary' || taskType === 'project') {
                    summaryIds.push(taskId);
                } else if (!parentId || !expandedTasks.has(parentId)) {
                    regularIds.push(taskId);
                }
            }

            return { regularIds, summaryIds, expandedIds };
        });
    });

    // Pools grow to max(seen) + buffer and never shrink (avoids DOM thrash).
    //
    // The high-water mark is the memo's own PREVIOUS value rather than a
    // closure counter: `prev.length` already IS `max(seen so far) +
    // POOL_BUFFER`, so `max(prev.length, ids.length + POOL_BUFFER)` reproduces
    // the old arithmetic exactly while leaving no mutable state inside a
    // compute — a compute that re-runs (or is disposed and rebuilt) must not
    // be able to observe a counter from an earlier pass.
    const poolSizeFrom = (
        prev: (string | undefined)[] | undefined,
        count: number,
    ): number => Math.max(prev?.length ?? 0, count + POOL_BUFFER);

    const pooledRegularIds = createMemo(
        (prev: (string | undefined)[] | undefined): (string | undefined)[] => {
            const ids = splitTaskIds().regularIds;
            const result: (string | undefined)[] = new Array(
                poolSizeFrom(prev, ids.length),
            );
            for (let i = 0; i < ids.length; i++) result[i] = ids[i];
            return result;
        },
    );

    // Pass task objects directly to <Bar> instead of doing per-bar
    // store.tasks[id] lookups inside child components.
    const pooledRegularTasks = createMemo((): (ProcessedTask | undefined)[] => {
        const ids = pooledRegularIds();
        const tasksObj = props.taskStore?.tasks ?? {};
        return untrack(() =>
            ids.map((id) =>
                id ? (tasksObj[id] as ProcessedTask | undefined) : undefined,
            ),
        );
    });

    const pooledSummaryIds = createMemo(
        (prev: (string | undefined)[] | undefined): (string | undefined)[] => {
            const ids = splitTaskIds().summaryIds;
            const result: (string | undefined)[] = new Array(
                poolSizeFrom(prev, ids.length),
            );
            for (let i = 0; i < ids.length; i++) result[i] = ids[i];
            return result;
        },
    );

    // Per-task position within its resource row.
    const getTaskPosition = (taskId: string): TaskPosition | null => {
        const rowLayouts = props.rowLayouts;
        if (!rowLayouts) return null;
        const task = props.taskStore?.getTask?.(taskId);
        if (!task) return null;

        const resourceId = task['resource'] as string | undefined;
        const rowLayout = rowLayouts.get(resourceId || '');
        if (!rowLayout) return null;

        if (isSimpleMode()) {
            return {
                ...rowLayout,
                y: rowLayout.contentY ?? rowLayout.y ?? 0,
                height:
                    rowLayout.contentHeight ??
                    rowLayout.height ??
                    DEFAULT_BAR_HEIGHT,
                isExpanded: false,
            };
        }

        const taskPos = rowLayout.taskPositions?.get(taskId);
        if (taskPos) {
            return {
                ...rowLayout,
                y: taskPos.y,
                height: taskPos.height,
                isExpanded: taskPos.isExpanded,
            };
        }

        return rowLayout;
    };

    return {
        splitTaskIds,
        pooledRegularTasks,
        pooledSummaryIds,
        getTaskPosition,
    };
}
