/**
 * Hierarchy processor utilities for parent-child task relationships.
 */
import { diagnosticWarn } from './diagnostics';

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

function getTaskFromMap<T>(
    tasksObj: TaskMapLike<T>,
    id: string,
): T | undefined {
    if (tasksObj instanceof Map) {
        return tasksObj.get(id);
    }
    return tasksObj[id];
}

/**
 * Build parent-child hierarchy from flat task array.
 * Mutates tasks to remove invalid parent links, assign children and depth,
 * and detect summary tasks.
 * Generic to preserve input task type.
 */
export function buildHierarchy<T extends HierarchyTask>(
    tasks: T[],
): Map<string, T> {
    const taskMap = new Map<string, T>();

    // Initialize all tasks
    for (const task of tasks) {
        task._children = [];
        task._depth = 0;
        taskMap.set(task.id, task);
    }

    // Remove invalid links before building the tree so every parent walk
    // terminates and descendants of an orphan still receive their depths.
    const visited = new Set<string>();
    const clearParent = (task: T): void => {
        diagnosticWarn(
            `Circular or orphaned parent reference detected for task ${task.id}`,
        );
        delete task.parentId;
    };
    for (const task of taskMap.values()) {
        if (!task.parentId || visited.has(task.id)) continue;
        const path = new Set<string>();
        let current: T | undefined = task;
        while (current?.parentId && !visited.has(current.id)) {
            if (path.has(current.id)) {
                clearParent(current);
                break;
            }
            path.add(current.id);
            const parent: T | undefined = taskMap.get(current.parentId);
            if (!parent) clearParent(current);
            current = parent;
        }
        for (const id of path) visited.add(id);
    }

    const queue: T[] = [];
    for (const task of taskMap.values()) {
        const parent = task.parentId ? taskMap.get(task.parentId) : undefined;
        if (parent) {
            parent._children!.push(task.id);
            parent.type ||= 'summary';
        } else {
            queue.push(task);
        }
    }

    for (let i = 0; i < queue.length; i += 1) {
        const task = queue[i]!;
        for (const childId of task._children!) {
            const child = taskMap.get(childId)!;
            child._depth = task._depth! + 1;
            queue.push(child);
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
    tasksObj: TaskMapLike<T>,
): Set<string> {
    const descendants = new Set<string>();
    const queue = [taskId];
    const getTask = (id: string) => getTaskFromMap(tasksObj, id);

    while (queue.length > 0) {
        const currentId = queue.shift();
        if (!currentId) continue;
        const task = getTask(currentId);

        for (const childId of task?._children || []) {
            if (childId !== taskId && !descendants.has(childId)) {
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
    collapsedSet: Set<string>,
): boolean {
    if (collapsedSet.size === 0) return false;

    const getTask = (id: string) => getTaskFromMap(tasksObj, id);
    let task = getTask(taskId);
    const visited = new Set([taskId]);

    while (task?.parentId && !visited.has(task.parentId)) {
        visited.add(task.parentId);
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
    tasksObj: TaskMapLike<T>,
): string[] {
    const getTask = (id: string) => getTaskFromMap(tasksObj, id);
    const ancestors: string[] = [];
    let task = getTask(taskId);
    const visited = new Set([taskId]);

    while (task?.parentId && !visited.has(task.parentId)) {
        visited.add(task.parentId);
        ancestors.push(task.parentId);
        task = getTask(task.parentId);
    }

    return ancestors;
}
