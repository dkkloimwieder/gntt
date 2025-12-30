#!/usr/bin/env node
/**
 * Profile how time distribution changes with relationship count
 */

import { generateDenseGraph, buildContext } from './generateBenchData.js';
import {
    calculateCascadeUpdates,
    getMinXFromPredecessors,
    getMaxXFromPredecessors,
    getMaxEndFromDownstream,
    getMaxXFromLockedSuccessors,
    EPSILON_PX,
} from '../utils/constraintEngine.js';
import {
    isMovementLocked,
    getMinXFromAbsolute,
    getMaxXFromAbsolute,
    getMaxEndFromAbsolute,
} from '../utils/absoluteConstraints.js';

const TASKS = 500;
const ITERATIONS = 50;

function profileResolve(ctx, taskId, proposedX, proposedWidth) {
    const { getBarPosition, getTask, relationships, pixelsPerHour, ganttStartDate } = ctx;
    const timings = {};

    const task = getTask?.(taskId);
    const currentBar = getBarPosition(taskId);

    let t0;

    t0 = performance.now();
    isMovementLocked(task?.constraints?.locked);
    timings.lockCheck = performance.now() - t0;

    let minX = 0, maxX = Infinity;

    t0 = performance.now();
    const absMinX = getMinXFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);
    const absMaxX = getMaxXFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);
    const absMaxEnd = getMaxEndFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);
    minX = Math.max(minX, absMinX);
    if (absMaxX !== Infinity) maxX = Math.min(maxX, absMaxX);
    if (absMaxEnd !== Infinity) maxX = Math.min(maxX, absMaxEnd - proposedWidth);
    timings.absolute = performance.now() - t0;

    t0 = performance.now();
    const predMinX = getMinXFromPredecessors(taskId, relationships, getBarPosition, pixelsPerHour, proposedWidth);
    minX = Math.max(minX, predMinX);
    timings.minXPred = performance.now() - t0;

    t0 = performance.now();
    const predMaxX = getMaxXFromPredecessors(taskId, relationships, getBarPosition, pixelsPerHour, proposedWidth);
    if (predMaxX !== Infinity) maxX = Math.min(maxX, predMaxX);
    timings.maxXPred = performance.now() - t0;

    t0 = performance.now();
    const downstreamMaxEnd = getMaxEndFromDownstream(taskId, relationships, getBarPosition, getTask, pixelsPerHour);
    if (downstreamMaxEnd !== Infinity) maxX = Math.min(maxX, downstreamMaxEnd - proposedWidth);
    timings.downstream = performance.now() - t0;

    t0 = performance.now();
    const sssfMaxX = getMaxXFromLockedSuccessors(taskId, relationships, getBarPosition, getTask, pixelsPerHour);
    if (sssfMaxX !== Infinity) maxX = Math.min(maxX, sssfMaxX);
    timings.lockedSucc = performance.now() - t0;

    let constrainedX = Math.max(minX, Math.min(proposedX, maxX));
    const blocked = minX > maxX + EPSILON_PX;
    if (blocked) constrainedX = currentBar.x;

    t0 = performance.now();
    if (!blocked) calculateCascadeUpdates(taskId, constrainedX, ctx);
    timings.cascade = performance.now() - t0;

    return timings;
}

console.log('═'.repeat(90));
console.log('Time Distribution by Relationship Count');
console.log('═'.repeat(90));
console.log('');
console.log('Rels    | downstream | cascade  | minXPred | maxXPred | lockedSucc | other');
console.log('─'.repeat(90));

for (const targetRels of [1000, 5000, 10000]) {
    const relsPerTask = Math.ceil(targetRels / TASKS);
    const data = generateDenseGraph(TASKS, relsPerTask, { seed: 12345 });
    const ctx = buildContext(data);
    const { tasks, relationships } = data;

    // Accumulate timings
    const totals = { lockCheck: 0, absolute: 0, minXPred: 0, maxXPred: 0, downstream: 0, lockedSucc: 0, cascade: 0 };

    for (let i = 0; i < ITERATIONS; i++) {
        const t = profileResolve(ctx, 'task-0', tasks['task-0'].$bar.x + 10, 80);
        for (const k in t) totals[k] += t[k];
    }

    // Convert to percentages
    const total = Object.values(totals).reduce((a, b) => a + b, 0);
    const pct = (k) => ((totals[k] / total) * 100).toFixed(1).padStart(5) + '%';
    const ms = (k) => (totals[k] / ITERATIONS).toFixed(2).padStart(6) + 'ms';

    const other = totals.lockCheck + totals.absolute;

    console.log(
        `${String(relationships.length).padStart(6)}  | ` +
        `${pct('downstream')} ${ms('downstream')} | ` +
        `${pct('cascade')} ${ms('cascade')} | ` +
        `${pct('minXPred')} | ` +
        `${pct('maxXPred')} | ` +
        `${pct('lockedSucc')} | ` +
        `${((other / total) * 100).toFixed(1).padStart(5)}%`
    );
}

console.log('─'.repeat(90));
console.log('');
console.log('Legend:');
console.log('  downstream  = getMaxEndFromDownstream (BFS for locked successors)');
console.log('  cascade     = calculateCascadeUpdates (push affected tasks)');
console.log('  minXPred    = getMinXFromPredecessors (O(n) relationship scan)');
console.log('  maxXPred    = getMaxXFromPredecessors (O(n) relationship scan)');
console.log('  lockedSucc  = getMaxXFromLockedSuccessors (O(n) relationship scan)');
console.log('  other       = lock check + absolute constraints');
console.log('');
console.log('═'.repeat(90));
