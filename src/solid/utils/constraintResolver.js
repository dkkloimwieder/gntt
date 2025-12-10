/**
 * Constraint Resolution Utilities
 *
 * Implements standard project management dependency types:
 * - FS (Finish-to-Start): Successor starts after predecessor finishes
 * - SS (Start-to-Start): Successor starts after predecessor starts
 * - FF (Finish-to-Finish): Successor finishes after predecessor finishes
 * - SF (Start-to-Finish): Successor finishes after predecessor starts
 *
 * Relationship Schema:
 * {
 *   from: string,      // Predecessor task ID
 *   to: string,        // Successor task ID
 *   type: 'FS'|'SS'|'FF'|'SF',  // Dependency type (default: 'FS')
 *   lag: number,       // Time offset (positive = delay, negative = lead)
 *   elastic: boolean   // If true, lag is minimum; if false, lag is fixed
 * }
 *
 * Tasks can have:
 * - locked: Task cannot move (blocks push/pull from relationships)
 */

// Dependency type constants
export const DEPENDENCY_TYPES = {
    FS: 'FS', // Finish-to-Start
    SS: 'SS', // Start-to-Start
    FF: 'FF', // Finish-to-Finish
    SF: 'SF', // Start-to-Finish
};

// Default lag (in pixels for now, will be time units with conversion)
export const DEFAULT_LAG = 0;

/**
 * Find all tasks connected by fixed (non-elastic) relationships.
 * Traverses bidirectionally through fixed links.
 *
 * @param {string} taskId - Starting task ID
 * @param {Array} relationships - Array of relationship objects
 * @param {Set} visited - Already visited task IDs (for recursion)
 * @returns {Array} Array of { taskId, relationship } objects
 */
export function findFixedLinks(taskId, relationships, visited = new Set()) {
    if (visited.has(taskId)) return [];
    visited.add(taskId);

    const linked = [];

    relationships.forEach((rel) => {
        // Only follow non-elastic (fixed) relationships
        if (rel.elastic !== false) return;

        if (rel.from === taskId && !visited.has(rel.to)) {
            linked.push({ taskId: rel.to, relationship: rel });
            linked.push(...findFixedLinks(rel.to, relationships, visited));
        }
        if (rel.to === taskId && !visited.has(rel.from)) {
            linked.push({ taskId: rel.from, relationship: rel });
            linked.push(...findFixedLinks(rel.from, relationships, visited));
        }
    });

    return linked;
}

/**
 * Calculate the minimum allowed successor X position based on dependency type.
 *
 * @param {string} type - Dependency type (FS, SS, FF, SF)
 * @param {Object} predTask - Predecessor task with $bar.x, $bar.width
 * @param {Object} succTask - Successor task with $bar.x, $bar.width
 * @param {number} lagPx - Lag in pixels
 * @param {number|null} predNewX - Optional new X position for predecessor
 * @returns {number} Minimum allowed X position for successor
 */
export function calculateMinSuccessorX(
    type,
    predTask,
    succTask,
    lagPx,
    predNewX = null,
) {
    const predX = predNewX ?? predTask.$bar.x;
    const predWidth = predTask.$bar.width;
    const succWidth = succTask.$bar.width;

    switch (type) {
        case DEPENDENCY_TYPES.FS:
            // succ.start >= pred.end + lag
            // succ.x >= pred.x + pred.width + lag
            return predX + predWidth + lagPx;

        case DEPENDENCY_TYPES.SS:
            // succ.start >= pred.start + lag
            // succ.x >= pred.x + lag
            return predX + lagPx;

        case DEPENDENCY_TYPES.FF:
            // succ.end >= pred.end + lag
            // succ.x + succ.width >= pred.x + pred.width + lag
            // succ.x >= pred.x + pred.width - succ.width + lag
            return predX + predWidth - succWidth + lagPx;

        case DEPENDENCY_TYPES.SF:
            // succ.end >= pred.start + lag
            // succ.x + succ.width >= pred.x + lag
            // succ.x >= pred.x - succ.width + lag
            return predX - succWidth + lagPx;

        default:
            // Default to FS behavior
            return predX + predWidth + lagPx;
    }
}

/**
 * Calculate the exact successor X position for fixed (non-elastic) relationships.
 *
 * @param {string} type - Dependency type (FS, SS, FF, SF)
 * @param {Object} predTask - Predecessor task with $bar.x, $bar.width
 * @param {Object} succTask - Successor task with $bar.x, $bar.width
 * @param {number} lagPx - Lag in pixels
 * @param {number|null} predNewX - Optional new X position for predecessor
 * @returns {number} Exact X position for successor
 */
export function calculateFixedSuccessorX(
    type,
    predTask,
    succTask,
    lagPx,
    predNewX = null,
) {
    // For fixed relationships, the successor position IS the minimum position
    // (exact distance maintained)
    return calculateMinSuccessorX(type, predTask, succTask, lagPx, predNewX);
}

/**
 * Calculate the required push amount for successor when predecessor moves.
 *
 * @param {string} type - Dependency type
 * @param {Object} predTask - Predecessor task
 * @param {Object} succTask - Successor task
 * @param {number} lagPx - Lag in pixels
 * @param {number} predNewX - New X position for predecessor
 * @returns {number} Amount to push successor (0 if no push needed)
 */
export function calculatePushAmount(type, predTask, succTask, lagPx, predNewX) {
    const minSuccX = calculateMinSuccessorX(
        type,
        predTask,
        succTask,
        lagPx,
        predNewX,
    );
    const currentSuccX = succTask.$bar.x;

    // Push amount is how much we need to move successor to satisfy constraint
    if (currentSuccX < minSuccX) {
        return minSuccX - currentSuccX;
    }
    return 0;
}

/**
 * Resolve task movement with all constraints applied.
 *
 * @param {string} taskId - ID of the task being moved
 * @param {number} newX - Proposed new X position
 * @param {number} newY - Proposed new Y position
 * @param {Object} taskStore - Task store with getTask, updateBarPosition methods
 * @param {Array} relationships - Array of relationship objects
 * @param {Object} options - Optional configuration
 * @param {number} options.pixelsPerTimeUnit - Conversion factor for lag (default: 1)
 * @param {number} depth - Recursion depth (max 10)
 * @returns {Object|null} Result object:
 *   - { type: 'single', taskId, x, y } for single task update
 *   - { type: 'batch', updates: [...] } for fixed batch update
 *   - null if movement is blocked
 */
export function resolveMovement(
    taskId,
    newX,
    newY,
    taskStore,
    relationships,
    options = {},
    depth = 0,
) {
    // Prevent infinite recursion
    if (depth > 10) return null;

    const { pixelsPerTimeUnit = 1 } = options;

    const task = taskStore.getTask(taskId);
    if (!task) return null;

    // Locked tasks cannot move
    if (task.constraints?.locked) {
        return null;
    }

    // Check fixed (non-elastic) relationships first (they override everything)
    const fixedLinks = findFixedLinks(taskId, relationships);
    if (fixedLinks.length > 0) {
        // Check if any linked task is locked
        const hasLockedLink = fixedLinks.some((link) => {
            const linkedTask = taskStore.getTask(link.taskId);
            return linkedTask?.constraints?.locked;
        });

        if (hasLockedLink) {
            return null; // Cannot move - linked to locked task
        }

        // Calculate delta and move all linked tasks
        const deltaX = newX - task.$bar.x;
        const deltaY = newY - task.$bar.y;

        const updates = [{ taskId, x: newX, y: newY }];

        fixedLinks.forEach((link) => {
            const linkedTask = taskStore.getTask(link.taskId);
            if (linkedTask) {
                updates.push({
                    taskId: link.taskId,
                    x: linkedTask.$bar.x + deltaX,
                    y: linkedTask.$bar.y + deltaY,
                });
            }
        });

        return { type: 'batch', updates };
    }

    // Process each elastic relationship involving this task
    for (const rel of relationships) {
        // Skip non-elastic (fixed) relationships - already handled above
        if (rel.elastic === false) continue;

        const isPredecessor = rel.from === taskId;
        const isSuccessor = rel.to === taskId;
        if (!isPredecessor && !isSuccessor) continue;

        const otherTaskId = isPredecessor ? rel.to : rel.from;
        const otherTask = taskStore.getTask(otherTaskId);
        if (!otherTask) continue;

        const type = rel.type || DEPENDENCY_TYPES.FS;
        const lag = rel.lag ?? DEFAULT_LAG;
        const lagPx = lag * pixelsPerTimeUnit;

        if (isPredecessor) {
            // This task is the PREDECESSOR - check if we need to push successor
            const pushAmount = calculatePushAmount(
                type,
                task,
                otherTask,
                lagPx,
                newX,
            );

            if (pushAmount > 0) {
                if (otherTask.constraints?.locked) {
                    // Can't push locked task - constrain this task instead
                    // Work backwards: what predecessor X keeps successor where it is?
                    const maxPredX = calculateMaxPredecessorX(
                        type,
                        task,
                        otherTask,
                        lagPx,
                        otherTask.$bar.x,
                    );
                    newX = Math.min(newX, maxPredX);
                } else {
                    // Push successor forward
                    const newSuccX = otherTask.$bar.x + pushAmount;
                    const result = resolveMovement(
                        otherTaskId,
                        newSuccX,
                        otherTask.$bar.y,
                        taskStore,
                        relationships,
                        options,
                        depth + 1,
                    );
                    if (result?.type === 'single') {
                        taskStore.updateBarPosition(otherTaskId, {
                            x: result.x,
                            y: result.y,
                        });
                    } else if (result?.type === 'batch') {
                        result.updates.forEach((update) => {
                            taskStore.updateBarPosition(update.taskId, {
                                x: update.x,
                                y: update.y,
                            });
                        });
                    }
                }
            }
        } else {
            // This task is the SUCCESSOR - constrain position based on predecessor
            const predTask = otherTask;
            const minSuccX = calculateMinSuccessorX(
                type,
                predTask,
                task,
                lagPx,
            );

            // Successor cannot violate the constraint
            if (newX < minSuccX) {
                newX = minSuccX;
            }
        }
    }

    return { type: 'single', taskId, x: newX, y: newY };
}

/**
 * Calculate the maximum allowed predecessor X position given successor's position.
 * Used when successor is locked and predecessor is moving.
 *
 * @param {string} type - Dependency type
 * @param {Object} predTask - Predecessor task
 * @param {Object} succTask - Successor task
 * @param {number} lagPx - Lag in pixels
 * @param {number} succX - Successor's X position
 * @returns {number} Maximum allowed X position for predecessor
 */
export function calculateMaxPredecessorX(
    type,
    predTask,
    succTask,
    lagPx,
    succX,
) {
    const predWidth = predTask.$bar.width;
    const succWidth = succTask.$bar.width;

    switch (type) {
        case DEPENDENCY_TYPES.FS:
            // succ.x >= pred.x + pred.width + lag
            // pred.x <= succ.x - pred.width - lag
            return succX - predWidth - lagPx;

        case DEPENDENCY_TYPES.SS:
            // succ.x >= pred.x + lag
            // pred.x <= succ.x - lag
            return succX - lagPx;

        case DEPENDENCY_TYPES.FF:
            // succ.x >= pred.x + pred.width - succ.width + lag
            // pred.x <= succ.x - pred.width + succ.width - lag
            return succX - predWidth + succWidth - lagPx;

        case DEPENDENCY_TYPES.SF:
            // succ.x >= pred.x - succ.width + lag
            // pred.x <= succ.x + succ.width - lag
            return succX + succWidth - lagPx;

        default:
            return succX - predWidth - lagPx;
    }
}

/**
 * Resolve constraints after a task's duration (width) changes.
 * Should be called when a task is resized.
 *
 * @param {string} taskId - ID of the task that was resized
 * @param {Object} taskStore - Task store
 * @param {Array} relationships - Array of relationship objects
 * @param {Object} options - Optional configuration
 */
export function resolveAfterResize(
    taskId,
    taskStore,
    relationships,
    options = {},
) {
    const { pixelsPerTimeUnit = 1 } = options;
    const task = taskStore.getTask(taskId);
    if (!task) return;

    // Find all relationships where this task is the predecessor
    // (width change affects where successor must be)
    for (const rel of relationships) {
        if (rel.from !== taskId) continue;

        const succTask = taskStore.getTask(rel.to);
        if (!succTask || succTask.constraints?.locked) continue;

        const type = rel.type || DEPENDENCY_TYPES.FS;
        const lag = rel.lag ?? DEFAULT_LAG;
        const lagPx = lag * pixelsPerTimeUnit;
        const elastic = rel.elastic !== false;

        if (elastic) {
            // For elastic relationships, push if needed
            const minSuccX = calculateMinSuccessorX(
                type,
                task,
                succTask,
                lagPx,
            );
            if (succTask.$bar.x < minSuccX) {
                const result = resolveMovement(
                    rel.to,
                    minSuccX,
                    succTask.$bar.y,
                    taskStore,
                    relationships,
                    options,
                    0,
                );
                if (result?.type === 'single') {
                    taskStore.updateBarPosition(rel.to, {
                        x: result.x,
                        y: result.y,
                    });
                } else if (result?.type === 'batch') {
                    result.updates.forEach((update) => {
                        taskStore.updateBarPosition(update.taskId, {
                            x: update.x,
                            y: update.y,
                        });
                    });
                }
            }
        } else {
            // For fixed relationships, move successor to exact position
            const fixedSuccX = calculateFixedSuccessorX(
                type,
                task,
                succTask,
                lagPx,
            );
            taskStore.updateBarPosition(rel.to, { x: fixedSuccX });
        }
    }

    // For FF and SF types, we also need to check relationships where this task
    // is the successor (since succ.end is part of the constraint)
    for (const rel of relationships) {
        if (rel.to !== taskId) continue;
        if (
            rel.type !== DEPENDENCY_TYPES.FF &&
            rel.type !== DEPENDENCY_TYPES.SF
        )
            continue;

        const predTask = taskStore.getTask(rel.from);
        if (!predTask) continue;

        const type = rel.type;
        const lag = rel.lag ?? DEFAULT_LAG;
        const lagPx = lag * pixelsPerTimeUnit;

        // Recalculate our own position based on new width
        const minSuccX = calculateMinSuccessorX(type, predTask, task, lagPx);
        if (task.$bar.x < minSuccX) {
            taskStore.updateBarPosition(taskId, { x: minSuccX });
        }
    }
}
