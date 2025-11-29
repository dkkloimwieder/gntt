/**
 * Constraint Resolution Utilities
 *
 * Extracted from ConstraintDemo.jsx for use in Bar components.
 *
 * Constraints are on RELATIONSHIPS, not tasks:
 * - minDistance: minimum gap (push if closer)
 * - maxDistance: maximum gap (pull if further)
 * - fixedOffset: exact distance maintained (tasks move together)
 *
 * Tasks can have:
 * - locked: Task cannot move (blocks push/pull from relationships)
 */

// Default minimum gap between tasks (pixels)
export const DEFAULT_MIN_DISTANCE = 10;

/**
 * Find all tasks connected by fixed-offset relationships.
 * Traverses bidirectionally through fixed-offset links.
 *
 * @param {string} taskId - Starting task ID
 * @param {Array} relationships - Array of relationship objects
 * @param {Set} visited - Already visited task IDs (for recursion)
 * @returns {Array} Array of { taskId, relationship } objects
 */
export function findFixedOffsetLinks(taskId, relationships, visited = new Set()) {
    if (visited.has(taskId)) return [];
    visited.add(taskId);

    const linked = [];

    relationships.forEach(rel => {
        if (!rel.fixedOffset) return;

        if (rel.from === taskId && !visited.has(rel.to)) {
            linked.push({ taskId: rel.to, relationship: rel });
            linked.push(...findFixedOffsetLinks(rel.to, relationships, visited));
        }
        if (rel.to === taskId && !visited.has(rel.from)) {
            linked.push({ taskId: rel.from, relationship: rel });
            linked.push(...findFixedOffsetLinks(rel.from, relationships, visited));
        }
    });

    return linked;
}

/**
 * Calculate distance between two tasks (edge to edge).
 * Distance = successor left edge - predecessor right edge
 *
 * @param {Object} predTask - Predecessor task with $bar.x and $bar.width
 * @param {Object} succTask - Successor task with $bar.x
 * @param {number|null} predNewX - Optional new X position for predecessor
 * @returns {number} Edge-to-edge distance in pixels
 */
export function calculateDistance(predTask, succTask, predNewX = null) {
    const predRightEdge = (predNewX ?? predTask.$bar.x) + predTask.$bar.width;
    const succLeftEdge = succTask.$bar.x;
    return succLeftEdge - predRightEdge;
}

/**
 * Resolve task movement with all constraints applied.
 *
 * @param {string} taskId - ID of the task being moved
 * @param {number} newX - Proposed new X position
 * @param {number} newY - Proposed new Y position
 * @param {Object} taskStore - Task store with getTask, updateBarPosition methods
 * @param {Array} relationships - Array of relationship objects with constraint properties
 * @param {number} depth - Recursion depth (max 10)
 * @returns {Object|null} Result object:
 *   - { type: 'single', taskId, x, y } for single task update
 *   - { type: 'batch', updates: [...] } for fixed-offset batch update
 *   - null if movement is blocked
 */
export function resolveMovement(taskId, newX, newY, taskStore, relationships, depth = 0) {
    // Prevent infinite recursion
    if (depth > 10) return null;

    const task = taskStore.getTask(taskId);
    if (!task) return null;

    // Locked tasks cannot move
    if (task.constraints?.locked) {
        return null;
    }

    // Check fixed-offset relationships first (they override everything)
    const fixedLinks = findFixedOffsetLinks(taskId, relationships);
    if (fixedLinks.length > 0) {
        // Check if any linked task is locked
        const hasLockedLink = fixedLinks.some(link => {
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

        fixedLinks.forEach(link => {
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

    // Process each relationship involving this task
    for (const rel of relationships) {
        if (rel.fixedOffset) continue; // Already handled above

        const isPredecessor = rel.from === taskId;
        const isSuccessor = rel.to === taskId;
        if (!isPredecessor && !isSuccessor) continue;

        const otherTaskId = isPredecessor ? rel.to : rel.from;
        const otherTask = taskStore.getTask(otherTaskId);
        if (!otherTask) continue;

        const minDist = rel.minDistance ?? DEFAULT_MIN_DISTANCE;
        const maxDist = rel.maxDistance;

        if (isPredecessor) {
            // This task is the PREDECESSOR - check distance to successor
            const distance = calculateDistance(task, otherTask, newX);

            // Check minDistance (push successor if too close)
            if (distance < minDist) {
                if (otherTask.constraints?.locked) {
                    // Can't push locked task - constrain this task
                    newX = otherTask.$bar.x - minDist - task.$bar.width;
                } else {
                    // Push successor forward
                    const pushAmount = minDist - distance;
                    const result = resolveMovement(
                        otherTaskId,
                        otherTask.$bar.x + pushAmount,
                        otherTask.$bar.y,
                        taskStore,
                        relationships,
                        depth + 1
                    );
                    if (result?.type === 'single') {
                        taskStore.updateBarPosition(otherTaskId, { x: result.x, y: result.y });
                    }
                }
            }

            // Check maxDistance (tether - constrain this task if too far)
            if (maxDist !== undefined && distance > maxDist) {
                if (otherTask.constraints?.locked) {
                    // Successor is locked - constrain predecessor
                    newX = otherTask.$bar.x - maxDist - task.$bar.width;
                } else {
                    // Pull successor back
                    const pullAmount = distance - maxDist;
                    const result = resolveMovement(
                        otherTaskId,
                        otherTask.$bar.x - pullAmount,
                        otherTask.$bar.y,
                        taskStore,
                        relationships,
                        depth + 1
                    );
                    if (result?.type === 'single') {
                        taskStore.updateBarPosition(otherTaskId, { x: result.x, y: result.y });
                    }
                }
            }
        } else {
            // This task is the SUCCESSOR - check distance from predecessor
            const predTask = otherTask;

            // HARD LIMIT: Successor cannot start before predecessor starts
            if (newX < predTask.$bar.x) {
                newX = predTask.$bar.x;
            }

            const newDistance = newX - (predTask.$bar.x + predTask.$bar.width);

            // Check minDistance (can't get too close to predecessor)
            // Successor cannot move into predecessor's space - simply constrain it
            if (newDistance < minDist) {
                newX = predTask.$bar.x + predTask.$bar.width + minDist;
            }

            // Recalculate distance after minDistance constraint
            const constrainedDistance = newX - (predTask.$bar.x + predTask.$bar.width);

            // Check maxDistance (tether - successor cannot drift too far from predecessor)
            if (maxDist !== undefined && constrainedDistance > maxDist) {
                newX = predTask.$bar.x + predTask.$bar.width + maxDist;
            }
        }
    }

    return { type: 'single', taskId, x: newX, y: newY };
}
