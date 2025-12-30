import { createSignal, createMemo, onMount, onCleanup, Index, untrack } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import calendarData from '../data/generated/calendar.json';
import { useGanttEvents, GanttEventsProvider } from '../contexts/GanttEvents.jsx';
import { useDrag } from '../hooks/useDrag.js';
import { GanttContainer } from '../components/GanttContainer.jsx';
import { Grid } from '../components/Grid.jsx';
import { DateHeaders } from '../components/DateHeaders.jsx';
import { ResourceColumn } from '../components/ResourceColumn.jsx';
import date_utils from '../utils/date_utils.js';

/**
 * GanttExperiments - Performance testing harness with date-based positioning
 * Use Chrome DevTools for performance measurement
 */

// Layout constants
const ROW_HEIGHT = 28;
const GAP = 4;
const HEADER_HEIGHT = 50;
const OVERSCAN_ROWS = 2;
const OVERSCAN_PX = 200; // Horizontal overscan in pixels

// Timeline: 6px per hour, 144px per day
const COLUMN_WIDTH = 6;
const DAY_WIDTH = 144;

// Parse date string as UTC: "YYYY-MM-DD HH:MM" -> Date
function parseUTC(str) {
    const [datePart, timePart] = str.split(' ');
    const [y, m, d] = datePart.split('-').map(Number);
    const [h, min] = (timePart || '00:00').split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, h, min));
}

// Parse tasks as UTC
const parsedTasks = calendarData.tasks.map(task => ({
    ...task,
    _start: parseUTC(task.start),
    _end: parseUTC(task.end),
}));

// Find earliest/latest and snap to midnight UTC
const minMs = Math.min(...parsedTasks.map(t => t._start.getTime()));
const maxMs = Math.max(...parsedTasks.map(t => t._end.getTime()));
const minDate = new Date(minMs);
const maxDate = new Date(maxMs);
const ganttStart = new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), minDate.getUTCDate()));
const ganttEnd = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth(), maxDate.getUTCDate() + 1));

// Resources
const uniqueResources = [...new Set(parsedTasks.map(t => t.resource))].sort();
const resourceToRow = {};
uniqueResources.forEach((res, i) => { resourceToRow[res] = i; });

// Dimensions
const TOTAL_ROWS = uniqueResources.length;
const TOTAL_DAYS = Math.round((ganttEnd - ganttStart) / (24 * 60 * 60 * 1000));
const TOTAL_WIDTH = TOTAL_DAYS * DAY_WIDTH;
const TOTAL_HEIGHT = TOTAL_ROWS * (ROW_HEIGHT + GAP);

// Date headers - one per day at exact day boundaries
const dateInfos = [];
for (let d = 0; d < TOTAL_DAYS; d++) {
    const dayDate = new Date(ganttStart.getTime() + d * 24 * 60 * 60 * 1000);
    dateInfos.push({
        x: d * DAY_WIDTH,
        width: DAY_WIDTH,
        upperText: d === 0 ? date_utils.format(dayDate, 'MMM YYYY') : (dayDate.getUTCDay() === 1 ? `W${Math.ceil((d + 1) / 7)}` : ''),
        lowerText: dayDate.getUTCDate().toString(),
        isThickLine: dayDate.getUTCDay() === 1,
    });
}

// Generate resource list for display
const resources = uniqueResources.map((res, i) => ({
    id: res,
    name: res,
    type: 'resource',
    displayIndex: i,
}));

const mockResourceStore = { displayResources: () => resources };
const mockGanttConfig = { barHeight: () => ROW_HEIGHT, padding: () => GAP };

// Build tasks with pixel positions computed directly from hours
const initialTasks = (() => {
    const result = {};
    const ganttStartMs = ganttStart.getTime();
    parsedTasks.forEach((task, i) => {
        const row = resourceToRow[task.resource] ?? 0;
        // Exact hour difference from ganttStart (midnight UTC)
        const startHours = (task._start.getTime() - ganttStartMs) / (1000 * 60 * 60);
        const endHours = (task._end.getTime() - ganttStartMs) / (1000 * 60 * 60);
        const x = startHours * COLUMN_WIDTH;
        const width = (endHours - startHours) * COLUMN_WIDTH;
        result[task.id] = {
            ...task,
            locked: i % 7 === 0,
            progress: task.progress || 0,
            $bar: {
                x,
                y: row * (ROW_HEIGHT + GAP),
                width: Math.max(width, 6),
                height: ROW_HEIGHT,
            },
        };
    });
    return result;
})();

// Pre-index tasks by row for fast lookup during virtualization
const taskIdsByRow = (() => {
    const byRow = {};
    for (let r = 0; r < TOTAL_ROWS; r++) byRow[r] = [];
    Object.entries(initialTasks).forEach(([id, task]) => {
        const row = resourceToRow[task.resource] ?? 0;
        byRow[row].push(id);
    });
    return byRow;
})();

// X-bucket spatial index for fast horizontal filtering (1 bucket = 1 day = DAY_WIDTH px)
const X_BUCKET_SIZE = DAY_WIDTH;

// Original xBucket: task appears in ALL buckets it spans (causes duplicates)
const taskIdsByXBucket = (() => {
    const index = {};
    Object.entries(initialTasks).forEach(([id, task]) => {
        const bar = task.$bar;
        const startBucket = Math.floor(bar.x / X_BUCKET_SIZE);
        const endBucket = Math.floor((bar.x + bar.width) / X_BUCKET_SIZE);
        for (let b = startBucket; b <= endBucket; b++) {
            (index[b] = index[b] || []).push(id);
        }
    });
    return index;
})();

// Task -> row index for fast row filtering
const taskRowIndex = Object.fromEntries(
    Object.entries(initialTasks).map(([id, task]) => [id, resourceToRow[task.resource] ?? 0])
);

// xBucketStart: task only in START bucket + store endBucket for filtering
// This avoids duplicates entirely
const tasksByStartBucket = (() => {
    const index = {};
    Object.entries(initialTasks).forEach(([id, task]) => {
        const bar = task.$bar;
        const startBucket = Math.floor(bar.x / X_BUCKET_SIZE);
        const endBucket = Math.floor((bar.x + bar.width) / X_BUCKET_SIZE);
        const row = resourceToRow[task.resource] ?? 0;
        (index[startBucket] = index[startBucket] || []).push({ id, endBucket, row });
    });
    return index;
})();

// Find max task width to know how far back to look for tasks
const maxTaskBuckets = Math.ceil(
    Math.max(...Object.values(initialTasks).map(t => t.$bar.width)) / X_BUCKET_SIZE
) + 1;

// 2D index: taskIds2D[row][xBucket] = [taskIds...] - no dedup needed within same (row,bucket)
const taskIds2D = (() => {
    const index = {};
    Object.entries(initialTasks).forEach(([id, task]) => {
        const row = resourceToRow[task.resource] ?? 0;
        const bar = task.$bar;
        const startBucket = Math.floor(bar.x / X_BUCKET_SIZE);
        const endBucket = Math.floor((bar.x + bar.width) / X_BUCKET_SIZE);
        if (!index[row]) index[row] = {};
        for (let b = startBucket; b <= endBucket; b++) {
            (index[row][b] = index[row][b] || []).push(id);
        }
    });
    return index;
})();

// ═══════════════════════════════════════════════════════════════════════════
// TESTBAR VARIANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Baseline - Single memo for all props, uses $bar for position */
function TestBarBaseline(props) {
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
            height: bar?.height ?? ROW_HEIGHT,
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

/** NoMemos - Direct store access, uses $bar for position */
function TestBarNoMemos(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const colorBg = () => getTask()?.color_bg ?? 'rgba(59,130,246,0.15)';
    const colorFill = () => getTask()?.color_fill ?? 'rgba(59,130,246,0.3)';
    const name = () => getTask()?.name ?? '';
    const id = () => getTask()?.id ?? '';
    const progress = () => getTask()?.progress ?? 0;
    const locked = () => getTask()?.locked ?? false;
    const x = () => getTask()?.$bar?.x ?? 0;
    const y = () => getTask()?.$bar?.y ?? 0;
    const width = () => getTask()?.$bar?.width ?? 40;
    const height = () => getTask()?.$bar?.height ?? ROW_HEIGHT;
    const pw = () => (width() * progress()) / 100;

    const bg = () => {
        const bgColor = colorBg();
        const fillColor = colorFill();
        const p = pw();
        return `linear-gradient(to right, ${fillColor} 0px, ${fillColor} ${p}px, ${bgColor} ${p}px, ${bgColor} 100%)${locked() ? ', repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : ''}`;
    };

    const { isDragging, startDrag } = useDrag({ onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {} });

    return (
        <div
            onMouseEnter={(e) => events.onHover?.(id(), e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(id(), e)}
            onMouseDown={(e) => startDrag(e, 'dragging_bar', { taskId: id() })}
            style={{
                position: 'absolute',
                transform: `translate(${x()}px, ${y()}px)`,
                width: `${width()}px`,
                height: `${height()}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${height()}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {name()}
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_left', { taskId: id() }); }} style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_right', { taskId: id() }); }} style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

/** SplitMemo - Separate static and dynamic memos, uses $bar for position */
function TestBarSplitMemo(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    const staticProps = createMemo(() => {
        const task = getTask();
        return { colorBg: task?.color_bg ?? 'rgba(59,130,246,0.15)', colorFill: task?.color_fill ?? 'rgba(59,130,246,0.3)', name: task?.name ?? '', id: task?.id ?? '', locked: task?.locked ?? false };
    });

    const dynamicProps = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const width = bar?.width ?? 40;
        return { x: bar?.x ?? 0, y: bar?.y ?? 0, width, height: bar?.height ?? ROW_HEIGHT, pw: (width * progress) / 100 };
    });

    const bg = () => {
        const s = staticProps();
        const d = dynamicProps();
        return `linear-gradient(to right, ${s.colorFill} 0px, ${s.colorFill} ${d.pw}px, ${s.colorBg} ${d.pw}px, ${s.colorBg} 100%)${s.locked ? ', repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : ''}`;
    };

    const { isDragging, startDrag } = useDrag({ onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {} });

    return (
        <div
            onMouseEnter={(e) => events.onHover?.(staticProps().id, e.clientX, e.clientY)}
            onMouseLeave={() => events.onHoverEnd?.()}
            onClick={(e) => events.onTaskClick?.(staticProps().id, e)}
            onMouseDown={(e) => startDrag(e, 'dragging_bar', { taskId: staticProps().id })}
            style={{
                position: 'absolute',
                transform: `translate(${dynamicProps().x}px, ${dynamicProps().y}px)`,
                width: `${dynamicProps().width}px`,
                height: `${dynamicProps().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '11px',
                'line-height': `${dynamicProps().height}px`,
                'padding-left': '4px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {staticProps().name}
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_left', { taskId: staticProps().id }); }} style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_right', { taskId: staticProps().id }); }} style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

/** Minimal - No handlers, no memos, uses $bar for position */
function TestBarMinimal(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const bar = () => getTask()?.$bar;

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${bar()?.x ?? 0}px, ${bar()?.y ?? 0}px)`,
            width: `${bar()?.width ?? 40}px`,
            height: `${bar()?.height ?? ROW_HEIGHT}px`,
            background: getTask()?.color ?? '#3b82f6',
            opacity: 0.5,
            'border-radius': '3px',
            color: '#fff',
            'font-size': '11px',
            'line-height': `${ROW_HEIGHT}px`,
            'padding-left': '4px',
            overflow: 'hidden',
        }}>
            {getTask()?.name ?? ''}
        </div>
    );
}

const BAR_VARIANTS = {
    baseline: TestBarBaseline,
    noMemos: TestBarNoMemos,
    splitMemo: TestBarSplitMemo,
    minimal: TestBarMinimal,
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function GanttExperiments() {
    const [tasks] = createStore(initialTasks);
    const allTaskIds = Object.keys(tasks);

    // URL params: ?variant=noMemos&test=vertical&virt=xySplit
    const params = new URLSearchParams(window.location.search);
    const initialVariant = params.get('variant') || 'baseline';
    const autoTest = params.get('test'); // 'vertical' | 'horizontal' | 'both'
    const initialVirt = params.get('virt') || 'combined'; // 'combined' | 'xySplit'

    const [barVariant, setBarVariant] = createSignal(initialVariant);
    const [virtMode, setVirtMode] = createSignal(initialVirt);

    const [viewportWidth, setViewportWidth] = createSignal(1200);
    const [viewportHeight, setViewportHeight] = createSignal(800);

    // Scroll position in pixels
    const [scrollX, setScrollX] = createSignal(0);
    const [scrollY, setScrollY] = createSignal(0);

    // Visible row range (Y virtualization)
    const visibleRowRange = createMemo(() => {
        const y = scrollY();
        const startRow = Math.floor(y / (ROW_HEIGHT + GAP));
        const endRow = Math.ceil((y + viewportHeight()) / (ROW_HEIGHT + GAP)) + OVERSCAN_ROWS;
        return { start: Math.max(0, startRow - OVERSCAN_ROWS), end: Math.min(endRow, TOTAL_ROWS) };
    });

    // Visible X range (horizontal virtualization)
    const visibleXRange = createMemo(() => {
        const x = scrollX();
        return { start: Math.max(0, x - OVERSCAN_PX), end: x + viewportWidth() + OVERSCAN_PX };
    });

    // COMBINED: Get visible tasks by filtering on row and X range together
    // Cache for selected mode to avoid running all memos
    let cachedVisibleTasks = [];

    const visibleTasksCombined = createMemo(() => {
        if (virtMode() !== 'combined') return cachedVisibleTasks;
        const rowRange = visibleRowRange();
        const xRange = visibleXRange();
        const result = [];

        for (let row = rowRange.start; row < rowRange.end; row++) {
            const rowTaskIds = taskIdsByRow[row] || [];
            for (const id of rowTaskIds) {
                const task = tasks[id];
                const bar = task?.$bar;
                if (!bar) continue;
                // Check if task overlaps visible X range
                const taskEnd = bar.x + bar.width;
                if (taskEnd >= xRange.start && bar.x <= xRange.end) {
                    result.push(task);
                }
            }
        }
        return result;
    });

    // XYSPLIT: Stage 1 - Get all tasks in visible rows (only recalcs on Y scroll)
    const visibleRowTasks = createMemo(() => {
        if (virtMode() !== 'xySplit') return [];
        const rowRange = visibleRowRange();
        const result = [];
        for (let row = rowRange.start; row < rowRange.end; row++) {
            const rowTaskIds = taskIdsByRow[row] || [];
            for (const id of rowTaskIds) {
                result.push(tasks[id]);
            }
        }
        return result;
    });

    // XYSPLIT: Stage 2 - Filter by X range (recalcs on X scroll, uses cached row tasks)
    const visibleTasksXYSplit = createMemo(() => {
        if (virtMode() !== 'xySplit') return [];
        const xRange = visibleXRange();
        const rowTasks = visibleRowTasks();
        const result = [];
        for (const task of rowTasks) {
            const bar = task?.$bar;
            if (!bar) continue;
            const taskEnd = bar.x + bar.width;
            if (taskEnd >= xRange.start && bar.x <= xRange.end) {
                result.push(task);
            }
        }
        return result;
    });

    // SMARTCACHE: Only recalc what changed (Y = rebuild rows, X = just filter)
    let smartCacheRowTasks = [];
    let smartCacheResult = [];
    let smartLastYStart = -1, smartLastYEnd = -1;
    let smartLastXStart = -1, smartLastXEnd = -1;

    const visibleTasksSmartCache = createMemo(() => {
        if (virtMode() !== 'smartCache') return [];
        const rowRange = visibleRowRange();
        const xRange = visibleXRange();

        const yChanged = rowRange.start !== smartLastYStart || rowRange.end !== smartLastYEnd;
        const xChanged = xRange.start !== smartLastXStart || xRange.end !== smartLastXEnd;

        if (yChanged) {
            smartCacheRowTasks = [];
            for (let row = rowRange.start; row < rowRange.end; row++) {
                for (const id of taskIdsByRow[row] || []) {
                    smartCacheRowTasks.push(tasks[id]);
                }
            }
            smartLastYStart = rowRange.start;
            smartLastYEnd = rowRange.end;
        }

        if (yChanged || xChanged) {
            smartCacheResult = [];
            for (const task of smartCacheRowTasks) {
                const bar = task?.$bar;
                if (bar && bar.x + bar.width >= xRange.start && bar.x <= xRange.end) {
                    smartCacheResult.push(task);
                }
            }
            smartLastXStart = xRange.start;
            smartLastXEnd = xRange.end;
        }

        return smartCacheResult;
    });

    // SPLITEQUALS: Use custom equality to prevent unnecessary downstream updates
    // Custom equality for ID arrays
    const idsEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    // Stage 1: Get visible row task IDs (only depends on Y)
    const visibleRowTaskIds = createMemo(() => {
        if (virtMode() !== 'splitEquals') return [];
        const rowRange = visibleRowRange();
        const ids = [];
        for (let row = rowRange.start; row < rowRange.end; row++) {
            for (const id of taskIdsByRow[row] || []) {
                ids.push(id);
            }
        }
        return ids;
    }, { equals: idsEqual });

    // Stage 2: Filter by X range and return VISIBLE IDs (with custom equality)
    const visibleTaskIdsSplitEquals = createMemo(() => {
        if (virtMode() !== 'splitEquals') return [];
        const ids = visibleRowTaskIds();
        const xRange = visibleXRange();
        const result = [];
        for (const id of ids) {
            const task = tasks[id];
            const bar = task?.$bar;
            if (bar && bar.x + bar.width >= xRange.start && bar.x <= xRange.end) {
                result.push(id);  // Return ID, not task object
            }
        }
        return result;
    }, { equals: idsEqual });

    // Stage 3: Map IDs to tasks (only reruns when visible IDs actually change)
    const visibleTasksSplitEquals = createMemo(() => {
        if (virtMode() !== 'splitEquals') return [];
        const ids = visibleTaskIdsSplitEquals();
        return ids.map(id => tasks[id]);
    });

    // UNTRACKED: Same as combined but with untrack() to prevent subscriptions
    const visibleTasksUntracked = createMemo(() => {
        if (virtMode() !== 'untracked') return [];
        const rowRange = visibleRowRange();
        const xRange = visibleXRange();

        return untrack(() => {
            const result = [];
            for (let row = rowRange.start; row < rowRange.end; row++) {
                const rowTaskIds = taskIdsByRow[row] || [];
                for (const id of rowTaskIds) {
                    const task = tasks[id];
                    const bar = task?.$bar;
                    if (!bar) continue;
                    const taskEnd = bar.x + bar.width;
                    if (taskEnd >= xRange.start && bar.x <= xRange.end) {
                        result.push(task);
                    }
                }
            }
            return result;
        });
    });

    // PLAIN LOOKUP: Use initialTasks (plain object) for filtering, no store subscriptions
    const visibleTasksPlainLookup = createMemo(() => {
        if (virtMode() !== 'plainLookup') return [];
        const rowRange = visibleRowRange();
        const xRange = visibleXRange();
        const result = [];

        for (let row = rowRange.start; row < rowRange.end; row++) {
            const rowTaskIds = taskIdsByRow[row] || [];
            for (const id of rowTaskIds) {
                const bar = initialTasks[id].$bar;  // Plain object - no subscription
                const taskEnd = bar.x + bar.width;
                if (taskEnd >= xRange.start && bar.x <= xRange.end) {
                    result.push(tasks[id]);  // Store ref for rendering
                }
            }
        }
        return result;
    });

    // X-BUCKET: Query spatial index instead of iterating all tasks
    // Uses Object for dedup (faster than Set for numeric keys)
    const visibleTasksXBucket = createMemo(() => {
        if (virtMode() !== 'xBucket') return [];
        const xRange = visibleXRange();
        const rowRange = visibleRowRange();

        const startBucket = Math.floor(xRange.start / X_BUCKET_SIZE);
        const endBucket = Math.floor(xRange.end / X_BUCKET_SIZE);

        const seen = {};  // Object faster than Set for numeric keys
        const result = [];

        for (let b = startBucket; b <= endBucket; b++) {
            for (const id of (taskIdsByXBucket[b] || [])) {
                if (seen[id]) continue;
                seen[id] = 1;

                const row = taskRowIndex[id];
                if (row >= rowRange.start && row < rowRange.end) {
                    result.push(tasks[id]);
                }
            }
        }
        return result;
    });

    // X-BUCKET-START: Tasks only in START bucket, no deduplication needed
    // Look backwards by maxTaskBuckets to catch tasks extending into view
    const visibleTasksXBucketStart = createMemo(() => {
        if (virtMode() !== 'xBucketStart') return [];
        const xRange = visibleXRange();
        const rowRange = visibleRowRange();

        const visibleStart = Math.floor(xRange.start / X_BUCKET_SIZE);
        const visibleEnd = Math.floor(xRange.end / X_BUCKET_SIZE);
        // Look back to catch tasks that START earlier but EXTEND into view
        const searchStart = Math.max(0, visibleStart - maxTaskBuckets);

        const result = [];

        for (let b = searchStart; b <= visibleEnd; b++) {
            for (const { id, endBucket, row } of (tasksByStartBucket[b] || [])) {
                // Task visible if: starts before visible end AND ends after visible start
                if (endBucket >= visibleStart && row >= rowRange.start && row < rowRange.end) {
                    result.push(tasks[id]);
                }
            }
        }
        return result;
    });

    // 2D: Filter by row first, then by bucket - minimal iterations
    const visibleTasks2D = createMemo(() => {
        if (virtMode() !== '2D') return [];
        const xRange = visibleXRange();
        const rowRange = visibleRowRange();

        const startBucket = Math.floor(xRange.start / X_BUCKET_SIZE);
        const endBucket = Math.floor(xRange.end / X_BUCKET_SIZE);

        const result = [];

        for (let row = rowRange.start; row < rowRange.end; row++) {
            const rowIndex = taskIds2D[row];
            if (!rowIndex) continue;

            const seenInRow = {};  // Dedup only within this row
            for (let b = startBucket; b <= endBucket; b++) {
                for (const id of (rowIndex[b] || [])) {
                    if (seenInRow[id]) continue;
                    seenInRow[id] = 1;
                    result.push(tasks[id]);
                }
            }
        }
        return result;
    });

    // Select virtualization mode
    const visibleTasks = () => {
        const mode = virtMode();
        if (mode === 'xySplit') return visibleTasksXYSplit();
        if (mode === 'smartCache') return visibleTasksSmartCache();
        if (mode === 'splitEquals') return visibleTasksSplitEquals();
        if (mode === 'untracked') return visibleTasksUntracked();
        if (mode === 'plainLookup') return visibleTasksPlainLookup();
        if (mode === 'xBucket') return visibleTasksXBucket();
        if (mode === 'xBucketStart') return visibleTasksXBucketStart();
        if (mode === '2D') return visibleTasks2D();
        return visibleTasksCombined();
    };

    let containerRef;
    let stressAbort = null;
    const [running, setRunning] = createSignal(false);
    const [testMode, setTestMode] = createSignal(null);

    const runStressTest = (mode) => {
        if (running()) {
            if (stressAbort) stressAbort.abort = true;
            setRunning(false);
            setTestMode(null);
            return;
        }

        setRunning(true);
        setTestMode(mode);
        const controller = { abort: false };
        stressAbort = controller;

        let vDirection = 1;
        let hDirection = 1;
        const duration = 10000;
        const startTime = performance.now();

        // Cache scroll dimensions and positions ONCE to avoid layout thrashing
        // Track position in JS instead of reading scrollLeft/scrollTop from DOM
        const scrollArea = containerRef?.querySelector('.gantt-scroll-area');
        const maxScrollV = scrollArea ? scrollArea.scrollHeight - scrollArea.clientHeight : 0;
        const maxScrollH = scrollArea ? scrollArea.scrollWidth - scrollArea.clientWidth : 0;
        let currentScrollV = scrollArea ? scrollArea.scrollTop : 0;
        let currentScrollH = scrollArea ? scrollArea.scrollLeft : 0;

        const tick = () => {
            if (controller.abort || performance.now() - startTime > duration) {
                setRunning(false);
                setTestMode(null);
                return;
            }

            if (scrollArea) {
                if (mode === 'vertical' || mode === 'both') {
                    currentScrollV += vDirection * 100;
                    if (currentScrollV >= maxScrollV) { vDirection = -1; currentScrollV = maxScrollV; }
                    else if (currentScrollV <= 0) { vDirection = 1; currentScrollV = 0; }
                    scrollArea.scrollTop = currentScrollV;
                }

                if (mode === 'horizontal' || mode === 'both') {
                    currentScrollH += hDirection * 150;
                    if (currentScrollH >= maxScrollH) { hDirection = -1; currentScrollH = maxScrollH; }
                    else if (currentScrollH <= 0) { hDirection = 1; currentScrollH = 0; }
                    scrollArea.scrollLeft = currentScrollH;
                }
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    onMount(() => {
        const updateViewport = () => {
            if (containerRef) {
                const scrollArea = containerRef.querySelector('.gantt-scroll-area');
                if (scrollArea) {
                    setViewportWidth(scrollArea.clientWidth);
                    setViewportHeight(scrollArea.clientHeight);
                }
            }
        };
        setTimeout(updateViewport, 100);
        const resizeObserver = new ResizeObserver(updateViewport);
        if (containerRef) resizeObserver.observe(containerRef);
        onCleanup(() => resizeObserver.disconnect());

        // Auto-start test if URL param provided
        if (autoTest && ['vertical', 'horizontal', 'both'].includes(autoTest)) {
            setTimeout(() => runStressTest(autoTest), 500);
        }
    });

    const BarComponent = () => BAR_VARIANTS[barVariant()] || TestBarBaseline;

    return (
        <GanttEventsProvider>
        <div style={{ height: '100vh', display: 'flex', 'flex-direction': 'column', padding: '10px', 'font-family': 'system-ui', background: '#1a1a1a', color: '#fff' }}>
            <div style={{ 'margin-bottom': '10px', display: 'flex', gap: '15px', 'align-items': 'center' }}>
                <h2 style={{ margin: 0, 'font-size': '16px' }}>Experiments ({TOTAL_DAYS} days × {TOTAL_ROWS} rows = {allTaskIds.length} tasks)</h2>
                <select
                    value={barVariant()}
                    onChange={(e) => setBarVariant(e.target.value)}
                    style={{ padding: '6px 10px', 'border-radius': '4px', border: '1px solid #444', background: '#2d2d44', color: '#fff', 'font-size': '12px' }}
                >
                    <option value="baseline">baseline (single memo)</option>
                    <option value="noMemos">noMemos (direct access)</option>
                    <option value="splitMemo">splitMemo (static+dynamic)</option>
                    <option value="minimal">minimal (no handlers)</option>
                </select>
                <select
                    value={virtMode()}
                    onChange={(e) => setVirtMode(e.target.value)}
                    style={{ padding: '6px 10px', 'border-radius': '4px', border: '1px solid #444', background: '#2d4444', color: '#fff', 'font-size': '12px' }}
                >
                    <option value="combined">combined (single memo)</option>
                    <option value="xySplit">xySplit (X/Y separate)</option>
                    <option value="smartCache">smartCache (skip unchanged)</option>
                    <option value="splitEquals">splitEquals (custom equality)</option>
                    <option value="untracked">untracked (no subscriptions)</option>
                    <option value="plainLookup">plainLookup (initialTasks)</option>
                    <option value="xBucket">xBucket (spatial index)</option>
                    <option value="xBucketStart">xBucketStart (no dedup)</option>
                    <option value="2D">2D (row+bucket)</option>
                </select>
                <span style={{ 'font-size': '11px', color: '#888' }}>Visible: {visibleTasks().length}</span>

                {running() ? (
                    <button onClick={() => { if (stressAbort) stressAbort.abort = true; setRunning(false); setTestMode(null); }} style={{ padding: '6px 12px', background: '#ef4444', color: '#fff', border: 'none', 'border-radius': '4px', cursor: 'pointer' }}>
                        Stop ({testMode()})
                    </button>
                ) : (
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => runStressTest('vertical')} style={{ padding: '6px 10px', background: '#8b5cf6', color: '#fff', border: 'none', 'border-radius': '4px', cursor: 'pointer' }}>V-Scroll</button>
                        <button onClick={() => runStressTest('horizontal')} style={{ padding: '6px 10px', background: '#3b82f6', color: '#fff', border: 'none', 'border-radius': '4px', cursor: 'pointer' }}>H-Scroll</button>
                        <button onClick={() => runStressTest('both')} style={{ padding: '6px 10px', background: '#059669', color: '#fff', border: 'none', 'border-radius': '4px', cursor: 'pointer' }}>Both</button>
                    </div>
                )}
            </div>

            <div ref={containerRef} style={{
                flex: 1,
                border: '1px solid #333',
                'border-radius': '8px',
                overflow: 'hidden',
                background: '#1a1a1a',
                '--g-header-bg-color': '#1a1a1a',
                '--g-header-text-color': '#ccc',
                '--g-header-text-color-secondary': '#888',
                '--g-grid-line-color': '#333',
                '--g-resource-bg': '#1a1a1a',
                '--g-text-color': '#aaa',
                '--g-row-color': '#1a1a1a',
                '--g-grid-bg-color': '#1a1a1a',
            }}>
                <GanttContainer
                    svgWidth={TOTAL_WIDTH}
                    svgHeight={TOTAL_HEIGHT}
                    resourceColumnWidth={60}
                    headerHeight={HEADER_HEIGHT}
                    onScroll={(sl, st) => {
                        setScrollX(sl);
                        setScrollY(st);
                    }}
                    header={
                        <DateHeaders
                            dateInfos={dateInfos}
                            columnWidth={DAY_WIDTH}
                            gridWidth={TOTAL_WIDTH}
                            upperHeaderHeight={25}
                            lowerHeaderHeight={25}
                        />
                    }
                    resourceColumn={
                        <ResourceColumn
                            resourceStore={mockResourceStore}
                            ganttConfig={mockGanttConfig}
                            width={60}
                            startRow={visibleRowRange().start}
                            endRow={visibleRowRange().end}
                        />
                    }
                    barsLayer={
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: `${TOTAL_WIDTH}px`,
                            height: `${TOTAL_HEIGHT}px`,
                            'pointer-events': 'auto',
                        }}>
                            <Index each={visibleTasks()}>
                                {(task) => (
                                    <Dynamic
                                        component={BarComponent()}
                                        task={task}
                                    />
                                )}
                            </Index>
                        </div>
                    }
                >
                    <Grid
                        width={TOTAL_WIDTH}
                        height={TOTAL_HEIGHT}
                        barHeight={ROW_HEIGHT}
                        padding={GAP}
                        taskCount={0}
                        columnWidth={DAY_WIDTH}
                        lines="vertical"
                        backgroundColor="#1a1a1a"
                        lineColor="#333"
                        thickLineColor="#444"
                    />
                </GanttContainer>
            </div>
        </div>
        </GanttEventsProvider>
    );
}

export default GanttExperiments;
