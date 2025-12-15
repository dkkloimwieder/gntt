import { createSignal, createMemo } from 'solid-js';

/**
 * Reactive task store for tracking task and bar positions.
 * Used by Arrow components to reactively update when task positions change.
 */
export function createTaskStore() {
    // Map of task ID to task data (includes position info)
    const [tasks, setTasks] = createSignal(new Map());

    // Set of collapsed task IDs (tasks whose children are hidden)
    const [collapsedTasks, setCollapsedTasks] = createSignal(new Set());

    // Get a specific task by ID
    // Returns raw value - don't create memos in event handlers!
    const getTask = (id) => {
        return tasks().get(id);
    };

    // Get bar position for a task
    // Accesses tasks() signal to ensure reactivity when called inside createMemo
    const getBarPosition = (id) => {
        const tasksMap = tasks(); // Access signal to track dependency
        const task = tasksMap.get(id);
        if (!task || !task.$bar) return null;

        return {
            x: task.$bar.x,
            y: task.$bar.y,
            width: task.$bar.width,
            height: task.$bar.height,
            index: task._index,
        };
    };

    // Update task in store
    const updateTask = (id, taskData) => {
        setTasks((prev) => {
            const next = new Map(prev);
            next.set(id, taskData);
            return next;
        });
    };

    // Update bar position for a task
    const updateBarPosition = (id, position) => {
        setTasks((prev) => {
            const next = new Map(prev);
            const task = next.get(id);
            if (task) {
                next.set(id, {
                    ...task,
                    $bar: {
                        ...task.$bar,
                        ...position,
                    },
                });
            }
            return next;
        });
    };

    // Batch update multiple tasks
    const updateTasks = (tasksArray) => {
        setTasks(() => {
            const next = new Map();
            tasksArray.forEach((task) => {
                next.set(task.id, task);
            });
            return next;
        });
    };

    // Remove task from store
    const removeTask = (id) => {
        setTasks((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
        });
    };

    // Clear all tasks
    const clear = () => {
        setTasks(new Map());
    };

    // Get all tasks as array
    const getAllTasks = () => {
        return Array.from(tasks().values());
    };

    // Get task count
    const taskCount = createMemo(() => tasks().size);

    /**
     * Move multiple tasks by deltaX in a single reactive update.
     * Used for batch drag operations to avoid N separate updates.
     *
     * @param {Map<string, {originalX: number}>} taskOriginals - Task ID -> original position
     * @param {number} deltaX - Pixels to move from original position
     */
    const batchMovePositions = (taskOriginals, deltaX) => {
        setTasks((prev) => {
            const next = new Map(prev);
            for (const [id, { originalX }] of taskOriginals) {
                const task = next.get(id);
                if (task?.$bar) {
                    next.set(id, {
                        ...task,
                        $bar: { ...task.$bar, x: originalX + deltaX },
                    });
                }
            }
            return next;
        });
    };

    // --- Subtask Collapse State ---

    /**
     * Toggle collapse state for a task (show/hide its descendants).
     * @param {string} taskId - Task ID to toggle
     */
    const toggleTaskCollapse = (taskId) => {
        setCollapsedTasks((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            return next;
        });
    };

    /**
     * Check if a task is collapsed.
     * @param {string} taskId - Task ID to check
     * @returns {boolean}
     */
    const isTaskCollapsed = (taskId) => collapsedTasks().has(taskId);

    /**
     * Explicitly expand a task (show its descendants).
     * @param {string} taskId - Task ID to expand
     */
    const expandTask = (taskId) => {
        setCollapsedTasks((prev) => {
            if (!prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.delete(taskId);
            return next;
        });
    };

    /**
     * Explicitly collapse a task (hide its descendants).
     * @param {string} taskId - Task ID to collapse
     */
    const collapseTask = (taskId) => {
        setCollapsedTasks((prev) => {
            if (prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.add(taskId);
            return next;
        });
    };

    /**
     * Expand all collapsed tasks.
     */
    const expandAllTasks = () => {
        setCollapsedTasks(new Set());
    };

    /**
     * Collapse all summary tasks.
     */
    const collapseAllTasks = () => {
        const summaryIds = [];
        for (const task of tasks().values()) {
            if (task.type === 'summary' || (task._children && task._children.length > 0)) {
                summaryIds.push(task.id);
            }
        }
        setCollapsedTasks(new Set(summaryIds));
    };

    return {
        tasks,
        getTask,
        getBarPosition,
        getAllTasks,
        taskCount,
        updateTask,
        updateBarPosition,
        updateTasks,
        batchMovePositions,
        removeTask,
        clear,
        // Subtask collapse state
        collapsedTasks,
        toggleTaskCollapse,
        isTaskCollapsed,
        expandTask,
        collapseTask,
        expandAllTasks,
        collapseAllTasks,
    };
}
