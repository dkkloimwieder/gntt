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
    // Round to nearest column boundary, subtract 0.5 to align with grid lines
    // Grid lines are at (index+1)*colWidth - 0.5, so bar starts at index*colWidth - 0.5
    return Math.round(diff) * columnWidth - 0.5;
}

/**
 * Compute bar Y position from task index.
 * Y position is relative to SVG content area (no header offset).
 * Bar is vertically centered within its row.
 * Row height = barHeight + padding, rows start at y=0.
 * @param {number} taskIndex - Task index (row number)
 * @param {number} barHeight - Height of each bar
 * @param {number} padding - Vertical padding between bars
 * @returns {number} Y position in pixels
 */
export function computeY(taskIndex, barHeight, padding) {
    // Row starts at taskIndex * rowHeight (where rowHeight = barHeight + padding)
    // Bar is centered within row, so add padding/2 offset from row start
    const rowHeight = barHeight + padding;
    return taskIndex * rowHeight + padding / 2;
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
    // Round to nearest column boundary
    return Math.round(diff) * columnWidth;
}

/**
 * Compute actual duration (excluding ignored dates).
 * @param {Date} taskStart - Task start date
 * @param {Date} taskEnd - Task end date
 * @param {Date[]} ignoredDates - Array of dates to ignore
 * @param {Function|null} ignoredFunction - Optional function to test if date should be ignored
 * @returns {{ totalDays: number, actualDays: number, ignoredDays: number }}
 */
export function computeDuration(
    taskStart,
    taskEnd,
    ignoredDates = [],
    ignoredFunction = null,
) {
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
export function computeProgressWidth(
    barX,
    barWidth,
    progress,
    ignoredPositions = [],
    columnWidth = 45,
) {
    const barEnd = barX + barWidth;

    // Pre-compute ignored column indices for O(1) lookups
    // This changes O(n*m) to O(n+m) where n=iterations, m=ignoredPositions
    const ignoredColSet = new Set(
        ignoredPositions.map((pos) => Math.floor(pos / columnWidth))
    );

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

    // Skip over any ignored regions at the progress end using O(1) Set lookup
    let currentPos = barX + progressWidth;
    while (currentPos < barEnd) {
        const currentCol = Math.floor(currentPos / columnWidth);
        if (ignoredColSet.has(currentCol)) {
            progressWidth += columnWidth;
            currentPos = barX + progressWidth;
        } else {
            break;
        }
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
 * Compute summary bar bounds from its children's positions.
 * Summary bar spans from earliest child start to latest child end.
 *
 * @param {Object} summaryTask - Summary task with _children array
 * @param {Object} taskMap - Task lookup (Map or plain object)
 * @param {number} minWidth - Minimum width for summary bar (default: 20)
 * @returns {{ x: number, width: number } | null} New bounds or null if no children
 */
export function computeSummaryBounds(summaryTask, taskMap, minWidth = 20) {
    if (!summaryTask._children || summaryTask._children.length === 0) {
        return null;
    }

    // Helper to get task (supports both Map and plain object)
    const getTask = taskMap.get ? (id) => taskMap.get(id) : (id) => taskMap[id];

    // Collect all descendant bars (recursive) for accurate span calculation
    const descendantBars = [];
    const collectBars = (childIds) => {
        for (const childId of childIds) {
            const child = getTask(childId);
            if (!child?.$bar) continue;

            // Include this child's bar
            descendantBars.push(child.$bar);

            // Recursively collect from grandchildren
            if (child._children && child._children.length > 0) {
                collectBars(child._children);
            }
        }
    };

    collectBars(summaryTask._children);

    if (descendantBars.length === 0) {
        return null;
    }

    const minX = Math.min(...descendantBars.map((b) => b.x));
    const maxRight = Math.max(...descendantBars.map((b) => b.x + b.width));
    const width = Math.max(maxRight - minX, minWidth);

    return { x: minX, width };
}

/**
 * Recompute all summary bar bounds in the task hierarchy.
 * Process from deepest level up so parent summaries include child summaries.
 *
 * @param {Map<string, Object>} taskMap - Map of task ID to task object
 */
export function recomputeAllSummaryBounds(taskMap) {
    // Find max depth
    let maxDepth = 0;
    for (const task of taskMap.values()) {
        if (task._depth > maxDepth) {
            maxDepth = task._depth;
        }
    }

    // Process from deepest to shallowest
    for (let depth = maxDepth; depth >= 0; depth--) {
        for (const task of taskMap.values()) {
            if (task._depth === depth && task.type === 'summary') {
                const bounds = computeSummaryBounds(task, taskMap);
                if (bounds && task.$bar) {
                    task.$bar.x = bounds.x;
                    task.$bar.width = bounds.width;
                }
            }
        }
    }
}

/**
 * Compute bar Y position from variable row layouts.
 * Used when rows have different heights (e.g., expanded subtask containers).
 *
 * @param {string} rowId - Row identifier (usually resource or task ID)
 * @param {Map} rowLayouts - Map<rowId, { y, height, contentY, contentHeight }>
 * @param {number} fallbackY - Fallback Y position if row not found
 * @returns {number} Y position for the bar
 */
export function computeVariableY(rowId, rowLayouts, fallbackY = 0) {
    const layout = rowLayouts?.get(rowId);
    if (layout) {
        return layout.contentY;
    }
    return fallbackY;
}

/**
 * Compute subtask bar height based on ratio.
 *
 * @param {number} barHeight - Normal bar height
 * @param {number} ratio - Subtask height ratio (default 0.5)
 * @returns {number} Subtask bar height
 */
export function computeSubtaskBarHeight(barHeight, ratio = 0.5) {
    return barHeight * ratio;
}

/**
 * Compute row height based on expansion state.
 * Used for determining container height when task is expanded.
 *
 * @param {Object} task - Task with _children and subtaskLayout
 * @param {boolean} isExpanded - Whether the task is expanded
 * @param {Object} config - { barHeight, padding, subtaskHeightRatio }
 * @returns {number} Row height
 */
export function computeExpandedRowHeight(task, isExpanded, config) {
    const { barHeight = 30, padding = 18, subtaskHeightRatio = 0.5 } = config;
    const baseRowHeight = barHeight + padding;

    if (!isExpanded || !task._children?.length) {
        return baseRowHeight;
    }

    const subtaskBarHeight = barHeight * subtaskHeightRatio;
    const subtaskPadding = padding * 0.4;
    const subtaskRowHeight = subtaskBarHeight + subtaskPadding;
    const layout = task.subtaskLayout || 'sequential';

    if (layout === 'parallel') {
        return padding + subtaskBarHeight + padding;
    }

    if (layout === 'mixed') {
        // Find max row index
        let maxRow = 0;
        for (const child of task._children || []) {
            if (typeof child.row === 'number') {
                maxRow = Math.max(maxRow, child.row);
            }
        }
        return padding + (maxRow + 1) * subtaskRowHeight + padding / 2;
    }

    // Sequential
    return padding + task._children.length * subtaskRowHeight + padding / 2;
}
