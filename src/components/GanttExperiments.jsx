import { createSignal, createMemo, onMount, onCleanup, Index } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import calendarData from '../data/calendar.json';
import { useGanttEvents, GanttEventsProvider } from '../contexts/GanttEvents.jsx';
import { useDrag } from '../hooks/useDrag.js';
import { GanttContainer } from './GanttContainer.jsx';
import { Grid } from './Grid.jsx';
import { DateHeaders } from './DateHeaders.jsx';
import { ResourceColumn } from './ResourceColumn.jsx';
import date_utils from '../utils/date_utils.js';
import { computeX, computeWidth } from '../utils/barCalculations.js';

/**
 * GanttExperiments - Copy of GanttMinimalTest with variant switching
 * Use Chrome DevTools for performance measurement
 */

// Layout constants (copied from GanttMinimalTest)
const TOTAL_COLS = 100;
const TOTAL_ROWS = Math.ceil(calendarData.tasks.length / TOTAL_COLS);
const SLOT_WIDTH = 120;
const SLOT_HEIGHT = 28;
const GAP = 4;
const HEADER_HEIGHT = 50;
const OVERSCAN = 2;

const TOTAL_WIDTH = TOTAL_COLS * (SLOT_WIDTH + GAP);
const TOTAL_HEIGHT = TOTAL_ROWS * (SLOT_HEIGHT + GAP);

// Mock data (copied from GanttMinimalTest)
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

const mockResources = [];
for (let i = 0; i < TOTAL_ROWS; i++) {
    mockResources.push({
        id: `row-${i}`,
        name: `Row ${i + 1}`,
        type: 'resource',
        displayIndex: i,
    });
}

const mockResourceStore = { displayResources: () => mockResources };
const mockGanttConfig = { barHeight: () => SLOT_HEIGHT, padding: () => GAP };

function getSlotPosition(slotIndex, visibleCols) {
    const row = Math.floor(slotIndex / visibleCols);
    const col = slotIndex % visibleCols;
    return {
        x: col * (SLOT_WIDTH + GAP),
        y: row * (SLOT_HEIGHT + GAP),
    };
}

// Date parsing (copied from GanttMinimalTest)
const UNIT = 'hour';
const STEP = 1;
const COLUMN_WIDTH = 30;

const parsedTasks = calendarData.tasks.map(task => ({
    ...task,
    _start: date_utils.parse(task.start),
    _end: date_utils.parse(task.end),
}));
const ganttStart = new Date(Math.min(...parsedTasks.map(t => t._start.getTime())));

const initialTasks = (() => {
    const result = {};
    parsedTasks.forEach((task, i) => {
        const row = Math.floor(i / TOTAL_COLS);
        const x = computeX(task._start, ganttStart, UNIT, STEP, COLUMN_WIDTH);
        const width = computeWidth(task._start, task._end, UNIT, STEP, COLUMN_WIDTH);
        result[task.id] = {
            ...task,
            locked: i % 7 === 0,
            progress: task.progress || 0,
            $bar: {
                x: Math.max(0, x),
                y: row * (SLOT_HEIGHT + GAP),
                width: Math.max(width, 20),
                height: SLOT_HEIGHT,
            },
        };
    });
    return result;
})();

// ═══════════════════════════════════════════════════════════════════════════
// TESTBAR VARIANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Baseline - Current GanttMinimalTest pattern (single memo) */
function TestBarBaseline(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const pos = () => getSlotPosition(props.slotIndex, props.visibleCols);

    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const width = bar?.width ?? SLOT_WIDTH;
        return {
            colorBg: task?.color_bg ?? 'rgba(59,130,246,0.15)',
            colorFill: task?.color_fill ?? 'rgba(59,130,246,0.3)',
            locked: task?.locked ?? false,
            name: task?.name ?? '',
            id: task?.id ?? '',
            width,
            height: bar?.height ?? SLOT_HEIGHT,
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
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_left', { taskId: t().id }); }} style={{ position: 'absolute', left: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
            <div onMouseDown={(e) => { e.stopPropagation(); startDrag(e, 'dragging_right', { taskId: t().id }); }} style={{ position: 'absolute', right: 0, top: 0, width: '6px', height: '100%', cursor: 'ew-resize' }} />
        </div>
    );
}

/** NoMemos - Direct store access */
function TestBarNoMemos(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const pos = () => getSlotPosition(props.slotIndex, props.visibleCols);

    const colorBg = () => getTask()?.color_bg ?? 'rgba(59,130,246,0.15)';
    const colorFill = () => getTask()?.color_fill ?? 'rgba(59,130,246,0.3)';
    const name = () => getTask()?.name ?? '';
    const id = () => getTask()?.id ?? '';
    const progress = () => getTask()?.progress ?? 0;
    const locked = () => getTask()?.locked ?? false;
    const width = () => getTask()?.$bar?.width ?? SLOT_WIDTH;
    const height = () => getTask()?.$bar?.height ?? SLOT_HEIGHT;
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
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${width()}px`,
                height: `${height()}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '12px',
                'line-height': `${height()}px`,
                'padding-left': '8px',
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

/** SplitMemo - Separate static and dynamic memos */
function TestBarSplitMemo(props) {
    const events = useGanttEvents();
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const pos = () => getSlotPosition(props.slotIndex, props.visibleCols);

    const staticProps = createMemo(() => {
        const task = getTask();
        return { colorBg: task?.color_bg ?? 'rgba(59,130,246,0.15)', colorFill: task?.color_fill ?? 'rgba(59,130,246,0.3)', name: task?.name ?? '', id: task?.id ?? '', locked: task?.locked ?? false };
    });

    const dynamicProps = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const width = bar?.width ?? SLOT_WIDTH;
        return { width, height: bar?.height ?? SLOT_HEIGHT, pw: (width * progress) / 100 };
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
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${dynamicProps().width}px`,
                height: `${dynamicProps().height}px`,
                cursor: isDragging() ? 'grabbing' : 'grab',
                background: bg(),
                'border-radius': '3px',
                color: '#fff',
                'font-size': '12px',
                'line-height': `${dynamicProps().height}px`,
                'padding-left': '8px',
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

/** Minimal - No handlers, no memos */
function TestBarMinimal(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const pos = () => getSlotPosition(props.slotIndex, props.visibleCols);

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${pos().x}px, ${pos().y}px)`,
            width: `${SLOT_WIDTH}px`,
            height: `${SLOT_HEIGHT}px`,
            background: getTask()?.color ?? '#3b82f6',
            opacity: 0.5,
            'border-radius': '3px',
            color: '#fff',
            'font-size': '12px',
            'line-height': `${SLOT_HEIGHT}px`,
            'padding-left': '8px',
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

    // URL params: ?variant=noMemos&test=vertical
    const params = new URLSearchParams(window.location.search);
    const initialVariant = params.get('variant') || 'baseline';
    const autoTest = params.get('test'); // 'vertical' | 'horizontal' | 'both'

    const [barVariant, setBarVariant] = createSignal(initialVariant);

    const [viewportWidth, setViewportWidth] = createSignal(1200);
    const [viewportHeight, setViewportHeight] = createSignal(800);

    const visibleCols = createMemo(() => Math.ceil(viewportWidth() / (SLOT_WIDTH + GAP)) + OVERSCAN);
    const visibleRows = createMemo(() => Math.ceil(viewportHeight() / (SLOT_HEIGHT + GAP)) + OVERSCAN);

    const [rowOffset, setRowOffset] = createSignal(0);
    const [colOffset, setColOffset] = createSignal(0);
    const [subRowOffset, setSubRowOffset] = createSignal(0);
    const [subColOffset, setSubColOffset] = createSignal(0);

    const visibleRowRange = createMemo(() => {
        const startRow = rowOffset();
        const endRow = startRow + visibleRows() + 1;
        return { start: startRow, end: Math.min(endRow, TOTAL_ROWS) };
    });

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
                <h2 style={{ margin: 0, 'font-size': '16px' }}>Experiments ({TOTAL_COLS}x{TOTAL_ROWS} = {allTaskIds.length} tasks)</h2>
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
                        const rowHeight = SLOT_HEIGHT + GAP;
                        const colWidth = SLOT_WIDTH + GAP;
                        const vRows = visibleRows();
                        const vCols = visibleCols();
                        const rowIndex = st / rowHeight;
                        setRowOffset(Math.max(0, Math.min(Math.floor(rowIndex), TOTAL_ROWS - vRows)));
                        setSubRowOffset((rowIndex % 1) * rowHeight);
                        const colIndex = sl / colWidth;
                        setColOffset(Math.max(0, Math.min(Math.floor(colIndex), TOTAL_COLS - vCols)));
                        setSubColOffset((colIndex % 1) * colWidth);
                    }}
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
                                    <Dynamic
                                        component={BarComponent()}
                                        task={task}
                                        slotIndex={slotIndex}
                                        visibleCols={visibleCols()}
                                    />
                                )}
                            </Index>
                        </div>
                    }
                >
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
                </GanttContainer>
            </div>
        </div>
        </GanttEventsProvider>
    );
}

export default GanttExperiments;
