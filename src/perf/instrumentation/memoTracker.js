/**
 * Memo Tracker - Wraps SolidJS createMemo to track invocations
 *
 * Tracks:
 * - Call count per memo
 * - Execution time per invocation
 * - Cascade detection (multiple memos firing in same frame)
 * - Recommendations for memoization decisions
 *
 * Usage:
 *   import { createTrackedMemo, getMemoStats, analyzeMemos } from './memoTracker';
 *
 *   // In component:
 *   const visibleTasks = createTrackedMemo(() => filterTasks(), 'visibleTasks');
 *
 *   // After benchmark:
 *   console.log(analyzeMemos());
 */

import { createMemo } from 'solid-js';

/** @type {Map<string, MemoStats>} */
const memoRegistry = new Map();

/** @type {Array<MemoInvocation>} */
let invocationLog = [];

/** Track frame boundaries for cascade detection */
let currentFrameId = 0;
let frameStartTime = 0;
let isTracking = false;

/**
 * @typedef {Object} MemoStats
 * @property {string} name - Memo identifier
 * @property {number} callCount - Total invocations
 * @property {number} totalTime - Cumulative execution time (ms)
 * @property {number} avgTime - Average execution time (ms)
 * @property {number} minTime - Fastest execution (ms)
 * @property {number} maxTime - Slowest execution (ms)
 * @property {string} location - Optional source location
 */

/**
 * @typedef {Object} MemoInvocation
 * @property {string} name - Memo name
 * @property {number} timestamp - performance.now()
 * @property {number} duration - Execution time (ms)
 * @property {number} frameId - Which frame this occurred in
 */

/**
 * Start tracking memo invocations
 */
export function startMemoTracking() {
    isTracking = true;
    invocationLog = [];
    currentFrameId = 0;

    // Track frame boundaries
    function nextFrame() {
        if (!isTracking) return;
        currentFrameId++;
        frameStartTime = performance.now();
        requestAnimationFrame(nextFrame);
    }
    requestAnimationFrame(nextFrame);
}

/**
 * Stop tracking memo invocations
 */
export function stopMemoTracking() {
    isTracking = false;
}

/**
 * Clear all tracked data
 */
export function clearMemoTracking() {
    memoRegistry.clear();
    invocationLog = [];
    currentFrameId = 0;
}

/**
 * Create a tracked memo that logs invocations
 *
 * @template T
 * @param {() => T} fn - Memo computation function
 * @param {string} name - Unique identifier for this memo
 * @param {Object} options - SolidJS memo options
 * @returns {() => T} Memo accessor
 */
export function createTrackedMemo(fn, name, options) {
    // Initialize stats for this memo
    if (!memoRegistry.has(name)) {
        memoRegistry.set(name, {
            name,
            callCount: 0,
            totalTime: 0,
            avgTime: 0,
            minTime: Infinity,
            maxTime: 0,
            location: getCallLocation(),
        });
    }

    // Wrap the computation
    const trackedFn = () => {
        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;

        // Update stats
        const stats = memoRegistry.get(name);
        stats.callCount++;
        stats.totalTime += duration;
        stats.avgTime = stats.totalTime / stats.callCount;
        stats.minTime = Math.min(stats.minTime, duration);
        stats.maxTime = Math.max(stats.maxTime, duration);

        // Log invocation if tracking enabled
        if (isTracking) {
            invocationLog.push({
                name,
                timestamp: start,
                duration,
                frameId: currentFrameId,
            });
        }

        return result;
    };

    return createMemo(trackedFn, undefined, options);
}

/**
 * Get stats for all tracked memos
 * @returns {MemoStats[]}
 */
export function getMemoStats() {
    return Array.from(memoRegistry.values()).map((stats) => ({
        ...stats,
        minTime: stats.minTime === Infinity ? 0 : stats.minTime,
    }));
}

/**
 * Get stats for a specific memo
 * @param {string} name
 * @returns {MemoStats | undefined}
 */
export function getMemoStat(name) {
    const stats = memoRegistry.get(name);
    if (!stats) return undefined;
    return {
        ...stats,
        minTime: stats.minTime === Infinity ? 0 : stats.minTime,
    };
}

/**
 * Get raw invocation log
 * @returns {MemoInvocation[]}
 */
export function getInvocationLog() {
    return [...invocationLog];
}

/**
 * Detect cascade patterns - multiple memos firing in the same frame
 * @returns {Object[]} Cascade events
 */
export function detectCascades() {
    // Group invocations by frame
    const byFrame = new Map();
    for (const inv of invocationLog) {
        if (!byFrame.has(inv.frameId)) {
            byFrame.set(inv.frameId, []);
        }
        byFrame.get(inv.frameId).push(inv);
    }

    // Find frames with multiple memos
    const cascades = [];
    for (const [frameId, invocations] of byFrame) {
        if (invocations.length > 1) {
            const uniqueMemos = new Set(invocations.map((i) => i.name));
            const totalTime = invocations.reduce((sum, i) => sum + i.duration, 0);

            cascades.push({
                frameId,
                memoCount: uniqueMemos.size,
                invocationCount: invocations.length,
                totalTime,
                memos: Array.from(uniqueMemos),
                invocations: invocations.sort((a, b) => a.timestamp - b.timestamp),
            });
        }
    }

    return cascades.sort((a, b) => b.totalTime - a.totalTime);
}

/**
 * Analyze memos and provide recommendations
 *
 * @returns {Object} Analysis with recommendations
 */
export function analyzeMemos() {
    const stats = getMemoStats();
    const cascades = detectCascades();
    const recommendations = [];

    // Thresholds for recommendations
    const CHEAP_THRESHOLD_MS = 0.1; // Under 0.1ms is cheap
    const EXPENSIVE_THRESHOLD_MS = 1; // Over 1ms is expensive
    const HIGH_FREQUENCY_THRESHOLD = 100; // More than 100 calls is high
    const CASCADE_THRESHOLD = 5; // More than 5 cascades is suspicious

    for (const stat of stats) {
        const rec = {
            name: stat.name,
            status: 'KEEP_MEMO',
            reason: '',
            metrics: {
                callCount: stat.callCount,
                avgTime: stat.avgTime.toFixed(3),
                totalTime: stat.totalTime.toFixed(3),
            },
        };

        // Check if memo is too cheap to be worth it
        if (stat.avgTime < CHEAP_THRESHOLD_MS && stat.callCount < HIGH_FREQUENCY_THRESHOLD) {
            rec.status = 'CONSIDER_PLAIN_FUNCTION';
            rec.reason =
                `Avg time ${stat.avgTime.toFixed(3)}ms is under ${CHEAP_THRESHOLD_MS}ms threshold. ` +
                `Memo overhead may exceed computation cost.`;
        }
        // Check for high frequency with expensive computation
        else if (stat.avgTime > EXPENSIVE_THRESHOLD_MS && stat.callCount > HIGH_FREQUENCY_THRESHOLD) {
            rec.status = 'OPTIMIZE_COMPUTATION';
            rec.reason =
                `Called ${stat.callCount} times with avg ${stat.avgTime.toFixed(3)}ms. ` +
                `Total ${stat.totalTime.toFixed(1)}ms spent in this memo.`;
        }
        // Check for cascade involvement
        else {
            const cascadeCount = cascades.filter((c) => c.memos.includes(stat.name)).length;
            if (cascadeCount > CASCADE_THRESHOLD) {
                rec.status = 'CHECK_REACTIVE_CASCADE';
                rec.reason =
                    `Involved in ${cascadeCount} cascade events. ` +
                    `May be triggering unnecessary reactive updates.`;
            }
        }

        recommendations.push(rec);
    }

    // Sort by total time (most expensive first)
    recommendations.sort((a, b) => {
        const aTime = parseFloat(a.metrics.totalTime);
        const bTime = parseFloat(b.metrics.totalTime);
        return bTime - aTime;
    });

    return {
        summary: {
            memoCount: stats.length,
            totalInvocations: stats.reduce((sum, s) => sum + s.callCount, 0),
            totalTime: stats.reduce((sum, s) => sum + s.totalTime, 0),
            cascadeEvents: cascades.length,
        },
        recommendations,
        cascades: cascades.slice(0, 10), // Top 10 worst cascades
    };
}

/**
 * Get approximate call location from stack trace
 * @returns {string}
 */
function getCallLocation() {
    try {
        const stack = new Error().stack;
        const lines = stack.split('\n');
        // Skip Error, getCallLocation, createTrackedMemo
        const callerLine = lines[4] || '';
        const match = callerLine.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/);
        if (match) {
            return `${match[2]}:${match[3]}`;
        }
        return callerLine.trim();
    } catch {
        return 'unknown';
    }
}

/**
 * Create a function call tracker for non-memo functions
 *
 * @param {Function} fn - Function to track
 * @param {string} name - Identifier
 * @returns {Function} Wrapped function
 */
export function trackFunction(fn, name) {
    if (!memoRegistry.has(name)) {
        memoRegistry.set(name, {
            name,
            callCount: 0,
            totalTime: 0,
            avgTime: 0,
            minTime: Infinity,
            maxTime: 0,
            location: getCallLocation(),
        });
    }

    return function tracked(...args) {
        const start = performance.now();
        const result = fn.apply(this, args);
        const duration = performance.now() - start;

        const stats = memoRegistry.get(name);
        stats.callCount++;
        stats.totalTime += duration;
        stats.avgTime = stats.totalTime / stats.callCount;
        stats.minTime = Math.min(stats.minTime, duration);
        stats.maxTime = Math.max(stats.maxTime, duration);

        if (isTracking) {
            invocationLog.push({
                name,
                timestamp: start,
                duration,
                frameId: currentFrameId,
            });
        }

        return result;
    };
}

export default {
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
};
