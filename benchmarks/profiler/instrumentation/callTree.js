/**
 * Call Tree Instrumentation
 *
 * Wraps functions to build a hierarchical call tree with timing data.
 * Shows exactly where time is spent and call relationships.
 */

// Global state
let rootCalls = [];
let callStack = [];
let isRecording = false;
let callId = 0;

/**
 * Call node structure
 */
function createCallNode(name, args) {
    return {
        id: ++callId,
        name,
        args: summarizeArgs(args),
        startTime: performance.now(),
        endTime: null,
        duration: null,
        children: [],
        parent: null,
    };
}

/**
 * Summarize arguments for display (avoid huge objects)
 */
function summarizeArgs(args) {
    if (!args || args.length === 0) return '';
    try {
        return Array.from(args).map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'string') return `"${arg.slice(0, 20)}"`;
            if (typeof arg === 'number') return String(arg);
            if (typeof arg === 'boolean') return String(arg);
            if (Array.isArray(arg)) return `Array(${arg.length})`;
            if (typeof arg === 'object') return `{${Object.keys(arg).slice(0, 3).join(',')}}`;
            if (typeof arg === 'function') return 'fn()';
            return typeof arg;
        }).join(', ');
    } catch {
        return '...';
    }
}

/**
 * Start recording calls
 */
export function startRecording() {
    rootCalls = [];
    callStack = [];
    callId = 0;
    isRecording = true;
}

/**
 * Stop recording calls
 */
export function stopRecording() {
    isRecording = false;
}

/**
 * Clear recorded data
 */
export function clearRecording() {
    rootCalls = [];
    callStack = [];
    callId = 0;
}

/**
 * Get the call tree
 */
export function getCallTree() {
    return rootCalls;
}

/**
 * Wrap a function with instrumentation
 * @param {Function} fn - Function to wrap
 * @param {string} name - Display name
 * @returns {Function} Wrapped function
 */
export function instrument(fn, name) {
    return function instrumented(...args) {
        if (!isRecording) {
            return fn.apply(this, args);
        }

        const node = createCallNode(name, args);

        // Link to parent
        if (callStack.length > 0) {
            const parent = callStack[callStack.length - 1];
            node.parent = parent.id;
            parent.children.push(node);
        } else {
            rootCalls.push(node);
        }

        callStack.push(node);

        try {
            const result = fn.apply(this, args);
            return result;
        } finally {
            node.endTime = performance.now();
            node.duration = node.endTime - node.startTime;
            callStack.pop();
        }
    };
}

/**
 * Wrap all methods of an object
 * @param {Object} obj - Object with methods to wrap
 * @param {string} prefix - Prefix for method names
 * @param {string[]} methodNames - Methods to wrap (all if not specified)
 */
export function instrumentObject(obj, prefix, methodNames) {
    const methods = methodNames || Object.keys(obj).filter(k => typeof obj[k] === 'function');

    for (const method of methods) {
        if (typeof obj[method] === 'function') {
            const original = obj[method].bind(obj);
            obj[method] = instrument(original, `${prefix}.${method}`);
        }
    }

    return obj;
}

/**
 * Analyze the call tree and return statistics
 */
export function analyzeCallTree() {
    const stats = new Map();

    function traverse(nodes) {
        for (const node of nodes) {
            if (!stats.has(node.name)) {
                stats.set(node.name, {
                    name: node.name,
                    callCount: 0,
                    totalTime: 0,
                    selfTime: 0,
                    minTime: Infinity,
                    maxTime: 0,
                    avgTime: 0,
                });
            }

            const stat = stats.get(node.name);
            stat.callCount++;
            stat.totalTime += node.duration || 0;
            stat.minTime = Math.min(stat.minTime, node.duration || 0);
            stat.maxTime = Math.max(stat.maxTime, node.duration || 0);

            // Self time = total - children
            const childTime = node.children.reduce((sum, c) => sum + (c.duration || 0), 0);
            stat.selfTime += (node.duration || 0) - childTime;

            traverse(node.children);
        }
    }

    traverse(rootCalls);

    // Calculate averages and sort by total time
    const result = Array.from(stats.values())
        .map(s => ({
            ...s,
            avgTime: s.callCount > 0 ? s.totalTime / s.callCount : 0,
            minTime: s.minTime === Infinity ? 0 : s.minTime,
        }))
        .sort((a, b) => b.totalTime - a.totalTime);

    return result;
}

/**
 * Format call tree as indented text
 */
export function formatCallTree(maxDepth = 10) {
    const lines = [];

    function traverse(nodes, depth) {
        if (depth > maxDepth) return;

        for (const node of nodes) {
            const indent = '  '.repeat(depth);
            const duration = node.duration?.toFixed(2) || '?';
            const args = node.args ? `(${node.args})` : '()';
            lines.push(`${indent}${node.name}${args} [${duration}ms]`);
            traverse(node.children, depth + 1);
        }
    }

    traverse(rootCalls, 0);
    return lines.join('\n');
}

/**
 * Format analysis as table
 */
export function formatAnalysis() {
    const analysis = analyzeCallTree();
    const lines = [
        'Function                          Calls    Total(ms)  Self(ms)   Avg(ms)    Max(ms)',
        '─'.repeat(85),
    ];

    for (const stat of analysis.slice(0, 30)) {
        const name = stat.name.padEnd(32).slice(0, 32);
        const calls = String(stat.callCount).padStart(8);
        const total = stat.totalTime.toFixed(2).padStart(10);
        const self = stat.selfTime.toFixed(2).padStart(10);
        const avg = stat.avgTime.toFixed(3).padStart(10);
        const max = stat.maxTime.toFixed(2).padStart(10);
        lines.push(`${name} ${calls} ${total} ${self} ${avg} ${max}`);
    }

    return lines.join('\n');
}

// Expose globally for console access
if (typeof window !== 'undefined') {
    window.__callTree = {
        startRecording,
        stopRecording,
        clearRecording,
        getCallTree,
        analyzeCallTree,
        formatCallTree,
        formatAnalysis,
        instrument,
        instrumentObject,
    };
}

export default {
    startRecording,
    stopRecording,
    clearRecording,
    getCallTree,
    analyzeCallTree,
    formatCallTree,
    formatAnalysis,
    instrument,
    instrumentObject,
};
