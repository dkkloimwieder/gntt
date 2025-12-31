import { For, Index, createMemo, untrack, Accessor, JSX } from 'solid-js';
import { Bar } from './Bar';
import { SummaryBar } from './SummaryBar';
import { ExpandedTaskContainer } from './ExpandedTaskContainer';
import {
    resolveConstraints,
    buildRelationshipIndex,
    collectDependentTasks,
    clampBatchDeltaX,
} from '../utils/constraintEngine';
import { collectDescendants } from '../utils/hierarchyProcessor';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { ResourceStore } from '../stores/resourceStore';
import type { ProcessedTask, Relationship, BarPosition } from '../types';
import type { RowLayout } from '../utils/rowLayoutCalculator';

// Pool sizing: We maintain a pool slightly larger than visible count.
// This provides buffer for smooth scrolling while avoiding constant DOM creation.
// Pool only grows (never shrinks) to prevent thrashing during scroll.
const POOL_BUFFER = 5; // Reduced from 50 - with Index, we don't create DOM during scroll

interface BatchOriginal {
    originalX: number;
}

interface ConstrainedResult {
    x: number;
    y: number;
}

interface TaskPosition extends RowLayout {
    isExpanded?: boolean;
}

interface TaskLayerProps {
    taskStore?: TaskStore;
    ganttConfig?: GanttConfigStore;
    resourceStore?: ResourceStore;
    tasks?: ProcessedTask[];
    relationships?: Relationship[];
    rowLayouts?: Map<string, RowLayout>;
    startRow?: number;
    endRow?: number;
    startX?: number;
    endX?: number;
    onDateChange?: (taskId: string, position: { x: number; width: number }) => void;
    onProgressChange?: (taskId: string, progress: number) => void;
    onResizeEnd?: (taskId: string) => void;
    onHover?: (taskId: string, clientX: number, clientY: number) => void;
    onHoverEnd?: () => void;
    onTaskClick?: (taskId: string, event: MouseEvent) => void;
}

interface DisplayResource {
    id: string;
    type: 'resource' | 'group';
}

/**
 * TaskLayer - Container for all task bars.
 * Maps tasks to Bar components and handles constraint resolution.
 */
export function TaskLayer(props: TaskLayerProps): JSX.Element {
    // Get tasks from store or props
    const tasks = (): ProcessedTask[] => {
        if (props.taskStore) {
            return props.taskStore.getAllTasks?.() || [];
        }
        return props.tasks || [];
    };

    // Relationships for constraint resolution
    const relationships = (): Relationship[] => props.relationships || [];

    // Pre-build relationship index for O(1) lookups (rebuilds when relationships change)
    const relationshipIndex = createMemo(() => buildRelationshipIndex(relationships()));

    /**
     * Handle constraint position callback from Bar.
     * Uses constraintEngine for dependency constraints.
     */
    const handleConstrainPosition = (taskId: string, newX: number, newY: number): ConstrainedResult | null => {
        if (!props.taskStore) return { x: newX, y: newY };

        // Get columnWidth for lag conversion (lag is in days, needs pixels)
        const columnWidth = props.ganttConfig?.columnWidth?.() ?? 45;

        // Get current bar for width
        const taskBar = props.taskStore.getBarPosition?.(taskId);
        const width = taskBar?.width ?? 100;

        // Build context for constraint engine
        const context = {
            getBarPosition: props.taskStore.getBarPosition?.bind(props.taskStore),
            getTask: props.taskStore.getTask?.bind(props.taskStore),
            relationships: relationships(),
            relationshipIndex: relationshipIndex(),
            pixelsPerHour: columnWidth, // Using columnWidth as pixels per time unit
            ganttStartDate: new Date(), // Placeholder - not used for pixel-based calculations
        };

        const result = resolveConstraints(taskId, newX, width, context);

        if (result.blocked) {
            // Movement blocked
            return null;
        }

        // Apply cascade updates to successors
        if (result.cascadeUpdates && result.cascadeUpdates.size > 0) {
            for (const [succId, update] of result.cascadeUpdates) {
                props.taskStore.updateBarPosition(succId, update as Partial<BarPosition>);
            }
        }

        // Return the constrained position for the dragged task
        return { x: result.constrainedX, y: newY };
    };

    /**
     * Handle date change callback from Bar.
     */
    const handleDateChange = (taskId: string, position: { x: number; width: number }): void => {
        props.onDateChange?.(taskId, position);
    };

    /**
     * Handle progress change callback from Bar.
     */
    const handleProgressChange = (taskId: string, progress: number): void => {
        props.onProgressChange?.(taskId, progress);
    };

    /**
     * Handle resize end callback from Bar.
     * Resolves constraints to push dependent tasks if needed.
     */
    const handleResizeEnd = (taskId: string): void => {
        // Apply constraints after resize - push dependents if needed
        if (props.taskStore) {
            const columnWidth = props.ganttConfig?.columnWidth?.() ?? 45;
            const taskBar = props.taskStore.getBarPosition?.(taskId);
            if (taskBar) {
                const context = {
                    getBarPosition: props.taskStore.getBarPosition?.bind(props.taskStore),
                    getTask: props.taskStore.getTask?.bind(props.taskStore),
                    relationships: relationships(),
                    relationshipIndex: relationshipIndex(),
                    pixelsPerHour: columnWidth,
                    ganttStartDate: new Date(), // Placeholder - not used for pixel-based calculations
                };
                const result = resolveConstraints(taskId, taskBar.x, taskBar.width, context);
                // Apply cascade updates
                if (result.cascadeUpdates) {
                    for (const [succId, update] of result.cascadeUpdates) {
                        props.taskStore.updateBarPosition(succId, update as Partial<BarPosition>);
                    }
                }
            }
        }
        props.onResizeEnd?.(taskId);
    };

    /**
     * Handle task hover.
     */
    const handleHover = (taskId: string, clientX: number, clientY: number): void => {
        props.onHover?.(taskId, clientX, clientY);
    };

    /**
     * Handle task hover end.
     */
    const handleHoverEnd = (): void => {
        props.onHoverEnd?.();
    };

    /**
     * Handle task click.
     */
    const handleTaskClick = (taskId: string, event: MouseEvent): void => {
        props.onTaskClick?.(taskId, event);
    };

    /**
     * Collect all dependent tasks for batch drag.
     * Returns a Set of task IDs that should move together.
     */
    const handleCollectDependents = (taskId: string): Set<string> => {
        const getTask = props.taskStore?.getTask?.bind(props.taskStore) ?? (() => undefined);
        return collectDependentTasks(taskId, relationships(), getTask);
    };

    /**
     * Clamp batch delta to prevent constraint violations.
     * Called during drag to ensure no task moves behind its predecessor.
     */
    const handleClampBatchDelta = (batchOriginals: Map<string, BatchOriginal>, proposedDeltaX: number): number => {
        const getTask = props.taskStore?.getTask?.bind(props.taskStore) ?? (() => undefined);
        // Get columnWidth for lag conversion (lag is in days, needs pixels)
        const columnWidth = props.ganttConfig?.columnWidth?.() ?? 45;
        return clampBatchDeltaX(
            batchOriginals,
            proposedDeltaX,
            relationships(),
            getTask,
            { pixelsPerTimeUnit: columnWidth },
        );
    };

    /**
     * Collect all descendant tasks for batch drag of summary bars.
     * Returns a Set of task IDs that should move with the parent.
     */
    const handleCollectDescendants = (taskId: string): Set<string> => {
        if (!props.taskStore) return new Set();
        // tasks is now a store object, not a Map
        return collectDescendants(taskId, props.taskStore.tasks);
    };

    /**
     * Handle collapse toggle for summary bars.
     */
    const handleToggleCollapse = (taskId: string): void => {
        props.taskStore?.toggleTaskCollapse?.(taskId);
    };

    // Get display resources from resourceStore (respects collapse state)
    const displayResources = (): DisplayResource[] => props.resourceStore?.displayResources() || [];

    // Viewport range for row virtualization
    const startRow = (): number => props.startRow ?? 0;
    const endRow = (): number => props.endRow ?? displayResources().length;

    // Viewport range for horizontal (X) virtualization
    const startX = (): number => props.startX ?? 0;
    const endX = (): number => props.endX ?? Infinity;

    // Group tasks by resource - CACHED to avoid O(10K) iteration on every scroll
    // Only rebuilds when task count changes (add/remove tasks)
    let cachedGrouping: Map<string, ProcessedTask[]> | null = null;
    let cachedTaskCount = -1;

    const tasksByResource = (): Map<string, ProcessedTask[]> => {
        const tasksObj = props.taskStore?.tasks;
        if (!tasksObj) return new Map();

        // Check if we need to rebuild (task count changed)
        const taskKeys = untrack(() => Object.keys(tasksObj));
        if (taskKeys.length === cachedTaskCount && cachedGrouping) {
            return cachedGrouping;
        }

        // Rebuild grouping
        cachedTaskCount = taskKeys.length;
        const grouped = new Map<string, ProcessedTask[]>();
        untrack(() => {
            for (const taskId of taskKeys) {
                const task = tasksObj[taskId] as ProcessedTask | undefined;
                if (!task || task._isHidden) continue;

                const resource = task.resource || 'Unassigned';
                if (!grouped.has(resource)) {
                    grouped.set(resource, []);
                }
                grouped.get(resource)!.push(task);
            }
        });
        cachedGrouping = grouped;
        return grouped;
    };

    // FLAT VIRTUALIZATION with both row AND X filtering
    // Key insight: Keeping DOM size small (~300-500 tasks) is more important than
    // avoiding CSS visibility toggles for 2,300 tasks

    // Create flat list of task IDs filtered by BOTH row AND X range
    // IMPORTANT: Return IDs (strings) instead of task objects to maintain stable references.
    // This prevents <For> from recreating Bar components when the store updates during drag,
    // which would kill the document event listeners and break drag functionality.
    const visibleTaskIds = createMemo((): string[] => {
        const result: string[] = [];
        const resList = displayResources();
        const grouped = tasksByResource();
        const startIdx = startRow();
        const endIdx = endRow();
        const sx = startX();
        const ex = endX();

        // Filter by row range (typically 20-50 rows with overscan)
        for (let i = startIdx; i < endIdx && i < resList.length; i++) {
            const item = resList[i];
            if (!item || item.type === 'group') continue;

            const resourceTaskList = grouped.get(item.id);
            if (!resourceTaskList) continue;

            // Filter by X range - untrack to prevent O(n) subscriptions
            // Tasks in resourceTaskList are store proxies - accessing _bar would create subscriptions
            untrack(() => {
                if (ex === Infinity) {
                    // No X filtering - just collect IDs
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        const t = resourceTaskList[j];
                        if (t) result.push(t.id);
                    }
                } else {
                    // X filtering enabled
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        const task = resourceTaskList[j];
                        if (!task) continue;
                        const bar = task._bar;
                        if (!bar || (bar.x + bar.width >= sx - 200 && bar.x <= ex + 200)) {
                            result.push(task.id);
                        }
                    }
                }
            });
        }
        return result;
    });

    // Check if a task is expanded (has subtasks and is in expandedTasks set)
    const isTaskExpanded = (taskId: string): boolean => {
        return props.ganttConfig?.isTaskExpanded?.(taskId) ?? false;
    };

    // Check if we're in simple mode (no expansion/subtasks)
    const isSimpleMode = (): boolean => props.ganttConfig?.renderMode?.() === 'simple';

    // Split visible tasks into three categories:
    // 1. expandedIds - tasks with subtasks that are expanded (render as ExpandedTaskContainer)
    // 2. summaryIds - project-level summary bars (render as SummaryBar)
    // 3. regularIds - normal tasks (render as Bar)
    //
    // In simple mode: skip all expansion logic, render all tasks as regular or summary
    const splitTaskIds = createMemo(() => {
        const simpleMode = isSimpleMode();
        const visibleIds = visibleTaskIds();

        // Untrack task store access to avoid per-task subscriptions
        return untrack(() => {
            const regularIds: string[] = [];
            const summaryIds: string[] = [];
            const expandedIds: string[] = [];
            const tasksObj = props.taskStore?.tasks ?? {};

            // Cache isTaskExpanded results to avoid repeated calls
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

                // Simple mode: skip subtasks entirely, render only top-level tasks
                if (simpleMode) {
                    if (parentId) continue;

                    if (taskType === 'summary' || taskType === 'project') {
                        summaryIds.push(taskId);
                    } else {
                        regularIds.push(taskId);
                    }
                    continue;
                }

                // Detailed mode: full expansion logic
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

    // Pool sizing: track max seen count to prevent shrinking
    let maxRegularCount = 0;
    let maxSummaryCount = 0;

    // Pooled arrays for <Index> - sized to max(seen) + buffer
    // Pool only grows, never shrinks, to prevent DOM thrashing
    const pooledRegularIds = createMemo((): (string | undefined)[] => {
        const ids = splitTaskIds().regularIds;
        maxRegularCount = Math.max(maxRegularCount, ids.length);
        const poolSize = maxRegularCount + POOL_BUFFER;

        // Create array with pool size, fill with IDs, rest are undefined
        const result: (string | undefined)[] = new Array(poolSize);
        for (let i = 0; i < ids.length; i++) {
            result[i] = ids[i];
        }
        return result;
    });

    // OPTIMIZATION: Pass task objects directly instead of IDs + store lookup
    // This reduces per-component overhead from multiple store.tasks[id] accesses
    const pooledRegularTasks = createMemo((): (ProcessedTask | undefined)[] => {
        const ids = pooledRegularIds();
        const tasksObj = props.taskStore?.tasks ?? {};
        return untrack(() => ids.map(id => id ? tasksObj[id] as ProcessedTask | undefined : undefined));
    });

    const pooledSummaryIds = createMemo((): (string | undefined)[] => {
        const ids = splitTaskIds().summaryIds;
        maxSummaryCount = Math.max(maxSummaryCount, ids.length);
        const poolSize = maxSummaryCount + POOL_BUFFER;

        const result: (string | undefined)[] = new Array(poolSize);
        for (let i = 0; i < ids.length; i++) {
            result[i] = ids[i];
        }
        return result;
    });

    // Get task-specific position within its resource row
    const getTaskPosition = (taskId: string): TaskPosition | null => {
        const rowLayouts = props.rowLayouts;
        if (!rowLayouts) return null;
        const task = props.taskStore?.getTask?.(taskId);
        if (!task) return null;

        const resourceId = task['resource'] as string | undefined;
        const rowLayout = rowLayouts.get(resourceId || '');
        if (!rowLayout) return null;

        // Simple mode: no taskPositions map, use static row position
        if (isSimpleMode()) {
            return {
                ...rowLayout,
                y: rowLayout.contentY ?? rowLayout.y ?? 0,
                height: rowLayout.contentHeight ?? rowLayout.height ?? 30,
                isExpanded: false,
            };
        }

        // Detailed mode: get task-specific position from taskPositions map
        const taskPos = rowLayout.taskPositions?.get(taskId);
        if (taskPos) {
            return {
                ...rowLayout,
                y: taskPos.y,
                height: taskPos.height,
                isExpanded: taskPos.isExpanded,
            };
        }

        // Fallback to row layout
        return rowLayout;
    };

    return (
        <div class="task-layer" style={{ contain: 'layout style', position: 'relative', width: '100%', height: '100%' }}>
            {/* Summary bars render BEHIND everything */}
            <div class="summary-layer" style={{ contain: 'layout style' }}>
                <Index each={pooledSummaryIds()}>
                    {(taskId: Accessor<string | undefined>) => (
                        <div style={{ display: taskId() ? 'block' : 'none' }}>
                            <SummaryBar
                                taskId={taskId as Accessor<string>}
                                taskStore={props.taskStore}
                                ganttConfig={props.ganttConfig}
                                onCollectDescendants={handleCollectDescendants}
                                onClampBatchDelta={handleClampBatchDelta}
                                onDragEnd={handleResizeEnd}
                            />
                        </div>
                    )}
                </Index>
            </div>

            {/* Expanded task containers (parent + subtasks) */}
            <div class="expanded-layer" style={{ contain: 'layout style' }}>
                <For each={splitTaskIds().expandedIds}>
                    {(taskId) => (
                        <ExpandedTaskContainer
                            taskId={taskId}
                            taskStore={props.taskStore}
                            ganttConfig={props.ganttConfig}
                            rowLayout={getTaskPosition(taskId) ?? undefined}
                        />
                    )}
                </For>
            </div>

            {/* Regular task bars render ON TOP */}
            <div class="task-bars-layer" style={{ contain: 'layout style' }}>
                <Index each={pooledRegularTasks()}>
                    {(task: Accessor<ProcessedTask | undefined>) => (
                        <div style={{ display: task() ? 'block' : 'none', 'pointer-events': 'auto' }}>
                            <Bar
                                task={task as Accessor<ProcessedTask>}
                                taskStore={props.taskStore}
                                ganttConfig={props.ganttConfig}
                                onConstrainPosition={handleConstrainPosition}
                                onCollectDependents={handleCollectDependents}
                                onCollectDescendants={handleCollectDescendants}
                                onClampBatchDelta={handleClampBatchDelta}
                                onDateChange={handleDateChange}
                                onProgressChange={handleProgressChange}
                                onResizeEnd={handleResizeEnd}
                                onHover={handleHover}
                                onHoverEnd={handleHoverEnd}
                                onTaskClick={handleTaskClick}
                            />
                        </div>
                    )}
                </Index>
            </div>
        </div>
    );
}

export default TaskLayer;
