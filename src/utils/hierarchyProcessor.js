/**
 * Hierarchy processor utilities for parent-child task relationships.
 *
 * Handles building task hierarchy, computing depths, collecting descendants,
 * and checking collapse visibility.
 */

/**
 * Build parent-child hierarchy from flat task array.
 * Mutates tasks in place to add _children, _depth, and auto-detect summary type.
 *
 * @param {Array<Object>} tasks - Array of task objects with optional parentId
 * @returns {Map<string, Object>} Map of task ID to task object with hierarchy data
 */
export function buildHierarchy(tasks) {
    const taskMap = new Map();

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
                parent._children.push(task.id);
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
    const queue = roots.map((t) => ({ task: t, depth: 0 }));

    while (queue.length > 0) {
        const { task, depth } = queue.shift();
        task._depth = depth;

        for (const childId of task._children) {
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
 *
 * @param {string} taskId - Parent task ID
 * @param {Object} tasksObj - Task lookup object (or Map with .get())
 * @returns {Set<string>} Set of all descendant task IDs (not including self)
 */
export function collectDescendants(taskId, tasksObj) {
    const descendants = new Set();
    const queue = [taskId];
    // Support both Map and plain object
    const getTask = tasksObj.get ? (id) => tasksObj.get(id) : (id) => tasksObj[id];

    while (queue.length > 0) {
        const currentId = queue.shift();
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
 *
 * @param {string} taskId - Task ID to check
 * @param {Object} tasksObj - Task lookup object (or Map with .get())
 * @param {Set<string>} collapsedSet - Set of collapsed task IDs
 * @returns {boolean} True if task should be hidden
 */
export function isHiddenByCollapsedAncestor(taskId, tasksObj, collapsedSet) {
    const getTask = tasksObj.get ? (id) => tasksObj.get(id) : (id) => tasksObj[id];
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
 *
 * @param {string} taskId - Task ID
 * @param {Object} tasksObj - Task lookup object (or Map with .get())
 * @returns {Array<string>} Array of ancestor IDs from immediate parent to root
 */
export function getAncestors(taskId, tasksObj) {
    const getTask = tasksObj.get ? (id) => tasksObj.get(id) : (id) => tasksObj[id];
    const ancestors = [];
    let task = getTask(taskId);

    while (task?.parentId) {
        ancestors.push(task.parentId);
        task = getTask(task.parentId);
    }

    return ancestors;
}

