/**
 * Gantt Chart Performance Benchmark Module
 *
 * QUICK START - Function Profiler:
 *
 *   1. Open browser console
 *   2. prof.enable()
 *   3. Scroll the chart
 *   4. prof.log()
 *
 * Or visit /examples/profiler.html for the visual profiler.
 *
 * The profiler instruments these hot paths:
 * - taskStore.getBarPosition
 * - ArrowLayer.visibleDependencies
 * - TaskLayer.visibleTaskIds
 * - Arrow.generatePath
 */

// Inline Function Profiler (main tool)
export { prof } from './profiler.js';

// Frame Metrics
export {
    createFrameMetrics,
    benchmarkFrames,
    default as FrameMetrics,
} from './metrics/frameMetrics.js';

// Memo Tracking
export {
    createTrackedMemo,
    trackFunction,
    startMemoTracking,
    stopMemoTracking,
    clearMemoTracking,
    getMemoStats,
    getMemoStat,
    getInvocationLog,
    detectCascades,
    analyzeMemos,
    default as MemoTracker,
} from './instrumentation/memoTracker.js';

// JSON Export
export {
    createBenchmarkResult,
    exportJSON,
    downloadJSON,
    storeBenchmark,
    loadBenchmark,
    compareBenchmarks,
    generateReport,
    default as JsonExporter,
} from './export/jsonExporter.js';

/**
 * Create a complete benchmark runner
 *
 * Usage:
 *   const benchmark = createBenchmarkRunner({ taskCount: 200, arrowCount: 500 });
 *   benchmark.start();
 *   // ... scroll test ...
 *   const results = benchmark.stop();
 *   benchmark.download();
 *
 * @param {Object} config - Test configuration
 * @returns {Object} Benchmark runner API
 */
export function createBenchmarkRunner(config = {}) {
    const { createFrameMetrics } = require('./metrics/frameMetrics.js');
    const {
        startMemoTracking,
        stopMemoTracking,
        analyzeMemos,
        clearMemoTracking,
    } = require('./instrumentation/memoTracker.js');
    const {
        createBenchmarkResult,
        downloadJSON,
        generateReport,
    } = require('./export/jsonExporter.js');

    const frameTracker = createFrameMetrics();
    let startTime = 0;
    let results = null;

    return {
        /**
         * Start the benchmark
         */
        start() {
            clearMemoTracking();
            startMemoTracking();
            frameTracker.startTracking();
            startTime = performance.now();
        },

        /**
         * Stop the benchmark and collect results
         * @returns {Object} Benchmark results
         */
        stop() {
            frameTracker.stopTracking();
            stopMemoTracking();

            const duration = performance.now() - startTime;
            const frameAnalysis = frameTracker.analyze();
            const memoAnalysis = analyzeMemos();
            const timeline = frameTracker.getFPSTimeline(100);

            results = createBenchmarkResult({
                frameAnalysis,
                memoAnalysis,
                timeline,
                config: {
                    ...config,
                    testDuration: duration,
                    testType: 'manual',
                },
            });

            return results;
        },

        /**
         * Get results (after stop)
         * @returns {Object | null}
         */
        getResults() {
            return results;
        },

        /**
         * Download results as JSON
         * @param {string} filename - Optional filename
         */
        download(filename) {
            if (results) {
                downloadJSON(results, filename);
            }
        },

        /**
         * Get text report
         * @returns {string}
         */
        getReport() {
            return results ? generateReport(results) : '';
        },

        /**
         * Reset for a new run
         */
        reset() {
            frameTracker.clear();
            clearMemoTracking();
            results = null;
            startTime = 0;
        },

        /**
         * Check if Long Animation Frames API is available
         */
        get hasLAF() {
            return frameTracker.hasLAF;
        },
    };
}

/**
 * Convenience: Run an automated scroll benchmark
 *
 * @param {HTMLElement} scrollContainer - Element to scroll
 * @param {Object} options
 * @param {number} options.duration - Test duration in ms (default 3000)
 * @param {number} options.scrollSpeed - Pixels per frame (default 10)
 * @param {string} options.direction - 'horizontal' | 'vertical' (default 'vertical')
 * @param {Object} options.config - Additional config for results
 * @returns {Promise<Object>} Benchmark results
 */
export async function runScrollBenchmark(scrollContainer, options = {}) {
    const {
        duration = 3000,
        scrollSpeed = 10,
        direction = 'vertical',
        config = {},
    } = options;

    const benchmark = createBenchmarkRunner(config);

    return new Promise((resolve) => {
        let elapsed = 0;
        let lastTime = performance.now();

        benchmark.start();

        function scroll() {
            const now = performance.now();
            const delta = now - lastTime;
            lastTime = now;
            elapsed += delta;

            if (elapsed >= duration) {
                const results = benchmark.stop();
                resolve(results);
                return;
            }

            // Scroll
            if (direction === 'horizontal') {
                scrollContainer.scrollLeft += scrollSpeed;
                // Wrap around
                if (
                    scrollContainer.scrollLeft >=
                    scrollContainer.scrollWidth - scrollContainer.clientWidth
                ) {
                    scrollContainer.scrollLeft = 0;
                }
            } else {
                scrollContainer.scrollTop += scrollSpeed;
                // Wrap around
                if (
                    scrollContainer.scrollTop >=
                    scrollContainer.scrollHeight - scrollContainer.clientHeight
                ) {
                    scrollContainer.scrollTop = 0;
                }
            }

            requestAnimationFrame(scroll);
        }

        requestAnimationFrame(scroll);
    });
}

// Expose on window for debugging
if (typeof window !== 'undefined') {
    window.__ganttPerf = {
        createFrameMetrics: () => require('./metrics/frameMetrics.js').createFrameMetrics(),
        createBenchmarkRunner,
        runScrollBenchmark,
    };
}
