#!/usr/bin/env node
/**
 * Constraint Resolution Benchmark CLI
 *
 * Usage:
 *   node src/benchmarks/runBenchmarks.js
 *   node src/benchmarks/runBenchmarks.js --tasks=500
 *   node src/benchmarks/runBenchmarks.js --topology=dense --tasks=200
 *   node src/benchmarks/runBenchmarks.js --all
 *   node src/benchmarks/runBenchmarks.js --output=results.json
 */

import {
    benchmark,
    benchmarkWithSetup,
    formatMs,
    formatSuite,
    runSuite,
    DEFAULT_CONFIG,
} from './constraintBench.js';

import {
    generateLinearChain,
    generateFanOut,
    generateFanIn,
    generateRandomGraph,
    generateDenseGraph,
    generateMixedTypes,
    generateWithLocks,
    buildContext,
    generateAllPresets,
    PROFILES,
} from './generateBenchData.js';

import {
    resolveConstraints,
    calculateCascadeUpdates,
    getMinXFromPredecessors,
    getMaxEndFromDownstream,
    getDepOffsets,
} from '../utils/constraintEngine.js';

import { writeFileSync } from 'fs';

// ═══════════════════════════════════════════════════════════════════════════════
// CLI ARGUMENT PARSING
// ═══════════════════════════════════════════════════════════════════════════════

function parseArgs(args) {
    const options = {
        tasks: 200,
        topology: 'linear',
        runs: DEFAULT_CONFIG.measuredRuns,
        warmup: DEFAULT_CONFIG.warmupRuns,
        all: false,
        output: null,
        verbose: false,
        help: false,
    };

    for (const arg of args.slice(2)) {
        if (!arg.startsWith('--')) continue;

        const [key, value] = arg.replace('--', '').split('=');

        switch (key) {
            case 'tasks':
            case 't':
                options.tasks = parseInt(value, 10);
                break;
            case 'topology':
            case 'topo':
                options.topology = value;
                break;
            case 'runs':
            case 'r':
                options.runs = parseInt(value, 10);
                break;
            case 'warmup':
            case 'w':
                options.warmup = parseInt(value, 10);
                break;
            case 'all':
            case 'a':
                options.all = value === undefined || value === 'true';
                break;
            case 'output':
            case 'o':
                options.output = value;
                break;
            case 'verbose':
            case 'v':
                options.verbose = value === undefined || value === 'true';
                break;
            case 'help':
            case 'h':
                options.help = true;
                break;
        }
    }

    return options;
}

function printHelp() {
    console.log(`
Constraint Resolution Benchmark CLI

Usage:
  node src/benchmarks/runBenchmarks.js [options]

Options:
  --tasks=N, -t=N       Number of tasks (default: 200)
  --topology=TYPE       Graph topology: linear, fanout, fanin, random, dense, mixed
                        (default: linear)
  --runs=N, -r=N        Number of measured runs (default: 100)
  --warmup=N, -w=N      Number of warmup runs (default: 5)
  --all, -a             Run all preset benchmarks
  --output=FILE, -o     Save results to JSON file
  --verbose, -v         Print detailed timing data
  --help, -h            Show this help

Topologies:
  linear    Linear chain: task-0 → task-1 → task-2 → ...
  fanout    Single root with many children
  fanin     Many tasks converging to single successor
  random    Random graph with ~10% edge density
  dense     Dense graph with ~4 relationships per task
  mixed     Linear chain with mixed FS/SS/FF/SF types

Examples:
  node src/benchmarks/runBenchmarks.js --tasks=500
  node src/benchmarks/runBenchmarks.js --topology=dense --tasks=200
  node src/benchmarks/runBenchmarks.js --all --output=baseline.json
`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPOLOGY GENERATOR DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

function generateByTopology(topology, taskCount, options = {}) {
    switch (topology) {
        case 'linear':
            return generateLinearChain(taskCount, options);
        case 'fanout':
            return generateFanOut(taskCount, options);
        case 'fanin':
            return generateFanIn(taskCount, options);
        case 'random':
            return generateRandomGraph(taskCount, 0.1, options);
        case 'dense':
            return generateDenseGraph(taskCount, 4, options);
        case 'mixed':
            return generateMixedTypes(taskCount, options);
        case 'locked-end':
            return generateWithLocks(taskCount, [taskCount - 1], options);
        default:
            console.warn(`Unknown topology: ${topology}, using linear`);
            return generateLinearChain(taskCount, options);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run benchmarks for a single dataset.
 */
function benchmarkDataset(data, config) {
    const context = buildContext(data);
    const { tasks, relationships } = data;
    const taskIds = Object.keys(tasks);
    const middleTaskId = taskIds[Math.floor(taskIds.length / 2)];
    const firstTaskId = taskIds[0];

    const results = [];

    // 1. resolveConstraints (main entry point)
    results.push(benchmark(
        'resolveConstraints',
        () => {
            const task = tasks[firstTaskId];
            const bar = task.$bar;
            resolveConstraints(firstTaskId, bar.x + 10, bar.width, context);
        },
        config
    ));

    // 2. getMinXFromPredecessors (O(n) scan)
    if (relationships.length > 0) {
        // Find a task with predecessors
        const taskWithPred = taskIds.find(id =>
            relationships.some(r => r.to === id)
        ) || middleTaskId;

        results.push(benchmark(
            'getMinXFromPredecessors',
            () => {
                getMinXFromPredecessors(
                    taskWithPred,
                    relationships,
                    context.getBarPosition,
                    context.pixelsPerHour,
                    80
                );
            },
            config
        ));
    }

    // 3. getMaxEndFromDownstream (BFS traversal)
    results.push(benchmark(
        'getMaxEndFromDownstream',
        () => {
            getMaxEndFromDownstream(
                firstTaskId,
                relationships,
                context.getBarPosition,
                context.getTask,
                context.pixelsPerHour
            );
        },
        config
    ));

    // 4. calculateCascadeUpdates (cascade propagation)
    results.push(benchmark(
        'calculateCascadeUpdates',
        () => {
            const task = tasks[firstTaskId];
            calculateCascadeUpdates(firstTaskId, task.$bar.x + 10, context);
        },
        config
    ));

    // 5. getDepOffsets (micro-benchmark)
    if (relationships.length > 0) {
        const rel = relationships[0];
        results.push(benchmark(
            'getDepOffsets',
            () => {
                getDepOffsets(rel, context.pixelsPerHour);
            },
            config
        ));
    }

    return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

function main() {
    const options = parseArgs(process.argv);

    if (options.help) {
        printHelp();
        process.exit(0);
    }

    const config = {
        warmupRuns: options.warmup,
        measuredRuns: options.runs,
    };

    console.log('═'.repeat(60));
    console.log('Constraint Resolution Benchmark');
    console.log('═'.repeat(60));
    console.log(`Runs: ${config.measuredRuns} (warmup: ${config.warmupRuns})`);
    console.log('');

    const allResults = [];

    if (options.all) {
        // Run all preset benchmarks
        const presets = generateAllPresets();

        for (const [name, data] of Object.entries(presets)) {
            console.log(`\n─── ${name} ───`);
            console.log(`Tasks: ${data.taskCount}, Relationships: ${data.relationships.length}`);

            const results = benchmarkDataset(data, config);
            allResults.push({
                dataset: name,
                taskCount: data.taskCount,
                relationships: data.relationships.length,
                topology: data.topology,
                results,
            });

            // Print summary for this dataset
            for (const r of results) {
                console.log(`  ${r.name}: mean=${formatMs(r.mean)}, p95=${formatMs(r.p95)}`);
            }
        }
    } else {
        // Run single benchmark
        const data = generateByTopology(options.topology, options.tasks);

        console.log(`Topology: ${options.topology}`);
        console.log(`Tasks: ${data.taskCount}, Relationships: ${data.relationships.length}`);
        console.log('');

        const results = benchmarkDataset(data, config);
        allResults.push({
            dataset: `${options.topology}-${options.tasks}`,
            taskCount: data.taskCount,
            relationships: data.relationships.length,
            topology: data.topology,
            results,
        });

        // Print detailed results
        for (const r of results) {
            console.log(`${r.name}:`);
            console.log(`  mean: ${formatMs(r.mean)}, median: ${formatMs(r.median)}`);
            console.log(`  p95: ${formatMs(r.p95)}, p99: ${formatMs(r.p99)}`);
            console.log(`  min: ${formatMs(r.min)}, max: ${formatMs(r.max)}`);
            console.log(`  stdDev: ${formatMs(r.stdDev)}`);
            console.log('');
        }
    }

    // Save to file if requested
    if (options.output) {
        const output = {
            timestamp: new Date().toISOString(),
            config,
            benchmarks: allResults,
        };

        writeFileSync(options.output, JSON.stringify(output, null, 2));
        console.log(`\nResults saved to: ${options.output}`);
    }

    console.log('═'.repeat(60));
}

main();
