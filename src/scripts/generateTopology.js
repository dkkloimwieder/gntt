#!/usr/bin/env node
/**
 * Topology Generator for Constraint System Benchmarking
 *
 * Creates test data with specific graph topologies to stress-test
 * the constraint resolution algorithm.
 *
 * Usage:
 *   node src/scripts/generateTopology.js --topology=breadth
 *   node src/scripts/generateTopology.js --topology=depth
 *   node src/scripts/generateTopology.js --topology=balanced
 *   node src/scripts/generateTopology.js --topology=all
 *
 * Options:
 *   --topology=TYPE  breadth|depth|balanced|all (default: balanced)
 *   --tasks=N        Target number of tasks (default: 500)
 *   --deps=N         Target number of dependencies (default: 1000)
 *   --seed=N         Random seed (default: 12345)
 *   --output=FILE    Output filename (default: topology-{type}.json)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    createRandom,
    getResourceLabel,
    formatDateTime,
    parseDateTime,
    addHours,
    cloneDate,
    calculateTaskTimes,
    GROUP_COLORS,
} from '../utils/taskGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG = {
    totalTasks: 500,
    targetDeps: 1000,
    seed: 12345,
    startDate: '2025-01-01',
    workdayStartHour: 8,
    workdayEndHour: 17,
    minDuration: 0.08,   // ~5 minutes
    maxDuration: 0.15,   // ~10 minutes
    resourceCount: 100,  // Many rows so all tasks visible at once
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function computeColorVariants(hex) {
    return {
        color: hex,
        color_progress: hex + 'cc',
        color_bg: hexToRgba(hex, 0.15),
        color_fill: hexToRgba(hex, 0.3),
    };
}

function randomBetween(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

function randomFloat(random, min, max) {
    return min + random() * (max - min);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BREADTH-HEAVY TOPOLOGY
// Wide forest with high fan-out, shallow depth (max 4-5 levels)
// Many tasks have MULTIPLE predecessors to hit the deps target
// ═══════════════════════════════════════════════════════════════════════════════

function generateBreadthHeavy(cfg, random) {
    const tasks = [];

    // Strategy: Create tasks in levels, then add deps to hit target
    // Level 0: 20 roots
    // Level 1: 80 tasks (4 per root)
    // Level 2: 200 tasks (2-3 per L1)
    // Level 3: 200 tasks (1-2 per L2)
    // Then add extra deps (multiple predecessors) to reach 1000

    const numRoots = 20;
    let taskNum = 1;
    let depCount = 0;
    const resourceCount = 25;
    const baseStart = parseDateTime(`${cfg.startDate} ${String(cfg.workdayStartHour).padStart(2, '0')}:00`);

    const resourceNextFree = {};
    for (let i = 0; i < resourceCount; i++) {
        resourceNextFree[getResourceLabel(i)] = cloneDate(baseStart);
    }

    const levels = [[], [], [], [], []];  // 5 levels max

    // Level 0: Root tasks
    for (let r = 0; r < numRoots && taskNum <= cfg.totalTasks; r++) {
        const resource = getResourceLabel(r % resourceCount);
        const colors = computeColorVariants(GROUP_COLORS[r % GROUP_COLORS.length]);
        const duration = randomFloat(random, cfg.minDuration, cfg.maxDuration);

        const { start, end } = calculateTaskTimes(
            resourceNextFree[resource],
            duration,
            cfg.workdayStartHour,
            cfg.workdayEndHour
        );
        resourceNextFree[resource] = cloneDate(end);

        const task = {
            id: `task-${taskNum}`,
            name: `R${r + 1}`,
            start: formatDateTime(start),
            end: formatDateTime(end),
            progress: 0,
            ...colors,
            resource,
        };
        tasks.push(task);
        levels[0].push(task);
        taskNum++;
    }

    // Levels 1-4: Children with single parent each (for structure)
    for (let level = 1; level <= 4 && taskNum <= cfg.totalTasks; level++) {
        const parents = levels[level - 1];
        const childrenPerParent = level === 1 ? 4 : (level === 2 ? 3 : 2);

        for (const parent of parents) {
            const numChildren = Math.min(childrenPerParent, Math.ceil((cfg.totalTasks - taskNum + 1) / parents.length));

            for (let c = 0; c < numChildren && taskNum <= cfg.totalTasks; c++) {
                const resource = getResourceLabel((taskNum - 1) % resourceCount);
                const colors = computeColorVariants(GROUP_COLORS[(taskNum - 1) % GROUP_COLORS.length]);
                const duration = randomFloat(random, cfg.minDuration, cfg.maxDuration);

                const parentEnd = parseDateTime(parent.end);
                const startTime = parentEnd > resourceNextFree[resource] ? parentEnd : resourceNextFree[resource];

                const { start, end } = calculateTaskTimes(
                    startTime,
                    duration,
                    cfg.workdayStartHour,
                    cfg.workdayEndHour
                );
                resourceNextFree[resource] = cloneDate(end);

                const task = {
                    id: `task-${taskNum}`,
                    name: `L${level}-${taskNum}`,
                    start: formatDateTime(start),
                    end: formatDateTime(end),
                    progress: 0,
                    ...colors,
                    resource,
                    dependencies: [{ id: parent.id, type: 'FS' }],
                };
                tasks.push(task);
                levels[level].push(task);
                depCount++;
                taskNum++;
            }
        }
    }

    // Fill remaining tasks
    while (taskNum <= cfg.totalTasks) {
        const resource = getResourceLabel((taskNum - 1) % resourceCount);
        const colors = computeColorVariants(GROUP_COLORS[(taskNum - 1) % GROUP_COLORS.length]);
        const duration = randomFloat(random, cfg.minDuration, cfg.maxDuration);

        const parentIdx = randomBetween(random, 0, tasks.length - 1);
        const parent = tasks[parentIdx];
        const parentEnd = parseDateTime(parent.end);
        const startTime = parentEnd > resourceNextFree[resource] ? parentEnd : resourceNextFree[resource];

        const { start, end } = calculateTaskTimes(
            startTime,
            duration,
            cfg.workdayStartHour,
            cfg.workdayEndHour
        );
        resourceNextFree[resource] = cloneDate(end);

        tasks.push({
            id: `task-${taskNum}`,
            name: `X-${taskNum}`,
            start: formatDateTime(start),
            end: formatDateTime(end),
            progress: 0,
            ...colors,
            resource,
            dependencies: [{ id: parent.id, type: 'FS' }],
        });
        depCount++;
        taskNum++;
    }

    // Add EXTRA dependencies to reach target (multiple predecessors per task)
    // This creates the "breadth" - tasks depend on MULTIPLE parents from same level
    while (depCount < cfg.targetDeps) {
        // Pick a non-root task
        const toIdx = randomBetween(random, numRoots + 1, tasks.length - 1);
        const toTask = tasks[toIdx];
        const toStart = parseDateTime(toTask.start);

        // Find a valid predecessor (different from existing deps)
        const existingDeps = new Set((toTask.dependencies || []).map(d => d.id));
        const candidates = tasks.filter((t, i) =>
            i < toIdx &&
            !existingDeps.has(t.id) &&
            parseDateTime(t.end) <= toStart
        );

        if (candidates.length > 0) {
            const fromTask = candidates[randomBetween(random, 0, candidates.length - 1)];
            if (!toTask.dependencies) toTask.dependencies = [];
            toTask.dependencies.push({ id: fromTask.id, type: 'FS' });
            depCount++;
        } else {
            break;  // No more valid candidates
        }
    }

    return { tasks, stats: computeStats(tasks) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPTH-HEAVY TOPOLOGY
// Few long chains with minimal branching
// ═══════════════════════════════════════════════════════════════════════════════

function generateDepthHeavy(cfg, random) {
    const tasks = [];

    // Calculate structure: 5 chains of ~100 tasks each
    // With ~2 deps per task average = ~1000 deps
    const numChains = 5;
    const tasksPerChain = Math.ceil(cfg.totalTasks / numChains);
    const branchProbability = 0.1;  // 10% chance of spawning a branch

    let taskNum = 1;
    let depCount = 0;
    const resourceCount = numChains;  // One resource per chain
    const baseStart = parseDateTime(`${cfg.startDate} ${String(cfg.workdayStartHour).padStart(2, '0')}:00`);

    for (let chain = 0; chain < numChains && taskNum <= cfg.totalTasks; chain++) {
        const resource = getResourceLabel(chain);
        const colors = computeColorVariants(GROUP_COLORS[chain % GROUP_COLORS.length]);
        let currentTime = cloneDate(baseStart);
        let prevTaskId = null;

        // Track branch points for secondary dependencies
        const chainTasks = [];

        for (let i = 0; i < tasksPerChain && taskNum <= cfg.totalTasks; i++) {
            const duration = randomFloat(random, cfg.minDuration, cfg.maxDuration);

            const { start, end } = calculateTaskTimes(
                currentTime,
                duration,
                cfg.workdayStartHour,
                cfg.workdayEndHour
            );
            currentTime = cloneDate(end);

            const deps = prevTaskId && depCount < cfg.targetDeps
                ? [{ id: prevTaskId, type: 'FS' }]
                : undefined;

            const task = {
                id: `task-${taskNum}`,
                name: `C${chain + 1}-${i + 1}`,
                start: formatDateTime(start),
                end: formatDateTime(end),
                progress: 0,
                ...colors,
                resource,
                dependencies: deps,
            };

            tasks.push(task);
            chainTasks.push(task);
            if (deps) depCount++;
            prevTaskId = task.id;
            taskNum++;

            // Occasionally spawn a branch (small side chain)
            if (random() < branchProbability && taskNum <= cfg.totalTasks && depCount < cfg.targetDeps) {
                const branchLength = randomBetween(random, 2, 5);
                let branchPrevId = task.id;
                const branchResource = getResourceLabel(resourceCount + chain);
                const branchColors = computeColorVariants(GROUP_COLORS[(chain + 5) % GROUP_COLORS.length]);
                let branchTime = cloneDate(end);

                for (let b = 0; b < branchLength && taskNum <= cfg.totalTasks && depCount < cfg.targetDeps; b++) {
                    const branchDuration = randomFloat(random, cfg.minDuration, cfg.maxDuration);
                    const { start: bStart, end: bEnd } = calculateTaskTimes(
                        branchTime,
                        branchDuration,
                        cfg.workdayStartHour,
                        cfg.workdayEndHour
                    );
                    branchTime = cloneDate(bEnd);

                    const branchTask = {
                        id: `task-${taskNum}`,
                        name: `C${chain + 1}-B${i}-${b + 1}`,
                        start: formatDateTime(bStart),
                        end: formatDateTime(bEnd),
                        progress: 0,
                        ...branchColors,
                        resource: branchResource,
                        dependencies: [{ id: branchPrevId, type: 'FS' }],
                    };

                    tasks.push(branchTask);
                    depCount++;
                    branchPrevId = branchTask.id;
                    taskNum++;
                }
            }
        }
    }

    // Add cross-chain dependencies to reach target
    const allTasks = [...tasks];
    let attempts = 0;
    const maxAttempts = cfg.targetDeps * 10;
    while (depCount < cfg.targetDeps && allTasks.length > 1 && attempts < maxAttempts) {
        attempts++;
        // Pick two tasks from different chains
        const fromIdx = randomBetween(random, 0, Math.floor(allTasks.length / 2));
        const toIdx = randomBetween(random, Math.floor(allTasks.length / 2), allTasks.length - 1);

        const fromTask = allTasks[fromIdx];
        const toTask = allTasks[toIdx];

        // Only add if from ends before to starts
        if (parseDateTime(fromTask.end) < parseDateTime(toTask.start)) {
            if (!toTask.dependencies) {
                toTask.dependencies = [];
            }
            // Check if dependency already exists
            if (!toTask.dependencies.some(d => d.id === fromTask.id)) {
                toTask.dependencies.push({ id: fromTask.id, type: 'FS' });
                depCount++;
            }
        }
    }

    return { tasks, stats: computeStats(tasks) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BALANCED TOPOLOGY
// Dense grid: ALL tasks visible at once, spread across many rows
// Each row has ~5 tasks, all rows start at same time
// ═══════════════════════════════════════════════════════════════════════════════

function generateBalanced(cfg, random) {
    const tasks = [];

    // Dense grid: scale rows to task count (aim for ~5 tasks per row)
    const numRows = Math.min(cfg.resourceCount || 100, Math.ceil(cfg.totalTasks / 5));
    const tasksPerRow = Math.ceil(cfg.totalTasks / numRows);

    let taskNum = 1;
    let depCount = 0;
    const baseStart = parseDateTime(`${cfg.startDate} ${String(cfg.workdayStartHour).padStart(2, '0')}:00`);

    // Track tasks by row for cross-row deps
    const rows = [];

    // Generate all rows starting at same time
    for (let r = 0; r < numRows && taskNum <= cfg.totalTasks; r++) {
        const resource = getResourceLabel(r);
        const rowColor = computeColorVariants(GROUP_COLORS[r % GROUP_COLORS.length]);
        const rowTasks = [];

        let currentTime = cloneDate(baseStart);
        let prevTaskId = null;

        const numInRow = Math.min(tasksPerRow, cfg.totalTasks - taskNum + 1);

        for (let i = 0; i < numInRow && taskNum <= cfg.totalTasks; i++) {
            const duration = randomFloat(random, cfg.minDuration, cfg.maxDuration);

            const { start, end } = calculateTaskTimes(
                currentTime,
                duration,
                cfg.workdayStartHour,
                cfg.workdayEndHour
            );
            currentTime = cloneDate(end);

            // Chain within row
            const deps = prevTaskId ? [{ id: prevTaskId, type: 'FS' }] : undefined;

            const task = {
                id: `task-${taskNum}`,
                name: `R${r + 1}-${i + 1}`,
                start: formatDateTime(start),
                end: formatDateTime(end),
                progress: 0,
                ...rowColor,
                resource,
                dependencies: deps,
            };

            tasks.push(task);
            rowTasks.push(task);
            if (deps) depCount++;
            prevTaskId = task.id;
            taskNum++;
        }

        rows.push(rowTasks);
    }

    // Add cross-row dependencies (mix of FS and SS)
    let attempts = 0;
    const maxAttempts = cfg.targetDeps * 10;
    while (depCount < cfg.targetDeps && attempts < maxAttempts) {
        attempts++;

        const toRowIdx = randomBetween(random, 1, rows.length - 1);
        const toRow = rows[toRowIdx];
        if (toRow.length < 1) continue;

        const toTaskIdx = randomBetween(random, 0, toRow.length - 1);
        const toTask = toRow[toTaskIdx];
        const toStart = parseDateTime(toTask.start);
        const toEnd = parseDateTime(toTask.end);

        // Pick from an earlier row
        const fromRowIdx = randomBetween(random, 0, toRowIdx - 1);
        const fromRow = rows[fromRowIdx];
        if (!fromRow || fromRow.length < 1) continue;

        const fromTaskIdx = randomBetween(random, 0, fromRow.length - 1);
        const fromTask = fromRow[fromTaskIdx];
        const fromStart = parseDateTime(fromTask.start);
        const fromEnd = parseDateTime(fromTask.end);

        if (!toTask.dependencies) toTask.dependencies = [];
        if (toTask.dependencies.some(d => d.id === fromTask.id)) continue;

        // Choose dep type based on timing validity:
        // FS valid if: fromEnd <= toStart (pred ends before succ starts)
        // SS valid if: fromStart <= toStart (pred starts before succ starts)
        const fsValid = fromEnd <= toStart;
        const ssValid = fromStart <= toStart;

        let depType;
        if (fsValid && ssValid) {
            depType = random() < 0.7 ? 'FS' : 'SS';
        } else if (ssValid) {
            depType = 'SS';
        } else if (fsValid) {
            depType = 'FS';
        } else {
            continue;  // Neither valid, skip
        }

        toTask.dependencies.push({ id: fromTask.id, type: depType });
        depCount++;
    }

    return { tasks, stats: computeStats(tasks) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════════════════════

function computeStats(tasks) {
    // Build adjacency for depth/breadth calculation
    const successors = new Map();
    const predecessors = new Map();
    let depCount = 0;

    for (const task of tasks) {
        if (!successors.has(task.id)) successors.set(task.id, []);
        if (!predecessors.has(task.id)) predecessors.set(task.id, []);

        if (task.dependencies) {
            for (const dep of task.dependencies) {
                depCount++;
                if (!successors.has(dep.id)) successors.set(dep.id, []);
                successors.get(dep.id).push(task.id);
                predecessors.get(task.id).push(dep.id);
            }
        }
    }

    // Find roots (no predecessors)
    const roots = tasks.filter(t => predecessors.get(t.id).length === 0);

    // Calculate max depth via BFS from roots
    let maxDepth = 0;
    const depths = new Map();

    // Initialize all nodes with depth 0
    for (const task of tasks) {
        depths.set(task.id, 0);
    }

    // Process in topological order (simple: iterate through all nodes repeatedly)
    let changed = true;
    let iterations = 0;
    const maxIterations = tasks.length;
    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        for (const task of tasks) {
            const preds = predecessors.get(task.id) || [];
            let maxPredDepth = -1;
            for (const predId of preds) {
                maxPredDepth = Math.max(maxPredDepth, depths.get(predId) || 0);
            }
            const newDepth = maxPredDepth + 1;
            if (newDepth > depths.get(task.id)) {
                depths.set(task.id, newDepth);
                changed = true;
            }
        }
    }

    for (const [id, depth] of depths) {
        maxDepth = Math.max(maxDepth, depth);
    }

    // Calculate breadth (max successors per task)
    let maxBreadth = 0;
    let avgBreadth = 0;
    let breadthCount = 0;

    for (const [id, succs] of successors) {
        if (succs.length > 0) {
            maxBreadth = Math.max(maxBreadth, succs.length);
            avgBreadth += succs.length;
            breadthCount++;
        }
    }
    avgBreadth = breadthCount > 0 ? (avgBreadth / breadthCount).toFixed(2) : 0;

    // Resources
    const resources = new Set(tasks.map(t => t.resource));

    return {
        tasks: tasks.length,
        dependencies: depCount,
        roots: roots.length,
        maxDepth,
        maxBreadth,
        avgBreadth,
        resources: resources.size,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════

function parseArgs(args) {
    const config = { ...DEFAULT_CONFIG };
    let topology = 'balanced';
    let outputFile = null;

    for (const arg of args.slice(2)) {
        if (!arg.startsWith('--')) continue;
        const [key, value] = arg.replace('--', '').split('=');

        switch (key) {
            case 'topology':
                topology = value;
                break;
            case 'tasks':
                config.totalTasks = parseInt(value, 10);
                break;
            case 'deps':
                config.targetDeps = parseInt(value, 10);
                break;
            case 'seed':
                config.seed = parseInt(value, 10);
                break;
            case 'output':
                outputFile = value;
                break;
            case 'help':
            case 'h':
                console.log(`
Topology Generator for Constraint System Benchmarking

Usage:
  node src/scripts/generateTopology.js [options]

Options:
  --topology=TYPE  breadth|depth|balanced|all (default: balanced)
  --tasks=N        Target number of tasks (default: 500)
  --deps=N         Target number of dependencies (default: 1000)
  --seed=N         Random seed (default: 12345)
  --output=FILE    Output filename (auto-generated if not specified)
  --help           Show this help

Topologies:
  breadth   Wide forest: many roots, high fan-out, shallow depth (~3-4 levels)
  depth     Long chains: few chains (~5), deep traversal (~100 levels)
  balanced  Project groups: 25-30 groups with internal + cross-group deps
  all       Generate all three topologies
`);
                process.exit(0);
        }
    }

    return { config, topology, outputFile };
}

function generateAndSave(topology, config, outputFile) {
    const random = createRandom(config.seed);

    let result;
    switch (topology) {
        case 'breadth':
            result = generateBreadthHeavy(config, random);
            break;
        case 'depth':
            result = generateDepthHeavy(config, random);
            break;
        case 'balanced':
        default:
            result = generateBalanced(config, random);
            break;
    }

    const { tasks, stats } = result;

    // Ensure data directory exists
    const dataDir = resolve(__dirname, '../data');
    mkdirSync(dataDir, { recursive: true });

    // Build output
    const output = {
        generated: new Date().toISOString(),
        topology,
        config,
        stats,
        tasks,
    };

    // Write file
    const filename = outputFile || `topology-${topology}.json`;
    const outputPath = resolve(dataDir, filename);
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`\n═══ ${topology.toUpperCase()} TOPOLOGY ═══`);
    console.log(`Tasks:        ${stats.tasks}`);
    console.log(`Dependencies: ${stats.dependencies}`);
    console.log(`Roots:        ${stats.roots}`);
    console.log(`Max Depth:    ${stats.maxDepth}`);
    console.log(`Max Breadth:  ${stats.maxBreadth}`);
    console.log(`Avg Breadth:  ${stats.avgBreadth}`);
    console.log(`Resources:    ${stats.resources}`);
    console.log(`Output:       ${outputPath}`);

    return stats;
}

// Main execution
const { config, topology, outputFile } = parseArgs(process.argv);

if (topology === 'all') {
    console.log('Generating all topologies...');
    generateAndSave('breadth', config, null);
    generateAndSave('depth', config, null);
    generateAndSave('balanced', config, null);
} else {
    generateAndSave(topology, config, outputFile);
}
