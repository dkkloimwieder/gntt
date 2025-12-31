#!/usr/bin/env node
/**
 * Benchmark early termination optimizations
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
console.log('Early Termination Optimization Benchmarks');
console.log('═'.repeat(90));
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: No position change
// ─────────────────────────────────────────────────────────────────────────────
console.log('─── TEST 1: No Position Change (should return immediately) ───');
const data1 = generateDenseGraph(500, 20, { seed: 12345 });
const ctx1 = buildContext(data1, { useIndex: true });
const task1 = data1.tasks['task-0'];

const noChange = benchmark('no change', () => {
    resolveConstraints('task-0', task1._bar.x, task1._bar.width, ctx1);
});
console.log(`  Same position: ${noChange.mean.toFixed(4)}ms (expect ~0ms)`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Moving LEFT vs RIGHT
// ─────────────────────────────────────────────────────────────────────────────
console.log('─── TEST 2: Movement Direction (left should skip downstream) ───');
const data2 = generateDenseGraph(500, 20, { seed: 12345 });
const ctx2 = buildContext(data2, { useIndex: true });
const task2 = data2.tasks['task-250'];  // Middle task

const moveRight = benchmark('move RIGHT +10px', () => {
    resolveConstraints('task-250', task2._bar.x + 10, task2._bar.width, ctx2);
});

const moveLeft = benchmark('move LEFT -10px', () => {
    resolveConstraints('task-250', task2._bar.x - 10, task2._bar.width, ctx2);
});

const directionSpeedup = moveRight.mean / moveLeft.mean;
console.log(`  Move RIGHT: ${moveRight.mean.toFixed(3)}ms (needs downstream check)`);
console.log(`  Move LEFT:  ${moveLeft.mean.toFixed(3)}ms (skips downstream)`);
console.log(`  Speedup:    ${directionSpeedup.toFixed(1)}x`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Task with no successors (last in chain)
// ─────────────────────────────────────────────────────────────────────────────
console.log('─── TEST 3: Task with No Successors (should return Infinity immediately) ───');
const data3 = generateLinearChain(500);
const ctx3 = buildContext(data3, { useIndex: true });
const lastTask = data3.tasks['task-499'];

const noSuccessors = benchmark('last task (no successors)', () => {
    resolveConstraints('task-499', lastTask._bar.x + 10, lastTask._bar.width, ctx3);
});

const firstTask3 = data3.tasks['task-0'];
const hasSuccessors = benchmark('first task (499 successors)', () => {
    resolveConstraints('task-0', firstTask3._bar.x + 10, firstTask3._bar.width, ctx3);
});

console.log(`  Last task (0 successors):    ${noSuccessors.mean.toFixed(3)}ms`);
console.log(`  First task (499 successors): ${hasSuccessors.mean.toFixed(3)}ms`);
console.log(`  Speedup:                     ${(hasSuccessors.mean / noSuccessors.mean).toFixed(1)}x`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Fan-out root vs child
// ─────────────────────────────────────────────────────────────────────────────
console.log('─── TEST 4: Fan-out Topology ───');
const data4 = generateFanOut(500);
const ctx4 = buildContext(data4, { useIndex: true });
const fanRoot = data4.tasks['task-0'];
const fanChild = data4.tasks['task-250'];

const fanRootBench = benchmark('root (499 children)', () => {
    resolveConstraints('task-0', fanRoot._bar.x + 10, fanRoot._bar.width, ctx4);
});

const fanChildBench = benchmark('child (0 successors)', () => {
    resolveConstraints('task-250', fanChild._bar.x + 10, fanChild._bar.width, ctx4);
});

console.log(`  Root (499 successors): ${fanRootBench.mean.toFixed(3)}ms`);
console.log(`  Child (0 successors):  ${fanChildBench.mean.toFixed(3)}ms`);
console.log(`  Speedup:               ${(fanRootBench.mean / fanChildBench.mean).toFixed(1)}x`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Dense graph at scale
// ─────────────────────────────────────────────────────────────────────────────
console.log('─── TEST 5: Dense Graph at Scale ───');
for (const rels of [1000, 5000, 10000]) {
    const relsPerTask = Math.ceil(rels / 500);
    const data5 = generateDenseGraph(500, relsPerTask, { seed: 12345 });
    const ctx5 = buildContext(data5, { useIndex: true });
    const task5 = data5.tasks['task-0'];

    const rightBench = benchmark(`${rels} rels RIGHT`, () => {
        resolveConstraints('task-0', task5._bar.x + 10, task5._bar.width, ctx5);
    });

    const leftBench = benchmark(`${rels} rels LEFT`, () => {
        resolveConstraints('task-0', task5._bar.x - 10, task5._bar.width, ctx5);
    });

    console.log(`  ${String(data5.relationships.length).padStart(5)} rels: RIGHT=${rightBench.mean.toFixed(3)}ms  LEFT=${leftBench.mean.toFixed(3)}ms  Speedup=${(rightBench.mean / leftBench.mean).toFixed(1)}x`);
}
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('═'.repeat(90));
console.log('SUMMARY');
console.log('═'.repeat(90));
console.log('');
console.log('Early termination conditions:');
console.log(`  1. No position change:     ${noChange.mean.toFixed(4)}ms (immediate return)`);
console.log(`  2. Moving LEFT:            ${moveLeft.mean.toFixed(3)}ms (skips downstream BFS)`);
console.log(`  3. No successors:          ${noSuccessors.mean.toFixed(3)}ms (immediate Infinity)`);
console.log('');
console.log('Compared to full constraint resolution:');
console.log(`  Moving RIGHT (full):       ${moveRight.mean.toFixed(3)}ms`);
console.log('');
console.log('Optimization effectiveness:');
console.log(`  Left vs Right speedup:     ${directionSpeedup.toFixed(1)}x`);
console.log(`  No successors speedup:     ${(hasSuccessors.mean / noSuccessors.mean).toFixed(1)}x`);
console.log('');
console.log('═'.repeat(90));
