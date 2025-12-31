/**
 * Hierarchy processor utilities for parent-child task relationships.
 */

/** Minimal interface for hierarchy processing */
interface HierarchyTask {
    id: string;
    parentId?: string;
    type?: string;
    _children?: string[];
    _depth?: number;
}

/** Generic task map - can be Map or Record */
type TaskMapLike<T> = Map<string, T> | Record<string, T | undefined>;

function getTaskFromMap<T>(tasksObj: TaskMapLike<T>, id: string): T | undefined {
    if (tasksObj instanceof Map) {
        return tasksObj.get(id);
    }
    return tasksObj[id];
}

/**
 * Build parent-child hierarchy from flat task array.
 * Mutates tasks in place to add _children, _depth, and auto-detect summary type.
 * Generic to preserve input task type.
 */
export function buildHierarchy<T extends HierarchyTask>(tasks: T[]): Map<string, T> {
    const taskMap = new Map<string, T>();

    // Initialize all tasks
    for (const task of tasks) {
        task._children = [];
        task._depth = 0;
        taskMap.set(task.id, task);
    }

    // Build parent-child links
    for (const task of tasks) {
        if (task.parentId) {
            const parent = taskMap.get(task.parentId);
            if (parent) {
                parent._children!.push(task.id);
                // Auto-detect summary type if not explicitly set
                if (!parent.type) {
                    parent.type = 'summary';
                }
            }
            // If parent doesn't exist, treat as orphan (root task)
        }
    }

    // Compute depths via BFS from roots
    const roots = tasks.filter((t) => !t.parentId);
    const queue: { task: T; depth: number }[] = roots.map((t) => ({ task: t, depth: 0 }));

    while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const { task, depth } = item;
        task._depth = depth;

        for (const childId of task._children || []) {
            const child = taskMap.get(childId);
            if (child) {
                queue.push({ task: child, depth: depth + 1 });
            }
        }
    }

    // Detect circular references (tasks with parentId but no depth assigned)
    for (const task of tasks) {
        if (task.parentId && task._depth === 0 && !roots.includes(task)) {
            console.warn(
                `Circular or orphaned parent reference detected for task ${task.id}`,
            );
            // Treat as root
            task._depth = 0;
        }
    }

    return taskMap;
}

/**
 * Collect all descendant task IDs for a given task.
 * Used for batch drag operations and collapse visibility.
 */
export function collectDescendants<T extends HierarchyTask>(
    taskId: string,
    tasksObj: TaskMapLike<T>
): Set<string> {
    const descendants = new Set<string>();
    const queue = [taskId];
    const getTask = (id: string) => getTaskFromMap(tasksObj, id);

    while (queue.length > 0) {
        const currentId = queue.shift();
        if (!currentId) continue;
        const task = getTask(currentId);

        for (const childId of task?._children || []) {
            if (!descendants.has(childId)) {
                descendants.add(childId);
                queue.push(childId);
            }
        }
    }

    return descendants;
}

/**
 * Check if a task should be hidden because any of its ancestors is collapsed.
 */
export function isHiddenByCollapsedAncestor<T extends HierarchyTask>(
    taskId: string,
    tasksObj: TaskMapLike<T>,
    collapsedSet: Set<string>
): boolean {
    const getTask = (id: string) => getTaskFromMap(tasksObj, id);
    let task = getTask(taskId);

    while (task?.parentId) {
        if (collapsedSet.has(task.parentId)) {
            return true;
        }
        task = getTask(task.parentId);
    }

    return false;
}

/**
 * Get all ancestor task IDs for a given task.
 */
export function getAncestors<T extends HierarchyTask>(
    taskId: string,
    tasksObj: TaskMapLike<T>
): string[] {
    const getTask = (id: string) => getTaskFromMap(tasksObj, id);
    const ancestors: string[] = [];
    let task = getTask(taskId);

    while (task?.parentId) {
        ancestors.push(task.parentId);
        task = getTask(task.parentId);
    }

    return ancestors;
}
