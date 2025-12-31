#!/usr/bin/env node
/**
 * Profile constraint resolution to see where time is spent
 */

import { generateDenseGraph, buildContext } from './generateBenchData.js';
import {
    resolveConstraints,
    calculateCascadeUpdates,
    getMinXFromPredecessors,
    getMaxXFromPredecessors,
    getMaxEndFromDownstream,
    getMaxXFromLockedSuccessors,
    getDepOffsets,
    EPSILON_PX,
} from '../utils/constraintEngine.js';
import {
    isMovementLocked,
    getMinXFromAbsolute,
    getMaxXFromAbsolute,
    getMaxEndFromAbsolute,
} from '../utils/absoluteConstraints.js';

const TASKS = 500;
const RELS = 10000;
const ITERATIONS = 100;
const USE_INDEX = true;  // Toggle to compare baseline vs indexed

// Generate test data
const relsPerTask = Math.ceil(RELS / TASKS);
const data = generateDenseGraph(TASKS, relsPerTask, { seed: 12345 });
const context = buildContext(data, { useIndex: USE_INDEX });
const { tasks, relationships } = data;

console.log('═'.repeat(70));
console.log('Constraint Resolution Profiling');
console.log('═'.repeat(70));
console.log(`Tasks: ${TASKS}, Relationships: ${relationships.length}`);
console.log(`Iterations: ${ITERATIONS}, Mode: ${USE_INDEX ? 'INDEXED' : 'BASELINE'}`);
console.log('');

// Time breakdown accumulators
const timings = {
    total: 0,
    lockCheck: 0,
    absoluteConstraints: 0,
    getMinXFromPredecessors: 0,
    getMaxXFromPredecessors: 0,
    getMaxEndFromDownstream: 0,
    getMaxXFromLockedSuccessors: 0,
    clampAndCheck: 0,
    calculateCascadeUpdates: 0,
};

// Instrumented version of resolveConstraints
function instrumentedResolveConstraints(taskId, proposedX, proposedWidth, ctx) {
    const { getBarPosition, getTask, relationships, relationshipIndex, pixelsPerHour, ganttStartDate } = ctx;

    // Use index if available, otherwise fall back to relationships array
    const relSource = relationshipIndex || relationships;

    let t0, t1;
    const totalStart = performance.now();

    const task = getTask?.(taskId);
    const currentBar = getBarPosition(taskId);

    if (!currentBar) {
        timings.total += performance.now() - totalStart;
        return { constrainedX: proposedX, constrainedWidth: proposedWidth, blocked: false, blockReason: null, cascadeUpdates: new Map() };
    }

    // 1. Lock check
    t0 = performance.now();
    const locked = isMovementLocked(task?.constraints?.locked);
    t1 = performance.now();
    timings.lockCheck += t1 - t0;

    if (locked) {
        timings.total += performance.now() - totalStart;
        return { constrainedX: currentBar.x, constrainedWidth: proposedWidth, blocked: true, blockReason: 'locked', cascadeUpdates: new Map() };
    }

    let minX = 0;
    let maxX = Infinity;

    // 2. Absolute constraints
    t0 = performance.now();
    const absMinX = getMinXFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);
    const absMaxX = getMaxXFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);
    const absMaxEnd = getMaxEndFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);
    minX = Math.max(minX, absMinX);
    if (absMaxX !== Infinity) maxX = Math.min(maxX, absMaxX);
    if (absMaxEnd !== Infinity) maxX = Math.min(maxX, absMaxEnd - proposedWidth);
    t1 = performance.now();
    timings.absoluteConstraints += t1 - t0;

    // 3. getMinXFromPredecessors
    t0 = performance.now();
    const predMinX = getMinXFromPredecessors(taskId, relSource, getBarPosition, pixelsPerHour, proposedWidth);
    minX = Math.max(minX, predMinX);
    t1 = performance.now();
    timings.getMinXFromPredecessors += t1 - t0;

    // 4. getMaxXFromPredecessors
    t0 = performance.now();
    const predMaxX = getMaxXFromPredecessors(taskId, relSource, getBarPosition, pixelsPerHour, proposedWidth);
    if (predMaxX !== Infinity) maxX = Math.min(maxX, predMaxX);
    t1 = performance.now();
    timings.getMaxXFromPredecessors += t1 - t0;

    // 5. getMaxEndFromDownstream
    t0 = performance.now();
    const downstreamMaxEnd = getMaxEndFromDownstream(taskId, relSource, getBarPosition, getTask, pixelsPerHour);
    if (downstreamMaxEnd !== Infinity) maxX = Math.min(maxX, downstreamMaxEnd - proposedWidth);
    t1 = performance.now();
    timings.getMaxEndFromDownstream += t1 - t0;

    // 6. getMaxXFromLockedSuccessors
    t0 = performance.now();
    const sssfMaxX = getMaxXFromLockedSuccessors(taskId, relSource, getBarPosition, getTask, pixelsPerHour);
    if (sssfMaxX !== Infinity) maxX = Math.min(maxX, sssfMaxX);
    t1 = performance.now();
    timings.getMaxXFromLockedSuccessors += t1 - t0;

    // 7. Clamp and check
    t0 = performance.now();
    let constrainedX = Math.max(minX, Math.min(proposedX, maxX));
    const blocked = minX > maxX + EPSILON_PX;
    if (blocked) constrainedX = currentBar.x;
    t1 = performance.now();
    timings.clampAndCheck += t1 - t0;

    // 8. calculateCascadeUpdates
    t0 = performance.now();
    const cascadeUpdates = blocked ? new Map() : calculateCascadeUpdates(taskId, constrainedX, ctx);
    t1 = performance.now();
    timings.calculateCascadeUpdates += t1 - t0;

    timings.total += performance.now() - totalStart;

    return { constrainedX, constrainedWidth: proposedWidth, blocked, blockReason: blocked ? 'conflicting_constraints' : null, cascadeUpdates };
}

// Run profiling
const taskId = 'task-0';
const task = tasks[taskId];

for (let i = 0; i < ITERATIONS; i++) {
    instrumentedResolveConstraints(taskId, task._bar.x + 10, task._bar.width, context);
}

// Calculate percentages
const total = timings.total;
const breakdown = [
    { name: 'getMaxEndFromDownstream', time: timings.getMaxEndFromDownstream },
    { name: 'calculateCascadeUpdates', time: timings.calculateCascadeUpdates },
    { name: 'getMinXFromPredecessors', time: timings.getMinXFromPredecessors },
    { name: 'getMaxXFromPredecessors', time: timings.getMaxXFromPredecessors },
    { name: 'getMaxXFromLockedSuccessors', time: timings.getMaxXFromLockedSuccessors },
    { name: 'absoluteConstraints', time: timings.absoluteConstraints },
    { name: 'lockCheck', time: timings.lockCheck },
    { name: 'clampAndCheck', time: timings.clampAndCheck },
].sort((a, b) => b.time - a.time);

console.log('Time Breakdown (sorted by time spent)');
console.log('─'.repeat(70));
console.log('');

const barWidth = 40;
for (const item of breakdown) {
    const pct = (item.time / total) * 100;
    const avgMs = item.time / ITERATIONS;
    const bar = '█'.repeat(Math.round(pct / 100 * barWidth));
    console.log(`${item.name.padEnd(28)} ${avgMs.toFixed(3).padStart(7)}ms  ${pct.toFixed(1).padStart(5)}%  ${bar}`);
}

console.log('─'.repeat(70));
console.log(`${'TOTAL'.padEnd(28)} ${(total / ITERATIONS).toFixed(3).padStart(7)}ms  100.0%`);
console.log('');

// Visual call graph
console.log('═'.repeat(70));
console.log('Call Graph (approximate time distribution)');
console.log('═'.repeat(70));
console.log('');
console.log('resolveConstraints()');
console.log('├── lockCheck                     ' + ((timings.lockCheck / total) * 100).toFixed(1) + '%');
console.log('├── absoluteConstraints           ' + ((timings.absoluteConstraints / total) * 100).toFixed(1) + '%');
console.log('├── getMinXFromPredecessors       ' + ((timings.getMinXFromPredecessors / total) * 100).toFixed(1) + '%');
console.log('│   └── for(rel of relationships) O(n) scan');
console.log('├── getMaxXFromPredecessors       ' + ((timings.getMaxXFromPredecessors / total) * 100).toFixed(1) + '%');
console.log('│   └── for(rel of relationships) O(n) scan');
console.log('├── getMaxEndFromDownstream       ' + ((timings.getMaxEndFromDownstream / total) * 100).toFixed(1) + '% ◀◀◀ BOTTLENECK');
console.log('│   ├── Build successorMap        O(n) scan');
console.log('│   ├── BFS traversal             O(v+e)');
console.log('│   └── Backward pass             O(v)');
console.log('├── getMaxXFromLockedSuccessors   ' + ((timings.getMaxXFromLockedSuccessors / total) * 100).toFixed(1) + '%');
console.log('│   └── for(rel of relationships) O(n) scan');
console.log('├── clampAndCheck                 ' + ((timings.clampAndCheck / total) * 100).toFixed(1) + '%');
console.log('└── calculateCascadeUpdates       ' + ((timings.calculateCascadeUpdates / total) * 100).toFixed(1) + '%');
console.log('    ├── Build successorRels       O(n) scan');
console.log('    └── Process queue             O(affected tasks)');
console.log('');
console.log('═'.repeat(70));
