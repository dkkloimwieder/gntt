import { For, Index, createMemo, untrack } from 'solid-js';
import { Bar } from './Bar.jsx';
import { SummaryBar } from './SummaryBar.jsx';
import { ExpandedTaskContainer } from './ExpandedTaskContainer.jsx';
import {
    resolveMovement,
    collectDependentTasks,
    clampBatchDeltaX,
    resolveAfterResize,
} from '../utils/constraintResolver.js';
import { collectDescendants } from '../utils/hierarchyProcessor.js';
import { prof } from '../perf/profiler.js';

// ═══════════════════════════════════════════════════════════════════════════════
// BAR POOLING: Fixed pool of indices for <Index> to prevent DOM creation/destruction
// ═══════════════════════════════════════════════════════════════════════════════
const BAR_POOL_SIZE = 500; // Max bars expected in viewport (increased for dense data)
const SUMMARY_POOL_SIZE = 100; // Max summary bars expected
const barPool = Array.from({ length: BAR_POOL_SIZE }, (_, i) => i);
const summaryPool = Array.from({ length: SUMMARY_POOL_SIZE }, (_, i) => i);

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

    /**
     * Handle constraint position callback from Bar.
     * Integrates with constraintResolver for dependency constraints.
     */
    const handleConstrainPosition = (taskId, newX, newY) => {
        if (!props.taskStore) return { x: newX, y: newY };

        // Get columnWidth for lag conversion (lag is in days, needs pixels)
        const columnWidth = props.ganttConfig?.columnWidth?.() ?? 45;

        const result = resolveMovement(
            taskId,
            newX,
            newY,
            props.taskStore,
            relationships(),
            { pixelsPerTimeUnit: columnWidth },
        );

        if (!result) {
            // Movement blocked
            return null;
        }

        if (result.type === 'batch') {
            // Multiple tasks need to move (fixed offset)
            for (const update of result.updates) {
                if (update.taskId !== taskId) {
                    props.taskStore.updateBarPosition(update.taskId, {
                        x: update.x,
                    });
                }
            }
            // Return the position for the dragged task
            const selfUpdate = result.updates.find((u) => u.taskId === taskId);
            return selfUpdate
                ? { x: selfUpdate.x, y: selfUpdate.y }
                : { x: newX, y: newY };
        }

        // Single task update
        return { x: result.x, y: result.y };
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
            resolveAfterResize(taskId, props.taskStore, relationships());
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

    // Group tasks by resource for row-level rendering
    const tasksByResource = createMemo(() => {
        const grouped = new Map();
        for (const task of tasks()) {
            // Skip hidden tasks (in collapsed groups)
            if (task._isHidden) continue;

            const resource = task.resource || 'Unassigned';
            if (!grouped.has(resource)) {
                grouped.set(resource, []);
            }
            grouped.get(resource).push(task);
        }
        return grouped;
    });

    // FLAT VIRTUALIZATION with both row AND X filtering
    // Key insight: Keeping DOM size small (~300-500 tasks) is more important than
    // avoiding CSS visibility toggles for 2,300 tasks

    // Create flat list of task IDs filtered by BOTH row AND X range
    // IMPORTANT: Return IDs (strings) instead of task objects to maintain stable references.
    // This prevents <For> from recreating Bar components when the store updates during drag,
    // which would kill the document event listeners and break drag functionality.
    const visibleTaskIds = createMemo(() => {
        const endProf = prof.start('TaskLayer.visibleTaskIds');

        const result = [];
        const resList = displayResources();
        const startIdx = startRow();
        const endIdx = endRow();
        const grouped = tasksByResource();
        const sx = startX();
        const ex = endX();

        // Filter by row range
        for (let i = startIdx; i < endIdx && i < resList.length; i++) {
            const item = resList[i];

            // Skip group rows - they have no tasks directly assigned
            if (item.type === 'group') continue;

            const resourceId = item.id;
            const resourceTaskList = grouped.get(resourceId);
            if (!resourceTaskList) continue;

            // Filter by X range with 200px buffer for partial visibility
            for (const task of resourceTaskList) {
                if (ex !== Infinity) {
                    // Untrack $bar access to prevent cascade during drag
                    // We still want this memo to update when tasks are added/removed
                    const bar = untrack(() => task.$bar);
                    if (bar && (bar.x + bar.width < sx - 200 || bar.x > ex + 200)) {
                        continue; // Skip tasks outside X viewport
                    }
                }
                result.push(task.id); // Push ID, not task object - keeps references stable
            }
        }

        endProf();
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
        const regularIds = [];
        const summaryIds = [];
        const expandedIds = [];
        // tasks is now a store object, not a Map
        const tasksObj = props.taskStore?.tasks ?? {};
        const simpleMode = isSimpleMode();

        for (const taskId of visibleTaskIds()) {
            const task = tasksObj[taskId];
            if (!task) continue;

            // Simple mode: skip subtasks entirely, render only top-level tasks
            if (simpleMode) {
                // Skip subtasks in simple mode
                if (task.parentId) continue;

                if (task.type === 'summary' || task.type === 'project') {
                    summaryIds.push(taskId);
                } else {
                    regularIds.push(taskId);
                }
                continue;
            }

            // Detailed mode: full expansion logic
            const hasSubtasks = task._children && task._children.length > 0;
            const expanded = isTaskExpanded(taskId);

            if (hasSubtasks && expanded) {
                // Expanded task with visible subtasks - use ExpandedTaskContainer
                expandedIds.push(taskId);
            } else if (task.type === 'summary' || task.type === 'project') {
                // Project-level summary bar
                summaryIds.push(taskId);
            } else if (!task.parentId || !isTaskExpanded(task.parentId)) {
                // Regular task (not a subtask of an expanded parent)
                // Subtasks of expanded parents are rendered inside ExpandedTaskContainer
                regularIds.push(taskId);
            }
            // else: subtask of expanded parent - skip, rendered by ExpandedTaskContainer
        }

        return { regularIds, summaryIds, expandedIds };
    });

    // Pooled task data for <Index> rendering (prevents DOM creation/destruction)
    const pooledRegularIds = createMemo(() => {
        const ids = splitTaskIds().regularIds;
        const result = new Array(BAR_POOL_SIZE);
        for (let i = 0; i < ids.length && i < BAR_POOL_SIZE; i++) {
            result[i] = ids[i];
        }
        return result;
    });

    const pooledSummaryIds = createMemo(() => {
        const ids = splitTaskIds().summaryIds;
        const result = new Array(SUMMARY_POOL_SIZE);
        for (let i = 0; i < ids.length && i < SUMMARY_POOL_SIZE; i++) {
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
        <g class="task-layer" style="contain: layout style;">
            {/* Summary bars render BEHIND everything */}
            <g class="summary-layer" style="contain: layout style;">
                <Index each={summaryPool}>
                    {(_, slotIndex) => {
                        // Pass accessor function for reactive updates when pool changes
                        const getTaskId = () => pooledSummaryIds()[slotIndex];
                        return (
                            <g style={{ display: getTaskId() ? 'block' : 'none' }}>
                                <SummaryBar
                                    taskId={getTaskId}
                                    taskStore={props.taskStore}
                                    ganttConfig={props.ganttConfig}
                                    taskPosition={getTaskPosition(getTaskId())}
                                    onCollectDescendants={handleCollectDescendants}
                                    onClampBatchDelta={handleClampBatchDelta}
                                    onToggleCollapse={handleToggleCollapse}
                                    onDragEnd={handleResizeEnd}
                                />
                            </g>
                        );
                    }}
                </Index>
            </g>

            {/* Expanded task containers (parent + subtasks) */}
            <g class="expanded-layer" style="contain: layout style;">
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
            </g>

            {/* Regular task bars render ON TOP */}
            <g class="task-bars-layer" style="contain: layout style;">
                <Index each={barPool}>
                    {(_, slotIndex) => {
                        // Pass accessor function for reactive updates when pool changes
                        const getTaskId = () => pooledRegularIds()[slotIndex];
                        return (
                            <g style={{ display: getTaskId() ? 'block' : 'none' }}>
                                <Bar
                                    taskId={getTaskId}
                                    taskStore={props.taskStore}
                                    ganttConfig={props.ganttConfig}
                                    taskPosition={getTaskPosition(getTaskId())}
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
                            </g>
                        );
                    }}
                </Index>
            </g>
        </g>
    );
}

export default TaskLayer;
