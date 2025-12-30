#!/usr/bin/env node
/**
 * Compare constraint resolution performance across different graph topologies
 */

import { generateLinearChain, generateFanOut, generateDenseGraph, buildContext } from './generateBenchData.js';
import { resolveConstraints } from '../utils/constraintEngine.js';

const ITERATIONS = 100;
const WARMUP = 10;

function benchmark(name, fn) {
    for (let i = 0; i < WARMUP; i++) fn();
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
    };
}

console.log('═'.repeat(90));
console.log('Topology Comparison: Deep vs Broad');
console.log('═'.repeat(90));
console.log('');

// Test 1: Linear chain (maximum depth, minimum breadth)
// A → B → C → D → ... → Z (500 tasks, 499 rels, depth=499)
console.log('─── LINEAR CHAIN (depth=499, breadth=1) ───');
const linearData = generateLinearChain(500);
const linearCtx = buildContext(linearData, { useIndex: true });
console.log(`Tasks: ${Object.keys(linearData.tasks).length}, Rels: ${linearData.relationships.length}`);

// Drag first task (affects all successors)
const linearFirst = benchmark('drag first (affects all)', () => {
    resolveConstraints('task-0', 110, 80, linearCtx);
});

// Drag middle task (affects half)
const linearMiddle = benchmark('drag middle (affects half)', () => {
    resolveConstraints('task-250', 25010, 80, linearCtx);
});

// Drag last task (affects none)
const linearLast = benchmark('drag last (affects none)', () => {
    resolveConstraints('task-499', 49910, 80, linearCtx);
});

console.log(`  First task:  ${linearFirst.mean.toFixed(3)}ms (cascades to 499 tasks)`);
console.log(`  Middle task: ${linearMiddle.mean.toFixed(3)}ms (cascades to 249 tasks)`);
console.log(`  Last task:   ${linearLast.mean.toFixed(3)}ms (no cascade)`);
console.log('');

// Test 2: Fan-out (minimum depth, maximum breadth)
// Root → [1, 2, 3, ..., 499] (500 tasks, 499 rels, depth=1)
console.log('─── FAN-OUT (depth=1, breadth=499) ───');
const fanData = generateFanOut(500);
const fanCtx = buildContext(fanData, { useIndex: true });
console.log(`Tasks: ${Object.keys(fanData.tasks).length}, Rels: ${fanData.relationships.length}`);

// Drag root (affects all children)
const fanRoot = benchmark('drag root (affects all)', () => {
    resolveConstraints('task-0', 10, 80, fanCtx);
});

// Drag child (affects none)
const fanChild = benchmark('drag child (affects none)', () => {
    resolveConstraints('task-250', 110, 80, fanCtx);
});

console.log(`  Root task:   ${fanRoot.mean.toFixed(3)}ms (cascades to 499 children)`);
console.log(`  Child task:  ${fanChild.mean.toFixed(3)}ms (no successors)`);
console.log('');

// Test 3: Dense graph (moderate depth and breadth)
console.log('─── DENSE GRAPH (depth≈67, breadth≈20) ───');
const denseData = generateDenseGraph(500, 20, { seed: 12345 });
const denseCtx = buildContext(denseData, { useIndex: true });
console.log(`Tasks: ${Object.keys(denseData.tasks).length}, Rels: ${denseData.relationships.length}`);

const denseFirst = benchmark('drag task-0', () => {
    resolveConstraints('task-0', 10, 80, denseCtx);
});

const denseMiddle = benchmark('drag task-250', () => {
    resolveConstraints('task-250', 25010, 80, denseCtx);
});

console.log(`  Task-0:      ${denseFirst.mean.toFixed(3)}ms`);
console.log(`  Task-250:    ${denseMiddle.mean.toFixed(3)}ms`);
console.log('');

// Summary
console.log('═'.repeat(90));
console.log('SUMMARY');
console.log('═'.repeat(90));
console.log('');
console.log('Current algorithm uses BFS traversal with backward propagation:');
console.log('  - Visits ALL reachable nodes regardless of depth/breadth');
console.log('  - No early termination when constraint is found');
console.log('');
console.log('Performance characteristics:');
console.log(`  - Linear chain (max depth):  ${linearFirst.mean.toFixed(3)}ms for full cascade`);
console.log(`  - Fan-out (max breadth):     ${fanRoot.mean.toFixed(3)}ms for full cascade`);
console.log(`  - Dense graph (mixed):       ${denseFirst.mean.toFixed(3)}ms`);
console.log('');
console.log('The algorithm is NOT optimized for either topology - it always does full traversal.');
console.log('Potential optimizations:');
console.log('  - Early termination: Stop when maxEnd <= current position');
console.log('  - Lazy evaluation: Only traverse if movement would affect successors');
console.log('');
console.log('═'.repeat(90));
