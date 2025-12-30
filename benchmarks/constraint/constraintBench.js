/**
 * Constraint Resolution Benchmark Harness
 *
 * Provides utilities for measuring function execution time
 * with statistical aggregation.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_CONFIG = {
    warmupRuns: 5,      // JIT warmup iterations (discarded)
    measuredRuns: 100,  // Measured iterations
    gcBetweenRuns: false, // Force GC between runs (Node.js --expose-gc)
};

// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate statistics from an array of timing measurements.
 * @param {number[]} times - Array of execution times in ms
 * @returns {Object} Statistics object
 */
export function calculateStats(times) {
    if (times.length === 0) {
        return { mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0, stdDev: 0 };
    }

    const sorted = [...times].sort((a, b) => a - b);
    const n = sorted.length;

    const mean = times.reduce((a, b) => a + b, 0) / n;
    const median = sorted[Math.floor(n / 2)];
    const p95 = sorted[Math.floor(n * 0.95)];
    const p99 = sorted[Math.floor(n * 0.99)];
    const min = sorted[0];
    const max = sorted[n - 1];

    // Standard deviation
    const squaredDiffs = times.map(t => Math.pow(t - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return { mean, median, p95, p99, min, max, stdDev };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Benchmark a single function.
 *
 * @param {string} name - Benchmark name
 * @param {Function} fn - Function to benchmark (called with no args)
 * @param {Object} config - Configuration options
 * @returns {Object} Benchmark results
 */
export function benchmark(name, fn, config = {}) {
    const { warmupRuns, measuredRuns, gcBetweenRuns } = { ...DEFAULT_CONFIG, ...config };

    // Warmup (JIT compilation)
    for (let i = 0; i < warmupRuns; i++) {
        fn();
    }

    // Optional GC before measurement
    if (gcBetweenRuns && typeof global !== 'undefined' && global.gc) {
        global.gc();
    }

    // Measure
    const times = [];
    for (let i = 0; i < measuredRuns; i++) {
        const start = performance.now();
        fn();
        const end = performance.now();
        times.push(end - start);

        // Optional GC between runs
        if (gcBetweenRuns && typeof global !== 'undefined' && global.gc) {
            global.gc();
        }
    }

    const stats = calculateStats(times);

    return {
        name,
        runs: measuredRuns,
        ...stats,
        times, // Raw data for further analysis
    };
}

/**
 * Benchmark a function with setup/teardown.
 *
 * @param {string} name - Benchmark name
 * @param {Function} setup - Setup function, returns context passed to fn
 * @param {Function} fn - Function to benchmark, receives context from setup
 * @param {Object} config - Configuration options
 * @returns {Object} Benchmark results
 */
export function benchmarkWithSetup(name, setup, fn, config = {}) {
    const { warmupRuns, measuredRuns } = { ...DEFAULT_CONFIG, ...config };

    // Warmup
    for (let i = 0; i < warmupRuns; i++) {
        const ctx = setup();
        fn(ctx);
    }

    // Measure
    const times = [];
    for (let i = 0; i < measuredRuns; i++) {
        const ctx = setup();
        const start = performance.now();
        fn(ctx);
        const end = performance.now();
        times.push(end - start);
    }

    const stats = calculateStats(times);

    return {
        name,
        runs: measuredRuns,
        ...stats,
        times,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK SUITE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run a suite of benchmarks.
 *
 * @param {string} suiteName - Suite name
 * @param {Array<{name: string, fn: Function}>} benchmarks - Array of benchmarks
 * @param {Object} config - Configuration options
 * @returns {Object} Suite results
 */
export function runSuite(suiteName, benchmarks, config = {}) {
    const results = [];

    for (const { name, fn } of benchmarks) {
        const result = benchmark(name, fn, config);
        results.push(result);
    }

    return {
        suite: suiteName,
        timestamp: new Date().toISOString(),
        config: { ...DEFAULT_CONFIG, ...config },
        results,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format a number as milliseconds with appropriate precision.
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted string
 */
export function formatMs(ms) {
    if (ms < 0.001) return `${(ms * 1000).toFixed(2)}μs`;
    if (ms < 1) return `${ms.toFixed(3)}ms`;
    return `${ms.toFixed(2)}ms`;
}

/**
 * Format benchmark results as a table string.
 * @param {Object} result - Single benchmark result
 * @returns {string} Formatted output
 */
export function formatResult(result) {
    const lines = [
        `${result.name}:`,
        `  mean: ${formatMs(result.mean)}, median: ${formatMs(result.median)}`,
        `  p95: ${formatMs(result.p95)}, p99: ${formatMs(result.p99)}`,
        `  min: ${formatMs(result.min)}, max: ${formatMs(result.max)}`,
        `  stdDev: ${formatMs(result.stdDev)}`,
    ];
    return lines.join('\n');
}

/**
 * Format suite results.
 * @param {Object} suiteResults - Suite results object
 * @returns {string} Formatted output
 */
export function formatSuite(suiteResults) {
    const lines = [
        '═'.repeat(60),
        `Benchmark Suite: ${suiteResults.suite}`,
        `Timestamp: ${suiteResults.timestamp}`,
        `Runs: ${suiteResults.config.measuredRuns} (warmup: ${suiteResults.config.warmupRuns})`,
        '─'.repeat(60),
    ];

    for (const result of suiteResults.results) {
        lines.push('');
        lines.push(formatResult(result));
    }

    lines.push('═'.repeat(60));
    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compare two benchmark results.
 * @param {Object} baseline - Baseline result
 * @param {Object} candidate - Candidate result
 * @returns {Object} Comparison metrics
 */
export function compareResults(baseline, candidate) {
    const speedup = baseline.mean / candidate.mean;
    const improvement = ((baseline.mean - candidate.mean) / baseline.mean) * 100;

    return {
        baseline: baseline.name,
        candidate: candidate.name,
        baselineMean: baseline.mean,
        candidateMean: candidate.mean,
        speedup,
        improvement,
        faster: speedup > 1,
    };
}

/**
 * Format comparison results.
 * @param {Object} comparison - Comparison object
 * @returns {string} Formatted output
 */
export function formatComparison(comparison) {
    const arrow = comparison.faster ? '↓' : '↑';
    const sign = comparison.faster ? '-' : '+';
    const pct = Math.abs(comparison.improvement).toFixed(1);

    return [
        `${comparison.baseline} vs ${comparison.candidate}`,
        `  ${formatMs(comparison.baselineMean)} → ${formatMs(comparison.candidateMean)}`,
        `  ${sign}${pct}% (${comparison.speedup.toFixed(2)}x) ${arrow}`,
    ].join('\n');
}
