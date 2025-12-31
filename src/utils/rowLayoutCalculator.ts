import type { BarPosition } from '../types';

export interface RowLayout {
    y: number;
    height: number;
    contentY?: number;
    contentHeight?: number;
    type?: string;
    expandedTasks?: string[];
    taskPositions?: Map<string, TaskPosition>;
}

interface TaskPosition {
    y: number;
    height: number;
    x?: number;
    width?: number;
    isExpanded?: boolean;
    isSubtask?: boolean;
}

interface LayoutConfig {
    barHeight?: number;
    padding?: number;
    subtaskHeightRatio?: number;
}

interface DisplayRow {
    id: string;
    type?: string;
}

interface TaskLike {
    id: string;
    resource?: string;
    parentId?: string;
    type?: string;
    _start?: Date | number;
    _end?: Date | number;
    _children?: string[];
    subtaskLayout?: 'sequential' | 'parallel' | 'mixed';
    order?: number;
    _bar?: BarPosition;
}

type TaskMap = Map<string, TaskLike> | Record<string, TaskLike | undefined>;

function iterateTasks(tasksObj: TaskMap | null | undefined): [string, TaskLike][] {
    if (!tasksObj) return [];
    if (tasksObj instanceof Map) {
        return Array.from(tasksObj.entries());
    }
    // Filter out undefined values for Record type
    return Object.entries(tasksObj).filter((entry): entry is [string, TaskLike] => entry[1] !== undefined);
}

function getTask(tasksObj: TaskMap | null | undefined, id: string): TaskLike | null {
    if (!tasksObj) return null;
    if (tasksObj instanceof Map) return tasksObj.get(id) ?? null;
    return (tasksObj as Record<string, TaskLike>)[id] ?? null;
}

export function calculateRowLayouts(
    displayRows: DisplayRow[],
    config: LayoutConfig,
    expandedTasks: Set<string> | null | undefined,
    taskMap: TaskMap | null | undefined
): Map<string, RowLayout> {
    const {
        barHeight = 30,
        padding = 18,
        subtaskHeightRatio = 0.5,
    } = config;

    const baseRowHeight = barHeight + padding;
    const layouts = new Map<string, RowLayout>();
    let cumulativeY = 0;

    const tasksByResource = new Map<string, TaskLike[]>();
    for (const [_taskId, task] of iterateTasks(taskMap)) {
        if (task.resource) {
            if (!tasksByResource.has(task.resource)) {
                tasksByResource.set(task.resource, []);
            }
            tasksByResource.get(task.resource)!.push(task);
        }
    }

    for (const row of displayRows) {
        let rowHeight = baseRowHeight;
        const expandedTasksInRow: TaskLike[] = [];

        const resourceTasks = tasksByResource.get(row.id) || [];
        for (const task of resourceTasks) {
            if (task.parentId) continue;
            if (task.type === 'project') continue;

            if (expandedTasks?.has(task.id) && task._children && task._children.length > 0) {
                expandedTasksInRow.push(task);
            }
        }

        if (expandedTasksInRow.length > 0) {
            let totalExpandedHeight = 0;
            for (const task of expandedTasksInRow) {
                totalExpandedHeight += calculateExpandedRowHeight(task, config, taskMap);
            }
            const nonExpandedCount = resourceTasks.filter(t =>
                !t.parentId && t.type !== 'project' && !expandedTasks?.has(t.id)
            ).length;
            rowHeight = totalExpandedHeight + nonExpandedCount * baseRowHeight;
        }

        const taskPositions = new Map<string, TaskPosition>();
        const baseY = cumulativeY + padding / 2;

        const sortedTasks = [...resourceTasks]
            .filter(t => !t.parentId)
            .sort((a, b) => {
                if (a.type === 'project' && b.type !== 'project') return -1;
                if (b.type === 'project' && a.type !== 'project') return 1;
                const aStart = a._start instanceof Date ? a._start.getTime() : (a._start ?? 0);
                const bStart = b._start instanceof Date ? b._start.getTime() : (b._start ?? 0);
                return aStart - bStart;
            });

        interface SubRow {
            y: number;
            height: number;
            occupiedRanges: { start: number | Date; end: number | Date }[];
        }

        const rows: SubRow[] = [];

        const overlapsRow = (task: TaskLike, subRow: SubRow): boolean => {
            const taskStart = task._start ?? task._bar?.x ?? 0;
            const taskEnd = task._end ?? ((task._bar?.x ?? 0) + (task._bar?.width ?? 1));
            for (const range of subRow.occupiedRanges) {
                if (!(taskEnd <= range.start || taskStart >= range.end)) {
                    return true;
                }
            }
            return false;
        };

        const findRowForTask = (task: TaskLike, taskHeight: number): number => {
            const taskStart = task._start ?? task._bar?.x ?? 0;
            const taskEnd = task._end ?? ((task._bar?.x ?? 0) + (task._bar?.width ?? 1));

            for (const subRow of rows) {
                if (!overlapsRow(task, subRow)) {
                    subRow.occupiedRanges.push({ start: taskStart, end: taskEnd });
                    subRow.height = Math.max(subRow.height, taskHeight);
                    return subRow.y;
                }
            }

            const lastRow = rows[rows.length - 1];
            const newY = rows.length === 0 ? baseY : lastRow!.y + lastRow!.height;
            rows.push({
                y: newY,
                height: taskHeight,
                occupiedRanges: [{ start: taskStart, end: taskEnd }],
            });
            return newY;
        };

        for (const task of sortedTasks) {
            const isExpanded = expandedTasks?.has(task.id) && task._children && task._children.length > 0;
            let taskHeight: number;
            let taskY: number;

            if (isExpanded) {
                taskHeight = calculateExpandedRowHeight(task, config, taskMap);
                const layout = task.subtaskLayout || 'sequential';

                const containerHeight = layout === 'sequential' ? barHeight : taskHeight;
                const visualHeight = layout === 'sequential' ? baseRowHeight : taskHeight;

                taskY = findRowForTask(task, visualHeight);

                taskPositions.set(task.id, {
                    y: taskY,
                    height: containerHeight,
                    x: task._bar?.x,
                    width: task._bar?.width,
                    isExpanded: true,
                });

                const subtaskBarHeight = barHeight * subtaskHeightRatio;
                const subtaskPadding = padding * 0.4;

                if (task._children) {
                    const rowAssignments = (layout === 'mixed' || layout === 'parallel')
                        ? computeSubtaskRows(task._children, taskMap)
                        : null;

                    const verticalPadding = (barHeight - subtaskBarHeight) / 2;

                    task._children.forEach((childId, index) => {
                        const child = getTask(taskMap, childId);
                        if (!child) return;

                        let childY: number;

                        if (layout === 'sequential') {
                            childY = taskY + verticalPadding;
                        } else {
                            const subtaskRow = rowAssignments?.get(childId) ?? index;
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
                    height: barHeight,
                    isExpanded: false,
                });
            }
        }

        let maxSubY = baseY;
        for (const subRow of rows) {
            maxSubY = Math.max(maxSubY, subRow.y + subRow.height);
        }
        const actualRowHeight = Math.max(baseRowHeight, maxSubY - cumulativeY);

        layouts.set(row.id, {
            y: cumulativeY,
            height: actualRowHeight,
            contentY: cumulativeY + padding / 2,
            contentHeight: actualRowHeight - padding,
            type: row.type,
            expandedTasks: expandedTasksInRow.map(t => t.id),
            taskPositions,
        });

        cumulativeY += actualRowHeight;
    }

    layouts.set('__total__', { y: 0, height: cumulativeY });

    return layouts;
}

export function calculateExpandedRowHeight(
    task: TaskLike,
    config: LayoutConfig,
    taskMap: TaskMap | null | undefined
): number {
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

    if (layout === 'sequential') {
        return barHeight + padding;
    }

    if (layout === 'parallel') {
        const verticalPadding = (barHeight - subtaskBarHeight) / 2;
        const rowCount = children.length;
        return verticalPadding * 2 + rowCount * subtaskBarHeight + (rowCount - 1) * subtaskPadding;
    }

    if (layout === 'mixed') {
        return calculateMixedLayoutHeight(task, config, taskMap);
    }

    return barHeight + padding;
}

function computeSubtaskRows(
    childIds: string[],
    taskMap: TaskMap | null | undefined
): Map<string, number> {
    const rowAssignments = new Map<string, number>();
    if (!childIds?.length || !taskMap) return rowAssignments;

    const subtasks = childIds
        .map(id => getTask(taskMap, id))
        .filter((t): t is TaskLike => t != null)
        .sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) {
                return a.order - b.order;
            }
            const aStart = a._start instanceof Date ? a._start.getTime() : (a._start ?? 0);
            const bStart = b._start instanceof Date ? b._start.getTime() : (b._start ?? 0);
            return aStart - bStart;
        });

    const rows: { start: number; end: number }[][] = [];

    for (const subtask of subtasks) {
        const startVal = subtask._start;
        const start = startVal instanceof Date ? startVal.getTime() : (startVal ?? subtask._bar?.x ?? 0);
        const endVal = subtask._end;
        const end = endVal instanceof Date ? endVal.getTime() : (endVal ?? ((subtask._bar?.x ?? 0) + (subtask._bar?.width ?? 1)));

        let assignedRow = -1;
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const hasOverlap = rows[rowIdx]!.some(range =>
                !(end <= range.start || start >= range.end)
            );
            if (!hasOverlap) {
                assignedRow = rowIdx;
                rows[rowIdx]!.push({ start, end });
                break;
            }
        }

        if (assignedRow === -1) {
            assignedRow = rows.length;
            rows.push([{ start, end }]);
        }

        rowAssignments.set(subtask.id, assignedRow);
    }

    return rowAssignments;
}

function calculateMixedLayoutHeight(
    task: TaskLike,
    config: LayoutConfig,
    taskMap: TaskMap | null | undefined
): number {
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

    const rowAssignments = computeSubtaskRows(children, taskMap);
    const maxRow = Math.max(0, ...rowAssignments.values());

    const rowCount = maxRow + 1;
    const verticalPadding = (barHeight - subtaskBarHeight) / 2;
    return verticalPadding * 2 + rowCount * subtaskBarHeight + (rowCount - 1) * subtaskPadding;
}

export function findRowAtY(sortedRows: RowLayout[], targetY: number): number {
    if (sortedRows.length === 0) return -1;
    if (targetY < 0) return 0;

    let left = 0;
    let right = sortedRows.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const row = sortedRows[mid]!;

        if (targetY >= row.y && targetY < row.y + row.height) {
            return mid;
        }

        if (targetY < row.y) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    return Math.min(left, sortedRows.length - 1);
}

export function rowLayoutsToSortedArray(rowLayouts: Map<string, RowLayout>): (RowLayout & { id: string })[] {
    const result: (RowLayout & { id: string })[] = [];
    for (const [id, layout] of rowLayouts) {
        if (id === '__total__') continue;
        result.push({ id, ...layout });
    }
    result.sort((a, b) => a.y - b.y);
    return result;
}

export function getVisibleRowRange(
    sortedRows: RowLayout[],
    scrollY: number,
    viewportHeight: number,
    overscan = 2
): { startIndex: number; endIndex: number } {
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

export function computeSubtaskY(
    subtaskIndex: number,
    parentContentY: number,
    layout: 'sequential' | 'parallel' | 'mixed',
    config: LayoutConfig,
    subtaskRow = 0
): number {
    const {
        barHeight = 30,
        padding = 18,
        subtaskHeightRatio = 0.5,
    } = config;

    const subtaskBarHeight = barHeight * subtaskHeightRatio;
    const subtaskPadding = padding * 0.4;
    const subtaskRowHeight = subtaskBarHeight + subtaskPadding;

    if (layout === 'sequential') {
        return parentContentY;
    }

    if (layout === 'mixed') {
        return parentContentY + padding / 2 + subtaskRow * subtaskRowHeight;
    }

    return parentContentY + padding / 2 + subtaskIndex * subtaskRowHeight;
}

export function calculateSimpleRowLayouts(
    displayRows: DisplayRow[],
    config: LayoutConfig
): Map<string, RowLayout> {
    const { barHeight = 30, padding = 18 } = config;
    const rowHeight = barHeight + padding;
    const layouts = new Map<string, RowLayout>();

    for (let i = 0; i < displayRows.length; i++) {
        const row = displayRows[i]!;
        const y = i * rowHeight;

        layouts.set(row.id, {
            y,
            height: rowHeight,
            contentY: y + padding / 2,
            contentHeight: barHeight,
            type: row.type,
        });
    }

    layouts.set('__total__', { y: 0, height: displayRows.length * rowHeight });

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
