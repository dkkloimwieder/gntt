/**
 * Absolute Time Constraint Helpers
 *
 * These functions handle min/max constraints on task start and end times,
 * independent of dependency relationships.
 *
 * Constraint priority: locked > absolute time > dependencies > groups
 */

/**
 * Convert a date/time constraint to pixels from gantt start.
 * @param {string|Date|null} constraint - The constraint value
 * @param {Date} ganttStart - The gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number|null} - Pixel position or null if no constraint
 */
function constraintToPixels(constraint, ganttStart, pixelsPerHour) {
    if (!constraint) return null;
    const date = typeof constraint === 'string' ? new Date(constraint) : constraint;
    if (isNaN(date.getTime())) return null;
    const hours = (date.getTime() - ganttStart.getTime()) / (1000 * 60 * 60);
    return hours * pixelsPerHour;
}

/**
 * Check if a lock state allows movement.
 * @param {boolean|string} locked - Lock state value
 * @returns {boolean} - True if movement is blocked
 */
export function isMovementLocked(locked) {
    if (locked === true) return true;
    if (locked === 'start') return true;  // Fixed start means no movement
    if (locked === 'end') return true;    // Fixed end means no movement
    return false;
}

/**
 * Check if a lock state allows left edge resize.
 * @param {boolean|string} locked - Lock state value
 * @returns {boolean} - True if left resize is blocked
 */
export function isLeftResizeLocked(locked) {
    if (locked === true) return true;
    if (locked === 'start') return true;  // Can't change start
    if (locked === 'duration') return true; // Can't change duration
    return false;
}

/**
 * Check if a lock state allows right edge resize.
 * @param {boolean|string} locked - Lock state value
 * @returns {boolean} - True if right resize is blocked
 */
export function isRightResizeLocked(locked) {
    if (locked === true) return true;
    if (locked === 'end') return true;    // Can't change end
    if (locked === 'duration') return true; // Can't change duration
    return false;
}

/**
 * Get minimum X position from absolute constraints.
 * @param {Object} constraints - Task constraints object
 * @param {Date} ganttStart - Gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number} - Minimum allowed X (0 if no constraint)
 */
export function getMinXFromAbsolute(constraints, ganttStart, pixelsPerHour) {
    if (!constraints?.minStart) return 0;
    const minX = constraintToPixels(constraints.minStart, ganttStart, pixelsPerHour);
    return minX ?? 0;
}

/**
 * Get maximum X position from absolute constraints.
 * @param {Object} constraints - Task constraints object
 * @param {Date} ganttStart - Gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number} - Maximum allowed X (Infinity if no constraint)
 */
export function getMaxXFromAbsolute(constraints, ganttStart, pixelsPerHour) {
    if (!constraints?.maxStart) return Infinity;
    const maxX = constraintToPixels(constraints.maxStart, ganttStart, pixelsPerHour);
    return maxX ?? Infinity;
}

/**
 * Get minimum end position (X + width) from absolute constraints.
 * @param {Object} constraints - Task constraints object
 * @param {Date} ganttStart - Gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number} - Minimum allowed end position (0 if no constraint)
 */
export function getMinEndFromAbsolute(constraints, ganttStart, pixelsPerHour) {
    if (!constraints?.minEnd) return 0;
    const minEnd = constraintToPixels(constraints.minEnd, ganttStart, pixelsPerHour);
    return minEnd ?? 0;
}

/**
 * Get maximum end position (X + width) from absolute constraints.
 * @param {Object} constraints - Task constraints object
 * @param {Date} ganttStart - Gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number} - Maximum allowed end position (Infinity if no constraint)
 */
export function getMaxEndFromAbsolute(constraints, ganttStart, pixelsPerHour) {
    if (!constraints?.maxEnd) return Infinity;
    const maxEnd = constraintToPixels(constraints.maxEnd, ganttStart, pixelsPerHour);
    return maxEnd ?? Infinity;
}

/**
 * Get minimum width from duration constraints.
 * @param {Object} constraints - Task constraints object
 * @param {number} pixelsPerHour - Conversion factor
 * @param {number} defaultMin - Default minimum width (typically 1 hour)
 * @returns {number} - Minimum allowed width
 */
export function getMinWidth(constraints, pixelsPerHour, defaultMin = null) {
    const min = defaultMin ?? pixelsPerHour; // Default to 1 hour
    if (!constraints?.minDuration) return min;
    return Math.max(min, constraints.minDuration * pixelsPerHour);
}

/**
 * Get maximum width from duration constraints.
 * @param {Object} constraints - Task constraints object
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number} - Maximum allowed width (Infinity if no constraint)
 */
export function getMaxWidth(constraints, pixelsPerHour) {
    if (!constraints?.maxDuration) return Infinity;
    return constraints.maxDuration * pixelsPerHour;
}

/**
 * Apply all absolute constraints to a proposed position.
 * Returns the constrained position and any adjustments needed.
 *
 * @param {number} proposedX - Proposed X position
 * @param {number} proposedWidth - Proposed width
 * @param {Object} constraints - Task constraints object
 * @param {Date} ganttStart - Gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {{ x: number, width: number, blocked: boolean }} - Constrained values
 */
export function applyAbsoluteConstraints(proposedX, proposedWidth, constraints, ganttStart, pixelsPerHour) {
    if (!constraints) {
        return { x: proposedX, width: proposedWidth, blocked: false };
    }

    let x = proposedX;
    let width = proposedWidth;
    let blocked = false;

    // Check locked state
    if (constraints.locked === true) {
        return { x: proposedX, width: proposedWidth, blocked: true };
    }

    // Apply minStart
    const minX = getMinXFromAbsolute(constraints, ganttStart, pixelsPerHour);
    if (x < minX) {
        x = minX;
    }

    // Apply maxStart
    const maxX = getMaxXFromAbsolute(constraints, ganttStart, pixelsPerHour);
    if (x > maxX) {
        x = maxX;
    }

    // Apply minEnd (adjust width if needed)
    const minEnd = getMinEndFromAbsolute(constraints, ganttStart, pixelsPerHour);
    if (x + width < minEnd) {
        width = minEnd - x;
    }

    // Apply maxEnd (adjust width if needed)
    const maxEnd = getMaxEndFromAbsolute(constraints, ganttStart, pixelsPerHour);
    if (x + width > maxEnd) {
        width = maxEnd - x;
    }

    // Apply duration constraints
    const minWidth = getMinWidth(constraints, pixelsPerHour);
    const maxWidth = getMaxWidth(constraints, pixelsPerHour);
    width = Math.max(minWidth, Math.min(width, maxWidth));

    // Check if fixed duration
    if (constraints.fixedDuration && proposedWidth !== width) {
        width = proposedWidth; // Restore original width
        blocked = true;
    }

    return { x, width, blocked };
}

/**
 * Check if moving to a position would violate absolute constraints.
 * Used to determine if a predecessor can push/pull a successor.
 *
 * @param {number} proposedX - Proposed X position
 * @param {number} width - Current width
 * @param {Object} constraints - Task constraints object
 * @param {Date} ganttStart - Gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {boolean} - True if position would violate constraints
 */
export function wouldViolateAbsolute(proposedX, width, constraints, ganttStart, pixelsPerHour) {
    if (!constraints) return false;

    const minX = getMinXFromAbsolute(constraints, ganttStart, pixelsPerHour);
    if (proposedX < minX) return true;

    const maxX = getMaxXFromAbsolute(constraints, ganttStart, pixelsPerHour);
    if (proposedX > maxX) return true;

    const maxEnd = getMaxEndFromAbsolute(constraints, ganttStart, pixelsPerHour);
    if (proposedX + width > maxEnd) return true;

    return false;
}

/**
 * Get the maximum X a task can be pushed to (based on its absolute constraints).
 * Used to limit how far a predecessor can extend/move.
 *
 * @param {Object} constraints - Successor's constraints
 * @param {number} width - Successor's width
 * @param {Date} ganttStart - Gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number} - Maximum X the successor can be at
 */
export function getMaxPushX(constraints, width, ganttStart, pixelsPerHour) {
    if (!constraints) return Infinity;

    let maxX = Infinity;

    // Can't push past maxStart
    const maxStart = getMaxXFromAbsolute(constraints, ganttStart, pixelsPerHour);
    maxX = Math.min(maxX, maxStart);

    // Can't push so far that end exceeds maxEnd
    const maxEnd = getMaxEndFromAbsolute(constraints, ganttStart, pixelsPerHour);
    maxX = Math.min(maxX, maxEnd - width);

    return maxX;
}

/**
 * Get the minimum X a task can be pulled to (based on its absolute constraints).
 * Used to limit how far a predecessor can shrink/move backward.
 *
 * @param {Object} constraints - Successor's constraints
 * @param {Date} ganttStart - Gantt chart start date
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number} - Minimum X the successor can be at
 */
export function getMinPullX(constraints, ganttStart, pixelsPerHour) {
    if (!constraints) return 0;

    // Can't pull before minStart
    return getMinXFromAbsolute(constraints, ganttStart, pixelsPerHour);
}
