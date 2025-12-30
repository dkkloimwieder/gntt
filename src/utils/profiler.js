/**
 * No-op Profiler Stub for Production
 *
 * Production builds use this no-op profiler. For actual profiling,
 * use the full profiler in benchmarks/profiler/profiler.js
 */

const noop = () => {};

export const prof = {
    start: () => noop,
    enable: noop,
    disable: noop,
    reset: noop,
    report: () => '',
    getData: () => new Map(),
    isEnabled: () => false,
};
