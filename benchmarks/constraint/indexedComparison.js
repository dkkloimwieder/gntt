#!/usr/bin/env node
/**
 * Compare baseline (O(n) scans) vs indexed (O(1) lookups) constraint resolution
 */

import { generateDenseGraph, buildContext } from './generateBenchData.js';
import { resolveConstraints } from '../utils/constraintEngine.js';

const TASKS = 500;
const ITERATIONS = 100;
const WARMUP = 10;

function benchmark(name, fn) {
    // Warmup
    for (let i = 0; i < WARMUP; i++) fn();

    // Measure
    const times = [];
    for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        fn();
        times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    return {
        name,
        mean: times.reduce((a, b) => a + b) / times.length,
        median: times[Math.floor(times.length / 2)],
        p95: times[Math.floor(times.length * 0.95)],
        min: times[0],
        max: times[times.length - 1],
    };
}

console.log('═'.repeat(90));
console.log('Constraint Resolution: Baseline vs Indexed Comparison');
console.log('═'.repeat(90));
console.log(`Tasks: ${TASKS}, Iterations: ${ITERATIONS}, Warmup: ${WARMUP}`);
console.log('');

console.log('Rels     | Baseline mean   | Indexed mean    | Speedup | Baseline p95   | Indexed p95');
console.log('─'.repeat(90));

for (const targetRels of [1000, 5000, 10000]) {
    const relsPerTask = Math.ceil(targetRels / TASKS);
    const data = generateDenseGraph(TASKS, relsPerTask, { seed: 12345 });

    // Build contexts: one without index (baseline), one with index
    const baselineCtx = buildContext(data, { useIndex: false });
    const indexedCtx = buildContext(data, { useIndex: true });

    const taskId = 'task-0';
    const task = data.tasks[taskId];
    const proposedX = task._bar.x + 10;
    const proposedWidth = task._bar.width;

    // Benchmark baseline
    const baseline = benchmark('baseline', () => {
        resolveConstraints(taskId, proposedX, proposedWidth, baselineCtx);
    });

    // Benchmark indexed
    const indexed = benchmark('indexed', () => {
        resolveConstraints(taskId, proposedX, proposedWidth, indexedCtx);
    });

    const speedup = baseline.mean / indexed.mean;
    const actualRels = data.relationships.length;

    console.log(
        `${String(actualRels).padStart(6)}   | ` +
        `${baseline.mean.toFixed(3).padStart(7)}ms       | ` +
        `${indexed.mean.toFixed(3).padStart(7)}ms       | ` +
        `${speedup.toFixed(1).padStart(5)}x  | ` +
        `${baseline.p95.toFixed(3).padStart(7)}ms      | ` +
        `${indexed.p95.toFixed(3).padStart(7)}ms`
    );
}

console.log('─'.repeat(90));
console.log('');
console.log('Legend:');
console.log('  Baseline = O(n) relationship array scans per function call');
console.log('  Indexed  = O(1) Map lookups from pre-built index');
console.log('  Speedup  = Baseline mean / Indexed mean');
console.log('');
console.log('═'.repeat(90));
