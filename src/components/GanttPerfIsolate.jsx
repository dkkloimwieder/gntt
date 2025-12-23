import { createSignal, createMemo, onMount, onCleanup, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import calendarData from '../data/calendar.json';
import date_utils from '../utils/date_utils.js';
import { useGanttEvents, GanttEventsProvider } from '../contexts/GanttEvents.jsx';
import { useDrag } from '../hooks/useDrag.js';
import { Grid } from './Grid.jsx';
import { DateHeaders } from './DateHeaders.jsx';
import { ResourceColumn } from './ResourceColumn.jsx';

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
const GAP = 4;
const COLUMN_WIDTH = 6;  // 6px per hour = 144px per day
const DAY_WIDTH = 24 * COLUMN_WIDTH;
const OVERSCAN_ROWS = 2;
const OVERSCAN_PX = 200;

// Parse tasks and compute positions
const parsedTasks = calendarData.tasks.map(task => ({
    ...task,
    _start: date_utils.parse(task.start),
    _end: date_utils.parse(task.end),
}));
const ganttStart = new Date(Math.min(...parsedTasks.map(t => t._start.getTime())));

// Get unique resources
const uniqueResources = [...new Set(calendarData.tasks.map(t => t.resource))].sort();
const resourceToRow = Object.fromEntries(uniqueResources.map((r, i) => [r, i]));
const TOTAL_ROWS = uniqueResources.length;

// Timeline dimensions
const maxEndTime = Math.max(...parsedTasks.map(t => t._end.getTime()));
const TOTAL_DAYS = Math.ceil((maxEndTime - ganttStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
const TOTAL_WIDTH = TOTAL_DAYS * DAY_WIDTH;
const TOTAL_HEIGHT = TOTAL_ROWS * (ROW_HEIGHT + GAP);

// Build tasks with pixel positions - SAME as GanttExperiments
const initialTasks = (() => {
    const result = {};
    const ganttStartMs = ganttStart.getTime();
    parsedTasks.forEach((task, i) => {
        const row = resourceToRow[task.resource] ?? 0;
        const startHours = (task._start.getTime() - ganttStartMs) / (1000 * 60 * 60);
        const endHours = (task._end.getTime() - ganttStartMs) / (1000 * 60 * 60);
        const x = startHours * COLUMN_WIDTH;
        const width = (endHours - startHours) * COLUMN_WIDTH;
        result[task.id] = {
            ...task,  // <-- ALL properties from calendarData (same as Experiments)
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

// Pre-index tasks by row
const taskIdsByRow = (() => {
    const byRow = {};
    for (let r = 0; r < TOTAL_ROWS; r++) byRow[r] = [];
    Object.entries(initialTasks).forEach(([id, task]) => {
        const row = Math.floor(task.$bar.y / (ROW_HEIGHT + GAP));
        byRow[row].push(id);
    });
    return byRow;
})();

// 2D spatial index: taskIds2D[row][xBucket] = [taskIds...]
const X_BUCKET_SIZE = DAY_WIDTH;
const taskIds2D = (() => {
    const index = {};
    Object.entries(initialTasks).forEach(([id, task]) => {
        const row = Math.floor(task.$bar.y / (ROW_HEIGHT + GAP));
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

console.log(`PerfIsolate: ${Object.keys(initialTasks).length} tasks, ${TOTAL_ROWS} rows, ${TOTAL_DAYS} days`);

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

// V9: No child divs - detect resize zones from click position
function BarNoChildren(props) {
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
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function GanttPerfIsolate() {
    const [tasks] = createStore(initialTasks);

    // URL params for progressive feature testing
    const params = new URLSearchParams(window.location.search);
    const barVariant = params.get('bar') || 'minimal';
    const virtMode = params.get('virt') || '2D';
    const autoTest = params.get('test');

    // Feature toggles: grid=1, headers=1, resources=1, context=1
    const showGrid = params.get('grid') === '1';
    const showHeaders = params.get('headers') === '1';
    const showResources = params.get('resources') === '1';
    const useContext = params.get('context') === '1' || ['events', 'full'].includes(barVariant);

    const BarComponent = BAR_VARIANTS[barVariant] || BarMinimal;

    // Mock stores for Grid/Headers/Resources
    const resources = uniqueResources.map((r, i) => ({ id: r, name: r, type: 'resource', displayIndex: i }));
    const mockResourceStore = { displayResources: () => resources };
    const mockGanttConfig = { barHeight: () => ROW_HEIGHT, padding: () => GAP };

    const [viewportWidth, setViewportWidth] = createSignal(1200);
    const [viewportHeight, setViewportHeight] = createSignal(800);
    const [scrollX, setScrollX] = createSignal(0);
    const [scrollY, setScrollY] = createSignal(0);

    // Visible ranges
    const visibleRowRange = createMemo(() => {
        const y = scrollY();
        const startRow = Math.floor(y / (ROW_HEIGHT + GAP));
        const endRow = Math.ceil((y + viewportHeight()) / (ROW_HEIGHT + GAP)) + OVERSCAN_ROWS;
        return { start: Math.max(0, startRow - OVERSCAN_ROWS), end: Math.min(endRow, TOTAL_ROWS) };
    });

    const visibleXRange = createMemo(() => {
        const x = scrollX();
        return { start: Math.max(0, x - OVERSCAN_PX), end: x + viewportWidth() + OVERSCAN_PX };
    });

    // URL param to enable dummy memos - use a signal so guards create subscriptions
    const [dummyMemosActive] = createSignal(params.get('memos') === '1' ? 'active' : 'off');

    // 2D virtualization - same as GanttExperiments
    const visibleTasks = createMemo(() => {
        const xRange = visibleXRange();
        const rowRange = visibleRowRange();

        const startBucket = Math.floor(xRange.start / X_BUCKET_SIZE);
        const endBucket = Math.floor(xRange.end / X_BUCKET_SIZE);

        const seen = {};
        const result = [];

        for (let row = rowRange.start; row < rowRange.end; row++) {
            const rowBuckets = taskIds2D[row] || {};
            for (let b = startBucket; b <= endBucket; b++) {
                for (const id of (rowBuckets[b] || [])) {
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
    const dummyMemo1 = createMemo(() => { if (dummyMemosActive() !== 'mode1') return []; return visibleXRange(); });
    const dummyMemo2 = createMemo(() => { if (dummyMemosActive() !== 'mode2') return []; return visibleXRange(); });
    const dummyMemo3 = createMemo(() => { if (dummyMemosActive() !== 'mode3') return []; return visibleXRange(); });
    const dummyMemo4 = createMemo(() => { if (dummyMemosActive() !== 'mode4') return []; return visibleXRange(); });
    const dummyMemo5 = createMemo(() => { if (dummyMemosActive() !== 'mode5') return []; return visibleXRange(); });
    const dummyMemo6 = createMemo(() => { if (dummyMemosActive() !== 'mode6') return []; return visibleXRange(); });
    const dummyMemo7 = createMemo(() => { if (dummyMemosActive() !== 'mode7') return []; return visibleXRange(); });
    const dummyMemo8 = createMemo(() => { if (dummyMemosActive() !== 'mode8') return []; return visibleXRange(); });
    const dummyMemo9 = createMemo(() => { if (dummyMemosActive() !== 'mode9') return []; return visibleXRange(); });
    const dummyMemo10 = createMemo(() => { if (dummyMemosActive() !== 'mode10') return []; return visibleXRange(); });

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

        // Auto-scroll test - matches GanttExperiments exactly (150px/frame horizontal, 100px/frame vertical)
        if (autoTest && scrollerRef) {
            const maxScrollH = TOTAL_WIDTH - viewportWidth();
            const maxScrollV = TOTAL_HEIGHT - viewportHeight();
            let currentH = 0;
            let currentV = 0;
            let hDir = 1;
            let vDir = 1;

            const tick = () => {
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
        const startCol = Math.floor(x / DAY_WIDTH);
        const endCol = Math.ceil((x + viewportWidth()) / DAY_WIDTH) + 2;
        return { start: Math.max(0, startCol - 1), end: Math.min(endCol, TOTAL_DAYS) };
    });

    // Build dateInfos for headers
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

    const features = [showGrid && 'grid', showHeaders && 'headers', showResources && 'resources', useContext && 'context'].filter(Boolean).join('+') || 'none';

    const content = (
        <div ref={(el) => containerRef = el} style={{ height: '100%', display: 'flex', 'flex-direction': 'column' }}>
            {/* Header */}
            <div style={{ padding: '8px 16px', background: '#2a2a2a', display: 'flex', gap: '16px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
                <span style={{ 'font-weight': 'bold' }}>PerfIsolate</span>
                <span>Bar: {barVariant}</span>
                <span>Features: {features}</span>
                <span>Visible: {visibleTasks().length}</span>
                <span style={{ color: '#888', 'font-size': '11px' }}>
                    ?bar=minimal|text|handles|reactive|drag|events|full &amp; grid=1 &amp; headers=1 &amp; resources=1
                </span>
            </div>

            {/* Main content area */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Resource column */}
                <Show when={showResources}>
                    <div style={{ width: '120px', 'flex-shrink': 0, background: '#222', 'border-right': '1px solid #444', overflow: 'hidden' }}>
                        <div style={{ height: showHeaders ? '75px' : '0' }} />
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
                        <div style={{ position: 'sticky', top: 0, 'z-index': 10 }}>
                            <DateHeaders
                                dateInfos={dateInfos}
                                gridWidth={TOTAL_WIDTH}
                                columnWidth={DAY_WIDTH}
                                startCol={visibleColRange().start}
                                endCol={visibleColRange().end}
                            />
                        </div>
                    </Show>

                    {/* Content sizer */}
                    <div style={{ width: `${TOTAL_WIDTH}px`, height: `${TOTAL_HEIGHT}px`, position: 'relative' }}>
                        {/* Grid SVG */}
                        <Show when={showGrid}>
                            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 'pointer-events': 'none' }}>
                                <Grid
                                    width={TOTAL_WIDTH}
                                    height={TOTAL_HEIGHT}
                                    columnWidth={DAY_WIDTH}
                                    dateInfos={dateInfos}
                                    barHeight={ROW_HEIGHT}
                                    padding={GAP}
                                    taskCount={TOTAL_ROWS}
                                    startRow={visibleRowRange().start}
                                    endRow={visibleRowRange().end}
                                    resourceStore={mockResourceStore}
                                />
                            </svg>
                        </Show>

                        {/* Task bars */}
                        <For each={visibleTasks()}>
                            {(task) => <BarComponent task={task} />}
                        </For>
                    </div>
                </div>
            </div>
        </div>
    );

    // Wrap in context if needed
    return useContext ? <GanttEventsProvider>{content}</GanttEventsProvider> : content;
}

export default GanttPerfIsolate;
