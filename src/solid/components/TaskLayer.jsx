import { For, createMemo } from 'solid-js';
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

    // Get task IDs for iteration - For will re-run when IDs change
    const taskIds = () => tasks().map((t) => t.id);

    return (
        <g class="task-layer">
            <For each={taskIds()}>
                {(taskId) => {
                    // Create accessor that reads fresh from store each time
                    const task = () => props.taskStore?.getTask(taskId);

                    return (
                        <Bar
                            task={task()}
                            taskId={taskId}
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
                    );
                }}
            </For>
        </g>
    );
}

export default TaskLayer;
