import { createSignal, createMemo, onMount, onCleanup, Index, For, Show } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import calendarData from '../data/calendar.json';
import constraintTestData from '../data/constraint-test.json';
import date_utils from '../utils/date_utils.js';
import { useGanttEvents, GanttEventsProvider } from '../contexts/GanttEvents.jsx';
import { useDrag } from '../hooks/useDrag.js';
import { Grid } from './Grid.jsx';
import { DateHeaders } from './DateHeaders.jsx';
import { DateHeadersOptimized } from './DateHeadersOptimized.jsx';
import { ResourceColumn } from './ResourceColumn.jsx';
import { ArrowLayerBatched } from './ArrowLayerBatched.jsx';
import { TaskDataPopup } from './TaskDataPopup.jsx';
import { TaskDataModal } from './TaskDataModal.jsx';
import {
    isMovementLocked,
    isLeftResizeLocked,
    isRightResizeLocked,
    getMinXFromAbsolute,
    getMaxXFromAbsolute,
    getMaxEndFromAbsolute,
    getMinWidth,
} from '../utils/absoluteConstraints.js';
// Note: constraintResolver.js still has utilities but we use simple inline helpers now

// ═══════════════════════════════════════════════════════════════════════════
// SIMPLE REACTIVE CONSTRAINT HELPERS
// Read from getBarPosition(), write via updateBarPosition(), let reactivity propagate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse dependency min/max offset values.
 * - min=0, max=undefined (default): Elastic - push only, gap can grow indefinitely
 * - min=0, max=0: Fixed gap - push AND pull to maintain exact lag
 * - min=0, max=N: Bounded - push always, pull only if gap > lag+max
 *
 * JSON uses null for Infinity since JSON doesn't support Infinity.
 */
function getDepOffsets(rel, pixelsPerHour) {
    const lag = (rel.lag ?? 0) * pixelsPerHour;
    const min = (rel.min ?? 0) * pixelsPerHour;
    // Default is elastic (push only): max=undefined or max=null → Infinity
    // Explicit max=0 means fixed gap (push+pull)
    // Explicit max=N means bounded (push, pull only when gap > N)
    const maxVal = rel.max;
    const max = (maxVal === undefined || maxVal === null) ? Infinity : maxVal * pixelsPerHour;

    return {
        lag,
        min,
        max,
        minGap: lag + min,  // Minimum allowed gap
        maxGap: lag + max,  // Maximum allowed gap (Infinity for elastic)
        isElastic: max === Infinity,  // Can gap grow indefinitely?
        isFixed: max === min,  // Must gap be exact?
    };
}

/**
 * Get minimum X this task can be at based on predecessor constraints.
 * Uses getBarPosition() to always get correct values.
 */
function getMinXFromPredecessors(taskId, relationships, getBarPosition, pixelsPerHour, taskWidth = 0) {
    let minX = 0;
    for (const rel of relationships) {
        if (rel.to !== taskId) continue;

        const predBar = getBarPosition(rel.from);
        if (!predBar) continue;

        const type = rel.type || 'FS';
        const lag = (rel.lag ?? 0) * pixelsPerHour;

        let constraint;
        switch (type) {
            case 'FS':
                constraint = predBar.x + predBar.width + lag;
                break;
            case 'SS':
                constraint = predBar.x + lag;
                break;
            case 'FF':
                // Finish-to-Finish: successor end >= predecessor end + lag
                // So successor.x >= predecessor.x + predecessor.width - successor.width + lag
                constraint = predBar.x + predBar.width - taskWidth + lag;
                break;
            case 'SF':
                // Start-to-Finish: successor end >= predecessor start + lag
                // So successor.x >= predecessor.x - successor.width + lag
                constraint = predBar.x - taskWidth + lag;
                break;
            default:
                constraint = predBar.x + predBar.width + lag;
        }
        minX = Math.max(minX, constraint);
    }
    return minX;
}

/**
 * Get maximum end position (x + width) this task can have based on downstream constraints.
 * RECURSIVELY checks all successors, not just direct ones.
 *
 * For unlocked successors: we can push them, but only up to their own downstream limit.
 * For locked successors: we cannot push at all, this is a hard constraint.
 */
function getMaxEndFromDownstream(taskId, relationships, getBarPosition, getTask, pixelsPerHour, visited = new Set()) {
    // Prevent infinite loops in circular dependencies
    if (visited.has(taskId)) return Infinity;
    visited.add(taskId);

    let maxEnd = Infinity;

    for (const rel of relationships) {
        if (rel.from !== taskId) continue;

        const succTask = getTask?.(rel.to);
        const succBar = getBarPosition(rel.to);
        if (!succBar) continue;

        const { minGap } = getDepOffsets(rel, pixelsPerHour);
        const type = rel.type || 'FS';
        const isLocked = isMovementLocked(succTask?.constraints?.locked);

        // Calculate constraint based on dependency type
        let constraint;
        switch (type) {
            case 'FS':
                // predecessor.end + minGap <= successor.start
                // => predecessor.end <= successor.start - minGap
                constraint = succBar.x - minGap;
                break;
            case 'FF':
                // predecessor.end <= successor.end - minGap
                constraint = succBar.x + succBar.width - minGap;
                break;
            case 'SS':
            case 'SF':
                // These constrain predecessor start, not end - skip
                continue;
            default:
                constraint = succBar.x - minGap;
        }

        if (isLocked) {
            // Locked successor: hard constraint, cannot push past
            maxEnd = Math.min(maxEnd, constraint);
        } else {
            // Unlocked successor: we can push them, but only so far
            // Recursively find their downstream limit
            const succMaxEnd = getMaxEndFromDownstream(rel.to, relationships, getBarPosition, getTask, pixelsPerHour, visited);

            // We can push successor up to: (succMaxEnd - succBar.width) for their new X
            // So our end can go to: newSuccX - minGap = succMaxEnd - succBar.width - minGap... no wait
            // Actually: if we push successor to position X', their end is X' + width
            // Their end must be <= succMaxEnd, so X' <= succMaxEnd - width
            // Our end + minGap <= X', so our end <= X' - minGap <= succMaxEnd - width - minGap
            // Hmm, this isn't quite right. Let me think again.
            //
            // For FS: our.end + minGap <= succ.start (succ.x)
            // If we push succ, succ.x' = our.end + minGap
            // Succ's end = succ.x' + succ.width = our.end + minGap + succ.width
            // Succ's end must be <= succMaxEnd
            // => our.end + minGap + succ.width <= succMaxEnd
            // => our.end <= succMaxEnd - minGap - succ.width

            // Actually simpler: how far can successor's START go?
            // Successor's end must be <= their downstream max, so:
            // succ.x + succ.width <= succMaxEnd
            // succ.x <= succMaxEnd - succ.width
            // And our.end + minGap <= succ.x
            // => our.end <= succ.x - minGap <= succMaxEnd - succ.width - minGap

            const succMaxX = succMaxEnd - succBar.width;  // Max start position for successor
            const ourMaxEnd = succMaxX - minGap;
            maxEnd = Math.min(maxEnd, ourMaxEnd);
        }
    }

    return maxEnd;
}

// Legacy alias for compatibility - now uses recursive version
function getMaxEndFromLockedSuccessors(taskId, relationships, getBarPosition, getTask, pixelsPerHour) {
    return getMaxEndFromDownstream(taskId, relationships, getBarPosition, getTask, pixelsPerHour, new Set());
}

/**
 * Get maximum start position this task can have based on LOCKED successor constraints.
 * For SS and SF types where the successor's position depends on predecessor's start.
 */
function getMaxXFromLockedSuccessors(taskId, relationships, getBarPosition, getTask, pixelsPerHour) {
    let maxX = Infinity;
    for (const rel of relationships) {
        if (rel.from !== taskId) continue;

        const succTask = getTask?.(rel.to);
        const isLocked = succTask?.constraints?.locked || succTask?.locked;
        if (!isLocked) continue;

        const succBar = getBarPosition(rel.to);
        if (!succBar) continue;

        const type = rel.type || 'FS';
        const lag = (rel.lag ?? 0) * pixelsPerHour;

        let constraint;
        switch (type) {
            case 'SS':
                // predecessor.start <= successor.start - lag
                constraint = succBar.x - lag;
                break;
            case 'SF':
                // predecessor.start <= successor.end - lag
                constraint = succBar.x + succBar.width - lag;
                break;
            default:
                continue;  // FS and FF don't constrain start position
        }
        maxX = Math.min(maxX, constraint);
    }
    return maxX;
}

/**
 * Recursively push/pull successors based on min/max offset constraints.
 * Updates store directly - SolidJS reactivity propagates changes to Bar components.
 *
 * Push when: currentGap < minGap (successor is too close)
 * Pull when: currentGap > maxGap AND maxGap !== Infinity (gap exceeded max)
 *
 * Locked tasks block the cascade chain.
 */
function pushSuccessorsIfNeeded(taskId, relationships, getBarPosition, updateBarPosition, pixelsPerHour, getTask, ganttStartDate, visited = new Set()) {
    // Prevent infinite loops in case of circular dependencies
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const taskBar = getBarPosition(taskId);
    if (!taskBar) return;

    for (const rel of relationships) {
        if (rel.from !== taskId) continue;

        const succTask = getTask?.(rel.to);
        const succBar = getBarPosition(rel.to);
        if (!succBar) continue;

        // Locked tasks cannot be pushed - they block the chain
        const isLocked = isMovementLocked(succTask?.constraints?.locked);
        if (isLocked) continue;

        const type = rel.type || 'FS';
        const { minGap, maxGap, isElastic } = getDepOffsets(rel, pixelsPerHour);

        // Calculate anchor position based on dependency type
        let anchorPos;  // The reference point on predecessor
        let succRef;    // The reference point on successor (start or end)
        let constrainsEnd = false;  // Does this dep type constrain successor's end?

        switch (type) {
            case 'FS':
                anchorPos = taskBar.x + taskBar.width;  // Pred end
                succRef = succBar.x;  // Succ start
                break;
            case 'SS':
                anchorPos = taskBar.x;  // Pred start
                succRef = succBar.x;  // Succ start
                break;
            case 'FF':
                anchorPos = taskBar.x + taskBar.width;  // Pred end
                succRef = succBar.x + succBar.width;  // Succ end
                constrainsEnd = true;
                break;
            case 'SF':
                anchorPos = taskBar.x;  // Pred start
                succRef = succBar.x + succBar.width;  // Succ end
                constrainsEnd = true;
                break;
            default:
                anchorPos = taskBar.x + taskBar.width;
                succRef = succBar.x;
        }

        // Current gap between anchor and successor reference point
        const currentGap = succRef - anchorPos;

        // Check if push or pull is needed
        const needsPush = currentGap < minGap;  // Gap too small
        const needsPull = !isElastic && currentGap > maxGap;  // Gap too large (and not elastic)

        if (needsPush || needsPull) {
            // Calculate target position for successor
            const targetGap = needsPush ? minGap : maxGap;
            const targetRef = anchorPos + targetGap;

            // Convert target reference point to target X position
            let targetX;
            if (constrainsEnd) {
                // For FF/SF: targetRef is the successor's END position
                targetX = targetRef - succBar.width;
            } else {
                // For FS/SS: targetRef is the successor's START position
                targetX = targetRef;
            }

            // Apply successor's absolute constraints
            const absMinX = getMinXFromAbsolute(succTask?.constraints, ganttStartDate, pixelsPerHour);
            const absMaxX = getMaxXFromAbsolute(succTask?.constraints, ganttStartDate, pixelsPerHour);
            targetX = Math.max(absMinX, Math.min(targetX, absMaxX));

            // Only update if position actually changes
            if (Math.abs(targetX - succBar.x) > 0.5) {  // Small epsilon to avoid floating point issues
                updateBarPosition(rel.to, { x: targetX });

                // Recursively cascade to this successor's successors
                pushSuccessorsIfNeeded(rel.to, relationships, getBarPosition, updateBarPosition, pixelsPerHour, getTask, ganttStartDate, visited);
            }
        }
    }
}

/**
 * GanttPerfIsolate - Stripped down to find the 6x overhead
 *
 * Start minimal, add things back until perf degrades.
 * Toggle features via URL params: ?bar=minimal&virt=2D
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS - Same as GanttExperiments
// ═══════════════════════════════════════════════════════════════════════════

const ROW_HEIGHT = 24;
const BAR_HEIGHT = 26;
const GAP = 4;
const DAYS_VISIBLE = 3;  // Fewer days = wider/longer tasks
const OVERSCAN_ROWS = 2;
const OVERSCAN_PX = 200;

// Select data source based on URL param: ?data=constraint
const urlParams = new URLSearchParams(window.location.search);
const dataSource = urlParams.get('data') || 'calendar';
const sourceData = dataSource === 'constraint' ? constraintTestData : calendarData;

// Parse tasks and compute TIME-based positions (hours from start)
const parsedTasks = sourceData.tasks.map(task => ({
    ...task,
    _start: date_utils.parse(task.start),
    _end: date_utils.parse(task.end),
}));
const ganttStart = new Date(Math.min(...parsedTasks.map(t => t._start.getTime())));
const ganttStartMs = ganttStart.getTime();

// Get unique resources - preserve generator order (A, B, C, ..., Z, AA, AB, ...)
// DO NOT sort alphabetically - that breaks row distance calculations
const seenResources = new Set();
const uniqueResources = [];
for (const t of sourceData.tasks) {
    if (!seenResources.has(t.resource)) {
        seenResources.add(t.resource);
        uniqueResources.push(t.resource);
    }
}
const resourceToRow = Object.fromEntries(uniqueResources.map((r, i) => [r, i]));
const TOTAL_ROWS = uniqueResources.length;

// Timeline dimensions in HOURS (not pixels - scale at render time)
const maxEndTime = Math.max(...parsedTasks.map(t => t._end.getTime()));
const TOTAL_HOURS = (maxEndTime - ganttStartMs) / (1000 * 60 * 60);
const TOTAL_DAYS = Math.ceil(TOTAL_HOURS / 24) + 1;
const TOTAL_HEIGHT = TOTAL_ROWS * (ROW_HEIGHT + GAP);

// Build tasks with HOUR-based positions (pixels computed at render time)
// Default hour width for initial $bar positions (will be recalculated on viewport resize)
const DEFAULT_HOUR_WIDTH = (1200 - 120) / DAYS_VISIBLE / 24; // ~6.4px per hour

const initialTasks = (() => {
    const result = {};
    parsedTasks.forEach((task, i) => {
        const row = resourceToRow[task.resource] ?? 0;
        const startHours = (task._start.getTime() - ganttStartMs) / (1000 * 60 * 60);
        const endHours = (task._end.getTime() - ganttStartMs) / (1000 * 60 * 60);
        const durationHours = endHours - startHours;
        result[task.id] = {
            ...task,
            locked: i % 7 === 0,
            progress: task.progress || 0,
            row,
            startHours,  // Store hours, not pixels
            durationHours,
            $bar: {
                x: startHours * DEFAULT_HOUR_WIDTH,
                y: row * (ROW_HEIGHT + GAP) + (ROW_HEIGHT + GAP - BAR_HEIGHT) / 2,
                width: durationHours * DEFAULT_HOUR_WIDTH,
                height: BAR_HEIGHT,
            },
        };
    });
    return result;
})();

// Pre-index tasks by row
const taskIdsByRow = (() => {
    const byRow = {};
    for (let r = 0; r < TOTAL_ROWS; r++) byRow[r] = [];
    Object.entries(initialTasks).forEach(([id, task]) => {
        byRow[task.row].push(id);
    });
    return byRow;
})();

// 2D spatial index: taskIds2D[row][dayBucket] = [taskIds...]
// Indexed by DAY (not pixels) so works regardless of scale
const taskIds2D = (() => {
    const index = {};
    Object.entries(initialTasks).forEach(([id, task]) => {
        const row = task.row;
        const startDay = Math.floor(task.startHours / 24);
        const endDay = Math.floor((task.startHours + task.durationHours) / 24);
        if (!index[row]) index[row] = {};
        for (let d = startDay; d <= endDay; d++) {
            (index[row][d] = index[row][d] || []).push(id);
        }
    });
    return index;
})();

// Parse dependencies from source data with min/max offset values
const relationships = (() => {
    const rels = [];
    for (const task of sourceData.tasks) {
        if (!task.dependencies) continue;
        // Handle string dep (FS) or object dep ({id, type, lag, min, max})
        const dep = task.dependencies;
        const isObj = typeof dep === 'object';
        const depId = isObj ? dep.id : dep;
        const depType = isObj ? (dep.type || 'FS') : 'FS';
        const lag = isObj ? (dep.lag || 0) : 0;
        const min = isObj ? (dep.min ?? 0) : 0;
        const max = isObj ? dep.max : undefined;  // undefined/null = elastic (default), 0 = fixed, N = bounded

        // Determine line style based on min/max
        // Elastic (max=undefined or max=null, the default): dotted line
        // Fixed (max=0): solid line
        // Bounded (max > 0): dashed line
        let strokeDasharray = '';
        let stroke;
        if (max === undefined || max === null) {
            // Default elastic - no special styling, use default arrow color
            // Only show special styling for explicit elastic deps
        } else if (max === 0) {
            // Fixed gap (push+pull) - solid line, slight color hint
            stroke = '#f472b6';  // Pink for fixed
        } else if (max > 0) {
            strokeDasharray = '6,3';  // Dashed for bounded
            stroke = '#fbbf24';  // Amber for bounded
        }

        rels.push({
            from: depId,
            to: task.id,
            type: depType,
            lag,
            min,
            max,
            strokeDasharray,
            stroke,
        });
    }
    return rels;
})();

console.log(`PerfIsolate [${dataSource}]: ${Object.keys(initialTasks).length} tasks, ${TOTAL_ROWS} rows, ${TOTAL_DAYS} days, ${relationships.length} deps`);

// ═══════════════════════════════════════════════════════════════════════════
// BAR VARIANTS - Toggle to find overhead
// ═══════════════════════════════════════════════════════════════════════════

// V1: Absolutely minimal - just a div with inline position
function BarMinimal(props) {
    const task = props.task;
    const bar = task.$bar;
    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${bar.x}px, ${bar.y}px)`,
            width: `${bar.width}px`,
            height: `${bar.height}px`,
            background: task.color,
            'border-radius': '3px',
        }} />
    );
}

// V2: Add text
function BarWithText(props) {
    const task = props.task;
    const bar = task.$bar;
    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${bar.x}px, ${bar.y}px)`,
            width: `${bar.width}px`,
            height: `${bar.height}px`,
            background: task.color,
            'border-radius': '3px',
            color: '#fff',
            'font-size': '11px',
            'line-height': `${bar.height}px`,
            'padding-left': '4px',
            overflow: 'hidden',
        }}>
            {task.name}
        </div>
    );
}

// V3: Add resize handles (like GanttExperiments)
function BarWithHandles(props) {
    const task = props.task;
    const bar = task.$bar;
    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${bar.x}px, ${bar.y}px)`,
            width: `${bar.width}px`,
            height: `${bar.height}px`,
            background: task.color,
            'border-radius': '3px',
            color: '#fff',
            'font-size': '11px',
            'line-height': `${bar.height}px`,
            'padding-left': '4px',
            overflow: 'hidden',
        }}>
            {task.name}
            <div style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

// V4: Reactive getters (like GanttExperiments TestBarBaseline2)
function BarReactive(props) {
    const t = () => props.task;
    const bar = () => t().$bar;
    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${bar().x}px, ${bar().y}px)`,
            width: `${bar().width}px`,
            height: `${bar().height}px`,
            background: t().color,
            'border-radius': '3px',
            color: '#fff',
            'font-size': '11px',
            'line-height': `${bar().height}px`,
            'padding-left': '4px',
            overflow: 'hidden',
        }}>
            {t().name}
            <div style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

// V5: With useDrag hook
function BarWithDrag(props) {
    const t = () => props.task;
    const bar = () => t().$bar;
    const { isDragging, startDrag } = useDrag({
        onDragStart: () => {},
        onDragMove: () => {},
        onDragEnd: () => {},
    });
    return (
        <div
            onMouseDown={(e) => startDrag(e, 'dragging_bar', { taskId: t().id })}
            style={{
                position: 'absolute',
                transform: `translate(${bar().x}px, ${bar().y}px)`,
                width: `${bar().width}px`,
                height: `${bar().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: t().color,
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${bar().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
            }}>
            {t().name}
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_left', { taskId: t().id }); }} style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_right', { taskId: t().id }); }} style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

// V6: With context events (hover, click)
function BarWithEvents(props) {
    const events = useGanttEvents();
    const t = () => props.task;
    const bar = () => t().$bar;
    const { isDragging, startDrag } = useDrag({
        onDragStart: () => {},
        onDragMove: () => {},
        onDragEnd: () => {},
    });
    return (
        <div
            onMouseEnter={(e) => events.onHover?.(t().id, e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(t().id, e)}
            onMouseDown={(e) => startDrag(e, 'dragging_bar', { taskId: t().id })}
            style={{
                position: 'absolute',
                transform: `translate(${bar().x}px, ${bar().y}px)`,
                width: `${bar().width}px`,
                height: `${bar().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: t().color,
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${bar().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
            }}>
            {t().name}
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_left', { taskId: t().id }); }} style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_right', { taskId: t().id }); }} style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

// V7: Full - with progress gradient (matches Experiments baseline)
function BarFull(props) {
    const events = useGanttEvents();
    const t = () => props.task;
    const bar = () => t().$bar;
    const progress = () => t().progress ?? 0;
    const pw = () => (bar().width * progress()) / 100;

    const bg = () => {
        const color = t().color || '#3b82f6';
        const p = pw();
        return `linear-gradient(to right, ${color}80 0px, ${color}80 ${p}px, ${color}40 ${p}px, ${color}40 100%)`;
    };

    const { isDragging, startDrag } = useDrag({
        onDragStart: () => {},
        onDragMove: () => {},
        onDragEnd: () => {},
    });

    return (
        <div
            onMouseEnter={(e) => events.onHover?.(t().id, e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(t().id, e)}
            onMouseDown={(e) => startDrag(e, 'dragging_bar', { taskId: t().id })}
            style={{
                position: 'absolute',
                transform: `translate(${bar().x}px, ${bar().y}px)`,
                width: `${bar().width}px`,
                height: `${bar().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${bar().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
            }}>
            {t().name}
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_left', { taskId: t().id }); }} style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_right', { taskId: t().id }); }} style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

// V8: Exact copy of GanttExperiments TestBarBaseline
function BarExperiments(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const width = bar?.width ?? 40;
        return {
            colorBg: task?.color_bg ?? 'rgba(59,130,246,0.15)',
            colorFill: task?.color_fill ?? 'rgba(59,130,246,0.3)',
            locked: task?.locked ?? false,
            name: task?.name ?? '',
            id: task?.id ?? '',
            x: bar?.x ?? 0,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
            pw: (width * progress) / 100,
        };
    });

    const bg = () => {
        const data = t();
        const pw = data.pw;
        return `linear-gradient(to right, ${data.colorFill} 0px, ${data.colorFill} ${pw}px, ${data.colorBg} ${pw}px, ${data.colorBg} 100%)${data.locked ? ', repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : ''}`;
    };

    const { isDragging, startDrag } = useDrag({ onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {} });

    return (
        <div
            onMouseEnter={(e) => events.onHover?.(t().id, e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(t().id, e)}
            onMouseDown={(e) => startDrag(e, 'dragging_bar', { taskId: t().id })}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {t().name}
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_left', { taskId: t().id }); }} style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_right', { taskId: t().id }); }} style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

// V9: No child divs - detect resize zones from click position
function BarNoChildren(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const hw = props.hourWidth || 7;  // fallback
        const x = (task?.startHours ?? 0) * hw;
        const width = Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            colorBg: 'rgba(128,128,128,0.15)',
            colorFill: 'rgba(128,128,128,0.4)',
            locked: task?.locked ?? false,
            name: task?.name ?? '',
            id: task?.id ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
            pw: (width * progress) / 100,
        };
    });

    const bg = () => {
        const data = t();
        const pw = data.pw;
        return `linear-gradient(to right, ${data.colorFill} 0px, ${data.colorFill} ${pw}px, ${data.colorBg} ${pw}px, ${data.colorBg} 100%)${data.locked ? ', repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : ''}`;
    };

    const { isDragging, startDrag } = useDrag({ onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {} });

    const handleMouseDown = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const width = rect.width;

        // 6px zones on each side for resize
        if (localX <= 6) {
            startDrag(e, 'dragging_left', { taskId: t().id });
        } else if (localX >= width - 6) {
            startDrag(e, 'dragging_right', { taskId: t().id });
        } else {
            startDrag(e, 'dragging_bar', { taskId: t().id });
        }
    };

    return (
        <div
            onMouseEnter={(e) => events.onHover?.(t().id, e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(t().id, e)}
            onMouseDown={handleMouseDown}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {t().name}
        </div>
    );
}

// V10: NoChildren + CSS containment
function BarContained(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const hw = props.hourWidth || 7;
        const x = (task?.startHours ?? 0) * hw;
        const width = Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            colorBg: task?.color_bg ?? 'rgba(59,130,246,0.15)',
            colorFill: task?.color_fill ?? 'rgba(59,130,246,0.3)',
            locked: task?.locked ?? false,
            name: task?.name ?? '',
            id: task?.id ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
            pw: (width * progress) / 100,
        };
    });

    const bg = () => {
        const data = t();
        const pw = data.pw;
        return `linear-gradient(to right, ${data.colorFill} 0px, ${data.colorFill} ${pw}px, ${data.colorBg} ${pw}px, ${data.colorBg} 100%)${data.locked ? ', repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : ''}`;
    };

    const { isDragging, startDrag } = useDrag({ onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {} });

    const handleMouseDown = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const width = rect.width;
        if (localX <= 6) {
            startDrag(e, 'dragging_left', { taskId: t().id });
        } else if (localX >= width - 6) {
            startDrag(e, 'dragging_right', { taskId: t().id });
        } else {
            startDrag(e, 'dragging_bar', { taskId: t().id });
        }
    };

    return (
        <div
            onMouseEnter={(e) => events.onHover?.(t().id, e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(t().id, e)}
            onMouseDown={handleMouseDown}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
                contain: 'layout style paint',
            }}>
            {t().name}
        </div>
    );
}

// V11: NoChildren + will-change: transform
function BarWillChange(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const hw = props.hourWidth || 7;
        const x = (task?.startHours ?? 0) * hw;
        const width = Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            colorBg: task?.color_bg ?? 'rgba(59,130,246,0.15)',
            colorFill: task?.color_fill ?? 'rgba(59,130,246,0.3)',
            locked: task?.locked ?? false,
            name: task?.name ?? '',
            id: task?.id ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
            pw: (width * progress) / 100,
        };
    });

    const bg = () => {
        const data = t();
        const pw = data.pw;
        return `linear-gradient(to right, ${data.colorFill} 0px, ${data.colorFill} ${pw}px, ${data.colorBg} ${pw}px, ${data.colorBg} 100%)${data.locked ? ', repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : ''}`;
    };

    const { isDragging, startDrag } = useDrag({ onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {} });

    const handleMouseDown = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const width = rect.width;
        if (localX <= 6) {
            startDrag(e, 'dragging_left', { taskId: t().id });
        } else if (localX >= width - 6) {
            startDrag(e, 'dragging_right', { taskId: t().id });
        } else {
            startDrag(e, 'dragging_bar', { taskId: t().id });
        }
    };

    return (
        <div
            onMouseEnter={(e) => events.onHover?.(t().id, e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(t().id, e)}
            onMouseDown={handleMouseDown}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
                'will-change': 'transform',
            }}>
            {t().name}
        </div>
    );
}

// V12: NoChildren + will-change + contain (combined)
function BarCombined(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const hw = props.hourWidth || 7;
        const x = (task?.startHours ?? 0) * hw;
        const width = Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            colorBg: task?.color_bg ?? 'rgba(59,130,246,0.15)',
            colorFill: task?.color_fill ?? 'rgba(59,130,246,0.3)',
            locked: task?.locked ?? false,
            name: task?.name ?? '',
            id: task?.id ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
            pw: (width * progress) / 100,
        };
    });

    const bg = () => {
        const data = t();
        const pw = data.pw;
        return `linear-gradient(to right, ${data.colorFill} 0px, ${data.colorFill} ${pw}px, ${data.colorBg} ${pw}px, ${data.colorBg} 100%)${data.locked ? ', repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : ''}`;
    };

    const { isDragging, startDrag } = useDrag({ onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {} });

    const handleMouseDown = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const width = rect.width;
        if (localX <= 6) {
            startDrag(e, 'dragging_left', { taskId: t().id });
        } else if (localX >= width - 6) {
            startDrag(e, 'dragging_right', { taskId: t().id });
        } else {
            startDrag(e, 'dragging_bar', { taskId: t().id });
        }
    };

    return (
        <div
            onMouseEnter={(e) => events.onHover?.(t().id, e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(t().id, e)}
            onMouseDown={handleMouseDown}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
                'will-change': 'transform',
                contain: 'layout style paint',
            }}>
            {t().name}
        </div>
    );
}

// V13: Hover popup - measures cost of onMouseEnter/Leave handlers
function BarHoverPopup(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const hw = props.hourWidth || 7;
        const x = (task?.startHours ?? 0) * hw;
        const width = Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            id: task?.id ?? '',
            name: task?.name ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
        };
    });

    return (
        <div
            onMouseEnter={(e) => props.setPopupState?.({ visible: true, taskId: t().id, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => props.setPopupState?.({ visible: false, taskId: null, x: 0, y: 0 })}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: 'pointer',
                background: 'rgba(128,128,128,0.3)',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {t().name}
        </div>
    );
}

// V14: Click modal - measures cost of onClick handler
function BarClickModal(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const hw = props.hourWidth || 7;
        const x = (task?.startHours ?? 0) * hw;
        const width = Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            id: task?.id ?? '',
            name: task?.name ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
        };
    });

    return (
        <div
            onClick={() => props.setModalState?.({ visible: true, taskId: t().id })}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: 'pointer',
                background: 'rgba(128,128,128,0.3)',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {t().name}
        </div>
    );
}

// V15: Baseline for drag comparison - same as dragfunc but NO handlers
function BarDragBaseline(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const hw = props.hourWidth || 7;
        const x = bar?.x ?? (task?.startHours ?? 0) * hw;
        const width = bar?.width ?? Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            id: task?.id ?? '',
            name: task?.name ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
        };
    });

    return (
        <div
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: 'default',
                background: 'rgba(59,130,246,0.3)',
                border: '1px solid rgba(59,130,246,0.6)',
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {t().name}
        </div>
    );
}

// V16: Functional drag - actually updates store positions
function BarDragFunctional(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const [hoverZone, setHoverZone] = createSignal('move'); // 'left', 'right', 'move'

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const hw = props.hourWidth || 7;
        // Use $bar.x/width if set (from drag), else compute from startHours/durationHours
        const x = bar?.x ?? (task?.startHours ?? 0) * hw;
        const width = bar?.width ?? Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            id: task?.id ?? '',
            name: task?.name ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
        };
    });

    const { isDragging, dragState, startDrag } = useDrag({
        onDragStart: (data, state) => {
            data.originalX = t().x;
            data.originalWidth = t().width;
        },

        onDragMove: (move, data, state) => {
            const hw = props.hourWidth || 7;
            const MIN_WIDTH = hw; // 1 hour minimum

            if (state === 'dragging_bar') {
                // Move bar horizontally
                const newX = data.originalX + move.deltaX;
                props.updateBarPosition?.(t().id, { x: newX });

            } else if (state === 'dragging_left') {
                // Resize from left - adjust x and width
                let newX = data.originalX + move.deltaX;
                let newWidth = data.originalWidth - move.deltaX;
                if (newWidth < MIN_WIDTH) {
                    newWidth = MIN_WIDTH;
                    newX = data.originalX + data.originalWidth - MIN_WIDTH;
                }
                props.updateBarPosition?.(t().id, { x: newX, width: newWidth });

            } else if (state === 'dragging_right') {
                // Resize from right - only adjust width
                let newWidth = Math.max(MIN_WIDTH, data.originalWidth + move.deltaX);
                props.updateBarPosition?.(t().id, { width: newWidth });
            }
        },

        onDragEnd: () => {},
    });

    const handleMouseMove = (e) => {
        if (isDragging()) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        if (localX <= 6) setHoverZone('left');
        else if (localX >= rect.width - 6) setHoverZone('right');
        else setHoverZone('move');
    };

    const handleMouseDown = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;

        // Detect resize zones (first/last 6px) vs move zone (middle)
        if (localX <= 6) {
            startDrag(e, 'dragging_left', {});
        } else if (localX >= rect.width - 6) {
            startDrag(e, 'dragging_right', {});
        } else {
            startDrag(e, 'dragging_bar', {});
        }
    };

    // Cursor based on drag state or hover zone
    const getCursor = () => {
        const state = dragState();
        if (state === 'dragging_left' || state === 'dragging_right') return 'ew-resize';
        if (state === 'dragging_bar') return 'grabbing';
        // Not dragging - use hover zone
        const zone = hoverZone();
        if (zone === 'left' || zone === 'right') return 'ew-resize';
        return 'grab';
    };

    return (
        <div
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: getCursor(),
                background: 'rgba(59,130,246,0.3)',
                border: '1px solid rgba(59,130,246,0.6)',
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {t().name}
        </div>
    );
}

// V17: Drag with constraint enforcement
function BarDragConstrained(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const [hoverZone, setHoverZone] = createSignal('move');

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const hw = props.hourWidth || 7;
        const x = bar?.x ?? (task?.startHours ?? 0) * hw;
        const width = bar?.width ?? Math.max((task?.durationHours ?? 1) * hw, 6);
        return {
            id: task?.id ?? '',
            name: task?.name ?? '',
            x,
            y: bar?.y ?? 0,
            width,
            height: bar?.height ?? BAR_HEIGHT,
        };
    });

    const { isDragging, dragState, startDrag } = useDrag({
        onDragStart: (data, state) => {
            data.originalX = t().x;
            data.originalWidth = t().width;
        },

        onDragMove: (move, data, state) => {
            const hw = props.hourWidth || 7;
            const MIN_WIDTH = hw;

            if (state === 'dragging_bar') {
                const newX = data.originalX + move.deltaX;

                // Simple reactive approach: constrain position handles everything
                // - Clamps to predecessors (can't move before them)
                // - Pushes successors if needed (cascade forward)
                if (props.onConstrainPosition) {
                    props.onConstrainPosition(t().id, newX, t().y);
                } else {
                    props.updateBarPosition?.(t().id, { x: newX });
                }

            } else if (state === 'dragging_left') {
                let newX = data.originalX + move.deltaX;
                let newWidth = data.originalWidth - move.deltaX;
                if (newWidth < MIN_WIDTH) {
                    newWidth = MIN_WIDTH;
                    newX = data.originalX + data.originalWidth - MIN_WIDTH;
                }
                if (props.onConstrainResize) {
                    props.onConstrainResize(t().id, newX, newWidth);
                } else {
                    props.updateBarPosition?.(t().id, { x: newX, width: newWidth });
                }

            } else if (state === 'dragging_right') {
                let newWidth = Math.max(MIN_WIDTH, data.originalWidth + move.deltaX);
                if (props.onConstrainResize) {
                    props.onConstrainResize(t().id, t().x, newWidth);
                } else {
                    props.updateBarPosition?.(t().id, { width: newWidth });
                }
            }
        },

        onDragEnd: () => {},
    });

    const handleMouseMove = (e) => {
        if (isDragging()) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        if (localX <= 6) setHoverZone('left');
        else if (localX >= rect.width - 6) setHoverZone('right');
        else setHoverZone('move');
    };

    const handleMouseDown = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        if (localX <= 6) startDrag(e, 'dragging_left', {});
        else if (localX >= rect.width - 6) startDrag(e, 'dragging_right', {});
        else startDrag(e, 'dragging_bar', {});
    };

    const lockState = () => getTask()?.constraints?.locked;

    const getCursor = () => {
        const lock = lockState();
        // Check if movement is locked
        if (isMovementLocked(lock)) return 'not-allowed';
        const state = dragState();
        if (state === 'dragging_left' || state === 'dragging_right') return 'ew-resize';
        if (state === 'dragging_bar') return 'grabbing';
        const zone = hoverZone();
        // Check if specific resize direction is locked
        if (zone === 'left' && isLeftResizeLocked(lock)) return 'not-allowed';
        if (zone === 'right' && isRightResizeLocked(lock)) return 'not-allowed';
        if (zone === 'left' || zone === 'right') return 'ew-resize';
        return 'grab';
    };

    const handleMouseDownLocked = (e) => {
        const lock = lockState();
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;

        // Check what type of drag this would be
        if (localX <= 6) {
            // Left resize attempt
            if (isLeftResizeLocked(lock)) return;
        } else if (localX >= rect.width - 6) {
            // Right resize attempt
            if (isRightResizeLocked(lock)) return;
        } else {
            // Move attempt
            if (isMovementLocked(lock)) return;
        }
        handleMouseDown(e);
    };

    // Visual styles based on lock state
    const getBarStyles = () => {
        const lock = lockState();

        if (lock === true) {
            // Fully locked - gray with lock icon
            return { bg: 'rgba(100,100,100,0.4)', border: '1px solid rgba(100,100,100,0.8)', icon: '🔒 ' };
        } else if (lock === 'start') {
            // Start locked - slightly different color, left edge indicator
            return { bg: 'rgba(239,68,68,0.3)', border: '1px solid rgba(239,68,68,0.6)', icon: '⊢ ' };
        } else if (lock === 'end') {
            // End locked - deadline style
            return { bg: 'rgba(249,115,22,0.3)', border: '1px solid rgba(249,115,22,0.6)', icon: ' ⊣' };
        } else if (lock === 'position') {
            // Position locked (can resize but not move)
            return { bg: 'rgba(168,85,247,0.3)', border: '1px solid rgba(168,85,247,0.6)', icon: '📍 ' };
        } else if (lock === 'duration') {
            // Duration locked (can move but not resize)
            return { bg: 'rgba(59,130,246,0.3)', border: '1px solid rgba(59,130,246,0.6)', icon: '↔ ' };
        }
        // Default - unlocked
        return { bg: 'rgba(34,197,94,0.3)', border: '1px solid rgba(34,197,94,0.6)', icon: '' };
    };

    const styles = () => getBarStyles();

    return (
        <div
            onMouseDown={handleMouseDownLocked}
            onMouseMove={handleMouseMove}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: getCursor(),
                background: styles().bg,
                border: styles().border,
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${t().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {styles().icon}{t().name}
        </div>
    );
}

const BAR_VARIANTS = {
    minimal: BarMinimal,
    text: BarWithText,
    handles: BarWithHandles,
    reactive: BarReactive,
    drag: BarWithDrag,
    events: BarWithEvents,
    full: BarFull,
    experiments: BarExperiments,
    nochildren: BarNoChildren,
    contained: BarContained,
    willchange: BarWillChange,
    combined: BarCombined,
    hoverpopup: BarHoverPopup,
    clickmodal: BarClickModal,
    dragbase: BarDragBaseline,
    dragfunc: BarDragFunctional,
    dragconst: BarDragConstrained,
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function GanttPerfIsolate() {
    const [tasks, setTasks] = createStore(initialTasks);

    // Version signal to trigger arrow re-renders when positions change
    const [positionVersion, setPositionVersion] = createSignal(0);

    // Helper for drag position updates
    const updateBarPosition = (id, updates) => {
        setTasks(produce(state => {
            if (state[id]?.$bar) {
                Object.assign(state[id].$bar, updates);
            }
        }));
        setPositionVersion(v => v + 1);  // Trigger arrow re-render
    };

    // URL params for progressive feature testing
    const params = new URLSearchParams(window.location.search);
    const barVariant = params.get('bar') || 'minimal';
    const virtMode = params.get('virt') || '2D';
    const autoTest = params.get('test');

    // Feature toggles: grid=1, headers=1, resources=1, context=1, headerOpt=1, arrows=1
    const showGrid = params.get('grid') === '1';
    const showHeaders = params.get('headers') === '1';
    const showResources = params.get('resources') === '1';
    const showArrows = params.get('arrows') === '1';
    const useContext = params.get('context') === '1' || ['events', 'full'].includes(barVariant);
    const useOptimizedHeaders = params.get('headerOpt') === '1';

    const BarComponent = BAR_VARIANTS[barVariant] || BarMinimal;

    // Mock stores for Grid/Headers/Resources
    const resources = uniqueResources.map((r, i) => ({ id: r, name: r, type: 'resource', displayIndex: i }));
    const mockResourceStore = { displayResources: () => resources };
    const mockGanttConfig = { barHeight: () => ROW_HEIGHT, padding: () => GAP };

    const [viewportWidth, setViewportWidth] = createSignal(1200);
    const [viewportHeight, setViewportHeight] = createSignal(800);
    const [scrollX, setScrollX] = createSignal(0);
    const [scrollY, setScrollY] = createSignal(0);

    // Popup/modal state for hoverpopup and clickmodal variants
    const [popupState, setPopupState] = createSignal({ visible: false, taskId: null, x: 0, y: 0 });
    const [modalState, setModalState] = createSignal({ visible: false, taskId: null });

    // Dynamic scale: 1 week fits in viewport (account for resource column)
    const RESOURCE_COL_WIDTH = 120;
    const chartWidth = createMemo(() => viewportWidth() - (showResources ? RESOURCE_COL_WIDTH : 0));
    const dayWidth = createMemo(() => chartWidth() / DAYS_VISIBLE);
    const hourWidth = createMemo(() => dayWidth() / 24);
    const totalWidth = createMemo(() => TOTAL_DAYS * dayWidth());

    // Mock taskStore for ArrowLayerBatched and constraints
    const mockTaskStore = {
        tasks: tasks,
        rowHeight: ROW_HEIGHT + GAP,
        getBarPosition: (id) => {
            const task = tasks[id];
            if (!task) return null;
            const hw = hourWidth();
            return {
                x: task.$bar?.x ?? task.startHours * hw,
                y: task.$bar.y,
                width: task.$bar?.width ?? task.durationHours * hw,
                height: task.$bar.height,
            };
        },
        getTask: (id) => tasks[id],
        updateBarPosition: updateBarPosition,
    };

    // Constraint callback for move - SIMPLE REACTIVE IMPLEMENTATION
    const handleConstrainPosition = (taskId, newX) => {
        const hw = hourWidth();
        const task = mockTaskStore.getTask(taskId);
        const taskBar = mockTaskStore.getBarPosition(taskId);
        if (!taskBar) {
            updateBarPosition(taskId, { x: newX });
            return;
        }

        // 0. Check if task is fully locked (cannot move)
        if (isMovementLocked(task?.constraints?.locked)) {
            return; // Don't allow any movement
        }

        // 1. Clamp to predecessor constraints (can't move before predecessors)
        let minX = getMinXFromPredecessors(
            taskId,
            relationships,
            mockTaskStore.getBarPosition,
            hw,
            taskBar.width
        );

        // 1b. Apply absolute minStart constraint
        const absMinX = getMinXFromAbsolute(task?.constraints, ganttStart, hw);
        minX = Math.max(minX, absMinX);

        // 2. Clamp to locked successor constraints (can't move past locked successors)
        let maxEnd = getMaxEndFromLockedSuccessors(
            taskId,
            relationships,
            mockTaskStore.getBarPosition,
            mockTaskStore.getTask,
            hw
        );

        // 2b. Apply absolute maxEnd constraint
        const absMaxEnd = getMaxEndFromAbsolute(task?.constraints, ganttStart, hw);
        maxEnd = Math.min(maxEnd, absMaxEnd);

        let maxX = maxEnd - taskBar.width;  // Convert max end to max start position

        // 2c. Apply absolute maxStart constraint
        const absMaxX = getMaxXFromAbsolute(task?.constraints, ganttStart, hw);
        maxX = Math.min(maxX, absMaxX);

        // Also check SS/SF constraints on start position
        const maxXFromSS = getMaxXFromLockedSuccessors(
            taskId,
            relationships,
            mockTaskStore.getBarPosition,
            mockTaskStore.getTask,
            hw
        );

        // Apply both min and max constraints
        const constrainedX = Math.max(minX, Math.min(newX, maxX, maxXFromSS));

        // 3. Update this task
        updateBarPosition(taskId, { x: constrainedX });

        // 4. Push/pull successors based on min/max offset constraints
        pushSuccessorsIfNeeded(
            taskId,
            relationships,
            mockTaskStore.getBarPosition,
            updateBarPosition,
            hw,
            mockTaskStore.getTask,
            ganttStart
        );
    };

    // Resize constraint callback - SIMPLE REACTIVE IMPLEMENTATION
    const handleConstrainResize = (taskId, newX, newWidth) => {
        const hw = hourWidth();
        const task = mockTaskStore.getTask(taskId);
        const taskBar = mockTaskStore.getBarPosition(taskId);
        if (!taskBar) {
            updateBarPosition(taskId, { x: newX, width: newWidth });
            return;
        }

        const isLeftResize = newX !== taskBar.x;  // Left edge moved
        const isRightResize = (newX + newWidth) !== (taskBar.x + taskBar.width);  // Right edge moved

        // 0. Check lock states for specific resize directions
        if (task?.constraints?.locked === true) {
            return; // Fully locked - no resize allowed
        }
        if (isLeftResize && isLeftResizeLocked(task?.constraints?.locked)) {
            // Can't resize left edge - restore original X, only allow right edge change
            newX = taskBar.x;
            newWidth = taskBar.width;
        }
        if (isRightResize && isRightResizeLocked(task?.constraints?.locked)) {
            // Can't resize right edge - restore original width
            newWidth = taskBar.width;
        }

        // 1. Clamp newX to predecessor constraints (for left edge resize)
        let minX = getMinXFromPredecessors(
            taskId,
            relationships,
            mockTaskStore.getBarPosition,
            hw,
            newWidth  // Pass the new width for FF/SF calculations
        );

        // 1b. Apply absolute minStart constraint
        const absMinX = getMinXFromAbsolute(task?.constraints, ganttStart, hw);
        minX = Math.max(minX, absMinX);

        if (newX < minX) {
            const diff = minX - newX;
            newX = minX;
            newWidth = Math.max(hw, newWidth - diff); // Shrink width to compensate
        }

        // 2. Clamp width to locked successor constraints (can't resize past locked successors)
        let maxEnd = getMaxEndFromLockedSuccessors(
            taskId,
            relationships,
            mockTaskStore.getBarPosition,
            mockTaskStore.getTask,
            hw
        );

        // 2b. Apply absolute maxEnd constraint
        const absMaxEnd = getMaxEndFromAbsolute(task?.constraints, ganttStart, hw);
        maxEnd = Math.min(maxEnd, absMaxEnd);

        const maxWidth = maxEnd - newX;
        if (newWidth > maxWidth) {
            newWidth = Math.max(hw, maxWidth);  // Ensure minimum width
        }

        // 2c. Apply minimum width constraint
        const minWidth = getMinWidth(task?.constraints, hw);
        newWidth = Math.max(minWidth, newWidth);

        // 3. Update this task's position and width
        updateBarPosition(taskId, { x: newX, width: newWidth });

        // 4. Push/pull successors based on min/max offset constraints
        pushSuccessorsIfNeeded(
            taskId,
            relationships,
            mockTaskStore.getBarPosition,
            updateBarPosition,
            hw,
            mockTaskStore.getTask,
            ganttStart
        );
    };

    // Visible ranges
    const visibleRowRange = createMemo(() => {
        const y = scrollY();
        const startRow = Math.floor(y / (ROW_HEIGHT + GAP));
        const endRow = Math.ceil((y + viewportHeight()) / (ROW_HEIGHT + GAP)) + OVERSCAN_ROWS;
        return { start: Math.max(0, startRow - OVERSCAN_ROWS), end: Math.min(endRow, TOTAL_ROWS) };
    });

    // Visible day range (for 2D index lookup)
    const visibleDayRange = createMemo(() => {
        const x = scrollX();
        const dw = dayWidth();
        const startDay = Math.floor((x - OVERSCAN_PX) / dw);
        const endDay = Math.ceil((x + viewportWidth() + OVERSCAN_PX) / dw);
        return { start: Math.max(0, startDay), end: Math.min(endDay, TOTAL_DAYS) };
    });

    // URL param to enable dummy memos - use a signal so guards create subscriptions
    const [dummyMemosActive] = createSignal(params.get('memos') === '1' ? 'active' : 'off');

    // 2D virtualization - returns tasks for Index (uses day-based buckets)
    const visibleTasks = createMemo(() => {
        const dayRange = visibleDayRange();
        const rowRange = visibleRowRange();

        const seen = {};
        const result = [];

        for (let row = rowRange.start; row < rowRange.end; row++) {
            const rowBuckets = taskIds2D[row] || {};
            for (let d = dayRange.start; d <= dayRange.end; d++) {
                for (const id of (rowBuckets[d] || [])) {
                    if (seen[id]) continue;
                    seen[id] = true;
                    result.push(tasks[id]);
                }
            }
        }
        return result;
    });

    // Dummy guarded memos to simulate GanttExperiments overhead (when memos=1)
    // Each memo reads dummyMemosActive() creating a subscription, just like GanttExperiments
    const dummyMemo1 = createMemo(() => { if (dummyMemosActive() !== 'mode1') return []; return visibleDayRange(); });
    const dummyMemo2 = createMemo(() => { if (dummyMemosActive() !== 'mode2') return []; return visibleDayRange(); });
    const dummyMemo3 = createMemo(() => { if (dummyMemosActive() !== 'mode3') return []; return visibleDayRange(); });
    const dummyMemo4 = createMemo(() => { if (dummyMemosActive() !== 'mode4') return []; return visibleDayRange(); });
    const dummyMemo5 = createMemo(() => { if (dummyMemosActive() !== 'mode5') return []; return visibleDayRange(); });
    const dummyMemo6 = createMemo(() => { if (dummyMemosActive() !== 'mode6') return []; return visibleDayRange(); });
    const dummyMemo7 = createMemo(() => { if (dummyMemosActive() !== 'mode7') return []; return visibleDayRange(); });
    const dummyMemo8 = createMemo(() => { if (dummyMemosActive() !== 'mode8') return []; return visibleDayRange(); });
    const dummyMemo9 = createMemo(() => { if (dummyMemosActive() !== 'mode9') return []; return visibleDayRange(); });
    const dummyMemo10 = createMemo(() => { if (dummyMemosActive() !== 'mode10') return []; return visibleDayRange(); });

    let containerRef;
    let scrollerRef;

    onMount(() => {
        const updateSize = () => {
            if (containerRef) {
                setViewportWidth(containerRef.clientWidth);
                setViewportHeight(containerRef.clientHeight - 40); // minus header
            }
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        onCleanup(() => window.removeEventListener('resize', updateSize));

        // Auto-scroll test - bounce back and forth
        if (autoTest && scrollerRef) {
            let currentH = 0;
            let currentV = 0;
            let hDir = 1;
            let vDir = 1;

            const tick = () => {
                const maxScrollH = totalWidth() - viewportWidth();
                const maxScrollV = TOTAL_HEIGHT - viewportHeight();

                if (autoTest === 'horizontal' || autoTest === 'both') {
                    currentH += hDir * 150;
                    if (currentH >= maxScrollH) { hDir = -1; currentH = maxScrollH; }
                    else if (currentH <= 0) { hDir = 1; currentH = 0; }
                    scrollerRef.scrollLeft = currentH;
                }
                if (autoTest === 'vertical' || autoTest === 'both') {
                    currentV += vDir * 100;
                    if (currentV >= maxScrollV) { vDir = -1; currentV = maxScrollV; }
                    else if (currentV <= 0) { vDir = 1; currentV = 0; }
                    scrollerRef.scrollTop = currentV;
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }
    });

    const handleScroll = (e) => {
        setScrollX(e.target.scrollLeft);
        setScrollY(e.target.scrollTop);
    };

    // Visible column range for headers
    const visibleColRange = createMemo(() => {
        const x = scrollX();
        const dw = dayWidth();
        const startCol = Math.floor(x / dw);
        const endCol = Math.ceil((x + viewportWidth()) / dw) + 2;
        return { start: Math.max(0, startCol - 1), end: Math.min(endCol, TOTAL_DAYS) };
    });

    // Build dateInfos for headers (dynamic based on dayWidth)
    const dateInfos = createMemo(() => {
        const dw = dayWidth();
        const result = [];
        for (let d = 0; d < TOTAL_DAYS; d++) {
            const dayDate = new Date(ganttStart.getTime() + d * 24 * 60 * 60 * 1000);
            result.push({
                x: d * dw,
                width: dw,
                upperText: '', // Removed week labels - only show day numbers
                lowerText: dayDate.getUTCDate().toString(),
                isThickLine: dayDate.getUTCDay() === 1,
            });
        }
        return result;
    });

    const features = [
        showGrid && 'grid',
        showHeaders && (useOptimizedHeaders ? 'headers(opt)' : 'headers'),
        showResources && 'resources',
        showArrows && `arrows(${relationships.length})`,
        useContext && 'context'
    ].filter(Boolean).join('+') || 'none';

    const HeaderComponent = useOptimizedHeaders ? DateHeadersOptimized : DateHeaders;

    const content = (
        <div ref={(el) => containerRef = el} style={{ height: '100%', display: 'flex', 'flex-direction': 'column' }}>
            {/* Header */}
            <div style={{ padding: '8px 16px', background: '#2a2a2a', display: 'flex', gap: '16px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
                <span style={{ 'font-weight': 'bold' }}>PerfIsolate</span>
                <span>Data: {dataSource}</span>
                <span>Bar: {barVariant}</span>
                <span>Features: {features}</span>
                <span>Visible: {visibleTasks().length}</span>
                <span style={{ color: '#888', 'font-size': '11px' }}>
                    ?data=constraint &amp; bar=dragconst &amp; arrows=1
                </span>
            </div>

            {/* Main content area */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Resource column */}
                <Show when={showResources}>
                    <div style={{ width: '120px', 'flex-shrink': 0, background: '#222', 'border-right': '1px solid #444', overflow: 'hidden' }}>
                        <div style={{ height: showHeaders ? '30px' : '0' }} />
                        <div style={{ transform: `translateY(-${scrollY()}px)` }}>
                            <ResourceColumn
                                resourceStore={mockResourceStore}
                                ganttConfig={mockGanttConfig}
                                startRow={visibleRowRange().start}
                                endRow={visibleRowRange().end}
                            />
                        </div>
                    </div>
                </Show>

                {/* Scrollable viewport */}
                <div
                    ref={(el) => scrollerRef = el}
                    onScroll={handleScroll}
                    style={{ flex: 1, overflow: 'auto', position: 'relative' }}
                >
                    {/* Headers */}
                    <Show when={showHeaders}>
                        <div style={{ position: 'sticky', top: 0, 'z-index': 10, '--g-header-bg-color': '#1a1a1a', '--g-header-text-color-secondary': '#999' }}>
                            <HeaderComponent
                                dateInfos={dateInfos()}
                                gridWidth={totalWidth()}
                                columnWidth={dayWidth()}
                                startCol={visibleColRange().start}
                                endCol={visibleColRange().end}
                                upperHeaderHeight={0}
                            />
                        </div>
                    </Show>

                    {/* Content sizer - background matches grid so empty areas don't flash black */}
                    <div style={{
                        width: `${totalWidth()}px`,
                        height: `${TOTAL_HEIGHT}px`,
                        position: 'relative',
                        background: 'var(--g-grid-bg-color, #1a1a1a)',
                    }}>
                        {/* Grid SVG */}
                        <Show when={showGrid}>
                            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 'pointer-events': 'none' }}>
                                <Grid
                                    width={totalWidth()}
                                    height={TOTAL_HEIGHT}
                                    columnWidth={dayWidth()}
                                    barHeight={ROW_HEIGHT}
                                    padding={GAP}
                                    taskCount={TOTAL_ROWS}
                                    startRow={visibleRowRange().start}
                                    endRow={visibleRowRange().end}
                                    lines="both"
                                    backgroundColor="#1a1a1a"
                                    lineColor="#555"
                                    thickLineColor="#666"
                                />
                            </svg>
                        </Show>

                        {/* Arrow layer */}
                        <Show when={showArrows}>
                            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 'pointer-events': 'none' }}>
                                <ArrowLayerBatched
                                    relationships={relationships}
                                    taskStore={mockTaskStore}
                                    positionVersion={positionVersion()}
                                    startRow={visibleRowRange().start}
                                    endRow={visibleRowRange().end}
                                    startX={scrollX() - 200}
                                    endX={scrollX() + chartWidth() + 200}
                                    arrowConfig={{
                                        stroke: '#888',
                                        strokeWidth: 1.2,
                                        strokeOpacity: 0.8,
                                        headSize: 4,
                                        curveRadius: 4,
                                    }}
                                />
                            </svg>
                        </Show>

                        {/* Task bars */}
                        <For each={visibleTasks()}>
                            {(task) => (
                                <BarComponent
                                    task={() => tasks[task.id]}
                                    hourWidth={hourWidth()}
                                    setPopupState={setPopupState}
                                    setModalState={setModalState}
                                    updateBarPosition={updateBarPosition}
                                    onConstrainPosition={handleConstrainPosition}
                                    onConstrainResize={handleConstrainResize}
                                />
                            )}
                        </For>

                        {/* Shared popup for hoverpopup variant */}
                        <Show when={popupState().visible}>
                            <TaskDataPopup
                                visible={() => popupState().visible}
                                position={() => ({ x: popupState().x, y: popupState().y })}
                                task={() => tasks[popupState().taskId]}
                                barPosition={() => null}
                            />
                        </Show>

                        {/* Shared modal for clickmodal variant */}
                        <Show when={modalState().visible}>
                            <TaskDataModal
                                visible={() => modalState().visible}
                                task={() => tasks[modalState().taskId]}
                                barPosition={() => null}
                                relationships={() => []}
                                onClose={() => setModalState({ visible: false, taskId: null })}
                            />
                        </Show>
                    </div>
                </div>
            </div>
        </div>
    );

    // Wrap in context if needed
    return useContext ? <GanttEventsProvider>{content}</GanttEventsProvider> : content;
}

export default GanttPerfIsolate;
