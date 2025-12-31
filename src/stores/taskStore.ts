import { createSignal, Accessor, Setter } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import { prof } from '../utils/profiler';
import type { BarPosition, ProcessedTask } from '../types';

/** Store's internal task map - keyed by task ID */
interface TaskMap {
    [key: string]: ProcessedTask | undefined;
}

interface BarPositionWithIndex extends BarPosition {
    index?: number;
}

interface BatchOriginal {
    originalX: number;
}

export interface TaskStore {
    tasks: TaskMap;
    getTask: (id: string) => ProcessedTask | undefined;
    getBarPosition: (id: string) => BarPositionWithIndex | null;
    getAllTasks: () => ProcessedTask[];
    taskCount: () => number;
    updateTask: (id: string, taskData: ProcessedTask) => void;
    updateBarPosition: (id: string, position: Partial<BarPosition>) => void;
    updateTasks: (tasksArray: ProcessedTask[]) => void;
    batchMovePositions: (taskOriginals: Map<string, BatchOriginal>, deltaX: number) => void;
    removeTask: (id: string) => void;
    clear: () => void;

    // Subtask collapse state
    collapsedTasks: Accessor<Set<string>>;
    toggleTaskCollapse: (taskId: string) => void;
    isTaskCollapsed: (taskId: string) => boolean;
    expandTask: (taskId: string) => void;
    collapseTask: (taskId: string) => void;
    expandAllTasks: () => void;
    collapseAllTasks: () => void;

    // Drag state - for deferring expensive calculations
    draggingTaskId: Accessor<string | null>;
    setDraggingTaskId: Setter<string | null>;
}

/**
 * Reactive task store for tracking task and bar positions.
 * Uses createStore for fine-grained reactivity - only components reading
 * specific task paths re-render when those paths change.
 */
export function createTaskStore(): TaskStore {
    // Object of task ID to task data (includes position info)
    // Using createStore for fine-grained reactivity (path-level tracking)
    const [tasks, setTasks] = createStore<TaskMap>({});

    // Set of collapsed task IDs (tasks whose children are hidden)
    const [collapsedTasks, setCollapsedTasks] = createSignal<Set<string>>(new Set());

    // Drag state - used to defer expensive recalculations during drag
    const [draggingTaskId, setDraggingTaskId] = createSignal<string | null>(null);

    // Get a specific task by ID
    // Accessing tasks[id] creates fine-grained dependency on just that task
    const getTask = (id: string): ProcessedTask | undefined => {
        return tasks[id];
    };

    // Get bar position for a task
    // Accessing tasks[id]._bar creates fine-grained dependency
    const getBarPosition = (id: string): BarPositionWithIndex | null => {
        const endProf = prof.start('taskStore.getBarPosition');

        const task = tasks[id];
        if (!task || !task._bar) {
            endProf();
            return null;
        }

        const result: BarPositionWithIndex = {
            x: task._bar.x,
            y: task._bar.y,
            width: task._bar.width,
            height: task._bar.height,
            index: task._index,
        };

        endProf();
        return result;
    };

    // Update task in store (replaces entire task)
    const updateTask = (id: string, taskData: ProcessedTask): void => {
        setTasks(id, taskData);
    };

    // Update bar position for a task (fine-grained path update)
    const updateBarPosition = (id: string, position: Partial<BarPosition>): void => {
        if (!tasks[id]) return;
        // Use produce for fine-grained update - only triggers subscribers to changed paths
        setTasks(
            produce((state) => {
                const task = state[id];
                if (task && task._bar) {
                    state[id] = {
                        ...task,
                        _bar: { ...task._bar, ...position },
                    };
                }
            }),
        );
    };

    // Batch update multiple tasks (typically on initial load)
    const updateTasks = (tasksArray: ProcessedTask[]): void => {
        const tasksObj: TaskMap = {};
        tasksArray.forEach((task) => {
            tasksObj[task.id] = task;
        });
        setTasks(reconcile(tasksObj));
    };

    // Remove task from store
    const removeTask = (id: string): void => {
        setTasks(id, undefined);
    };

    // Clear all tasks
    const clear = (): void => {
        setTasks(reconcile({}));
    };

    // Get all tasks as array
    const getAllTasks = (): ProcessedTask[] => {
        return Object.values(tasks).filter((t): t is ProcessedTask => t !== undefined);
    };

    // Get task count (reads all keys, so subscribes to additions/removals)
    const taskCount = (): number => Object.keys(tasks).length;

    /**
     * Move multiple tasks by deltaX in a single reactive update.
     * Uses produce for fine-grained updates - only affected Bar components re-render.
     */
    const batchMovePositions = (taskOriginals: Map<string, BatchOriginal>, deltaX: number): void => {
        setTasks(
            produce((state) => {
                for (const [id, { originalX }] of taskOriginals) {
                    const task = state[id];
                    if (task?._bar) {
                        state[id] = {
                            ...task,
                            _bar: { ...task._bar, x: originalX + deltaX },
                        };
                    }
                }
            }),
        );
    };

    // --- Subtask Collapse State ---

    /**
     * Toggle collapse state for a task (show/hide its descendants).
     */
    const toggleTaskCollapse = (taskId: string): void => {
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
     */
    const isTaskCollapsed = (taskId: string): boolean => collapsedTasks().has(taskId);

    /**
     * Explicitly expand a task (show its descendants).
     */
    const expandTask = (taskId: string): void => {
        setCollapsedTasks((prev) => {
            if (!prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.delete(taskId);
            return next;
        });
    };

    /**
     * Explicitly collapse a task (hide its descendants).
     */
    const collapseTask = (taskId: string): void => {
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
    const expandAllTasks = (): void => {
        setCollapsedTasks(new Set<string>());
    };

    /**
     * Collapse all summary tasks.
     */
    const collapseAllTasks = (): void => {
        const summaryIds: string[] = [];
        for (const task of Object.values(tasks)) {
            if (task && (task.type === 'summary' || (task._children && task._children.length > 0))) {
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
