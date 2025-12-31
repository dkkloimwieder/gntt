// @ts-nocheck
import { createSignal, createMemo, onMount, onCleanup, Index, For, Show, batch } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import calendarData from '../data/generated/calendar.json';
import constraintTestData from '../data/fixtures/constraint-test.json';
import topologyBreadthData from '../data/generated/topology-breadth.json';
import topologyDepthData from '../data/generated/topology-depth.json';
import topologyBalancedData from '../data/generated/topology-balanced.json';
import topologyDebugData from '../data/generated/topology-debug.json';
import date_utils from '../utils/date_utils.js';
import { useGanttEvents, GanttEventsProvider } from '../contexts/GanttEvents';
import { useDrag } from '../hooks/useDrag.js';
import { Grid } from '../components/Grid';
import { DateHeaders } from '../components/DateHeaders';
import { DateHeadersOptimized } from './DateHeadersOptimized';
import { ResourceColumn } from '../components/ResourceColumn';
import { ArrowLayerBatched } from '../components/ArrowLayerBatched';
import { TaskDataPopup } from '../components/TaskDataPopup';
import { TaskDataModal } from '../components/TaskDataModal';
import {
    isMovementLocked,
    isLeftResizeLocked,
    isRightResizeLocked,
    getMinWidth,
} from '../utils/absoluteConstraints.js';
import {
    resolveConstraints,
    calculateCascadeUpdates,
    buildRelationshipIndex,
} from '../utils/constraintEngine.js';

// Constraint logic has been moved to constraintEngine.js for better modularity

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
const OVERSCAN_ROWS = 2;
const OVERSCAN_PX = 200;

// Select data source based on URL param: ?data=constraint or ?topology=breadth|depth|balanced
const urlParams = new URLSearchParams(window.location.search);
const topologyParam = urlParams.get('topology');
const dataParam = urlParams.get('data') || 'calendar';

// Topology takes precedence over data param
const dataSource = topologyParam
    ? `topology-${topologyParam}`
    : dataParam;

const sourceData = (() => {
    if (topologyParam === 'breadth') return topologyBreadthData;
    if (topologyParam === 'depth') return topologyDepthData;
    if (topologyParam === 'balanced') return topologyBalancedData;
    if (topologyParam === 'debug') return topologyDebugData;
    if (dataParam === 'constraint') return constraintTestData;
    return calendarData;
})();

// Parse tasks and compute TIME-based positions (hours from start)
const parsedTasks = sourceData.tasks.map(task => ({
    ...task,
    _start: date_utils.parse(task.start),
    _end: date_utils.parse(task.end),
}));
const ganttStart = new Date(Math.min(...parsedTasks.map(t => t._start.getTime())));
const ganttStartMs = ganttStart.getTime();

// Calculate average task duration to auto-adjust zoom for short tasks
const avgDurationHours = parsedTasks.reduce((sum, t) => {
    return sum + (t._end.getTime() - t._start.getTime()) / (1000 * 60 * 60);
}, 0) / parsedTasks.length;

// Auto-zoom: if tasks avg < 1 hour, show 3 hours; if < 4 hours show 1 day; else 5 days
// Can override with ?hours=N URL param
const hoursParam = urlParams.get('hours');
const HOURS_VISIBLE = hoursParam
    ? parseFloat(hoursParam)
    : avgDurationHours < 0.5 ? 3 : avgDurationHours < 4 ? 24 : 120;
const DAYS_VISIBLE = HOURS_VISIBLE / 24;

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
// Default hour width for initial _bar positions (will be recalculated on viewport resize)
const DEFAULT_HOUR_WIDTH = (1200 - 120) / DAYS_VISIBLE / 24; // ~6.4px per hour

const initialTasks = (() => {
    const result = {};
    parsedTasks.forEach((task, i) => {
        const row = resourceToRow[task.resource] ?? 0;
        const startHours = (task._start.getTime() - ganttStartMs) / (1000 * 60 * 60);
        const endHours = (task._end.getTime() - ganttStartMs) / (1000 * 60 * 60);
        const durationHours = endHours - startHours;
        // Apply minStart constraint to initial position
        let effectiveStartHours = startHours;
        if (task.constraints?.minStart) {
            const minStartTime = date_utils.parse(task.constraints.minStart).getTime();
            const minStartHours = (minStartTime - ganttStartMs) / (1000 * 60 * 60);
            effectiveStartHours = Math.max(startHours, minStartHours);
        }

        result[task.id] = {
            ...task,
            progress: task.progress || 0,
            row,
            startHours: effectiveStartHours,
            durationHours,
            _bar: {
                x: effectiveStartHours * DEFAULT_HOUR_WIDTH,
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

        // Normalize to array: handle string, object, or array of dependencies
        const deps = Array.isArray(task.dependencies)
            ? task.dependencies
            : [task.dependencies];

        for (const dep of deps) {
            const isObj = typeof dep === 'object' && dep !== null;
            const depId = isObj ? dep.id : dep;
            const depType = isObj ? (dep.type || 'FS') : 'FS';
            const lag = isObj ? (dep.lag || 0) : 0;
            const min = isObj ? (dep.min ?? 0) : 0;
            const max = isObj ? dep.max : undefined;  // undefined/null = elastic (default), 0 = fixed, N = bounded

            rels.push({
                from: depId,
                to: task.id,
                type: depType,
                lag,
                min,
                max,
            });
        }
    }
    return rels;
})();

// Pre-build relationship index for O(1) constraint lookups (built once, reused for all drags)
const relationshipIndex = buildRelationshipIndex(relationships);

console.log(`PerfIsolate [${dataSource}]: ${Object.keys(initialTasks).length} tasks, ${TOTAL_ROWS} rows, ${TOTAL_DAYS} days, ${relationships.length} deps`);

// ═══════════════════════════════════════════════════════════════════════════
// BAR VARIANTS - Toggle to find overhead
// ═══════════════════════════════════════════════════════════════════════════

// V1: Absolutely minimal - just a div with inline position
function BarMinimal(props) {
    const task = props.task;
    const bar = task._bar;
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
    const bar = task._bar;
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
    const bar = task._bar;
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
    const bar = () => t()._bar;
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
    const bar = () => t()._bar;
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
    const bar = () => t()._bar;
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
    const bar = () => t()._bar;
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
        const bar = task?._bar;
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
        const bar = task?._bar;
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
        const bar = task?._bar;
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
        const bar = task?._bar;
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
        const bar = task?._bar;
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
        const bar = task?._bar;
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
        const bar = task?._bar;
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
        const hw = props.hourWidth || 7;
        // Always calculate from hours to handle viewport resize correctly
        const x = (task?.startHours ?? 0) * hw;
        const width = Math.max((task?.durationHours ?? 1) * hw, 6);
        const row = task?.row ?? 0;
        return {
            id: task?.id ?? '',
            name: task?.name ?? '',
            x,
            y: row * (ROW_HEIGHT + GAP) + (ROW_HEIGHT + GAP - BAR_HEIGHT) / 2,
            width,
            height: BAR_HEIGHT,
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
        const bar = task?._bar;
        const hw = props.hourWidth || 7;
        // Use _bar.x/width if set (from drag), else compute from startHours/durationHours
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
// BarDragConstrained: Identical to BarNoChildren + constraint logic in drag handlers
function BarDragConstrained(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const [hoverZone, setHoverZone] = createSignal('move');

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?._bar;
        const progress = task?.progress ?? 0;
        const hw = props.hourWidth || 7;
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
                // Constraint logic: clamps to predecessors, pushes successors
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

    const getCursor = () => {
        const state = dragState();
        if (state === 'dragging_left' || state === 'dragging_right') return 'ew-resize';
        if (state === 'dragging_bar') return 'grabbing';
        const zone = hoverZone();
        if (zone === 'left' || zone === 'right') return 'ew-resize';
        return 'grab';
    };

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
            onMouseMove={handleMouseMove}
            onClick={(e) => events.onTaskClick?.(t().id, e)}
            onMouseDown={handleMouseDown}
            style={{
                position: 'absolute',
                transform: `translate(${t().x}px, ${t().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: getCursor(),
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

    // URL params for progressive feature testing
    const params = new URLSearchParams(window.location.search);
    const barVariant = params.get('bar') || 'minimal';
    const virtMode = params.get('virt') || '2D';
    const autoTest = params.get('test');

    // Feature toggles: grid=1, headers=1, resources=1, context=1, headerOpt=1, arrows=1
    const showGrid = params.get('grid') === '1';
    const showHeaders = params.get('headers') === '1' || dataSource === 'constraint';
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

    // Dynamic scale: days visible fits in viewport (account for resource column)
    const RESOURCE_COL_WIDTH = 120;
    const chartWidth = createMemo(() => viewportWidth() - (showResources ? RESOURCE_COL_WIDTH : 0));
    const dayWidth = createMemo(() => chartWidth() / DAYS_VISIBLE);
    const hourWidth = createMemo(() => dayWidth() / 24);
    const totalWidth = createMemo(() => TOTAL_DAYS * dayWidth());

    // Helper for drag position updates - stores hours, not pixels
    // Note: Arrow re-render is triggered ONCE after batch via setPositionVersion
    const updateBarPosition = (id, updates) => {
        const hw = hourWidth();
        setTasks(produce(state => {
            if (state[id]) {
                if (updates.x !== undefined) {
                    state[id].startHours = updates.x / hw;
                }
                if (updates.width !== undefined) {
                    state[id].durationHours = updates.width / hw;
                }
            }
        }));
    };

    // Separate function to trigger arrow re-render (call once after batch)
    const triggerArrowUpdate = () => setPositionVersion(v => v + 1);

    // Mock taskStore for ArrowLayerBatched and constraints
    // IMPORTANT: Always calculate pixel positions from hours * hourWidth() to handle viewport resize
    const mockTaskStore = {
        tasks: tasks,
        rowHeight: ROW_HEIGHT + GAP,
        getBarPosition: (id) => {
            const task = tasks[id];
            if (!task) return null;
            const hw = hourWidth();
            return {
                x: task.startHours * hw,
                y: task.row * (ROW_HEIGHT + GAP) + (ROW_HEIGHT + GAP - BAR_HEIGHT) / 2,
                width: task.durationHours * hw,
                height: BAR_HEIGHT,
            };
        },
        getTask: (id) => tasks[id],
        updateBarPosition: updateBarPosition,
    };

    // Constraint callback for move - uses unified constraint engine
    const handleConstrainPosition = (taskId, newX) => {
        const hw = hourWidth();
        const taskBar = mockTaskStore.getBarPosition(taskId);
        if (!taskBar) {
            updateBarPosition(taskId, { x: newX });
            return;
        }

        // Build context for constraint engine (uses pre-built index for O(1) lookups)
        const context = {
            getBarPosition: mockTaskStore.getBarPosition,
            getTask: mockTaskStore.getTask,
            relationships,
            relationshipIndex,  // Pre-built index for O(1) lookups
            pixelsPerHour: hw,
            ganttStartDate: ganttStart,
        };

        // Resolve all constraints with single function call
        const result = resolveConstraints(taskId, newX, taskBar.width, context);

        // If blocked (locked or conflicting constraints), don't update
        if (result.blocked) return;

        // Batch ALL updates to avoid multiple reactivity triggers
        batch(() => {
            updateBarPosition(taskId, { x: result.constrainedX });

            // Apply cascade updates to successors
            for (const [succId, update] of result.cascadeUpdates) {
                updateBarPosition(succId, update);
            }

            // Trigger arrow re-render once after all updates
            triggerArrowUpdate();
        });
    };

    // Resize constraint callback - uses constraint engine with resize-specific logic
    const handleConstrainResize = (taskId, newX, newWidth) => {
        const hw = hourWidth();
        const task = mockTaskStore.getTask(taskId);
        const taskBar = mockTaskStore.getBarPosition(taskId);
        if (!taskBar) {
            updateBarPosition(taskId, { x: newX, width: newWidth });
            return;
        }

        const isLeftResize = newX !== taskBar.x;
        const isRightResize = (newX + newWidth) !== (taskBar.x + taskBar.width);

        // Check lock states for specific resize directions
        if (task?.constraints?.locked === true) {
            return;  // Fully locked
        }
        if (isLeftResize && isLeftResizeLocked(task?.constraints?.locked)) {
            newX = taskBar.x;
            newWidth = taskBar.width;
        }
        if (isRightResize && isRightResizeLocked(task?.constraints?.locked)) {
            newWidth = taskBar.width;
        }

        // Build context for constraint engine (uses pre-built index for O(1) lookups)
        const context = {
            getBarPosition: mockTaskStore.getBarPosition,
            getTask: mockTaskStore.getTask,
            relationships,
            relationshipIndex,  // Pre-built index for O(1) lookups
            pixelsPerHour: hw,
            ganttStartDate: ganttStart,
        };

        // Use engine for constraint resolution (handles position and cascade)
        const result = resolveConstraints(taskId, newX, newWidth, context);

        // Adjust width if X was clamped (for left edge resize)
        let finalX = result.constrainedX;
        let finalWidth = newWidth;
        if (isLeftResize && finalX > newX) {
            const diff = finalX - newX;
            finalWidth = Math.max(hw, newWidth - diff);
        }

        // Apply minimum width constraint
        const minWidth = getMinWidth(task?.constraints, hw);
        finalWidth = Math.max(minWidth, finalWidth);

        // Batch ALL updates
        batch(() => {
            updateBarPosition(taskId, { x: finalX, width: finalWidth });

            // Calculate and apply cascade updates for the final position
            const cascadeUpdates = calculateCascadeUpdates(taskId, finalX, context);
            for (const [succId, update] of cascadeUpdates) {
                updateBarPosition(succId, update);
            }

            triggerArrowUpdate();
        });
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
                // Trigger arrow re-render when viewport changes (hourWidth changes)
                setPositionVersion(v => v + 1);
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
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        for (let d = 0; d < TOTAL_DAYS; d++) {
            const dayDate = new Date(ganttStart.getTime() + d * 24 * 60 * 60 * 1000);
            const month = months[dayDate.getUTCMonth()];
            const day = dayDate.getUTCDate();
            result.push({
                x: d * dw,
                width: dw,
                upperText: '',
                lowerText: `${month} ${day}`,
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
                <span>Data: {dataSource} ({HOURS_VISIBLE}h view)</span>
                <span>Bar: {barVariant}</span>
                <span>Features: {features}</span>
                <span>Visible: {visibleTasks().length}</span>
                <span style={{ color: '#888', 'font-size': '11px' }}>
                    ?topology=breadth|depth|balanced &amp; bar=dragconst &amp; arrows=1
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
                                        stroke: '#fff',
                                        strokeWidth: 1.5,
                                        strokeOpacity: 1,
                                        headSize: 6,
                                        curveRadius: 5,
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
