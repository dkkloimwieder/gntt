import { createSignal, createMemo } from 'solid-js';

/**
 * Reactive task store for tracking task and bar positions.
 * Used by Arrow components to reactively update when task positions change.
 */
export function createTaskStore() {
    // Map of task ID to task data (includes position info)
    const [tasks, setTasks] = createSignal(new Map());

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
    };
}
