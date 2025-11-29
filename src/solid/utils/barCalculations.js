import date_utils from './date_utils.js';

/**
 * Pure functions for bar geometry calculations.
 * No side effects - just compute values from inputs.
 */

/**
 * Compute bar X position from task start date.
 * @param {Date} taskStart - Task start date
 * @param {Date} ganttStart - Gantt chart start date
 * @param {string} unit - Time unit ('day', 'hour', etc.)
 * @param {number} step - Number of units per column
 * @param {number} columnWidth - Width of each column in pixels
 * @returns {number} X position in pixels
 */
export function computeX(taskStart, ganttStart, unit, step, columnWidth) {
    const diff = date_utils.diff(taskStart, ganttStart, unit) / step;
    return diff * columnWidth;
}

/**
 * Compute bar Y position from task index.
 * @param {number} taskIndex - Task index (row number)
 * @param {number} headerHeight - Total header height
 * @param {number} barHeight - Height of each bar
 * @param {number} padding - Vertical padding between bars
 * @returns {number} Y position in pixels
 */
export function computeY(taskIndex, headerHeight, barHeight, padding) {
    return headerHeight + padding / 2 + taskIndex * (barHeight + padding);
}

/**
 * Compute bar width from task duration.
 * @param {Date} taskStart - Task start date
 * @param {Date} taskEnd - Task end date
 * @param {string} unit - Time unit ('day', 'hour', etc.)
 * @param {number} step - Number of units per column
 * @param {number} columnWidth - Width of each column in pixels
 * @returns {number} Width in pixels
 */
export function computeWidth(taskStart, taskEnd, unit, step, columnWidth) {
    const diff = date_utils.diff(taskEnd, taskStart, unit) / step;
    return diff * columnWidth;
}

/**
 * Compute actual duration (excluding ignored dates).
 * @param {Date} taskStart - Task start date
 * @param {Date} taskEnd - Task end date
 * @param {Date[]} ignoredDates - Array of dates to ignore
 * @param {Function|null} ignoredFunction - Optional function to test if date should be ignored
 * @returns {{ totalDays: number, actualDays: number, ignoredDays: number }}
 */
export function computeDuration(taskStart, taskEnd, ignoredDates = [], ignoredFunction = null) {
    let actualDays = 0;
    let totalDays = 0;

    for (let d = new Date(taskStart); d < taskEnd; d.setDate(d.getDate() + 1)) {
        totalDays++;

        const isIgnored =
            ignoredDates.some((k) => k.getTime() === d.getTime()) ||
            (ignoredFunction && ignoredFunction(d));

        if (!isIgnored) {
            actualDays++;
        }
    }

    return {
        totalDays,
        actualDays,
        ignoredDays: totalDays - actualDays,
    };
}

/**
 * Convert duration to units.
 * @param {number} days - Duration in days
 * @param {string} unit - Target unit
 * @param {number} step - Step size
 * @returns {number} Duration in target units/step
 */
export function daysToUnits(days, unit, step) {
    const durationStr = days + 'd';
    return date_utils.convert_scales(durationStr, unit) / step;
}

/**
 * Compute progress bar width accounting for ignored positions.
 * @param {number} barX - Bar X position
 * @param {number} barWidth - Bar width
 * @param {number} progress - Progress percentage (0-100)
 * @param {number[]} ignoredPositions - Array of X positions that are ignored
 * @param {number} columnWidth - Column width
 * @returns {number} Progress bar width in pixels
 */
export function computeProgressWidth(barX, barWidth, progress, ignoredPositions = [], columnWidth = 45) {
    const barEnd = barX + barWidth;

    // Count ignored columns within bar
    const totalIgnoredInBar = ignoredPositions.reduce((acc, pos) => {
        return acc + (pos >= barX && pos < barEnd ? 1 : 0);
    }, 0);

    const totalIgnoredArea = totalIgnoredInBar * columnWidth;

    // Base progress width (excluding ignored area)
    let progressWidth = ((barWidth - totalIgnoredArea) * progress) / 100;

    // Count ignored columns within progress area
    const progressEnd = barX + progressWidth;
    const ignoredInProgress = ignoredPositions.reduce((acc, pos) => {
        return acc + (pos >= barX && pos < progressEnd ? 1 : 0);
    }, 0);

    // Add back ignored area within progress
    progressWidth += ignoredInProgress * columnWidth;

    // Skip over any ignored regions at the progress end
    let currentPos = barX + progressWidth;
    while (ignoredPositions.some((pos) => Math.abs(pos - currentPos) < columnWidth / 2 && currentPos < barEnd)) {
        progressWidth += columnWidth;
        currentPos = barX + progressWidth;
    }

    // Clamp to bar width
    return Math.min(progressWidth, barWidth);
}

/**
 * Compute expected progress based on current date.
 * @param {Date} taskStart - Task start date
 * @param {Date} taskEnd - Task end date
 * @param {string} unit - Time unit
 * @param {number} step - Step size
 * @returns {number} Expected progress percentage (0-100)
 */
export function computeExpectedProgress(taskStart, taskEnd, unit, step) {
    const today = date_utils.today();
    const totalDuration = date_utils.diff(taskEnd, taskStart, 'hour') / step;
    const elapsed = date_utils.diff(today, taskStart, 'hour') / step;

    // Clamp to 0-100%
    const progress = Math.min(elapsed, totalDuration);
    return totalDuration > 0 ? (progress * 100) / totalDuration : 0;
}

/**
 * Check if a position falls within an ignored region.
 * @param {number} x - X position to check
 * @param {number[]} ignoredPositions - Array of ignored X positions
 * @param {number} columnWidth - Column width
 * @returns {boolean}
 */
export function isIgnoredPosition(x, ignoredPositions, columnWidth) {
    return ignoredPositions.some((pos) => x >= pos && x < pos + columnWidth);
}

/**
 * Get the next valid (non-ignored) position.
 * @param {number} x - Current X position
 * @param {number[]} ignoredPositions - Array of ignored X positions
 * @param {number} columnWidth - Column width
 * @param {number} direction - 1 for right, -1 for left
 * @returns {number} Next valid position
 */
export function getNextValidPosition(x, ignoredPositions, columnWidth, direction = 1) {
    let current = x;
    const maxIterations = 100; // Safety limit

    for (let i = 0; i < maxIterations; i++) {
        if (!isIgnoredPosition(current, ignoredPositions, columnWidth)) {
            return current;
        }
        current += direction * columnWidth;
    }

    return current;
}

/**
 * Snap position to grid.
 * @param {number} x - X position
 * @param {number} columnWidth - Column width
 * @param {number[]} ignoredPositions - Positions to skip
 * @returns {number} Snapped position
 */
export function snapToGrid(x, columnWidth, ignoredPositions = []) {
    // Snap to nearest column
    let snapped = Math.round(x / columnWidth) * columnWidth;

    // If snapped to ignored position, move to next valid
    while (isIgnoredPosition(snapped, ignoredPositions, columnWidth)) {
        snapped += columnWidth;
    }

    return snapped;
}

/**
 * Compute label position (inside or outside bar based on width).
 * @param {number} barX - Bar X position
 * @param {number} barWidth - Bar width
 * @param {string} labelText - Label text
 * @param {number} charWidth - Approximate character width (default 7)
 * @returns {{ x: number, position: 'inside' | 'outside' }}
 */
export function computeLabelPosition(barX, barWidth, labelText, charWidth = 7) {
    const labelWidth = labelText.length * charWidth;
    const padding = 10;

    if (labelWidth + padding < barWidth) {
        // Label fits inside bar - center it
        return {
            x: barX + barWidth / 2,
            position: 'inside',
        };
    } else {
        // Label outside bar - position after bar end
        return {
            x: barX + barWidth + 5,
            position: 'outside',
        };
    }
}

/**
 * Calculate distance between two tasks (edge to edge).
 * @param {Object} predBar - Predecessor bar { x, width }
 * @param {Object} succBar - Successor bar { x }
 * @returns {number} Distance in pixels (positive = gap, negative = overlap)
 */
export function calculateDistance(predBar, succBar) {
    const predRightEdge = predBar.x + predBar.width;
    return succBar.x - predRightEdge;
}

/**
 * Validate that successor doesn't start before predecessor.
 * @param {number} succX - Successor X position
 * @param {number} predX - Predecessor X position
 * @returns {boolean} True if valid
 */
export function validateSuccessorPosition(succX, predX) {
    return succX >= predX;
}
