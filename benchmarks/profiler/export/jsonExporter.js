/**
 * JSON Exporter - Export benchmark results for analysis and CI/CD
 *
 * Exports a structured JSON format containing:
 * - Metadata (version, timestamp, browser info)
 * - Configuration (task count, arrow count, viewport)
 * - Frame metrics (FPS, timing percentiles)
 * - Memo analysis (recommendations)
 * - Memory metrics (if available)
 */

/**
 * @typedef {Object} BenchmarkResult
 * @property {Object} metadata - Version, timestamp, browser
 * @property {Object} configuration - Test configuration
 * @property {Object} frameMetrics - Frame timing analysis
 * @property {Object} memoAnalysis - Memo tracking results
 * @property {Object} memory - Memory usage (optional)
 * @property {Array} timeline - FPS over time
 */

/**
 * Create a benchmark result object
 *
 * @param {Object} options
 * @param {Object} options.frameAnalysis - From frameMetrics.analyze()
 * @param {Object} options.memoAnalysis - From memoTracker.analyzeMemos()
 * @param {Object} options.config - Test configuration
 * @param {Array} options.timeline - From frameMetrics.getFPSTimeline()
 * @returns {BenchmarkResult}
 */
export function createBenchmarkResult(options) {
    const {
        frameAnalysis = {},
        memoAnalysis = {},
        config = {},
        timeline = [],
    } = options;

    return {
        metadata: {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            browser: getBrowserInfo(),
            userAgent: navigator?.userAgent || 'unknown',
        },
        configuration: {
            taskCount: config.taskCount ?? 0,
            arrowCount: config.arrowCount ?? 0,
            viewMode: config.viewMode ?? 'Day',
            viewportWidth: config.viewportWidth ?? window?.innerWidth ?? 0,
            viewportHeight: config.viewportHeight ?? window?.innerHeight ?? 0,
            arrowRenderer: config.arrowRenderer ?? 'individual',
            testDuration: config.testDuration ?? 0,
            testType: config.testType ?? 'manual',
        },
        frameMetrics: {
            frameCount: frameAnalysis.frameCount ?? 0,
            totalDuration: round(frameAnalysis.totalDuration),
            avgFrameTime: round(frameAnalysis.avgFrameTime),
            avgFPS: round(frameAnalysis.avgFPS),
            minFrameTime: round(frameAnalysis.minFrameTime),
            maxFrameTime: round(frameAnalysis.maxFrameTime),
            percentile95: round(frameAnalysis.percentile95),
            percentile99: round(frameAnalysis.percentile99),
            droppedFrames: frameAnalysis.droppedFrames ?? 0,
            droppedFramePercent: round(frameAnalysis.droppedFramePercent),
            blockingTime: round(frameAnalysis.blockingTime),
            source: frameAnalysis.source ?? 'unknown',
            worstFrame: frameAnalysis.worstFrame
                ? {
                      timestamp: round(frameAnalysis.worstFrame.timestamp),
                      duration: round(frameAnalysis.worstFrame.duration),
                      blockingDuration: round(
                          frameAnalysis.worstFrame.blockingDuration
                      ),
                      scripts: frameAnalysis.worstFrame.scripts || [],
                  }
                : null,
        },
        memoAnalysis: {
            summary: memoAnalysis.summary ?? {},
            recommendations: (memoAnalysis.recommendations || []).slice(0, 20),
            cascades: (memoAnalysis.cascades || []).slice(0, 10),
        },
        memory: getMemoryInfo(),
        timeline: timeline.map((t) => ({
            time: round(t.time),
            fps: round(t.fps),
            frameCount: t.frameCount,
        })),
    };
}

/**
 * Export benchmark result as JSON string
 *
 * @param {BenchmarkResult} result
 * @param {Object} options
 * @param {boolean} options.pretty - Pretty print JSON (default: true)
 * @returns {string}
 */
export function exportJSON(result, options = {}) {
    const { pretty = true } = options;
    return JSON.stringify(result, null, pretty ? 2 : 0);
}

/**
 * Download benchmark result as JSON file
 *
 * @param {BenchmarkResult} result
 * @param {string} filename - Optional filename (default: benchmark-{timestamp}.json)
 */
export function downloadJSON(result, filename) {
    const json = exportJSON(result);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = filename || `gantt-benchmark-${timestamp}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();

    URL.revokeObjectURL(url);
}

/**
 * Store benchmark result to localStorage
 *
 * @param {BenchmarkResult} result
 * @param {string} key - Storage key (default: 'gantt-benchmark-latest')
 */
export function storeBenchmark(result, key = 'gantt-benchmark-latest') {
    try {
        localStorage.setItem(key, exportJSON(result, { pretty: false }));
        return true;
    } catch (e) {
        console.warn('Failed to store benchmark:', e);
        return false;
    }
}

/**
 * Load benchmark result from localStorage
 *
 * @param {string} key - Storage key
 * @returns {BenchmarkResult | null}
 */
export function loadBenchmark(key = 'gantt-benchmark-latest') {
    try {
        const json = localStorage.getItem(key);
        return json ? JSON.parse(json) : null;
    } catch (e) {
        console.warn('Failed to load benchmark:', e);
        return null;
    }
}

/**
 * Compare two benchmark results
 *
 * @param {BenchmarkResult} baseline
 * @param {BenchmarkResult} current
 * @returns {Object} Comparison with deltas and pass/fail status
 */
export function compareBenchmarks(baseline, current) {
    const comparison = {
        metadata: {
            baselineTimestamp: baseline.metadata?.timestamp,
            currentTimestamp: current.metadata?.timestamp,
        },
        frameMetrics: {},
        status: 'pass',
        regressions: [],
        improvements: [],
    };

    // Compare frame metrics
    const metrics = [
        { key: 'avgFPS', threshold: -5, higherIsBetter: true },
        { key: 'avgFrameTime', threshold: 5, higherIsBetter: false },
        { key: 'maxFrameTime', threshold: 10, higherIsBetter: false },
        { key: 'percentile95', threshold: 5, higherIsBetter: false },
        { key: 'droppedFramePercent', threshold: 5, higherIsBetter: false },
    ];

    for (const { key, threshold, higherIsBetter } of metrics) {
        const baseVal = baseline.frameMetrics?.[key] ?? 0;
        const currVal = current.frameMetrics?.[key] ?? 0;
        const delta = currVal - baseVal;
        const percentChange = baseVal !== 0 ? (delta / baseVal) * 100 : 0;

        const isRegression = higherIsBetter
            ? percentChange < threshold
            : percentChange > threshold;

        const isImprovement = higherIsBetter
            ? percentChange > Math.abs(threshold)
            : percentChange < -Math.abs(threshold);

        comparison.frameMetrics[key] = {
            baseline: baseVal,
            current: currVal,
            delta: round(delta),
            percentChange: round(percentChange),
            status: isRegression ? 'regression' : isImprovement ? 'improvement' : 'neutral',
        };

        if (isRegression) {
            comparison.status = 'fail';
            comparison.regressions.push(key);
        } else if (isImprovement) {
            comparison.improvements.push(key);
        }
    }

    return comparison;
}

/**
 * Generate a summary report string
 *
 * @param {BenchmarkResult} result
 * @returns {string}
 */
export function generateReport(result) {
    const lines = [];

    lines.push('=== Gantt Chart Performance Benchmark ===');
    lines.push(`Timestamp: ${result.metadata.timestamp}`);
    lines.push(`Browser: ${result.metadata.browser}`);
    lines.push('');

    lines.push('Configuration:');
    lines.push(`  Tasks: ${result.configuration.taskCount}`);
    lines.push(`  Arrows: ${result.configuration.arrowCount}`);
    lines.push(`  Arrow Renderer: ${result.configuration.arrowRenderer}`);
    lines.push(`  Viewport: ${result.configuration.viewportWidth}x${result.configuration.viewportHeight}`);
    lines.push('');

    lines.push('Frame Metrics:');
    lines.push(`  Average FPS: ${result.frameMetrics.avgFPS}`);
    lines.push(`  Average Frame: ${result.frameMetrics.avgFrameTime}ms`);
    lines.push(`  Worst Frame: ${result.frameMetrics.maxFrameTime}ms`);
    lines.push(`  95th Percentile: ${result.frameMetrics.percentile95}ms`);
    lines.push(`  Dropped Frames: ${result.frameMetrics.droppedFrames} (${result.frameMetrics.droppedFramePercent}%)`);
    lines.push(`  Measurement Source: ${result.frameMetrics.source}`);
    lines.push('');

    if (result.memoAnalysis?.summary?.memoCount) {
        lines.push('Memo Analysis:');
        lines.push(`  Tracked Memos: ${result.memoAnalysis.summary.memoCount}`);
        lines.push(`  Total Invocations: ${result.memoAnalysis.summary.totalInvocations}`);
        lines.push(`  Total Time: ${round(result.memoAnalysis.summary.totalTime)}ms`);
        lines.push(`  Cascade Events: ${result.memoAnalysis.summary.cascadeEvents}`);

        if (result.memoAnalysis.recommendations?.length > 0) {
            lines.push('');
            lines.push('Top Recommendations:');
            for (const rec of result.memoAnalysis.recommendations.slice(0, 5)) {
                lines.push(`  [${rec.status}] ${rec.name}`);
                if (rec.reason) lines.push(`    ${rec.reason}`);
            }
        }
    }

    if (result.memory?.jsHeapSizeLimit) {
        lines.push('');
        lines.push('Memory:');
        lines.push(`  Used Heap: ${formatBytes(result.memory.usedJSHeapSize)}`);
        lines.push(`  Total Heap: ${formatBytes(result.memory.totalJSHeapSize)}`);
    }

    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function round(num, decimals = 2) {
    if (typeof num !== 'number' || isNaN(num)) return 0;
    return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function getBrowserInfo() {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = navigator.userAgent;
    if (ua.includes('Chrome')) {
        const match = ua.match(/Chrome\/(\d+)/);
        return `Chrome ${match?.[1] || ''}`;
    }
    if (ua.includes('Firefox')) {
        const match = ua.match(/Firefox\/(\d+)/);
        return `Firefox ${match?.[1] || ''}`;
    }
    if (ua.includes('Safari') && !ua.includes('Chrome')) {
        const match = ua.match(/Version\/(\d+)/);
        return `Safari ${match?.[1] || ''}`;
    }
    return 'unknown';
}

function getMemoryInfo() {
    if (typeof performance === 'undefined' || !performance.memory) {
        return null;
    }
    return {
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        usedJSHeapSize: performance.memory.usedJSHeapSize,
    };
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default {
    createBenchmarkResult,
    exportJSON,
    downloadJSON,
    storeBenchmark,
    loadBenchmark,
    compareBenchmarks,
    generateReport,
};
