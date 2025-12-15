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
 * @param {Map<string, Object>} taskMap - Task lookup map
 * @returns {Set<string>} Set of all descendant task IDs (not including self)
 */
export function collectDescendants(taskId, taskMap) {
    const descendants = new Set();
    const queue = [taskId];

    while (queue.length > 0) {
        const currentId = queue.shift();
        const task = taskMap.get(currentId);

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
 * @param {Map<string, Object>} taskMap - Task lookup map
 * @param {Set<string>} collapsedSet - Set of collapsed task IDs
 * @returns {boolean} True if task should be hidden
 */
export function isHiddenByCollapsedAncestor(taskId, taskMap, collapsedSet) {
    let task = taskMap.get(taskId);

    while (task?.parentId) {
        if (collapsedSet.has(task.parentId)) {
            return true;
        }
        task = taskMap.get(task.parentId);
    }

    return false;
}

/**
 * Get all ancestor task IDs for a given task.
 *
 * @param {string} taskId - Task ID
 * @param {Map<string, Object>} taskMap - Task lookup map
 * @returns {Array<string>} Array of ancestor IDs from immediate parent to root
 */
export function getAncestors(taskId, taskMap) {
    const ancestors = [];
    let task = taskMap.get(taskId);

    while (task?.parentId) {
        ancestors.push(task.parentId);
        task = taskMap.get(task.parentId);
    }

    return ancestors;
}

/**
 * Validate that a dependency is between siblings (same parent).
 * Used to enforce the sibling-only dependency constraint.
 *
 * @param {string} fromId - Predecessor task ID
 * @param {string} toId - Successor task ID
 * @param {Map<string, Object>} taskMap - Task lookup map
 * @returns {boolean} True if dependency is valid (same parent)
 */
export function isValidSiblingDependency(fromId, toId, taskMap) {
    const fromTask = taskMap.get(fromId);
    const toTask = taskMap.get(toId);

    if (!fromTask || !toTask) {
        return false;
    }

    // Both tasks must have the same parentId (or both be root tasks with null)
    return fromTask.parentId === toTask.parentId;
}

/**
 * Filter dependencies to only include valid sibling relationships.
 * Logs warnings for invalid cross-hierarchy dependencies.
 *
 * @param {Array<Object>} relationships - Dependency relationships
 * @param {Map<string, Object>} taskMap - Task lookup map
 * @returns {Array<Object>} Filtered relationships (siblings only)
 */
export function filterSiblingDependencies(relationships, taskMap) {
    const validRelationships = [];

    for (const rel of relationships) {
        if (isValidSiblingDependency(rel.from, rel.to, taskMap)) {
            validRelationships.push(rel);
        } else {
            console.warn(
                `Skipping cross-hierarchy dependency: ${rel.from} → ${rel.to}. Dependencies must be between siblings.`,
            );
        }
    }

    return validRelationships;
}

/**
 * Get all tasks at a specific depth level.
 *
 * @param {Map<string, Object>} taskMap - Task lookup map
 * @param {number} depth - Depth level (0 = roots)
 * @returns {Array<Object>} Tasks at the specified depth
 */
export function getTasksAtDepth(taskMap, depth) {
    const result = [];
    for (const task of taskMap.values()) {
        if (task._depth === depth) {
            result.push(task);
        }
    }
    return result;
}

/**
 * Get the maximum depth in the task hierarchy.
 *
 * @param {Map<string, Object>} taskMap - Task lookup map
 * @returns {number} Maximum depth (0 if no tasks)
 */
export function getMaxDepth(taskMap) {
    let maxDepth = 0;
    for (const task of taskMap.values()) {
        if (task._depth > maxDepth) {
            maxDepth = task._depth;
        }
    }
    return maxDepth;
}
