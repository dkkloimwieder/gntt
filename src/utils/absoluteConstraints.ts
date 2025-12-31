/**
 * Absolute Time Constraint Helpers
 *
 * These functions handle min/max constraints on task start and end times,
 * independent of dependency relationships.
 *
 * Constraint priority: locked > absolute time > dependencies > groups
 */

import type { LockState, TaskConstraints } from '../types';

/**
 * Convert a date/time constraint to pixels from gantt start.
 */
function constraintToPixels(
    constraint: string | Date | null | undefined,
    ganttStart: Date,
    pixelsPerHour: number
): number | null {
    if (!constraint) return null;
    const date = typeof constraint === 'string' ? new Date(constraint) : constraint;
    if (isNaN(date.getTime())) return null;
    const hours = (date.getTime() - ganttStart.getTime()) / (1000 * 60 * 60);
    return hours * pixelsPerHour;
}

/**
 * Check if a lock state allows movement.
 */
export function isMovementLocked(locked: LockState | undefined): boolean {
    if (locked === true) return true;
    if (locked === 'start') return true;  // Fixed start means no movement
    if (locked === 'end') return true;    // Fixed end means no movement
    return false;
}

/**
 * Check if a lock state allows left edge resize.
 */
export function isLeftResizeLocked(locked: LockState | undefined): boolean {
    if (locked === true) return true;
    if (locked === 'start') return true;  // Can't change start
    if (locked === 'duration') return true; // Can't change duration
    return false;
}

/**
 * Check if a lock state allows right edge resize.
 */
export function isRightResizeLocked(locked: LockState | undefined): boolean {
    if (locked === true) return true;
    if (locked === 'end') return true;    // Can't change end
    if (locked === 'duration') return true; // Can't change duration
    return false;
}

/**
 * Get minimum X position from absolute constraints.
 */
export function getMinXFromAbsolute(
    constraints: TaskConstraints | null | undefined,
    ganttStart: Date,
    pixelsPerHour: number
): number {
    if (!constraints?.minStart) return 0;
    const minX = constraintToPixels(constraints.minStart, ganttStart, pixelsPerHour);
    return minX ?? 0;
}

/**
 * Get maximum X position from absolute constraints.
 */
export function getMaxXFromAbsolute(
    constraints: TaskConstraints | null | undefined,
    ganttStart: Date,
    pixelsPerHour: number
): number {
    if (!constraints?.maxStart) return Infinity;
    const maxX = constraintToPixels(constraints.maxStart, ganttStart, pixelsPerHour);
    return maxX ?? Infinity;
}

/**
 * Get minimum end position (X + width) from absolute constraints.
 */
export function getMinEndFromAbsolute(
    constraints: TaskConstraints | null | undefined,
    ganttStart: Date,
    pixelsPerHour: number
): number {
    if (!constraints?.minEnd) return 0;
    const minEnd = constraintToPixels(constraints.minEnd, ganttStart, pixelsPerHour);
    return minEnd ?? 0;
}

/**
 * Get maximum end position (X + width) from absolute constraints.
 */
export function getMaxEndFromAbsolute(
    constraints: TaskConstraints | null | undefined,
    ganttStart: Date,
    pixelsPerHour: number
): number {
    if (!constraints?.maxEnd) return Infinity;
    const maxEnd = constraintToPixels(constraints.maxEnd, ganttStart, pixelsPerHour);
    return maxEnd ?? Infinity;
}

/**
 * Get minimum width from duration constraints.
 */
export function getMinWidth(
    constraints: TaskConstraints | null | undefined,
    pixelsPerHour: number,
    defaultMin: number | null = null
): number {
    const min = defaultMin ?? pixelsPerHour; // Default to 1 hour
    if (!constraints?.minDuration) return min;
    return Math.max(min, constraints.minDuration * pixelsPerHour);
}

/**
 * Get maximum width from duration constraints.
 */
export function getMaxWidth(
    constraints: TaskConstraints | null | undefined,
    pixelsPerHour: number
): number {
    if (!constraints?.maxDuration) return Infinity;
    return constraints.maxDuration * pixelsPerHour;
}

interface AbsoluteConstraintResult {
    x: number;
    width: number;
    blocked: boolean;
}

/**
 * Apply all absolute constraints to a proposed position.
 * Returns the constrained position and any adjustments needed.
 */
export function applyAbsoluteConstraints(
    proposedX: number,
    proposedWidth: number,
    constraints: TaskConstraints | null | undefined,
    ganttStart: Date,
    pixelsPerHour: number
): AbsoluteConstraintResult {
    if (!constraints) {
        return { x: proposedX, width: proposedWidth, blocked: false };
    }

    let x = proposedX;
    let width = proposedWidth;
    const blocked = false;

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
        return { x, width: proposedWidth, blocked: true };
    }

    return { x, width, blocked };
}

/**
 * Check if moving to a position would violate absolute constraints.
 * Used to determine if a predecessor can push/pull a successor.
 */
export function wouldViolateAbsolute(
    proposedX: number,
    width: number,
    constraints: TaskConstraints | null | undefined,
    ganttStart: Date,
    pixelsPerHour: number
): boolean {
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
 */
export function getMaxPushX(
    constraints: TaskConstraints | null | undefined,
    width: number,
    ganttStart: Date,
    pixelsPerHour: number
): number {
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
 */
export function getMinPullX(
    constraints: TaskConstraints | null | undefined,
    ganttStart: Date,
    pixelsPerHour: number
): number {
    if (!constraints) return 0;

    // Can't pull before minStart
    return getMinXFromAbsolute(constraints, ganttStart, pixelsPerHour);
}
