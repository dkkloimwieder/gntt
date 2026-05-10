/**
 * TaskLayer virtualization: tasks-by-resource grouping + viewport row/X
 * filtering + pooled <Index> arrays + per-task position lookup.
 *
 * Extracted from TaskLayer.tsx so the component file focuses on
 * composition + JSX. The reactive primitives (createMemo) are recreated
 * on every TaskLayer mount, which is the right behavior — the cache
 * state held in closures here is per-instance.
 */
import { createMemo, untrack, type Accessor } from 'solid-js';
import { DEFAULT_BAR_HEIGHT } from '../constants';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { ResourceStore } from '../stores/resourceStore';
import type { ProcessedTask } from '../types';
import type { RowLayout } from '../utils/rowLayoutCalculator';

// Pool sizing: maintain a pool slightly larger than visible count so
// scroll doesn't keep growing/shrinking the DOM. Pool only grows.
const POOL_BUFFER = 5;

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
    const isTaskExpanded = (taskId: string): boolean =>
        props.ganttConfig?.isTaskExpanded?.(taskId) ?? false;

    // Group tasks by resource — cached to avoid O(N) scan on every scroll.
    // Only rebuilds when task count changes (add/remove tasks).
    let cachedGrouping: Map<string, ProcessedTask[]> | null = null;
    let cachedTaskCount = -1;

    const tasksByResource = (): Map<string, ProcessedTask[]> => {
        const tasksObj = props.taskStore?.tasks;
        if (!tasksObj) return new Map();

        const taskKeys = untrack(() => Object.keys(tasksObj));
        if (taskKeys.length === cachedTaskCount && cachedGrouping) {
            return cachedGrouping;
        }

        cachedTaskCount = taskKeys.length;
        const grouped = new Map<string, ProcessedTask[]>();
        untrack(() => {
            for (const taskId of taskKeys) {
                const task = tasksObj[taskId] as ProcessedTask | undefined;
                if (!task || task._isHidden) continue;

                const resource = task.resource || 'Unassigned';
                if (!grouped.has(resource)) grouped.set(resource, []);
                grouped.get(resource)!.push(task);
            }
        });
        cachedGrouping = grouped;
        return grouped;
    };

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

        return untrack(() => {
            const regularIds: string[] = [];
            const summaryIds: string[] = [];
            const expandedIds: string[] = [];
            const tasksObj = props.taskStore?.tasks ?? {};

            const expandedCache = new Map<string, boolean>();
            const checkExpanded = (id: string): boolean => {
                if (!expandedCache.has(id)) {
                    expandedCache.set(id, isTaskExpanded(id));
                }
                return expandedCache.get(id)!;
            };

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
                const expanded = checkExpanded(taskId);

                if (hasSubtasks && expanded) {
                    expandedIds.push(taskId);
                } else if (taskType === 'summary' || taskType === 'project') {
                    summaryIds.push(taskId);
                } else if (!parentId || !checkExpanded(parentId)) {
                    regularIds.push(taskId);
                }
            }

            return { regularIds, summaryIds, expandedIds };
        });
    });

    // Pools grow to max(seen) + buffer; never shrink (avoids DOM thrash).
    let maxRegularCount = 0;
    let maxSummaryCount = 0;

    const pooledRegularIds = createMemo((): (string | undefined)[] => {
        const ids = splitTaskIds().regularIds;
        maxRegularCount = Math.max(maxRegularCount, ids.length);
        const poolSize = maxRegularCount + POOL_BUFFER;
        const result: (string | undefined)[] = new Array(poolSize);
        for (let i = 0; i < ids.length; i++) result[i] = ids[i];
        return result;
    });

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

    const pooledSummaryIds = createMemo((): (string | undefined)[] => {
        const ids = splitTaskIds().summaryIds;
        maxSummaryCount = Math.max(maxSummaryCount, ids.length);
        const poolSize = maxSummaryCount + POOL_BUFFER;
        const result: (string | undefined)[] = new Array(poolSize);
        for (let i = 0; i < ids.length; i++) result[i] = ids[i];
        return result;
    });

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
