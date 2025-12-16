import { createSignal } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';

/**
 * Reactive task store for tracking task and bar positions.
 * Uses createStore for fine-grained reactivity - only components reading
 * specific task paths re-render when those paths change.
 */
export function createTaskStore() {
    // Object of task ID to task data (includes position info)
    // Using createStore for fine-grained reactivity (path-level tracking)
    const [tasks, setTasks] = createStore({});

    // Set of collapsed task IDs (tasks whose children are hidden)
    const [collapsedTasks, setCollapsedTasks] = createSignal(new Set());

    // Drag state - used to defer expensive recalculations during drag
    const [draggingTaskId, setDraggingTaskId] = createSignal(null);

    // Get a specific task by ID
    // Accessing tasks[id] creates fine-grained dependency on just that task
    const getTask = (id) => {
        return tasks[id];
    };

    // Get bar position for a task
    // Accessing tasks[id].$bar creates fine-grained dependency
    const getBarPosition = (id) => {
        const task = tasks[id];
        if (!task || !task.$bar) return null;

        return {
            x: task.$bar.x,
            y: task.$bar.y,
            width: task.$bar.width,
            height: task.$bar.height,
            index: task._index,
        };
    };

    // Update task in store (replaces entire task)
    const updateTask = (id, taskData) => {
        setTasks(id, taskData);
    };

    // Update bar position for a task (fine-grained path update)
    const updateBarPosition = (id, position) => {
        if (!tasks[id]) return;
        // Use produce for fine-grained update - only triggers subscribers to changed paths
        setTasks(
            produce((state) => {
                if (state[id]) {
                    state[id].$bar = { ...state[id].$bar, ...position };
                }
            }),
        );
    };

    // Batch update multiple tasks (typically on initial load)
    const updateTasks = (tasksArray) => {
        const tasksObj = {};
        tasksArray.forEach((task) => {
            tasksObj[task.id] = task;
        });
        setTasks(reconcile(tasksObj));
    };

    // Remove task from store
    const removeTask = (id) => {
        setTasks(id, undefined);
    };

    // Clear all tasks
    const clear = () => {
        setTasks(reconcile({}));
    };

    // Get all tasks as array
    const getAllTasks = () => {
        return Object.values(tasks);
    };

    // Get task count (reads all keys, so subscribes to additions/removals)
    const taskCount = () => Object.keys(tasks).length;

    /**
     * Move multiple tasks by deltaX in a single reactive update.
     * Uses produce for fine-grained updates - only affected Bar components re-render.
     *
     * @param {Map<string, {originalX: number}>} taskOriginals - Task ID -> original position
     * @param {number} deltaX - Pixels to move from original position
     */
    const batchMovePositions = (taskOriginals, deltaX) => {
        setTasks(
            produce((state) => {
                for (const [id, { originalX }] of taskOriginals) {
                    if (state[id]?.$bar) {
                        state[id].$bar.x = originalX + deltaX;
                    }
                }
            }),
        );
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
        for (const task of Object.values(tasks)) {
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
        // Drag state - for deferring expensive calculations
        draggingTaskId,
        setDraggingTaskId,
    };
}
