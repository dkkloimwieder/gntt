/**
 * Row Layout Calculator
 *
 * Calculates variable row heights and cumulative Y positions for the Gantt chart.
 * Supports expanded tasks that contain subtasks at 50% height.
 */

// Helper to iterate over tasks (supports both Map and plain object)
function iterateTasks(tasksObj) {
    if (!tasksObj) return [];
    if (tasksObj.entries) {
        // It's a Map
        return Array.from(tasksObj.entries());
    }
    // Plain object
    return Object.entries(tasksObj);
}

// Helper to get task by ID (supports both Map and plain object)
function getTask(tasksObj, id) {
    if (!tasksObj) return null;
    if (tasksObj.get) return tasksObj.get(id);
    return tasksObj[id];
}

/**
 * Calculate row layouts with variable heights.
 *
 * @param {Array} displayRows - Flat list of rows to display [{id, type, ...}]
 * @param {Object} config - { barHeight, padding, subtaskHeightRatio }
 * @param {Set} expandedTasks - Task IDs that are expanded
 * @param {Object} taskMap - Task lookup (Map or plain object)
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
    for (const [taskId, task] of iterateTasks(taskMap)) {
        if (task.resource) {
            if (!tasksByResource.has(task.resource)) {
                tasksByResource.set(task.resource, []);
            }
            tasksByResource.get(task.resource).push(task);
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
        // Tasks that don't overlap in time share the same Y position
        const taskPositions = new Map();
        const baseY = cumulativeY + padding / 2;

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

        // Track rows (Y levels) and their occupied time ranges
        // Each row has: { y, height, occupiedRanges: [{start, end}] }
        const rows = [];

        // Helper to check if a task overlaps with any range in a row
        const overlapsRow = (task, row) => {
            const taskStart = task._start ?? task.$bar?.x ?? 0;
            const taskEnd = task._end ?? (task.$bar?.x + task.$bar?.width) ?? taskStart + 1;
            for (const range of row.occupiedRanges) {
                // Overlap if not (taskEnd <= rangeStart OR taskStart >= rangeEnd)
                if (!(taskEnd <= range.start || taskStart >= range.end)) {
                    return true;
                }
            }
            return false;
        };

        // Helper to find or create a row for a task
        const findRowForTask = (task, taskHeight) => {
            const taskStart = task._start ?? task.$bar?.x ?? 0;
            const taskEnd = task._end ?? (task.$bar?.x + task.$bar?.width) ?? taskStart + 1;

            // Try to find an existing row where this task fits (no time overlap)
            for (const row of rows) {
                if (!overlapsRow(task, row)) {
                    row.occupiedRanges.push({ start: taskStart, end: taskEnd });
                    // Update row height to max of all tasks at this level
                    row.height = Math.max(row.height, taskHeight);
                    return row.y;
                }
            }

            // No existing row fits, create a new one
            const newY = rows.length === 0 ? baseY : rows[rows.length - 1].y + rows[rows.length - 1].height;
            rows.push({
                y: newY,
                height: taskHeight,
                occupiedRanges: [{ start: taskStart, end: taskEnd }],
            });
            return newY;
        };

        for (const task of sortedTasks) {
            const isExpanded = expandedTasks?.has(task.id) && task._children?.length > 0;
            let taskHeight;
            let taskY;

            if (isExpanded) {
                taskHeight = calculateExpandedRowHeight(task, config, taskMap);
                const layout = task.subtaskLayout || 'sequential';

                // For sequential, container is barHeight (same as regular task)
                // For parallel/mixed, use the full expanded height
                const containerHeight = layout === 'sequential' ? barHeight : taskHeight;
                const visualHeight = layout === 'sequential' ? baseRowHeight : taskHeight;

                taskY = findRowForTask(task, visualHeight);

                taskPositions.set(task.id, {
                    y: taskY,
                    height: containerHeight,
                    // Store container x/width for arrow positioning
                    x: task.$bar?.x,
                    width: task.$bar?.width,
                    isExpanded,
                });

                // Add subtask positions within the expanded container
                const subtaskBarHeight = barHeight * subtaskHeightRatio;
                const subtaskPadding = padding * 0.4;
                const subtaskRowHeight = subtaskBarHeight + subtaskPadding;

                if (task._children) {
                    // For mixed/parallel, compute row assignments based on time overlaps
                    const rowAssignments = (layout === 'mixed' || layout === 'parallel')
                        ? computeSubtaskRows(task._children, taskMap)
                        : null;

                    // Use consistent vertical padding (matches sequential centering)
                    const verticalPadding = (barHeight - subtaskBarHeight) / 2;

                    task._children.forEach((childId, index) => {
                        const child = getTask(taskMap, childId);
                        let childY;

                        if (layout === 'sequential') {
                            // Sequential: center subtasks in barHeight container
                            childY = taskY + verticalPadding;
                        } else {
                            // Mixed/Parallel: use computed row based on time overlaps
                            const subtaskRow = rowAssignments?.get(childId) ?? index;
                            // Stack with same padding as sequential
                            childY = taskY + verticalPadding + subtaskRow * (subtaskBarHeight + subtaskPadding);
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
                taskY = findRowForTask(task, taskHeight);
                taskPositions.set(task.id, {
                    y: taskY,
                    height: taskHeight,
                    isExpanded: false,
                });
            } else {
                taskHeight = baseRowHeight;
                taskY = findRowForTask(task, taskHeight);
                taskPositions.set(task.id, {
                    y: taskY,
                    height: barHeight, // Use bar height for arrow center calculation
                    isExpanded: false,
                });
            }
        }

        // Calculate total row height from all sub-rows
        let maxSubY = baseY;
        for (const subRow of rows) {
            maxSubY = Math.max(maxSubY, subRow.y + subRow.height);
        }
        // Use calculated height (accounts for task packing), ensure at least baseRowHeight
        const actualRowHeight = Math.max(baseRowHeight, maxSubY - cumulativeY);

        layouts.set(row.id, {
            y: cumulativeY,
            height: actualRowHeight,
            contentY: cumulativeY + padding / 2,
            contentHeight: actualRowHeight - padding,
            type: row.type,
            expandedTasks: expandedTasksInRow.map(t => t.id),
            taskPositions, // Map of taskId -> { y, height, isExpanded }
        });

        cumulativeY += actualRowHeight;
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

    // Sequential: same height as a normal task row (subtasks fit in same space)
    if (layout === 'sequential') {
        return barHeight + padding;
    }

    // Parallel: stack vertically (subtasks overlap in time, need separate rows)
    if (layout === 'parallel') {
        // Use same vertical padding as sequential centering
        const verticalPadding = (barHeight - subtaskBarHeight) / 2;
        const rowCount = children.length;
        return verticalPadding * 2 + rowCount * subtaskBarHeight + (rowCount - 1) * subtaskPadding;
    }

    // Mixed: analyze subtask row assignments
    if (layout === 'mixed') {
        return calculateMixedLayoutHeight(task, config, taskMap);
    }

    // Default to sequential (same height as normal task)
    return barHeight + padding;
}

/**
 * Compute row assignments for subtasks based on time overlaps.
 * Uses a packing algorithm - places each subtask on the first row
 * where it doesn't overlap with existing subtasks.
 *
 * @param {Array} childIds - Array of child task IDs
 * @param {Object} taskMap - Task lookup (Map or plain object)
 * @returns {Map} subtaskId -> computed row index
 */
function computeSubtaskRows(childIds, taskMap) {
    const rowAssignments = new Map();
    if (!childIds?.length || !taskMap) return rowAssignments;

    // Get subtasks with their time ranges, sorted by order field or start time
    const subtasks = childIds
        .map(id => getTask(taskMap, id))
        .filter(t => t != null)
        .sort((a, b) => {
            // Sort by order field if present, otherwise by start time
            if (a.order !== undefined && b.order !== undefined) {
                return a.order - b.order;
            }
            return (a._start || 0) - (b._start || 0);
        });

    // Track rows and their occupied time ranges
    const rows = []; // Array of arrays of {start, end}

    for (const subtask of subtasks) {
        const start = subtask._start ?? subtask.$bar?.x ?? 0;
        const end = subtask._end ?? (subtask.$bar?.x + subtask.$bar?.width) ?? start + 1;

        // Find first row where this subtask fits
        let assignedRow = -1;
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const hasOverlap = rows[rowIdx].some(range =>
                !(end <= range.start || start >= range.end)
            );
            if (!hasOverlap) {
                assignedRow = rowIdx;
                rows[rowIdx].push({ start, end });
                break;
            }
        }

        // No existing row fits - create new one
        if (assignedRow === -1) {
            assignedRow = rows.length;
            rows.push([{ start, end }]);
        }

        rowAssignments.set(subtask.id, assignedRow);
    }

    return rowAssignments;
}

/**
 * Calculate height for mixed/parallel layout.
 * Auto-computes rows based on time overlaps.
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

    if (children.length === 0) {
        return barHeight + padding;
    }

    // Compute rows automatically based on overlaps
    const rowAssignments = computeSubtaskRows(children, taskMap);
    const maxRow = Math.max(0, ...rowAssignments.values());

    const rowCount = maxRow + 1;
    // Use same vertical padding as sequential centering
    const verticalPadding = (barHeight - subtaskBarHeight) / 2;
    return verticalPadding * 2 + rowCount * subtaskBarHeight + (rowCount - 1) * subtaskPadding;
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

    // Sequential: all subtasks on same Y, already centered by parentContentY
    if (layout === 'sequential') {
        return parentContentY;
    }

    // Mixed: use subtaskRow for explicit positioning
    if (layout === 'mixed') {
        return parentContentY + padding / 2 + subtaskRow * subtaskRowHeight;
    }

    // Parallel (default): stack by index (they overlap in time, need separate rows)
    return parentContentY + padding / 2 + subtaskIndex * subtaskRowHeight;
}

/**
 * Calculate simple row layouts with static heights.
 * Used in 'simple' view mode for maximum performance.
 * Skips all subtask/expansion logic - every row is the same height.
 *
 * @param {Array} displayRows - Flat list of rows [{id, type, ...}]
 * @param {Object} config - { barHeight, padding }
 * @returns {Map} rowLayouts - Map<rowId, { y, height, contentY, contentHeight }>
 */
export function calculateSimpleRowLayouts(displayRows, config) {
    const { barHeight = 30, padding = 18 } = config;
    const rowHeight = barHeight + padding;
    const layouts = new Map();

    for (let i = 0; i < displayRows.length; i++) {
        const row = displayRows[i];
        const y = i * rowHeight;

        layouts.set(row.id, {
            y,
            height: rowHeight,
            contentY: y + padding / 2,
            contentHeight: barHeight,
            type: row.type,
            // No taskPositions needed - all tasks use static Y from row index
        });
    }

    // Store total height
    layouts.set('__total__', { height: displayRows.length * rowHeight });

    return layouts;
}

export default {
    calculateRowLayouts,
    calculateSimpleRowLayouts,
    calculateExpandedRowHeight,
    findRowAtY,
    rowLayoutsToSortedArray,
    getVisibleRowRange,
    computeSubtaskY,
};
