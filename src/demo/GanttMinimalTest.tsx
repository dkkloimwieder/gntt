// @ts-nocheck
import { createSignal, createMemo, onMount, onCleanup, Index } from 'solid-js';
import { createStore } from 'solid-js/store';
import calendarData from '../data/generated/calendar.json';
import { useGanttEvents, GanttEventsProvider } from '../contexts/GanttEvents';
import { useDrag } from '../hooks/useDrag.js';
import { GanttContainer } from '../components/GanttContainer';
import { Grid } from '../components/Grid';
import { DateHeaders } from '../components/DateHeaders';
import { ResourceColumn } from '../components/ResourceColumn';
import date_utils from '../utils/date_utils.js';
import { computeX, computeWidth } from '../utils/barCalculations.js';
// import { ArrowLayerBatched } from '../components/ArrowLayerBatched'; // Removed - causes 21% perf regression

/**
 * GanttMinimalTest - EXACT COPY of indexTest.jsx pattern with real scroll
 */

// ═══════════════════════════════════════════════════════════════════════════
// HORIZONTAL + VERTICAL SCROLL TEST (100 columns)
// ═══════════════════════════════════════════════════════════════════════════

// Layout constants - 100 columns for horizontal scroll testing
const TOTAL_COLS = 100;          // Total columns in grid
const TOTAL_ROWS = Math.ceil(calendarData.tasks.length / TOTAL_COLS);
const SLOT_WIDTH = 120;
const SLOT_HEIGHT = 28;
const GAP = 4;
const HEADER_HEIGHT = 50;
const OVERSCAN = 2;              // Extra rows/cols for smooth scrolling

// Total dimensions
const TOTAL_WIDTH = TOTAL_COLS * (SLOT_WIDTH + GAP);
const TOTAL_HEIGHT = TOTAL_ROWS * (SLOT_HEIGHT + GAP);

console.log(`Grid: ${TOTAL_COLS}x${TOTAL_ROWS} = ${calendarData.tasks.length} tasks`);
console.log(`Total size: ${TOTAL_WIDTH}px x ${TOTAL_HEIGHT}px`);
console.log(`Visible: calculated from viewport size + ${OVERSCAN} overscan`);

// Mock dateInfos for DateHeaders (all columns for scrolling)
const mockDateInfos = [];
for (let i = 0; i < TOTAL_COLS; i++) {
    mockDateInfos.push({
        x: i * (SLOT_WIDTH + GAP),
        width: SLOT_WIDTH + GAP,
        upperText: i % 10 === 0 ? `Week ${Math.floor(i/10) + 1}` : '',
        lowerText: `Col ${i + 1}`,
        isThickLine: i % 10 === 0,
    });
}

// Mock resources (one per row)
const ROW_COUNT = TOTAL_ROWS;
const mockResources = [];
for (let i = 0; i < ROW_COUNT; i++) {
    mockResources.push({
        id: `row-${i}`,
        name: `Row ${i + 1}`,
        type: 'resource',
        displayIndex: i,
    });
}

// Mock resourceStore for ResourceColumn
const mockResourceStore = {
    displayResources: () => mockResources,
};

// Mock ganttConfig for ResourceColumn
const mockGanttConfig = {
    barHeight: () => SLOT_HEIGHT,
    padding: () => GAP,
};

// Slot position helper - computes screen position from slot index
// slotIndex = row * visibleCols + col (within visible window)
function getSlotPosition(slotIndex, visibleCols) {
    const row = Math.floor(slotIndex / visibleCols);
    const col = slotIndex % visibleCols;
    return {
        x: col * (SLOT_WIDTH + GAP),
        y: row * (SLOT_HEIGHT + GAP),
    };
}

// Step 15: Date-based position calculation
const UNIT = 'hour';
const STEP = 1;
const COLUMN_WIDTH = 30; // 30px per hour

// Parse all dates and find ganttStart (earliest date)
const parsedTasks = calendarData.tasks.map(task => ({
    ...task,
    _start: date_utils.parse(task.start),
    _end: date_utils.parse(task.end),
}));
const ganttStart = new Date(Math.min(...parsedTasks.map(t => t._start.getTime())));

// Pre-process tasks with _bar positions from dates
const initialTasks = (() => {
    const result = {};
    parsedTasks.forEach((task, i) => {
        const row = Math.floor(i / TOTAL_COLS);
        const col = i % TOTAL_COLS;

        // Compute x and width from dates
        const x = computeX(task._start, ganttStart, UNIT, STEP, COLUMN_WIDTH);
        const width = computeWidth(task._start, task._end, UNIT, STEP, COLUMN_WIDTH);

        result[task.id] = {
            ...task,
            locked: i % 7 === 0,
            progress: task.progress || 0,
            _bar: {
                x: Math.max(0, x), // Ensure non-negative
                y: row * (SLOT_HEIGHT + GAP),
                width: Math.max(width, 20), // Minimum 20px width
                height: SLOT_HEIGHT,
            },
        };
    });
    return result;
})();

// Calculate total timeline width
const maxX = Math.max(...Object.values(initialTasks).map(t => t._bar.x + t._bar.width));
const TIMELINE_WIDTH = Math.ceil(maxX / 100) * 100; // Round up to nearest 100
console.log('Timeline width:', TIMELINE_WIDTH, 'px');

// Bar component - renders at screen position based on slot index
function TestBar(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    // Slot position for rendering (computed from slotIndex and visibleCols)
    const pos = () => getSlotPosition(props.slotIndex, props.visibleCols);

    // Step 2: Read task properties
    const t = createMemo(() => {
        const task = getTask();
        const bar = task?._bar;
        const progress = task?.progress ?? 0;
        const width = bar?.width ?? SLOT_WIDTH;
        return {
            color: task?.color ?? '#3b82f6',
            colorProgress: task?.color_progress ?? '#a3a3ff',
            locked: task?.locked ?? false,
            name: task?.name ?? '',
            id: task?.id ?? '',
            width,
            height: bar?.height ?? SLOT_HEIGHT,
            pw: (width * progress) / 100,
        };
    });

    // Convert hex to rgba
    const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    };

    // Reactive getter for background
    const bg = () => {
        const data = t();
        const bgRgba = hexToRgba(data.color, 0.15);
        const progressRgba = hexToRgba(data.colorProgress, 0.3);
        const pw = data.pw;
        const gradient = `linear-gradient(to right, ${progressRgba} 0px, ${progressRgba} ${pw}px, ${bgRgba} ${pw}px, ${bgRgba} 100%)`;
        const lockedOverlay = data.locked ? ', repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : '';
        return gradient + lockedOverlay;
    };

    // Step 5: Hover handlers (Step 7: use context as fallback)
    const handleMouseEnter = (e) => (props.onHover ?? events.onHover)?.(t().id, e.clientX, e.clientY);
    const handleMouseLeave = () => (props.onHoverEnd ?? events.onHoverEnd)?.();
    // Step 6: Click handler (Step 7: use context as fallback)
    const handleClick = (e) => (props.onTaskClick ?? events.onTaskClick)?.(t().id, e);

    // Step 8: useDrag hook
    const { isDragging, startDrag } = useDrag({
        onDragStart: () => {},
        onDragMove: () => {},
        onDragEnd: () => {},
    });
    const handleMouseDown = (e) => startDrag(e, 'dragging_bar', { taskId: t().id });
    // Step 9: Resize handles
    const handleLeftResize = (e) => { e.stopPropagation(); startDrag(e, 'dragging_left', { taskId: t().id }); };
    const handleRightResize = (e) => { e.stopPropagation(); startDrag(e, 'dragging_right', { taskId: t().id }); };

    // 3-element approach with gradient background
    return (
        <div
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            style={{
                position: 'absolute',
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${t().width}px`,
                height: `${t().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '12px',
                'line-height': `${t().height}px`,
                'padding-left': '8px',
                overflow: 'hidden',
                'white-space': 'nowrap',
                'text-overflow': 'ellipsis',
                'box-sizing': 'border-box',
            }}>
            {t().name}
            {/* Resize handles */}
            <div onMouseDown={handleLeftResize} style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div onMouseDown={handleRightResize} style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

export function GanttMinimalTest() {
    const [tasks] = createStore(initialTasks);
    const allTaskIds = Object.keys(tasks);

    // Viewport size (updated on mount and resize)
    const [viewportWidth, setViewportWidth] = createSignal(1200);
    const [viewportHeight, setViewportHeight] = createSignal(800);

    // Calculate visible cols/rows from viewport size + overscan
    const visibleCols = createMemo(() =>
        Math.ceil(viewportWidth() / (SLOT_WIDTH + GAP)) + OVERSCAN
    );
    const visibleRows = createMemo(() =>
        Math.ceil(viewportHeight() / (SLOT_HEIGHT + GAP)) + OVERSCAN
    );

    // 2D scroll offsets
    const [rowOffset, setRowOffset] = createSignal(0);
    const [colOffset, setColOffset] = createSignal(0);
    // Sub-offsets for smooth scrolling
    const [subRowOffset, setSubRowOffset] = createSignal(0);
    const [subColOffset, setSubColOffset] = createSignal(0);

    // Visible row range for ResourceColumn virtualization
    const visibleRowRange = createMemo(() => {
        const startRow = rowOffset();
        const endRow = startRow + visibleRows() + 1;
        return { start: startRow, end: Math.min(endRow, TOTAL_ROWS) };
    });

    // Visible column range
    const visibleColRange = createMemo(() => {
        const startCol = colOffset();
        const endCol = startCol + visibleCols() + 1;
        return { start: startCol, end: Math.min(endCol, TOTAL_COLS) };
    });

    // Visible tasks (2D window based on viewport)
    const visibleTasks = createMemo(() => {
        const sr = rowOffset();
        const sc = colOffset();
        const vRows = visibleRows();
        const vCols = visibleCols();
        const result = [];
        for (let r = 0; r < vRows && sr + r < TOTAL_ROWS; r++) {
            for (let c = 0; c < vCols && sc + c < TOTAL_COLS; c++) {
                const taskIndex = (sr + r) * TOTAL_COLS + (sc + c);
                if (taskIndex < allTaskIds.length) {
                    result.push(tasks[allTaskIds[taskIndex]]);
                }
            }
        }
        return result;
    });

    // FPS tracking
    const [fps, setFps] = createSignal(0);
    const [worstFrame, setWorstFrame] = createSignal(0);
    const [avgFrame, setAvgFrame] = createSignal(0);
    const [running, setRunning] = createSignal(false);
    let frameTimes = [];
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let lastFrameTime = performance.now();
    let scrollRef;
    let containerRef;

    // Stress test modes: 'vertical' | 'horizontal' | 'both'
    const [testMode, setTestMode] = createSignal(null);
    let stressAbort = null;

    const runStressTest = (mode) => {
        if (running()) {
            if (stressAbort) stressAbort.abort = true;
            setRunning(false);
            setTestMode(null);
            return;
        }

        setRunning(true);
        setTestMode(mode);
        frameTimes = [];
        const controller = { abort: false };
        stressAbort = controller;

        let vDirection = 1;
        let hDirection = 1;
        const duration = 10000;
        const startTime = performance.now();

        const tick = () => {
            if (controller.abort || performance.now() - startTime > duration) {
                setRunning(false);
                setTestMode(null);
                console.log(`${mode} test complete:`, { fps: fps(), worst: worstFrame(), avg: avgFrame() });
                return;
            }

            const scrollArea = containerRef?.querySelector('.gantt-scroll-area') || scrollRef;
            if (scrollArea) {
                // Vertical scroll
                if (mode === 'vertical' || mode === 'both') {
                    const maxScrollV = scrollArea.scrollHeight - scrollArea.clientHeight;
                    let currentScrollV = scrollArea.scrollTop;
                    currentScrollV += vDirection * 100;
                    if (currentScrollV >= maxScrollV) { vDirection = -1; currentScrollV = maxScrollV; }
                    else if (currentScrollV <= 0) { vDirection = 1; currentScrollV = 0; }
                    scrollArea.scrollTop = currentScrollV;
                }

                // Horizontal scroll
                if (mode === 'horizontal' || mode === 'both') {
                    const maxScrollH = scrollArea.scrollWidth - scrollArea.clientWidth;
                    let currentScrollH = scrollArea.scrollLeft;
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

    const stopTest = () => {
        if (stressAbort) stressAbort.abort = true;
        setRunning(false);
        setTestMode(null);
    };

    // FPS counter + viewport tracking
    onMount(() => {
        // Track viewport size
        const updateViewport = () => {
            if (containerRef) {
                const scrollArea = containerRef.querySelector('.gantt-scroll-area');
                if (scrollArea) {
                    setViewportWidth(scrollArea.clientWidth);
                    setViewportHeight(scrollArea.clientHeight);
                }
            }
        };

        // Initial size
        setTimeout(updateViewport, 100);

        // Resize observer
        const resizeObserver = new ResizeObserver(updateViewport);
        if (containerRef) {
            resizeObserver.observe(containerRef);
        }

        onCleanup(() => resizeObserver.disconnect());

        // FPS measurement
        const measureFrame = (timestamp) => {
            frameCount++;
            const frameTime = timestamp - lastFrameTime;
            lastFrameTime = timestamp;
            if (running() && frameTime < 500) {
                frameTimes.push(frameTime);
            }
            if (frameTimes.length > 60) frameTimes.shift();

            const elapsed = timestamp - lastFpsUpdate;
            if (elapsed >= 1000) {
                setFps(Math.round((frameCount * 1000) / elapsed));
                frameCount = 0;
                lastFpsUpdate = timestamp;
                if (frameTimes.length > 0) {
                    setWorstFrame(Math.max(...frameTimes).toFixed(1));
                    setAvgFrame((frameTimes.reduce((a,b) => a+b, 0) / frameTimes.length).toFixed(1));
                }
            }
            requestAnimationFrame(measureFrame);
        };
        requestAnimationFrame(measureFrame);
    });

    const fpsColor = () => fps() >= 55 ? '#10b981' : fps() >= 30 ? '#f59e0b' : '#ef4444';

    return (
        <GanttEventsProvider>
        <div style={{ height: '100vh', display: 'flex', 'flex-direction': 'column', padding: '10px', 'font-family': 'system-ui', background: '#1a1a1a', color: '#fff' }}>
            <div style={{ 'margin-bottom': '10px', display: 'flex', gap: '20px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
                <h2 style={{ margin: 0 }}>2D Scroll Test ({TOTAL_COLS}x{TOTAL_ROWS})</h2>
                <div style={{ display: 'flex', gap: '12px', padding: '8px 12px', background: '#1f2937', color: '#fff', 'border-radius': '6px', 'font-size': '12px', 'font-family': 'monospace' }}>
                    <span>Tasks: <b style={{ color: '#10b981' }}>{allTaskIds.length}</b></span>
                    <span>Visible: <b style={{ color: '#10b981' }}>{visibleTasks().length}</b></span>
                    <span>Row: <b>{rowOffset()}</b></span>
                    <span>Col: <b>{colOffset()}</b></span>
                    <span>FPS: <b style={{ color: fpsColor() }}>{fps()}</b></span>
                    <span>Worst: <b>{worstFrame()}ms</b></span>
                    <span>Avg: <b>{avgFrame()}ms</b></span>
                </div>
                {running() ? (
                    <button
                        onClick={stopTest}
                        style={{
                            padding: '8px 16px',
                            background: '#ef4444',
                            color: '#fff',
                            border: 'none',
                            'border-radius': '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Stop ({testMode()})
                    </button>
                ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => runStressTest('vertical')}
                            style={{
                                padding: '8px 12px',
                                background: '#8b5cf6',
                                color: '#fff',
                                border: 'none',
                                'border-radius': '4px',
                                cursor: 'pointer'
                            }}
                        >
                            ↕ Vertical
                        </button>
                        <button
                            onClick={() => runStressTest('horizontal')}
                            style={{
                                padding: '8px 12px',
                                background: '#3b82f6',
                                color: '#fff',
                                border: 'none',
                                'border-radius': '4px',
                                cursor: 'pointer'
                            }}
                        >
                            ↔ Horizontal
                        </button>
                    </div>
                )}
            </div>

            {/* GanttContainer with 2D scrolling */}
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
                        const rowHeight = SLOT_HEIGHT + GAP;
                        const colWidth = SLOT_WIDTH + GAP;
                        const vRows = visibleRows();
                        const vCols = visibleCols();
                        // Row offset
                        const rowIndex = st / rowHeight;
                        setRowOffset(Math.max(0, Math.min(Math.floor(rowIndex), TOTAL_ROWS - vRows)));
                        setSubRowOffset((rowIndex % 1) * rowHeight);
                        // Column offset
                        const colIndex = sl / colWidth;
                        setColOffset(Math.max(0, Math.min(Math.floor(colIndex), TOTAL_COLS - vCols)));
                        setSubColOffset((colIndex % 1) * colWidth);
                    }}
                    onContainerReady={(api) => { scrollRef = api; }}
                    header={
                        <DateHeaders
                            dateInfos={mockDateInfos}
                            columnWidth={SLOT_WIDTH + GAP}
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
                            position: 'sticky',
                            top: 0,
                            left: 0,
                            width: `${visibleCols() * (SLOT_WIDTH + GAP)}px`,
                            height: `${visibleRows() * (SLOT_HEIGHT + GAP)}px`,
                            'pointer-events': 'auto',
                            transform: `translate(${-subColOffset()}px, ${-subRowOffset()}px)`,
                        }}>
                            <Index each={visibleTasks()}>
                                {(task, slotIndex) => (
                                    <TestBar task={task} slotIndex={slotIndex} visibleCols={visibleCols()} />
                                )}
                            </Index>
                        </div>
                    }
                >
                    {/* Grid SVG background - vertical lines for 100 columns */}
                    <Grid
                        width={TOTAL_WIDTH}
                        height={TOTAL_HEIGHT}
                        barHeight={SLOT_HEIGHT}
                        padding={GAP}
                        taskCount={0}
                        columnWidth={SLOT_WIDTH + GAP}
                        lines="vertical"
                        backgroundColor="#1a1a1a"
                        lineColor="#333"
                        thickLineColor="#444"
                    />
                    {/* Step 14: ArrowLayer - SKIPPED (21% perf regression from SVG path updates) */}
                </GanttContainer>
            </div>
        </div>
        </GanttEventsProvider>
    );
}

export default GanttMinimalTest;
