/**
 * Inline Profiler - Direct timing hooks for hot paths
 *
 * Usage in components:
 *   import { prof } from '../perf/profiler.js';
 *
 *   // In hot path:
 *   const end = prof.start('Arrow.generatePath');
 *   // ... do work ...
 *   end();
 *
 * Results:
 *   prof.report() -> formatted stats
 *   prof.getData() -> raw data
 */

const stats = new Map();
let enabled = false;
let callStack = [];

/**
 * Start timing a function
 * @param {string} name - Function identifier
 * @returns {Function} End function to call when done
 */
function start(name) {
    if (!enabled) return () => {};

    const startTime = performance.now();
    const parentName = callStack.length > 0 ? callStack[callStack.length - 1] : null;
    callStack.push(name);

    return function end() {
        const duration = performance.now() - startTime;
        callStack.pop();

        if (!stats.has(name)) {
            stats.set(name, {
                name,
                calls: 0,
                totalTime: 0,
                selfTime: 0,
                minTime: Infinity,
                maxTime: 0,
                parent: new Map(),
            });
        }

        const stat = stats.get(name);
        stat.calls++;
        stat.totalTime += duration;
        stat.selfTime += duration; // Will be adjusted by children
        stat.minTime = Math.min(stat.minTime, duration);
        stat.maxTime = Math.max(stat.maxTime, duration);

        // Track parent relationship
        if (parentName) {
            const parentStat = stats.get(parentName);
            if (parentStat) {
                parentStat.selfTime -= duration; // Subtract child time from parent's self time
            }
            stat.parent.set(parentName, (stat.parent.get(parentName) || 0) + 1);
        }
    };
}

/**
 * Time a synchronous function
 */
function time(name, fn) {
    if (!enabled) return fn();
    const end = start(name);
    try {
        return fn();
    } finally {
        end();
    }
}

/**
 * Enable profiling
 */
function enable() {
    enabled = true;
    console.log('[Profiler] Enabled');
}

/**
 * Disable profiling
 */
function disable() {
    enabled = false;
    console.log('[Profiler] Disabled');
}

/**
 * Clear all stats
 */
function clear() {
    stats.clear();
    callStack = [];
}

/**
 * Check if enabled
 */
function isEnabled() {
    return enabled;
}

/**
 * Get raw stats data
 */
function getData() {
    return Array.from(stats.values())
        .map(s => ({
            ...s,
            avgTime: s.calls > 0 ? s.totalTime / s.calls : 0,
            minTime: s.minTime === Infinity ? 0 : s.minTime,
            parent: Object.fromEntries(s.parent),
        }))
        .sort((a, b) => b.totalTime - a.totalTime);
}

/**
 * Generate formatted report
 */
function report() {
    const data = getData();
    if (data.length === 0) {
        return 'No profiling data. Call prof.enable() then interact with the chart.';
    }

    const lines = [
        '',
        '='.repeat(90),
        'FUNCTION PROFILER REPORT',
        '='.repeat(90),
        '',
        'Function                              Calls     Total(ms)   Self(ms)    Avg(ms)    Max(ms)',
        '-'.repeat(90),
    ];

    for (const stat of data) {
        const name = stat.name.padEnd(36).slice(0, 36);
        const calls = String(stat.calls).padStart(8);
        const total = stat.totalTime.toFixed(2).padStart(12);
        const self = stat.selfTime.toFixed(2).padStart(10);
        const avg = stat.avgTime.toFixed(3).padStart(10);
        const max = stat.maxTime.toFixed(2).padStart(10);
        lines.push(`${name} ${calls} ${total} ${self} ${avg} ${max}`);
    }

    lines.push('-'.repeat(90));
    lines.push('');

    // Show call relationships
    lines.push('CALL RELATIONSHIPS:');
    for (const stat of data.slice(0, 15)) {
        const parents = Object.entries(stat.parent);
        if (parents.length > 0) {
            lines.push(`  ${stat.name} <- ${parents.map(([p, c]) => `${p}(${c})`).join(', ')}`);
        }
    }

    lines.push('');
    return lines.join('\n');
}

/**
 * Log report to console
 */
function log() {
    console.log(report());
}

// Global profiler object
const prof = {
    start,
    time,
    enable,
    disable,
    clear,
    isEnabled,
    getData,
    report,
    log,
};

// Expose globally
if (typeof window !== 'undefined') {
    window.prof = prof;
}

export { prof };
export default prof;
