import { createSignal, createMemo, onMount, Index } from 'solid-js';
import { createStore } from 'solid-js/store';
import calendarData from '../data/calendar.json';
import { useGanttEvents, GanttEventsProvider } from '../contexts/GanttEvents.jsx';
import { useDrag } from '../hooks/useDrag.js';
import { GanttContainer } from './GanttContainer.jsx';
import { Grid } from './Grid.jsx';
import { DateHeaders } from './DateHeaders.jsx';
import { ResourceColumn } from './ResourceColumn.jsx';
// import { ArrowLayerBatched } from './ArrowLayerBatched.jsx'; // Removed - causes 21% perf regression

/**
 * GanttMinimalTest - EXACT COPY of indexTest.jsx pattern with real scroll
 */

// ═══════════════════════════════════════════════════════════════════════════
// EXACTLY LIKE indexTest.jsx
// ═══════════════════════════════════════════════════════════════════════════

// Layout constants
const COLS = 4;
const ROWS = 85;
const SLOT_WIDTH = 180;
const SLOT_HEIGHT = 28;
const GAP = 4;
const VISIBLE_COUNT = COLS * ROWS; // 340 visible slots
const HEADER_HEIGHT = 50;

// Mock dateInfos for DateHeaders (one per column)
const mockDateInfos = [];
for (let i = 0; i < COLS; i++) {
    mockDateInfos.push({
        x: i * (SLOT_WIDTH + GAP),
        width: SLOT_WIDTH + GAP,
        upperText: i === 0 ? 'Week 1' : '',  // Only show on first column
        lowerText: `Col ${i + 1}`,
        isThickLine: i === 0,
    });
}

// Mock resources (one per row)
const ROW_COUNT = Math.ceil(calendarData.tasks.length / COLS);
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

// Fixed slot positions for rendering (indexTest pattern)
const slotPositions = [];
for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
        slotPositions.push({
            x: col * (SLOT_WIDTH + GAP),
            y: row * (SLOT_HEIGHT + GAP),
        });
    }
}

// Pre-process tasks with $bar positions
const initialTasks = (() => {
    const result = {};
    calendarData.tasks.forEach((task, i) => {
        const row = Math.floor(i / COLS);
        const col = i % COLS;

        result[task.id] = {
            ...task,
            locked: i % 7 === 0,
            progress: task.progress || 0,
            $bar: {
                x: col * (SLOT_WIDTH + GAP),
                y: row * (SLOT_HEIGHT + GAP),
                width: SLOT_WIDTH,
                height: SLOT_HEIGHT,
            },
        };
    });
    return result;
})();

// Bar component - Step 1: Read $bar properties (but use slot position for rendering)
function TestBar(props) {
    // Step 7: Context access
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    // Slot position for rendering (fixed DOM positions like indexTest)
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // Step 2: Read task properties
    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
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
    // EXACTLY like indexTest
    const [tasks] = createStore(initialTasks);
    const allTaskIds = Object.keys(tasks);

    // Current visible window offset (EXACTLY like indexTest)
    const [offset, setOffset] = createSignal(0);
    // Sub-row scroll offset for smooth scrolling (fraction within a row)
    const [subRowOffset, setSubRowOffset] = createSignal(0);
    // Visible row range for ResourceColumn virtualization
    const visibleRowRange = createMemo(() => {
        const startRow = Math.floor(offset() / COLS);
        const endRow = startRow + ROWS + 1; // +1 for partial row
        return { start: startRow, end: Math.min(endRow, ROW_COUNT) };
    });

    // Visible tasks (EXACTLY like indexTest)
    const visibleTasks = createMemo(() => {
        const start = offset();
        const end = Math.min(start + VISIBLE_COUNT, allTaskIds.length);
        return allTaskIds.slice(start, end).map(id => tasks[id]);
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

    // Stress test
    let stressAbort = null;
    const runStressTest = () => {
        if (running()) {
            if (stressAbort) stressAbort.abort = true;
            setRunning(false);
            return;
        }

        setRunning(true);
        frameTimes = [];
        const controller = { abort: false };
        stressAbort = controller;

        let direction = 1;
        const duration = 10000;
        const startTime = performance.now();

        const tick = () => {
            if (controller.abort || performance.now() - startTime > duration) {
                setRunning(false);
                console.log('Test complete:', { fps: fps(), worst: worstFrame(), avg: avgFrame() });
                return;
            }

            // Find scroll area inside GanttContainer
            const scrollArea = containerRef?.querySelector('.gantt-scroll-area') || scrollRef;
            if (scrollArea) {
                const maxScroll = scrollArea.scrollHeight - scrollArea.clientHeight;
                let currentScroll = scrollArea.scrollTop;
                currentScroll += direction * 100; // Fast scroll like perf demo

                if (currentScroll >= maxScroll) {
                    direction = -1;
                    currentScroll = maxScroll;
                } else if (currentScroll <= 0) {
                    direction = 1;
                    currentScroll = 0;
                }
                scrollArea.scrollTop = currentScroll;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    // FPS counter
    onMount(() => {
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

    const totalHeight = Math.ceil(allTaskIds.length / COLS) * (SLOT_HEIGHT + GAP);
    const fpsColor = () => fps() >= 55 ? '#10b981' : fps() >= 30 ? '#f59e0b' : '#ef4444';

    return (
        <GanttEventsProvider>
        <div style={{ height: '100vh', display: 'flex', 'flex-direction': 'column', padding: '10px', 'font-family': 'system-ui', background: '#1a1a1a', color: '#fff' }}>
            <div style={{ 'margin-bottom': '10px', display: 'flex', gap: '20px', 'align-items': 'center' }}>
                <h2 style={{ margin: 0 }}>DOM Optimization Test</h2>
                <div style={{ display: 'flex', gap: '15px', padding: '8px 12px', background: '#1f2937', color: '#fff', 'border-radius': '6px', 'font-size': '13px', 'font-family': 'monospace' }}>
                    <span>Tasks: <b style={{ color: '#10b981' }}>{allTaskIds.length}</b></span>
                    <span>Visible: <b style={{ color: '#10b981' }}>{visibleTasks().length}</b></span>
                    <span>Offset: <b>{offset()}</b></span>
                    <span>FPS: <b style={{ color: fpsColor() }}>{fps()}</b></span>
                    <span>Worst: <b>{worstFrame()}ms</b></span>
                    <span>Avg: <b>{avgFrame()}ms</b></span>
                </div>
                <button
                    onClick={runStressTest}
                    style={{
                        padding: '8px 16px',
                        background: running() ? '#ef4444' : '#8b5cf6',
                        color: '#fff',
                        border: 'none',
                        'border-radius': '4px',
                        cursor: 'pointer'
                    }}
                >
                    {running() ? 'Stop' : 'Scroll Test'}
                </button>
            </div>

            {/* Step 10: GanttContainer */}
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
                    svgWidth={COLS * (SLOT_WIDTH + GAP)}
                    svgHeight={totalHeight}
                    resourceColumnWidth={60}
                    headerHeight={HEADER_HEIGHT}
                    onScroll={(sl, st) => {
                        const rowHeight = SLOT_HEIGHT + GAP;
                        const rowIndex = st / rowHeight;
                        const newOffset = Math.floor(rowIndex) * COLS;
                        setOffset(Math.max(0, Math.min(newOffset, allTaskIds.length - VISIBLE_COUNT)));
                        // Sub-row offset for smooth scrolling (0 to rowHeight)
                        setSubRowOffset((rowIndex % 1) * rowHeight);
                    }}
                    onContainerReady={(api) => { scrollRef = api; }}
                    header={
                        <DateHeaders
                            dateInfos={mockDateInfos}
                            columnWidth={SLOT_WIDTH + GAP}
                            gridWidth={COLS * (SLOT_WIDTH + GAP)}
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
                            width: `${COLS * (SLOT_WIDTH + GAP)}px`,
                            height: `${ROWS * (SLOT_HEIGHT + GAP)}px`,
                            'pointer-events': 'auto',
                            transform: `translateY(${-subRowOffset()}px)`,
                        }}>
                            <Index each={visibleTasks()}>
                                {(task, slotIndex) => (
                                    <TestBar task={task} slotIndex={slotIndex} />
                                )}
                            </Index>
                        </div>
                    }
                >
                    {/* Step 11: Grid SVG background - vertical lines only, no row rects */}
                    <Grid
                        width={COLS * (SLOT_WIDTH + GAP)}
                        height={totalHeight}
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
