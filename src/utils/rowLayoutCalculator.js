/**
 * Row Layout Calculator
 *
 * Calculates variable row heights and cumulative Y positions for the Gantt chart.
 * Supports expanded tasks that contain subtasks at 50% height.
 */

/**
 * Calculate row layouts with variable heights.
 *
 * @param {Array} displayRows - Flat list of rows to display [{id, type, ...}]
 * @param {Object} config - { barHeight, padding, subtaskHeightRatio }
 * @param {Set} expandedTasks - Task IDs that are expanded
 * @param {Map} taskMap - Map of taskId -> task (for subtask lookup)
 * @returns {Map} rowLayouts - Map<rowId, { y, height, contentY, contentHeight }>
 */
export function calculateRowLayouts(displayRows, config, expandedTasks, taskMap) {
    const {
        barHeight = 30,
        padding = 18,
        subtaskHeightRatio = 0.5,
    } = config;

    const baseRowHeight = barHeight + padding;
    const layouts = new Map();
    let cumulativeY = 0;

    // Build resource -> tasks lookup for finding expanded tasks per resource
    const tasksByResource = new Map();
    if (taskMap) {
        for (const [taskId, task] of taskMap) {
            if (task.resource) {
                if (!tasksByResource.has(task.resource)) {
                    tasksByResource.set(task.resource, []);
                }
                tasksByResource.get(task.resource).push(task);
            }
        }
    }

    for (const row of displayRows) {
        let rowHeight = baseRowHeight;
        let contentHeight = barHeight;
        let expandedTasksInRow = [];

        // Check for expanded tasks in this resource row
        const resourceTasks = tasksByResource.get(row.id) || [];
        for (const task of resourceTasks) {
            // Skip subtasks (they have parentId)
            if (task.parentId) continue;
            // Skip project summary bars (type === 'project')
            if (task.type === 'project') continue;

            // Check if this task is expanded with subtasks
            if (expandedTasks?.has(task.id) && task._children?.length > 0) {
                expandedTasksInRow.push(task);
            }
        }

        // If there are expanded tasks, calculate total height
        if (expandedTasksInRow.length > 0) {
            // Calculate height for each expanded task and sum them
            let totalExpandedHeight = 0;
            for (const task of expandedTasksInRow) {
                totalExpandedHeight += calculateExpandedRowHeight(task, config, taskMap);
            }
            // Add height for non-expanded tasks (just baseRowHeight each)
            const nonExpandedCount = resourceTasks.filter(t =>
                !t.parentId && t.type !== 'project' && !expandedTasks?.has(t.id)
            ).length;
            rowHeight = totalExpandedHeight + nonExpandedCount * baseRowHeight;
            contentHeight = rowHeight - padding;
        }

        // Compute sub-positions for tasks within this row
        // This positions each task vertically within the resource row
        const taskPositions = new Map();
        let subY = cumulativeY + padding / 2;

        // Sort resource tasks: project summaries first, then by start date
        const sortedTasks = [...resourceTasks]
            .filter(t => !t.parentId) // Skip subtasks
            .sort((a, b) => {
                // Project summaries first
                if (a.type === 'project' && b.type !== 'project') return -1;
                if (b.type === 'project' && a.type !== 'project') return 1;
                // Then by start date
                return (a._start || 0) - (b._start || 0);
            });

        for (const task of sortedTasks) {
            const isExpanded = expandedTasks?.has(task.id) && task._children?.length > 0;
            let taskHeight;

            if (isExpanded) {
                taskHeight = calculateExpandedRowHeight(task, config, taskMap);

                // Add parent task position (at top of its container)
                taskPositions.set(task.id, {
                    y: subY,
                    height: taskHeight,
                    isExpanded,
                });

                // Add subtask positions within the expanded container
                const subtaskBarHeight = barHeight * subtaskHeightRatio;
                const subtaskPadding = padding * 0.4;
                const subtaskRowHeight = subtaskBarHeight + subtaskPadding;
                const layout = task.subtaskLayout || 'sequential';

                if (task._children) {
                    // contentY matches ExpandedTaskContainer: containerY + padding/2
                    const contentY = subY + padding / 2;

                    task._children.forEach((childId, index) => {
                        const child = taskMap?.get(childId);
                        const subtaskRow = child?.row ?? index;
                        let childY;

                        if (layout === 'sequential') {
                            // Sequential: all subtasks on same Y (they don't overlap in time)
                            childY = contentY + padding / 2;
                        } else if (layout === 'mixed') {
                            // Mixed: use row field for explicit positioning
                            childY = contentY + padding / 2 + subtaskRow * subtaskRowHeight;
                        } else {
                            // Parallel: stack by index (they overlap in time, need separate rows)
                            childY = contentY + padding / 2 + index * subtaskRowHeight;
                        }

                        taskPositions.set(childId, {
                            y: childY,
                            height: subtaskBarHeight,
                            isSubtask: true,
                        });
                    });
                }
            } else if (task.type === 'project') {
                // Project summary bars are thin
                taskHeight = barHeight * 0.6;
                taskPositions.set(task.id, {
                    y: subY,
                    height: taskHeight,
                    isExpanded: false,
                });
            } else {
                taskHeight = baseRowHeight;
                taskPositions.set(task.id, {
                    y: subY,
                    height: taskHeight,
                    isExpanded: false,
                });
            }

            subY += taskHeight;
        }

        layouts.set(row.id, {
            y: cumulativeY,
            height: rowHeight,
            contentY: cumulativeY + padding / 2,
            contentHeight: contentHeight,
            type: row.type,
            expandedTasks: expandedTasksInRow.map(t => t.id),
            taskPositions, // Map of taskId -> { y, height, isExpanded }
        });

        cumulativeY += rowHeight;
    }

    // Store total height for container sizing
    layouts.set('__total__', { height: cumulativeY });

    return layouts;
}

/**
 * Calculate row height when task is expanded with subtasks.
 *
 * @param {Object} task - Task with _children and subtaskLayout
 * @param {Object} config - { barHeight, padding, subtaskHeightRatio }
 * @param {Map} taskMap - Map of taskId -> task
 * @returns {number} Total row height
 */
export function calculateExpandedRowHeight(task, config, taskMap) {
    const {
        barHeight = 30,
        padding = 18,
        subtaskHeightRatio = 0.5,
    } = config;

    const subtaskBarHeight = barHeight * subtaskHeightRatio;
    const subtaskPadding = padding * 0.4;
    const children = task._children || [];

    if (children.length === 0) {
        return barHeight + padding;
    }

    const layout = task.subtaskLayout || 'sequential';

    // Sequential: single row (subtasks don't overlap in time)
    if (layout === 'sequential') {
        return padding + subtaskBarHeight + padding;
    }

    // Parallel: stack vertically (subtasks overlap in time, need separate rows)
    if (layout === 'parallel') {
        const subtaskRowHeight = subtaskBarHeight + subtaskPadding;
        return padding + children.length * subtaskRowHeight + padding / 2;
    }

    // Mixed: analyze subtask row assignments
    if (layout === 'mixed') {
        return calculateMixedLayoutHeight(task, config, taskMap);
    }

    // Default to sequential
    const subtaskRowHeight = subtaskBarHeight + subtaskPadding;
    return padding + children.length * subtaskRowHeight + padding / 2;
}

/**
 * Calculate height for mixed layout (some parallel, some sequential).
 * Uses the `row` field on subtasks to determine vertical stacking.
 *
 * @param {Object} task - Parent task
 * @param {Object} config - Config
 * @param {Map} taskMap - Task map
 * @returns {number} Total row height
 */
function calculateMixedLayoutHeight(task, config, taskMap) {
    const {
        barHeight = 30,
        padding = 18,
        subtaskHeightRatio = 0.5,
    } = config;

    const subtaskBarHeight = barHeight * subtaskHeightRatio;
    const subtaskPadding = padding * 0.4;
    const children = task._children || [];

    // Find max row index from subtasks
    let maxRow = 0;
    for (const childId of children) {
        const child = taskMap?.get(childId);
        if (child && typeof child.row === 'number') {
            maxRow = Math.max(maxRow, child.row);
        }
    }

    const rowCount = maxRow + 1;
    const subtaskRowHeight = subtaskBarHeight + subtaskPadding;
    return padding + rowCount * subtaskRowHeight + padding / 2;
}

/**
 * Binary search to find the row at a given Y position.
 * Used for virtualization with variable row heights.
 *
 * @param {Array} sortedRows - Array of {id, y, height} sorted by y
 * @param {number} targetY - Y position to find
 * @returns {number} Index of row containing targetY, or -1 if before all rows
 */
export function findRowAtY(sortedRows, targetY) {
    if (sortedRows.length === 0) return -1;
    if (targetY < 0) return 0;

    let left = 0;
    let right = sortedRows.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const row = sortedRows[mid];

        if (targetY >= row.y && targetY < row.y + row.height) {
            return mid;
        }

        if (targetY < row.y) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    // Return last row if beyond all rows
    return Math.min(left, sortedRows.length - 1);
}

/**
 * Convert row layouts Map to sorted array for binary search.
 *
 * @param {Map} rowLayouts - Map<rowId, {y, height, ...}>
 * @returns {Array} Sorted array of {id, y, height}
 */
export function rowLayoutsToSortedArray(rowLayouts) {
    const result = [];
    for (const [id, layout] of rowLayouts) {
        if (id === '__total__') continue;
        result.push({ id, ...layout });
    }
    result.sort((a, b) => a.y - b.y);
    return result;
}

/**
 * Get visible row range for a viewport.
 *
 * @param {Array} sortedRows - Sorted array of {id, y, height}
 * @param {number} scrollY - Current scroll position
 * @param {number} viewportHeight - Visible height
 * @param {number} overscan - Extra rows to render (default 2)
 * @returns {{ startIndex: number, endIndex: number }}
 */
export function getVisibleRowRange(sortedRows, scrollY, viewportHeight, overscan = 2) {
    if (sortedRows.length === 0) {
        return { startIndex: 0, endIndex: 0 };
    }

    const startIndex = Math.max(0, findRowAtY(sortedRows, scrollY) - overscan);
    const endIndex = Math.min(
        sortedRows.length,
        findRowAtY(sortedRows, scrollY + viewportHeight) + 1 + overscan
    );

    return { startIndex, endIndex };
}

/**
 * Compute subtask Y position within an expanded parent.
 *
 * @param {number} subtaskIndex - Index of subtask in parent's children
 * @param {number} parentContentY - Y position where parent content starts
 * @param {string} layout - 'sequential' | 'parallel' | 'mixed'
 * @param {Object} config - { barHeight, padding, subtaskHeightRatio }
 * @param {number} subtaskRow - For mixed layout, which row the subtask is on
 * @returns {number} Y position for the subtask bar
 */
export function computeSubtaskY(subtaskIndex, parentContentY, layout, config, subtaskRow = 0) {
    const {
        barHeight = 30,
        padding = 18,
        subtaskHeightRatio = 0.5,
    } = config;

    const subtaskBarHeight = barHeight * subtaskHeightRatio;
    const subtaskPadding = padding * 0.4;
    const subtaskRowHeight = subtaskBarHeight + subtaskPadding;

    // Sequential: all subtasks on same Y (they don't overlap in time)
    if (layout === 'sequential') {
        return parentContentY + padding / 2;
    }

    // Mixed: use subtaskRow for explicit positioning
    if (layout === 'mixed') {
        return parentContentY + padding / 2 + subtaskRow * subtaskRowHeight;
    }

    // Parallel (default): stack by index (they overlap in time, need separate rows)
    return parentContentY + padding / 2 + subtaskIndex * subtaskRowHeight;
}

export default {
    calculateRowLayouts,
    calculateExpandedRowHeight,
    findRowAtY,
    rowLayoutsToSortedArray,
    getVisibleRowRange,
    computeSubtaskY,
};
