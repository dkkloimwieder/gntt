#!/usr/bin/env node
/**
 * Relationship count scaling benchmark
 * 500 tasks with 1000, 5000, 10000 relationships
 */

import {
    benchmark,
    formatMs,
} from './constraintBench.js';

import {
    generateDenseGraph,
    buildContext,
} from './generateBenchData.js';

import {
    resolveConstraints,
    calculateCascadeUpdates,
    getMinXFromPredecessors,
    getMaxEndFromDownstream,
} from '../utils/constraintEngine.js';

const TASKS = 500;
const DEP_COUNTS = [1000, 5000, 10000];

console.log('═'.repeat(70));
console.log('Constraint Resolution: Relationship Count Scaling');
console.log('═'.repeat(70));
console.log(`Fixed: ${TASKS} tasks`);
console.log('Varying: relationship count (1000, 5000, 10000)');
console.log('Runs: 100 (warmup: 5)');
console.log('');

const results = [];

for (const targetDeps of DEP_COUNTS) {
    const relsPerTask = Math.ceil(targetDeps / TASKS);
    const data = generateDenseGraph(TASKS, relsPerTask, { seed: 12345 });
    const context = buildContext(data);
    const { tasks, relationships } = data;
    const firstTaskId = 'task-0';

    console.log(`─── ${relationships.length} relationships (${relsPerTask} per task) ───`);

    // resolveConstraints
    const r1 = benchmark('resolveConstraints', () => {
        const task = tasks[firstTaskId];
        resolveConstraints(firstTaskId, task._bar.x + 10, task._bar.width, context);
    });

    // getMinXFromPredecessors
    const r2 = benchmark('getMinXFromPredecessors', () => {
        getMinXFromPredecessors('task-250', relationships, context.getBarPosition, context.pixelsPerHour, 80);
    });

    // getMaxEndFromDownstream
    const r3 = benchmark('getMaxEndFromDownstream', () => {
        getMaxEndFromDownstream(firstTaskId, relationships, context.getBarPosition, context.getTask, context.pixelsPerHour);
    });

    // calculateCascadeUpdates
    const r4 = benchmark('calculateCascadeUpdates', () => {
        calculateCascadeUpdates(firstTaskId, tasks[firstTaskId]._bar.x + 10, context);
    });

    console.log(`  resolveConstraints:        mean=${formatMs(r1.mean).padEnd(10)} p95=${formatMs(r1.p95)}`);
    console.log(`  getMinXFromPredecessors:   mean=${formatMs(r2.mean).padEnd(10)} p95=${formatMs(r2.p95)}`);
    console.log(`  getMaxEndFromDownstream:   mean=${formatMs(r3.mean).padEnd(10)} p95=${formatMs(r3.p95)}`);
    console.log(`  calculateCascadeUpdates:   mean=${formatMs(r4.mean).padEnd(10)} p95=${formatMs(r4.p95)}`);
    console.log('');

    results.push({
        relationships: relationships.length,
        resolveConstraints: r1.mean,
        getMinXFromPredecessors: r2.mean,
        getMaxEndFromDownstream: r3.mean,
        calculateCascadeUpdates: r4.mean,
    });
}

// Summary comparison
console.log('═'.repeat(70));
console.log('SCALING COMPARISON (mean times)');
console.log('═'.repeat(70));
console.log('');
console.log('Relationships     | resolveAll | getMinX    | getMaxDown | cascade');
console.log('─'.repeat(70));

const baseline = results[0];
for (const r of results) {
    const scale = (r.relationships / baseline.relationships).toFixed(0) + 'x';
    const r1x = (r.resolveConstraints / baseline.resolveConstraints).toFixed(1) + 'x';
    const r2x = (r.getMinXFromPredecessors / baseline.getMinXFromPredecessors).toFixed(1) + 'x';
    const r3x = (r.getMaxEndFromDownstream / baseline.getMaxEndFromDownstream).toFixed(1) + 'x';
    const r4x = (r.calculateCascadeUpdates / baseline.calculateCascadeUpdates).toFixed(1) + 'x';

    console.log(`${String(r.relationships).padEnd(6)} (${scale.padEnd(3)}) | ${formatMs(r.resolveConstraints).padEnd(7)} ${r1x.padEnd(5)} | ${formatMs(r.getMinXFromPredecessors).padEnd(7)} ${r2x.padEnd(5)} | ${formatMs(r.getMaxEndFromDownstream).padEnd(7)} ${r3x.padEnd(5)} | ${formatMs(r.calculateCascadeUpdates).padEnd(7)} ${r4x}`);
}

console.log('');
console.log('═'.repeat(70));
