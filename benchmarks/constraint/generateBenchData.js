/**
 * Synthetic Test Data Generator for Constraint Benchmarks
 *
 * Generates various graph topologies to stress-test constraint resolution:
 * - Linear chains (worst case for cascade propagation)
 * - Wide fan-out (many successors per task)
 * - Random graphs (realistic distribution)
 * - Dense graphs (many cross-dependencies)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SEEDED RANDOM (for reproducibility)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a seeded random number generator.
 * @param {number} seed - Random seed
 * @returns {Function} Random function returning 0-1
 */
export function createRandom(seed = 12345) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

export const PROFILES = {
    small: { tasks: 50, description: 'Typical project' },
    medium: { tasks: 200, description: 'Large project' },
    large: { tasks: 1000, description: 'Stress test' },
    xlarge: { tasks: 5000, description: 'Extreme stress test' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// TASK GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a single task object.
 * @param {string} id - Task ID
 * @param {number} x - X position
 * @param {Object} options - Additional options
 * @returns {Object} Task object
 */
function createTask(id, x, options = {}) {
    return {
        id,
        _bar: {
            x,
            y: 0,
            width: options.width ?? 80,
            height: 30,
        },
        constraints: {
            locked: options.locked ?? false,
        },
    };
}

/**
 * Create a relationship object.
 * @param {string} from - Predecessor task ID
 * @param {string} to - Successor task ID
 * @param {Object} options - Relationship options
 * @returns {Object} Relationship object
 */
function createRelationship(from, to, options = {}) {
    return {
        from,
        to,
        type: options.type ?? 'FS',
        lag: options.lag ?? 0,
        min: options.min ?? 0,
        max: options.max, // undefined = elastic
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPOLOGY GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a linear chain: task-0 → task-1 → task-2 → ...
 * Worst case for cascade propagation (all tasks affected).
 *
 * @param {number} taskCount - Number of tasks
 * @param {Object} options - Generation options
 * @returns {Object} { tasks, relationships }
 */
export function generateLinearChain(taskCount, options = {}) {
    const tasks = {};
    const relationships = [];
    const spacing = options.spacing ?? 100;

    for (let i = 0; i < taskCount; i++) {
        const id = `task-${i}`;
        tasks[id] = createTask(id, i * spacing);

        if (i > 0) {
            relationships.push(createRelationship(`task-${i - 1}`, id, options.relOptions));
        }
    }

    return { tasks, relationships, topology: 'linear', taskCount };
}

/**
 * Generate a wide fan-out: single root with many children.
 * Tests handling of many successors per task.
 *
 * @param {number} taskCount - Total number of tasks
 * @param {Object} options - Generation options
 * @returns {Object} { tasks, relationships }
 */
export function generateFanOut(taskCount, options = {}) {
    const tasks = {};
    const relationships = [];
    const spacing = options.spacing ?? 100;

    // Root task
    tasks['task-0'] = createTask('task-0', 0);

    // All children depend on root
    for (let i = 1; i < taskCount; i++) {
        const id = `task-${i}`;
        tasks[id] = createTask(id, spacing);
        relationships.push(createRelationship('task-0', id, options.relOptions));
    }

    return { tasks, relationships, topology: 'fanout', taskCount };
}

/**
 * Generate a fan-in: many tasks converging to single successor.
 * Tests handling of many predecessors per task.
 *
 * @param {number} taskCount - Total number of tasks
 * @param {Object} options - Generation options
 * @returns {Object} { tasks, relationships }
 */
export function generateFanIn(taskCount, options = {}) {
    const tasks = {};
    const relationships = [];
    const spacing = options.spacing ?? 100;

    // All predecessors
    for (let i = 0; i < taskCount - 1; i++) {
        const id = `task-${i}`;
        tasks[id] = createTask(id, 0);
    }

    // Single successor depends on all predecessors
    const lastId = `task-${taskCount - 1}`;
    tasks[lastId] = createTask(lastId, spacing);

    for (let i = 0; i < taskCount - 1; i++) {
        relationships.push(createRelationship(`task-${i}`, lastId, options.relOptions));
    }

    return { tasks, relationships, topology: 'fanin', taskCount };
}

/**
 * Generate a binary tree: each task has two successors.
 * Tests balanced cascade propagation.
 *
 * @param {number} depth - Tree depth (2^depth - 1 tasks)
 * @param {Object} options - Generation options
 * @returns {Object} { tasks, relationships }
 */
export function generateBinaryTree(depth, options = {}) {
    const tasks = {};
    const relationships = [];
    const spacing = options.spacing ?? 100;

    let taskId = 0;

    function buildLevel(level, parentId) {
        if (level > depth) return;

        const leftId = `task-${taskId++}`;
        const rightId = `task-${taskId++}`;

        tasks[leftId] = createTask(leftId, level * spacing);
        tasks[rightId] = createTask(rightId, level * spacing);

        if (parentId) {
            relationships.push(createRelationship(parentId, leftId, options.relOptions));
            relationships.push(createRelationship(parentId, rightId, options.relOptions));
        }

        buildLevel(level + 1, leftId);
        buildLevel(level + 1, rightId);
    }

    // Root
    const rootId = `task-${taskId++}`;
    tasks[rootId] = createTask(rootId, 0);
    buildLevel(1, rootId);

    return { tasks, relationships, topology: 'binarytree', taskCount: Object.keys(tasks).length };
}

/**
 * Generate a random graph with controlled density.
 * Realistic distribution of dependencies.
 *
 * @param {number} taskCount - Number of tasks
 * @param {number} density - Probability of edge between any two tasks (0-1)
 * @param {Object} options - Generation options
 * @returns {Object} { tasks, relationships }
 */
export function generateRandomGraph(taskCount, density = 0.1, options = {}) {
    const random = createRandom(options.seed ?? 12345);
    const tasks = {};
    const relationships = [];
    const spacing = options.spacing ?? 100;

    // Create tasks
    for (let i = 0; i < taskCount; i++) {
        const id = `task-${i}`;
        tasks[id] = createTask(id, i * spacing);
    }

    // Create random edges (only forward edges to avoid cycles)
    for (let i = 0; i < taskCount; i++) {
        for (let j = i + 1; j < taskCount; j++) {
            if (random() < density) {
                relationships.push(createRelationship(`task-${i}`, `task-${j}`, options.relOptions));
            }
        }
    }

    return { tasks, relationships, topology: 'random', taskCount, density };
}

/**
 * Generate a dense graph with many cross-dependencies.
 * Stress test for relationship scanning.
 *
 * @param {number} taskCount - Number of tasks
 * @param {number} relsPerTask - Average relationships per task
 * @param {Object} options - Generation options
 * @returns {Object} { tasks, relationships }
 */
export function generateDenseGraph(taskCount, relsPerTask = 4, options = {}) {
    const random = createRandom(options.seed ?? 12345);
    const tasks = {};
    const relationships = [];
    const spacing = options.spacing ?? 100;

    // Create tasks
    for (let i = 0; i < taskCount; i++) {
        const id = `task-${i}`;
        tasks[id] = createTask(id, i * spacing);
    }

    // Calculate max possible edges (forward only to avoid cycles)
    // n*(n-1)/2 for complete graph
    const maxPossibleEdges = (taskCount * (taskCount - 1)) / 2;
    const targetRels = Math.min(taskCount * relsPerTask, maxPossibleEdges);

    // For high density (>5% of possible edges), use systematic generation
    // Random selection becomes inefficient due to collision rate
    if (targetRels > maxPossibleEdges * 0.05) {
        // Generate all possible edges, shuffle, take first targetRels
        const allEdges = [];
        for (let i = 0; i < taskCount; i++) {
            for (let j = i + 1; j < taskCount; j++) {
                allEdges.push([i, j]);
            }
        }

        // Fisher-Yates shuffle with seeded random
        for (let i = allEdges.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [allEdges[i], allEdges[j]] = [allEdges[j], allEdges[i]];
        }

        // Take first targetRels edges
        for (let i = 0; i < targetRels && i < allEdges.length; i++) {
            const [from, to] = allEdges[i];
            relationships.push(createRelationship(`task-${from}`, `task-${to}`, options.relOptions));
        }
    } else {
        // For lower density, random selection is efficient
        const existingRels = new Set();
        let attempts = 0;
        const maxAttempts = targetRels * 100; // Increased from 10x to 100x

        while (relationships.length < targetRels && attempts < maxAttempts) {
            attempts++;
            const from = Math.floor(random() * (taskCount - 1));
            const to = from + 1 + Math.floor(random() * (taskCount - from - 1));

            if (to >= taskCount) continue;

            const key = `${from}-${to}`;
            if (existingRels.has(key)) continue;

            existingRels.add(key);
            relationships.push(createRelationship(`task-${from}`, `task-${to}`, options.relOptions));
        }
    }

    return { tasks, relationships, topology: 'dense', taskCount, relsPerTask, maxPossibleEdges };
}

/**
 * Generate a graph with locked tasks at specific positions.
 * Tests constraint blocking behavior.
 *
 * @param {number} taskCount - Number of tasks
 * @param {number[]} lockedIndices - Indices of locked tasks
 * @param {Object} options - Generation options
 * @returns {Object} { tasks, relationships }
 */
export function generateWithLocks(taskCount, lockedIndices = [], options = {}) {
    const { tasks, relationships, ...meta } = generateLinearChain(taskCount, options);

    for (const idx of lockedIndices) {
        const id = `task-${idx}`;
        if (tasks[id]) {
            tasks[id].constraints.locked = true;
        }
    }

    return { tasks, relationships, ...meta, lockedIndices };
}

/**
 * Generate a graph with mixed dependency types.
 * Tests FS/SS/FF/SF handling.
 *
 * @param {number} taskCount - Number of tasks
 * @param {Object} options - Generation options
 * @returns {Object} { tasks, relationships }
 */
export function generateMixedTypes(taskCount, options = {}) {
    const random = createRandom(options.seed ?? 12345);
    const tasks = {};
    const relationships = [];
    const spacing = options.spacing ?? 100;
    const types = ['FS', 'SS', 'FF', 'SF'];

    for (let i = 0; i < taskCount; i++) {
        const id = `task-${i}`;
        tasks[id] = createTask(id, i * spacing);

        if (i > 0) {
            const type = types[Math.floor(random() * types.length)];
            relationships.push(createRelationship(`task-${i - 1}`, id, { type }));
        }
    }

    return { tasks, relationships, topology: 'mixed', taskCount };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build relationship lookup indices for O(1) access.
 * @param {Array} relationships - All relationships
 * @returns {Object} { bySuccessor: Map, byPredecessor: Map }
 */
export function buildRelationshipIndex(relationships) {
    const bySuccessor = new Map();   // taskId → rels where task is `to`
    const byPredecessor = new Map(); // taskId → rels where task is `from`

    for (const rel of relationships) {
        if (!bySuccessor.has(rel.to)) bySuccessor.set(rel.to, []);
        bySuccessor.get(rel.to).push(rel);

        if (!byPredecessor.has(rel.from)) byPredecessor.set(rel.from, []);
        byPredecessor.get(rel.from).push(rel);
    }

    return { bySuccessor, byPredecessor };
}

/**
 * Build a context object for constraint resolution.
 *
 * @param {Object} data - Generated data { tasks, relationships }
 * @param {Object} options - Context options
 * @param {boolean} options.useIndex - Build and include relationship index for O(1) lookups
 * @returns {Object} Context for resolveConstraints
 */
export function buildContext(data, options = {}) {
    const { tasks, relationships } = data;
    const pixelsPerHour = options.pixelsPerHour ?? 10;
    const ganttStartDate = options.ganttStartDate ?? new Date('2025-01-01');

    const context = {
        getBarPosition: (id) => tasks[id]?._bar,
        getTask: (id) => tasks[id],
        relationships,
        pixelsPerHour,
        ganttStartDate,
    };

    // Optionally build relationship index for O(1) lookups
    if (options.useIndex) {
        context.relationshipIndex = buildRelationshipIndex(relationships);
    }

    return context;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRESETS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate all standard test datasets.
 * @returns {Object} Map of dataset name to generated data
 */
export function generateAllPresets() {
    return {
        // Size variations (linear chain)
        'linear-50': generateLinearChain(50),
        'linear-200': generateLinearChain(200),
        'linear-1000': generateLinearChain(1000),

        // Topology variations (200 tasks)
        'fanout-200': generateFanOut(200),
        'fanin-200': generateFanIn(200),
        'random-200': generateRandomGraph(200, 0.1),
        'dense-200': generateDenseGraph(200, 4),
        'mixed-200': generateMixedTypes(200),

        // Stress tests
        'linear-deep': generateLinearChain(500),
        'dense-stress': generateDenseGraph(500, 8),

        // Lock variations
        'locked-end': generateWithLocks(100, [99]),
        'locked-middle': generateWithLocks(100, [50]),
        'locked-both': generateWithLocks(100, [0, 99]),
    };
}

export default {
    createRandom,
    PROFILES,
    generateLinearChain,
    generateFanOut,
    generateFanIn,
    generateBinaryTree,
    generateRandomGraph,
    generateDenseGraph,
    generateWithLocks,
    generateMixedTypes,
    buildContext,
    generateAllPresets,
};
