// @ts-nocheck
import { createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import { createRAF } from '@solid-primitives/raf';
import { Gantt } from '../components/Gantt';
import calendarData from '../data/generated/calendar.json';
import {
    createFrameMetrics,
    startMemoTracking,
    stopMemoTracking,
    clearMemoTracking,
    analyzeMemos,
    createBenchmarkResult,
    downloadJSON,
    generateReport,
} from '../../benchmarks/profiler/index.js';

/**
 * GanttPerfDemo - Performance testing component for Gantt chart.
 * Uses pre-generated JSON data (run `pnpm run generate:calendar` to create).
 */
export function GanttPerfDemo() {
    // Task data from JSON
    const [tasks, setTasks] = createSignal([]);

    // Performance metrics
    const [renderTime, setRenderTime] = createSignal(null);
    const [domStats, setDomStats] = createSignal({ tasks: 0, arrows: 0 });
    const [viewMode, setViewMode] = createSignal('Hour');
    const [fps, setFps] = createSignal(0);
    const [worstFrameTime, setWorstFrameTime] = createSignal(0);
    const [avgFrameTime, setAvgFrameTime] = createSignal(0);

    // Stress test state
    const [stressTestRunning, setStressTestRunning] = createSignal(false);
    const [verticalStressTestRunning, setVerticalStressTestRunning] = createSignal(false);
    const [scrollEventsPerSec, setScrollEventsPerSec] = createSignal(0);

    // Buffer controls for testing virtualization tradeoffs
    const [overscanRows, setOverscanRows] = createSignal(5);
    const [overscanX, setOverscanX] = createSignal(600);
    const [overscanCols, setOverscanCols] = createSignal(5);
    const [heapSize, setHeapSize] = createSignal(null);

    // Advanced perf tracking
    const [benchmarkRunning, setBenchmarkRunning] = createSignal(false);
    const [lastBenchmarkResult, setLastBenchmarkResult] = createSignal(null);
    const [arrowRenderer, setArrowRenderer] = createSignal('batched');
    // Render mode: 'simple' (flat tasks, static heights) or 'detailed' (hierarchy, subtasks)
    const [renderMode, setRenderMode] = createSignal('simple');
    // Task layer mode: 'full' (TaskLayer with all features) or 'minimal' (TaskLayerMinimal matching V7j)
    const [taskLayerMode, setTaskLayerMode] = createSignal('full');
    let frameTracker = null;

    // Frame timing tracking
    let lastFrameTime = performance.now();
    let frameTimes = [];
    let scrollEventCount = 0;
    let lastScrollCountUpdate = performance.now();

    // FPS counter using RAF
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    const [, startFpsCounter] = createRAF((timestamp) => {
        frameCount++;

        const frameTime = timestamp - lastFrameTime;
        lastFrameTime = timestamp;
        frameTimes.push(frameTime);

        if (frameTimes.length > 60) {
            frameTimes.shift();
        }

        const elapsed = timestamp - lastFpsUpdate;
        if (elapsed >= 1000) {
            setFps(Math.round((frameCount * 1000) / elapsed));
            frameCount = 0;
            lastFpsUpdate = timestamp;

            if (frameTimes.length > 0) {
                const maxFrame = Math.max(...frameTimes);
                const avgFrame = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
                setWorstFrameTime(maxFrame.toFixed(1));
                setAvgFrameTime(avgFrame.toFixed(1));
            }

            const scrollElapsed = timestamp - lastScrollCountUpdate;
            if (scrollElapsed >= 1000) {
                setScrollEventsPerSec(Math.round((scrollEventCount * 1000) / scrollElapsed));
                scrollEventCount = 0;
                lastScrollCountUpdate = timestamp;
            }

            // Memory tracking (Chrome only)
            if (performance.memory) {
                setHeapSize((performance.memory.usedJSHeapSize / 1048576).toFixed(1));
            }
        }
    });

    // Horizontal scroll stress test
    let stressTestAbort = null;
    const runScrollStressTest = () => {
        if (stressTestRunning()) {
            if (stressTestAbort) stressTestAbort.abort = true;
            setStressTestRunning(false);
            return;
        }

        const scrollArea = document.querySelector('.gantt-scroll-area');
        if (!scrollArea) return;

        setStressTestRunning(true);
        frameTimes = [];
        setWorstFrameTime(0);

        const controller = { abort: false };
        stressTestAbort = controller;

        const duration = 30000; // 30 seconds for better trace capture
        const startTime = performance.now();
        let direction = 1;
        let scrollPos = scrollArea.scrollLeft;

        const fireScrollEvent = () => {
            if (controller.abort || performance.now() - startTime > duration) {
                setStressTestRunning(false);
                console.log('H-Scroll test complete:', { worst: worstFrameTime(), avg: avgFrameTime() });
                return;
            }

            const deltaX = direction * 200;
            scrollPos += deltaX;
            if (scrollPos > scrollArea.scrollWidth - scrollArea.clientWidth - 500) direction = -1;
            else if (scrollPos < 500) direction = 1;
            scrollArea.scrollLeft = scrollPos;

            // Use RAF for vsync-aligned updates (eliminates tearing)
            requestAnimationFrame(fireScrollEvent);
        };

        requestAnimationFrame(fireScrollEvent);
    };

    // Vertical scroll stress test
    let verticalStressTestAbort = null;
    const runVerticalScrollStressTest = () => {
        if (verticalStressTestRunning()) {
            if (verticalStressTestAbort) verticalStressTestAbort.abort = true;
            setVerticalStressTestRunning(false);
            return;
        }

        const scrollArea = document.querySelector('.gantt-scroll-area');
        if (!scrollArea) return;

        setVerticalStressTestRunning(true);
        frameTimes = [];
        setWorstFrameTime(0);

        const controller = { abort: false };
        verticalStressTestAbort = controller;

        const duration = 30000; // 30 seconds for better trace capture
        const startTime = performance.now();
        let direction = 1;
        let scrollPos = scrollArea.scrollTop;

        const fireScrollEvent = () => {
            if (controller.abort || performance.now() - startTime > duration) {
                setVerticalStressTestRunning(false);
                console.log('V-Scroll test complete:', { worst: worstFrameTime(), avg: avgFrameTime() });
                return;
            }

            const deltaY = direction * 100;
            scrollPos += deltaY;
            if (scrollPos > scrollArea.scrollHeight - scrollArea.clientHeight - 200) direction = -1;
            else if (scrollPos < 200) direction = 1;
            scrollArea.scrollTop = scrollPos;

            // Use RAF for vsync-aligned updates (eliminates tearing)
            requestAnimationFrame(fireScrollEvent);
        };

        requestAnimationFrame(fireScrollEvent);
    };

    // Advanced benchmark: Start collecting detailed metrics
    const startBenchmark = () => {
        if (benchmarkRunning()) {
            stopBenchmark();
            return;
        }

        frameTracker = createFrameMetrics();
        clearMemoTracking();
        startMemoTracking();
        frameTracker.startTracking();
        setBenchmarkRunning(true);
        frameTimes = [];
        console.log('Benchmark started - scroll or interact, then click Stop');
    };

    // Stop and collect results
    const stopBenchmark = () => {
        if (!benchmarkRunning()) return;

        frameTracker?.stopTracking();
        stopMemoTracking();
        setBenchmarkRunning(false);

        const frameAnalysis = frameTracker?.analyze() || {};
        const memoAnalysis = analyzeMemos();
        const timeline = frameTracker?.getFPSTimeline(100) || [];

        const result = createBenchmarkResult({
            frameAnalysis,
            memoAnalysis,
            timeline,
            config: {
                taskCount: domStats().tasks,
                arrowCount: domStats().arrows,
                viewMode: viewMode(),
                arrowRenderer: arrowRenderer(),
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                testType: 'manual',
            },
        });

        setLastBenchmarkResult(result);
        console.log('Benchmark complete:', generateReport(result));
    };

    // Export last benchmark result
    const exportBenchmark = () => {
        const result = lastBenchmarkResult();
        if (result) {
            downloadJSON(result);
        } else {
            console.warn('No benchmark results to export. Run a benchmark first.');
        }
    };

    // Track scroll events and log perf stats
    onMount(() => {
        const scrollArea = document.querySelector('.gantt-scroll-area');
        if (scrollArea) {
            const trackScroll = () => scrollEventCount++;
            scrollArea.addEventListener('scroll', trackScroll, { passive: true });
            onCleanup(() => scrollArea.removeEventListener('scroll', trackScroll));
        }

        // Perf stats logger - logs every 2 seconds during stress test
        let lastLogTime = 0;
        const logInterval = setInterval(() => {
            if (stressTestRunning() || verticalStressTestRunning()) {
                const now = performance.now();
                if (now - lastLogTime > 2000) {
                    lastLogTime = now;
                    console.log('[PERF]', {
                        fps: fps(),
                        avgFrame: avgFrameTime() + 'ms',
                        worstFrame: worstFrameTime() + 'ms',
                        scrollEvents: scrollEventsPerSec() + '/sec',
                        heap: heapSize() + 'MB',
                    });
                }
            }
        }, 500);
        onCleanup(() => clearInterval(logInterval));
    });

    // Gantt options
    const options = createMemo(() => ({
        view_mode: viewMode(),
        renderMode: renderMode(), // simple or detailed
        bar_height: 20,
        padding: 8,
        column_width: viewMode() === 'Hour' ? 25 : 30,
        upper_header_height: 35,
        lower_header_height: 25,
        headerHeight: 60,
        lines: 'both',
        scroll_to: 'start',
    }));

    // Load tasks and measure render time
    const loadTasks = () => {
        const startTime = performance.now();
        setTasks(calendarData.tasks);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    setRenderTime((performance.now() - startTime).toFixed(1));
                    setDomStats({
                        tasks: document.querySelectorAll('.bar-wrapper').length,
                        arrows: document.querySelectorAll('.arrow-layer > g').length,
                    });
                }, 0);
            });
        });
    };

    onMount(() => {
        loadTasks();
        startFpsCounter();
    });

    // Styles
    const styles = {
        container: {
            'max-width': '100%',
            height: '100vh',
            margin: 0,
            padding: '10px',
            display: 'flex',
            'flex-direction': 'column',
            'box-sizing': 'border-box',
            overflow: 'hidden',
            'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        header: {
            'margin-bottom': '10px',
            display: 'flex',
            'align-items': 'center',
            gap: '20px',
            'flex-wrap': 'wrap',
        },
        stats: {
            display: 'flex',
            gap: '15px',
            padding: '10px 15px',
            'background-color': '#1f2937',
            color: '#fff',
            'border-radius': '6px',
            'font-size': '13px',
            'font-family': 'monospace',
        },
        statItem: { display: 'flex', gap: '5px' },
        statLabel: { color: '#9ca3af' },
        statValue: { color: '#10b981', 'font-weight': 'bold' },
        controls: { display: 'flex', gap: '10px', 'align-items': 'center' },
        select: {
            padding: '6px 10px',
            border: '1px solid #d1d5db',
            'border-radius': '4px',
            'font-size': '13px',
            cursor: 'pointer',
        },
        button: {
            padding: '6px 12px',
            'background-color': '#3b82f6',
            color: '#fff',
            border: 'none',
            'border-radius': '4px',
            cursor: 'pointer',
            'font-size': '13px',
        },
        ganttWrapper: {
            border: '1px solid #e0e0e0',
            'border-radius': '8px',
            overflow: 'hidden',
            'background-color': '#fff',
            flex: 1,
            'min-height': 0,
        },
    };

    const fpsColor = () => fps() >= 55 ? '#10b981' : fps() >= 30 ? '#f59e0b' : '#ef4444';
    const frameColor = (v) => v <= 16.67 ? '#10b981' : v <= 33 ? '#f59e0b' : '#ef4444';

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h1 style={{ margin: 0, 'font-size': '20px' }}>Performance Test</h1>

                <div style={styles.stats}>
                    <div style={styles.statItem}>
                        <span style={styles.statLabel}>Tasks:</span>
                        <span style={styles.statValue}>{domStats().tasks}</span>
                    </div>
                    <div style={styles.statItem}>
                        <span style={styles.statLabel}>Arrows:</span>
                        <span style={styles.statValue}>{domStats().arrows}</span>
                    </div>
                    <div style={styles.statItem}>
                        <span style={styles.statLabel}>Render:</span>
                        <span style={styles.statValue}>{renderTime() ? `${renderTime()}ms` : '...'}</span>
                    </div>
                    <div style={styles.statItem}>
                        <span style={styles.statLabel}>FPS:</span>
                        <span style={{ ...styles.statValue, color: fpsColor() }}>{fps()}</span>
                    </div>
                    <div style={styles.statItem}>
                        <span style={styles.statLabel}>Worst:</span>
                        <span style={{ ...styles.statValue, color: frameColor(worstFrameTime()) }}>{worstFrameTime()}ms</span>
                    </div>
                    <div style={styles.statItem}>
                        <span style={styles.statLabel}>Avg:</span>
                        <span style={{ ...styles.statValue, color: frameColor(avgFrameTime()) }}>{avgFrameTime()}ms</span>
                    </div>
                    <div style={styles.statItem}>
                        <span style={styles.statLabel}>Scroll/s:</span>
                        <span style={styles.statValue}>{scrollEventsPerSec()}</span>
                    </div>
                    <div style={styles.statItem}>
                        <span style={styles.statLabel}>Heap:</span>
                        <span style={styles.statValue}>{heapSize() ? `${heapSize()}MB` : 'N/A'}</span>
                    </div>
                </div>

                <div style={styles.controls}>
                    <label style={{ 'font-size': '13px' }}>
                        View:
                        <select
                            value={viewMode()}
                            onChange={(e) => setViewMode(e.target.value)}
                            style={{ ...styles.select, width: '100px', 'margin-left': '5px' }}
                        >
                            <option value="Hour">Hour</option>
                            <option value="Day">Day</option>
                            <option value="Week">Week</option>
                            <option value="Month">Month</option>
                        </select>
                    </label>
                    <button onClick={loadTasks} style={styles.button}>Reload</button>
                    <button
                        onClick={runScrollStressTest}
                        style={{ ...styles.button, 'background-color': stressTestRunning() ? '#ef4444' : '#8b5cf6' }}
                    >
                        {stressTestRunning() ? 'Stop' : 'H-Scroll'}
                    </button>
                    <button
                        onClick={runVerticalScrollStressTest}
                        style={{ ...styles.button, 'background-color': verticalStressTestRunning() ? '#ef4444' : '#8b5cf6' }}
                    >
                        {verticalStressTestRunning() ? 'Stop' : 'V-Scroll'}
                    </button>
                    <span style={{ color: '#9ca3af', margin: '0 5px' }}>|</span>
                    <button
                        onClick={startBenchmark}
                        style={{ ...styles.button, 'background-color': benchmarkRunning() ? '#ef4444' : '#059669' }}
                    >
                        {benchmarkRunning() ? 'Stop Bench' : 'Benchmark'}
                    </button>
                    <button
                        onClick={exportBenchmark}
                        style={{ ...styles.button, 'background-color': lastBenchmarkResult() ? '#0891b2' : '#6b7280' }}
                        disabled={!lastBenchmarkResult()}
                    >
                        Export JSON
                    </button>
                    <label style={{ 'font-size': '13px' }}>
                        Arrows:
                        <select
                            value={arrowRenderer()}
                            onChange={(e) => setArrowRenderer(e.target.value)}
                            style={{ ...styles.select, width: '100px', 'margin-left': '5px' }}
                        >
                            <option value="individual">Individual</option>
                            <option value="batched">Batched</option>
                        </select>
                    </label>
                    <label style={{ 'font-size': '13px' }}>
                        Mode:
                        <select
                            value={renderMode()}
                            onChange={(e) => setRenderMode(e.target.value)}
                            style={{ ...styles.select, width: '100px', 'margin-left': '5px' }}
                        >
                            <option value="simple">Simple</option>
                            <option value="detailed">Detailed</option>
                        </select>
                    </label>
                    <label style={{ 'font-size': '13px' }}>
                        TaskLayer:
                        <select
                            value={taskLayerMode()}
                            onChange={(e) => setTaskLayerMode(e.target.value)}
                            style={{ ...styles.select, width: '100px', 'margin-left': '5px' }}
                        >
                            <option value="full">Full</option>
                            <option value="minimal">Minimal (V7j)</option>
                        </select>
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '15px', 'align-items': 'center', 'font-size': '12px', color: '#6b7280' }}>
                    <span style={{ 'font-weight': 'bold' }}>Buffers:</span>
                    <label style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
                        Rows:
                        <input type="range" min="1" max="30" value={overscanRows()}
                               onInput={(e) => setOverscanRows(+e.target.value)} style={{ width: '60px' }} />
                        <span style={{ 'min-width': '20px' }}>{overscanRows()}</span>
                    </label>
                    <label style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
                        X:
                        <input type="range" min="200" max="3000" step="100" value={overscanX()}
                               onInput={(e) => setOverscanX(+e.target.value)} style={{ width: '60px' }} />
                        <span style={{ 'min-width': '45px' }}>{overscanX()}px</span>
                    </label>
                    <label style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
                        Cols:
                        <input type="range" min="1" max="30" value={overscanCols()}
                               onInput={(e) => setOverscanCols(+e.target.value)} style={{ width: '60px' }} />
                        <span style={{ 'min-width': '20px' }}>{overscanCols()}</span>
                    </label>
                </div>
            </div>

            <div style={styles.ganttWrapper}>
                <Gantt
                    tasks={tasks()}
                    options={options()}
                    overscanRows={overscanRows()}
                    overscanX={overscanX()}
                    overscanCols={overscanCols()}
                    arrowRenderer={arrowRenderer()}
                    taskLayerMode={taskLayerMode()}
                    onDateChange={(id, pos) => console.log('Date changed:', id, pos)}
                    onProgressChange={(id, prog) => console.log('Progress changed:', id, prog)}
                    onTaskClick={(id) => console.log('Task clicked:', id)}
                />
            </div>
        </div>
    );
}

export default GanttPerfDemo;
