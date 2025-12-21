import { createSignal, createMemo, onMount, Index } from 'solid-js';
import { createStore } from 'solid-js/store';
import calendarData from '../data/calendar.json';

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

// Pre-process tasks with $bar positions (Step 1: test $bar property reads)
const initialTasks = (() => {
    const result = {};
    calendarData.tasks.forEach((task, i) => {
        // Calculate grid position based on task index
        const row = Math.floor(i / COLS);
        const col = i % COLS;

        result[task.id] = {
            ...task,
            locked: i % 7 === 0,
            progress: task.progress || 0,
            // Step 1: Add $bar with real positions
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
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    // Slot position for rendering (fixed DOM positions like indexTest)
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // Step 2: Add progress color from task
    const t = createMemo(() => {
        const task = getTask();
        const bar = task?.$bar;
        const progress = task?.progress ?? 0;
        const width = bar?.width ?? SLOT_WIDTH;
        return {
            color: task?.color ?? '#3b82f6',
            colorProgress: task?.color_progress ?? '#a3a3ff',
            locked: task?.locked ?? false,
            progress,
            name: task?.name ?? '',
            pw: (width * progress) / 100,
            id: task?.id ?? '',
            width,
            height: bar?.height ?? SLOT_HEIGHT,
        };
    });

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${pos().x}px, ${pos().y}px)`,
            width: `${t().width}px`,
            height: `${t().height}px`,
        }}>
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                'background-color': t().color,
                'background-image': t().locked ? 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 6px)' : 'none',
                opacity: 0.15,
                'border-radius': '3px',
            }} />
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${t().pw}px`,
                'background-color': t().colorProgress,
                opacity: 0.3,
                'border-radius': '3px',
            }} />
            <div style={{
                position: 'absolute',
                top: '50%',
                left: '8px',
                transform: 'translateY(-50%)',
                color: '#fff',
                'font-size': '12px',
            }}>{t().name}</div>
        </div>
    );
}

export function GanttMinimalTest() {
    // EXACTLY like indexTest
    const [tasks] = createStore(initialTasks);
    const allTaskIds = Object.keys(tasks);

    // Current visible window offset (EXACTLY like indexTest)
    const [offset, setOffset] = createSignal(0);

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

    // Scroll handler - converts scroll position to offset (like indexTest realScrollMode)
    const handleScroll = (e) => {
        const scrollTop = e.target.scrollTop;
        const rowHeight = SLOT_HEIGHT + GAP;
        const newOffset = Math.floor(scrollTop / rowHeight) * COLS;
        setOffset(Math.max(0, Math.min(newOffset, allTaskIds.length - VISIBLE_COUNT)));
    };

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

            if (scrollRef) {
                const maxScroll = scrollRef.scrollHeight - scrollRef.clientHeight;
                let currentScroll = scrollRef.scrollTop;
                currentScroll += direction * 100; // Fast scroll like perf demo

                if (currentScroll >= maxScroll) {
                    direction = -1;
                    currentScroll = maxScroll;
                } else if (currentScroll <= 0) {
                    direction = 1;
                    currentScroll = 0;
                }
                scrollRef.scrollTop = currentScroll;
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
        <div style={{ height: '100vh', display: 'flex', 'flex-direction': 'column', padding: '10px', 'font-family': 'system-ui' }}>
            <div style={{ 'margin-bottom': '10px', display: 'flex', gap: '20px', 'align-items': 'center' }}>
                <h2 style={{ margin: 0 }}>Step 5: Hover handlers</h2>
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

            <div
                ref={scrollRef}
                onScroll={handleScroll}
                style={{
                    flex: 1,
                    overflow: 'auto',
                    border: '1px solid #e0e0e0',
                    'border-radius': '8px',
                    background: '#f9fafb'
                }}
            >
                {/* Scroll spacer */}
                <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
                    {/* Fixed viewport container */}
                    <div style={{
                        position: 'sticky',
                        top: 0,
                        width: `${COLS * (SLOT_WIDTH + GAP)}px`,
                        height: `${ROWS * (SLOT_HEIGHT + GAP)}px`,
                    }}>
                        {/* Step 1: Reading $bar properties */}
                        <Index each={visibleTasks()}>
                            {(task, slotIndex) => (
                                <TestBar task={task} slotIndex={slotIndex} />
                            )}
                        </Index>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default GanttMinimalTest;
