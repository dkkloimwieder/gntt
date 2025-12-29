#!/usr/bin/env node
/**
 * Graph structure statistics for generated benchmark data
 */

import { generateDenseGraph } from './generateBenchData.js';

function analyzeGraph(data) {
    const { tasks, relationships } = data;
    const taskIds = Object.keys(tasks);

    // Build adjacency lists
    const successors = new Map(); // taskId -> [successorIds]
    const predecessors = new Map(); // taskId -> [predecessorIds]

    for (const id of taskIds) {
        successors.set(id, []);
        predecessors.set(id, []);
    }

    for (const rel of relationships) {
        successors.get(rel.from).push(rel.to);
        predecessors.get(rel.to).push(rel.from);
    }

    // Calculate outgoing edges (breadth) per task
    const outgoingCounts = taskIds.map(id => successors.get(id).length);
    const incomingCounts = taskIds.map(id => predecessors.get(id).length);

    // Calculate depth (longest path from each node using memoized DFS)
    const depthCache = new Map();

    function getMaxDepth(taskId) {
        if (depthCache.has(taskId)) {
            return depthCache.get(taskId);
        }

        const succs = successors.get(taskId);
        if (succs.length === 0) {
            depthCache.set(taskId, 0);
            return 0;
        }

        let maxChildDepth = 0;
        for (const succ of succs) {
            maxChildDepth = Math.max(maxChildDepth, getMaxDepth(succ));
        }

        const depth = 1 + maxChildDepth;
        depthCache.set(taskId, depth);
        return depth;
    }

    const depths = taskIds.map(id => getMaxDepth(id));

    // Find root nodes (no predecessors) and leaf nodes (no successors)
    const roots = taskIds.filter(id => predecessors.get(id).length === 0);
    const leaves = taskIds.filter(id => successors.get(id).length === 0);

    // Calculate longest path in entire graph
    const maxGraphDepth = Math.max(...depths);

    // Find one longest chain using memoized depths
    function findLongestChain() {
        // Start from node with max depth
        let startNode = taskIds[0];
        let maxDepth = 0;
        for (const id of taskIds) {
            const d = depthCache.get(id);
            if (d > maxDepth) {
                maxDepth = d;
                startNode = id;
            }
        }

        // Trace path by always following successor with max depth
        const chain = [startNode];
        let current = startNode;

        while (true) {
            const succs = successors.get(current);
            if (succs.length === 0) break;

            // Pick successor with max depth
            let bestSucc = succs[0];
            let bestDepth = depthCache.get(bestSucc);
            for (const s of succs) {
                const d = depthCache.get(s);
                if (d > bestDepth) {
                    bestDepth = d;
                    bestSucc = s;
                }
            }

            chain.push(bestSucc);
            current = bestSucc;
        }

        return chain;
    }

    return {
        taskCount: taskIds.length,
        relationshipCount: relationships.length,
        roots: roots.length,
        leaves: leaves.length,
        outgoing: computeStats(outgoingCounts),
        incoming: computeStats(incomingCounts),
        depth: computeStats(depths),
        maxGraphDepth,
        longestChain: findLongestChain(),
    };
}

function computeStats(values) {
    if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0 };

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    return {
        min: sorted[0],
        max: sorted[n - 1],
        mean: values.reduce((a, b) => a + b, 0) / n,
        median: sorted[Math.floor(n / 2)],
        p25: sorted[Math.floor(n * 0.25)],
        p75: sorted[Math.floor(n * 0.75)],
        p95: sorted[Math.floor(n * 0.95)],
    };
}

function formatStats(stats, label) {
    return `${label}: min=${stats.min}, max=${stats.max}, median=${stats.median}, mean=${stats.mean.toFixed(1)}, p95=${stats.p95}`;
}

// Main
const TASKS = 500;
const DEP_COUNTS = [1000, 5000, 10000];

console.log('═'.repeat(80));
console.log('Graph Structure Statistics');
console.log('═'.repeat(80));
console.log('');

for (const target of DEP_COUNTS) {
    const relsPerTask = Math.ceil(target / TASKS);
    const data = generateDenseGraph(TASKS, relsPerTask, { seed: 12345 });
    const stats = analyzeGraph(data);

    console.log(`─── ${stats.relationshipCount} relationships ───`);
    console.log(`  Tasks: ${stats.taskCount}, Roots: ${stats.roots}, Leaves: ${stats.leaves}`);
    console.log('');
    console.log(`  ${formatStats(stats.outgoing, 'Outgoing (successors)')}`);
    console.log(`  ${formatStats(stats.incoming, 'Incoming (predecessors)')}`);
    console.log(`  ${formatStats(stats.depth, 'Depth (longest path from node)')}`);
    console.log('');
    console.log(`  Max graph depth: ${stats.maxGraphDepth}`);
    console.log(`  Longest chain: ${stats.longestChain.length} nodes`);
    console.log(`    Path: ${stats.longestChain.slice(0, 5).join(' → ')}${stats.longestChain.length > 5 ? ' → ...' : ''}`);
    console.log('');
}

console.log('═'.repeat(80));
