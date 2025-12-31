import date_utils from './date_utils';
import type { TimeScale } from './date_utils';
import type { BarPosition } from '../types';

/**
 * Pure functions for bar geometry calculations.
 * No side effects - just compute values from inputs.
 */

/**
 * Compute bar X position from task start date.
 */
export function computeX(
    taskStart: Date,
    ganttStart: Date,
    unit: TimeScale | string,
    step: number,
    columnWidth: number
): number {
    const diff = date_utils.diff(taskStart, ganttStart, unit) / step;
    // Use exact position, no rounding - rounding causes adjacent tasks to overlap
    return diff * columnWidth;
}

/**
 * Compute bar Y position from task index.
 * Y position is relative to SVG content area (no header offset).
 * Bar is vertically centered within its row.
 * Row height = barHeight + padding, rows start at y=0.
 */
export function computeY(taskIndex: number, barHeight: number, padding: number): number {
    // Row starts at taskIndex * rowHeight (where rowHeight = barHeight + padding)
    // Bar is centered within row, so add padding/2 offset from row start
    const rowHeight = barHeight + padding;
    return taskIndex * rowHeight + padding / 2;
}

/**
 * Compute bar width from task duration.
 */
export function computeWidth(
    taskStart: Date,
    taskEnd: Date,
    unit: TimeScale | string,
    step: number,
    columnWidth: number
): number {
    const diff = date_utils.diff(taskEnd, taskStart, unit) / step;
    // Use exact width, no rounding - rounding causes adjacent tasks to overlap
    return diff * columnWidth;
}

interface DurationResult {
    totalDays: number;
    actualDays: number;
    ignoredDays: number;
}

/**
 * Compute actual duration (excluding ignored dates).
 */
export function computeDuration(
    taskStart: Date,
    taskEnd: Date,
    ignoredDates: Date[] = [],
    ignoredFunction: ((date: Date) => boolean) | null = null,
): DurationResult {
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
 */
export function daysToUnits(days: number, unit: TimeScale, step: number): number {
    const durationStr = days + 'd';
    return date_utils.convert_scales(durationStr, unit) / step;
}

/**
 * Compute progress bar width accounting for ignored positions.
 */
export function computeProgressWidth(
    barX: number,
    barWidth: number,
    progress: number,
    ignoredPositions: number[] = [],
    columnWidth = 45,
): number {
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
 */
export function computeExpectedProgress(
    taskStart: Date,
    taskEnd: Date,
    unit: TimeScale | string,
    step: number
): number {
    const today = date_utils.today();
    const totalDuration = date_utils.diff(taskEnd, taskStart, 'hour') / step;
    const elapsed = date_utils.diff(today, taskStart, 'hour') / step;

    // Clamp to 0-100%
    const progress = Math.min(elapsed, totalDuration);
    return totalDuration > 0 ? (progress * 100) / totalDuration : 0;
}

/**
 * Check if a position falls within an ignored region.
 */
export function isIgnoredPosition(
    x: number,
    ignoredPositions: number[],
    columnWidth: number
): boolean {
    return ignoredPositions.some((pos) => x >= pos && x < pos + columnWidth);
}

/**
 * Snap position to grid.
 */
export function snapToGrid(
    x: number,
    columnWidth: number,
    ignoredPositions: number[] = []
): number {
    // Snap to nearest column
    let snapped = Math.round(x / columnWidth) * columnWidth;

    // If snapped to ignored position, move to next valid
    while (isIgnoredPosition(snapped, ignoredPositions, columnWidth)) {
        snapped += columnWidth;
    }

    return snapped;
}

interface LabelPosition {
    x: number;
    position: 'inside' | 'outside';
}

/**
 * Compute label position (inside or outside bar based on width).
 */
export function computeLabelPosition(
    barX: number,
    barWidth: number,
    labelText: string,
    charWidth = 7
): LabelPosition {
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
 */
export function calculateDistance(
    predBar: { x: number; width: number },
    succBar: { x: number }
): number {
    const predRightEdge = predBar.x + predBar.width;
    return succBar.x - predRightEdge;
}

interface TaskWithChildren {
    _children?: string[];
    type?: string;
    _depth?: number;
    _bar?: BarPosition;
    subtaskLayout?: 'sequential' | 'parallel' | 'mixed';
}

type TaskMap = Map<string, TaskWithChildren> | Record<string, TaskWithChildren>;

function getTaskFromMap(taskMap: TaskMap, id: string): TaskWithChildren | undefined {
    if (taskMap instanceof Map) {
        return taskMap.get(id);
    }
    return taskMap[id];
}

interface SummaryBounds {
    x: number;
    width: number;
}

/**
 * Compute summary bar bounds from its children's positions.
 * Summary bar spans from earliest child start to latest child end.
 */
export function computeSummaryBounds(
    summaryTask: TaskWithChildren,
    taskMap: TaskMap,
    minWidth = 20
): SummaryBounds | null {
    if (!summaryTask._children || summaryTask._children.length === 0) {
        return null;
    }

    // Collect all descendant bars (recursive) for accurate span calculation
    const descendantBars: BarPosition[] = [];
    const collectBars = (childIds: string[]): void => {
        for (const childId of childIds) {
            const child = getTaskFromMap(taskMap, childId);
            if (!child?._bar) continue;

            // Include this child's bar
            descendantBars.push(child._bar);

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
 */
export function recomputeAllSummaryBounds(taskMap: Map<string, TaskWithChildren>): void {
    // Find max depth
    let maxDepth = 0;
    for (const task of taskMap.values()) {
        if (task._depth !== undefined && task._depth > maxDepth) {
            maxDepth = task._depth;
        }
    }

    // Process from deepest to shallowest
    for (let depth = maxDepth; depth >= 0; depth--) {
        for (const task of taskMap.values()) {
            if (task._depth === depth && task.type === 'summary') {
                const bounds = computeSummaryBounds(task, taskMap);
                if (bounds && task._bar) {
                    task._bar.x = bounds.x;
                    task._bar.width = bounds.width;
                }
            }
        }
    }
}

interface RowLayout {
    y: number;
    height: number;
    contentY?: number;
    contentHeight?: number;
}

/**
 * Compute bar Y position from variable row layouts.
 * Used when rows have different heights (e.g., expanded subtask containers).
 */
export function computeVariableY(
    rowId: string,
    rowLayouts: Map<string, RowLayout> | null | undefined,
    fallbackY = 0
): number {
    const layout = rowLayouts?.get(rowId);
    if (layout && layout.contentY !== undefined) {
        return layout.contentY;
    }
    return fallbackY;
}

/**
 * Compute subtask bar height based on ratio.
 */
export function computeSubtaskBarHeight(barHeight: number, ratio = 0.5): number {
    return barHeight * ratio;
}

interface ExpandedRowConfig {
    barHeight?: number;
    padding?: number;
    subtaskHeightRatio?: number;
}

interface TaskWithSubtasks extends TaskWithChildren {
    row?: number;
}

/**
 * Compute row height based on expansion state.
 * Used for determining container height when task is expanded.
 */
export function computeExpandedRowHeight(
    task: TaskWithSubtasks,
    isExpanded: boolean,
    config: ExpandedRowConfig
): number {
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
        // Mixed layout: assume all children fit in available rows
        // For proper mixed layout, would need task map to look up child row assignments
        // For now, use same calculation as sequential
        return padding + task._children.length * subtaskRowHeight + padding / 2;
    }

    // Sequential
    return padding + task._children.length * subtaskRowHeight + padding / 2;
}
