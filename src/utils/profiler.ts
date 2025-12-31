/**
 * No-op Profiler Stub for Production
 *
 * Production builds use this no-op profiler. For actual profiling,
 * use the full profiler in benchmarks/profiler/profiler.js
 */

interface ProfilerData {
    count: number;
    totalTime: number;
    minTime: number;
    maxTime: number;
}

interface Profiler {
    start: (name: string) => () => void;
    enable: () => void;
    disable: () => void;
    reset: () => void;
    report: () => string;
    getData: () => Map<string, ProfilerData>;
    isEnabled: () => boolean;
}

const noop = (): void => {};

export const prof: Profiler = {
    start: () => noop,
    enable: noop,
    disable: noop,
    reset: noop,
    report: () => '',
    getData: () => new Map(),
    isEnabled: () => false,
};
