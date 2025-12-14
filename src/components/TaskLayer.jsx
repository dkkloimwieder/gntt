import { Index, createMemo } from 'solid-js';
import { Bar } from './Bar.jsx';
import {
    resolveMovement,
    collectDependentTasks,
    clampBatchDeltaX,
    resolveAfterResize,
} from '../utils/constraintResolver.js';

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

    // Resources list for row grouping
    const resources = () => props.resources || [];

    // Viewport range for row virtualization
    const startRow = () => props.startRow ?? 0;
    const endRow = () => props.endRow ?? resources().length;

    // Viewport range for horizontal (X) virtualization
    const startX = () => props.startX ?? 0;
    const endX = () => props.endX ?? Infinity;

    // Group tasks by resource for row-level rendering
    const tasksByResource = createMemo(() => {
        const t0 = performance.now();
        const grouped = new Map();
        for (const task of tasks()) {
            const resource = task.resource || 'Unassigned';
            if (!grouped.has(resource)) {
                grouped.set(resource, []);
            }
            grouped.get(resource).push(task);
        }
        const elapsed = performance.now() - t0;
        if (elapsed > 1) {
            console.log(`[TaskLayer] tasksByResource recalc: ${elapsed.toFixed(2)}ms`);
        }
        return grouped;
    });

    // FLAT VIRTUALIZATION with both row AND X filtering
    // Key insight: Keeping DOM size small (~300-500 tasks) is more important than
    // avoiding CSS visibility toggles for 2,300 tasks

    // Create flat list of tasks filtered by BOTH row AND X range
    const visibleTasks = createMemo(() => {
        const t0 = performance.now();
        const result = [];
        const resList = resources();
        const startIdx = startRow();
        const endIdx = endRow();
        const grouped = tasksByResource();
        const sx = startX();
        const ex = endX();

        // Filter by row range
        for (let i = startIdx; i < endIdx && i < resList.length; i++) {
            const resource = resList[i];
            const resourceTaskList = grouped.get(resource);
            if (!resourceTaskList) continue;

            // Filter by X range
            for (const task of resourceTaskList) {
                if (ex !== Infinity) {
                    const bar = task.$bar;
                    if (bar && (bar.x + bar.width < sx || bar.x > ex)) {
                        continue; // Skip tasks outside X viewport
                    }
                }
                result.push(task);
            }
        }

        const elapsed = performance.now() - t0;
        if (elapsed > 1) {
            console.log(`[TaskLayer] visibleTasks filter: ${elapsed.toFixed(2)}ms, ${result.length} tasks`);
        }
        return result;
    });

    return (
        <g class="task-layer">
            {/* Index-based virtualization: components reuse on scroll (no create/destroy) */}
            {/* With Index, task is a signal - components update their data rather than being recreated */}
            <Index each={visibleTasks()}>
                {(task) => (
                    <Bar
                        task={task()}
                        taskId={task().id}
                        taskStore={props.taskStore}
                        ganttConfig={props.ganttConfig}
                        onConstrainPosition={handleConstrainPosition}
                        onCollectDependents={handleCollectDependents}
                        onClampBatchDelta={handleClampBatchDelta}
                        onDateChange={handleDateChange}
                        onProgressChange={handleProgressChange}
                        onResizeEnd={handleResizeEnd}
                        onHover={handleHover}
                        onHoverEnd={handleHoverEnd}
                        onTaskClick={handleTaskClick}
                    />
                )}
            </Index>
        </g>
    );
}

export default TaskLayer;
