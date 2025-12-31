import { For, Index, createMemo, untrack } from 'solid-js';
import { Bar } from './Bar.jsx';
import { SummaryBar } from './SummaryBar.jsx';
import { ExpandedTaskContainer } from './ExpandedTaskContainer.jsx';
import {
    resolveConstraints,
    buildRelationshipIndex,
    collectDependentTasks,
    clampBatchDeltaX,
} from '../utils/constraintEngine.js';
import { collectDescendants } from '../utils/hierarchyProcessor.js';
import { prof } from '../utils/profiler.js';

// Pool sizing: We maintain a pool slightly larger than visible count.
// This provides buffer for smooth scrolling while avoiding constant DOM creation.
// Pool only grows (never shrinks) to prevent thrashing during scroll.
const POOL_BUFFER = 5; // Reduced from 50 - with Index, we don't create DOM during scroll

/**
 * TaskLayer - Container for all task bars.
 * Maps tasks to Bar components and handles constraint resolution.
 */
export function TaskLayer(props) {
    // Get tasks from store or props
    const tasks = () => {
        if (props.taskStore) {
            return props.taskStore.getAllTasks?.() || [];
        }
        return props.tasks || [];
    };

    // Relationships for constraint resolution
    const relationships = () => props.relationships || [];

    // Pre-build relationship index for O(1) lookups (rebuilds when relationships change)
    const relationshipIndex = createMemo(() => buildRelationshipIndex(relationships()));

    /**
     * Handle constraint position callback from Bar.
     * Uses constraintEngine for dependency constraints.
     */
    const handleConstrainPosition = (taskId, newX, newY) => {
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
        };

        const result = resolveConstraints(taskId, newX, width, context);

        if (result.blocked) {
            // Movement blocked
            return null;
        }

        // Apply cascade updates to successors
        if (result.cascadeUpdates && result.cascadeUpdates.length > 0) {
            for (const [succId, update] of result.cascadeUpdates) {
                props.taskStore.updateBarPosition(succId, update);
            }
        }

        // Return the constrained position for the dragged task
        return { x: result.constrainedX, y: newY };
    };

    /**
     * Handle date change callback from Bar.
     */
    const handleDateChange = (taskId, position) => {
        props.onDateChange?.(taskId, position);
    };

    /**
     * Handle progress change callback from Bar.
     */
    const handleProgressChange = (taskId, progress) => {
        props.onProgressChange?.(taskId, progress);
    };

    /**
     * Handle resize end callback from Bar.
     * Resolves constraints to push dependent tasks if needed.
     */
    const handleResizeEnd = (taskId) => {
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
                };
                const result = resolveConstraints(taskId, taskBar.x, taskBar.width, context);
                // Apply cascade updates
                if (result.cascadeUpdates) {
                    for (const [succId, update] of result.cascadeUpdates) {
                        props.taskStore.updateBarPosition(succId, update);
                    }
                }
            }
        }
        props.onResizeEnd?.(taskId);
    };

    /**
     * Handle task hover.
     */
    const handleHover = (taskId, clientX, clientY) => {
        props.onHover?.(taskId, clientX, clientY);
    };

    /**
     * Handle task hover end.
     */
    const handleHoverEnd = () => {
        props.onHoverEnd?.();
    };

    /**
     * Handle task click.
     */
    const handleTaskClick = (taskId, event) => {
        props.onTaskClick?.(taskId, event);
    };

    /**
     * Collect all dependent tasks for batch drag.
     * Returns a Set of task IDs that should move together.
     */
    const handleCollectDependents = (taskId) => {
        const getTask = props.taskStore?.getTask?.bind(props.taskStore);
        return collectDependentTasks(taskId, relationships(), getTask);
    };

    /**
     * Clamp batch delta to prevent constraint violations.
     * Called during drag to ensure no task moves behind its predecessor.
     * @param {Map<string, {originalX: number}>} batchOriginals - Original positions
     * @param {number} proposedDeltaX - Proposed movement delta
     */
    const handleClampBatchDelta = (batchOriginals, proposedDeltaX) => {
        const getTask = props.taskStore?.getTask?.bind(props.taskStore);
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
     * @param {string} taskId - Parent task ID
     * @returns {Set<string>} Descendant task IDs
     */
    const handleCollectDescendants = (taskId) => {
        if (!props.taskStore) return new Set();
        // tasks is now a store object, not a Map
        const tasksObj = props.taskStore.tasks;
        return collectDescendants(taskId, tasksObj);
    };

    /**
     * Handle collapse toggle for summary bars.
     * @param {string} taskId - Summary task ID
     */
    const handleToggleCollapse = (taskId) => {
        props.taskStore?.toggleTaskCollapse(taskId);
    };

    // Get display resources from resourceStore (respects collapse state)
    const displayResources = () => props.resourceStore?.displayResources() || [];

    // Viewport range for row virtualization
    const startRow = () => props.startRow ?? 0;
    const endRow = () => props.endRow ?? displayResources().length;

    // Viewport range for horizontal (X) virtualization
    const startX = () => props.startX ?? 0;
    const endX = () => props.endX ?? Infinity;

    // Group tasks by resource - CACHED to avoid O(10K) iteration on every scroll
    // Only rebuilds when task count changes (add/remove tasks)
    let cachedGrouping = null;
    let cachedTaskCount = -1;

    const tasksByResource = () => {
        const tasksObj = props.taskStore?.tasks;
        if (!tasksObj) return new Map();

        // Check if we need to rebuild (task count changed)
        const taskKeys = untrack(() => Object.keys(tasksObj));
        if (taskKeys.length === cachedTaskCount && cachedGrouping) {
            return cachedGrouping;
        }

        // Rebuild grouping
        cachedTaskCount = taskKeys.length;
        const grouped = new Map();
        untrack(() => {
            for (const taskId of taskKeys) {
                const task = tasksObj[taskId];
                if (!task || task._isHidden) continue;

                const resource = task.resource || 'Unassigned';
                if (!grouped.has(resource)) {
                    grouped.set(resource, []);
                }
                grouped.get(resource).push(task);
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
    const visibleTaskIds = createMemo(() => {
        const result = [];
        const resList = displayResources();
        const grouped = tasksByResource();
        const startIdx = startRow();
        const endIdx = endRow();
        const sx = startX();
        const ex = endX();

        // Filter by row range (typically 20-50 rows with overscan)
        for (let i = startIdx; i < endIdx && i < resList.length; i++) {
            const item = resList[i];
            if (item.type === 'group') continue;

            const resourceTaskList = grouped.get(item.id);
            if (!resourceTaskList) continue;

            // Filter by X range - untrack to prevent O(n) subscriptions
            // Tasks in resourceTaskList are store proxies - accessing $bar would create subscriptions
            untrack(() => {
                if (ex === Infinity) {
                    // No X filtering - just collect IDs
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        result.push(resourceTaskList[j].id);
                    }
                } else {
                    // X filtering enabled
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        const task = resourceTaskList[j];
                        const bar = task.$bar;
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
    const isTaskExpanded = (taskId) => {
        return props.ganttConfig?.isTaskExpanded?.(taskId) ?? false;
    };

    // Check if we're in simple mode (no expansion/subtasks)
    const isSimpleMode = () => props.ganttConfig?.renderMode?.() === 'simple';

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
            const regularIds = [];
            const summaryIds = [];
            const expandedIds = [];
            const tasksObj = props.taskStore?.tasks ?? {};

            // Cache isTaskExpanded results to avoid repeated calls
            const expandedCache = new Map();
            const checkExpanded = (id) => {
                if (!expandedCache.has(id)) {
                    expandedCache.set(id, isTaskExpanded(id));
                }
                return expandedCache.get(id);
            };

            for (const taskId of visibleIds) {
                const task = tasksObj[taskId];
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
    const pooledRegularIds = createMemo(() => {
        const ids = splitTaskIds().regularIds;
        maxRegularCount = Math.max(maxRegularCount, ids.length);
        const poolSize = maxRegularCount + POOL_BUFFER;

        // Create array with pool size, fill with IDs, rest are undefined
        const result = new Array(poolSize);
        for (let i = 0; i < ids.length; i++) {
            result[i] = ids[i];
        }
        return result;
    });

    // OPTIMIZATION: Pass task objects directly instead of IDs + store lookup
    // This reduces per-component overhead from multiple store.tasks[id] accesses
    const pooledRegularTasks = createMemo(() => {
        const ids = pooledRegularIds();
        const tasksObj = props.taskStore?.tasks ?? {};
        return untrack(() => ids.map(id => id ? tasksObj[id] : undefined));
    });

    const pooledSummaryIds = createMemo(() => {
        const ids = splitTaskIds().summaryIds;
        maxSummaryCount = Math.max(maxSummaryCount, ids.length);
        const poolSize = maxSummaryCount + POOL_BUFFER;

        const result = new Array(poolSize);
        for (let i = 0; i < ids.length; i++) {
            result[i] = ids[i];
        }
        return result;
    });

    // Get task-specific position within its resource row
    const getTaskPosition = (taskId) => {
        const rowLayouts = props.rowLayouts;
        if (!rowLayouts) return null;
        const task = props.taskStore?.getTask?.(taskId);
        if (!task) return null;

        const rowLayout = rowLayouts.get(task.resource);
        if (!rowLayout) return null;

        // Simple mode: no taskPositions map, use static row position
        if (isSimpleMode()) {
            return {
                ...rowLayout,
                y: rowLayout.contentY,
                height: rowLayout.contentHeight,
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
                    {(taskId) => (
                        <div style={{ display: taskId() ? 'block' : 'none' }}>
                            <SummaryBar
                                taskId={taskId}
                                taskStore={props.taskStore}
                                ganttConfig={props.ganttConfig}
                                onCollectDescendants={handleCollectDescendants}
                                onClampBatchDelta={handleClampBatchDelta}
                                onToggleCollapse={handleToggleCollapse}
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
                            rowLayout={getTaskPosition(taskId)}
                        />
                    )}
                </For>
            </div>

            {/* Regular task bars render ON TOP */}
            <div class="task-bars-layer" style={{ contain: 'layout style' }}>
                <Index each={pooledRegularTasks()}>
                    {(task) => (
                        <div style={{ display: task() ? 'block' : 'none', 'pointer-events': 'auto' }}>
                            <Bar
                                task={task}
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
