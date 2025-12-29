/**
 * constraintEngine.js - Unified Constraint Resolution Engine
 *
 * Single source of truth for all constraint logic:
 * - Dependency type calculations (FS/SS/FF/SF)
 * - Gap behavior (elastic, fixed, bounded)
 * - Constraint resolution with iterative relaxation cascade
 *
 * Design principles:
 * 1. Single model: min/max offsets (more expressive than boolean)
 * 2. Constraint order: locks → absolute → dependencies
 * 3. Iterative relaxation: Guaranteed convergence for DAGs
 * 4. Pure functions: No store mutation inside engine
 *
 * Cascade Algorithm (December 2025):
 * ─────────────────────────────────
 * The cascade uses iterative constraint relaxation instead of BFS.
 *
 * Problem with BFS: When task A has multiple predecessors (B, C, D) from
 * different paths, BFS may visit A before all predecessors are updated,
 * causing A's position to not satisfy all constraints.
 *
 * Solution: Iterative relaxation
 * 1. Find all reachable successors from dragged task (single BFS)
 * 2. Loop until convergence:
 *    - For each reachable task, recalculate minX from ALL predecessors
 *    - If minX > current position, update position and mark changed
 * 3. Repeat until no changes (guaranteed for DAGs)
 *
 * Complexity: O(depth × reachable), typically 2-3 iterations
 *
 * @module constraintEngine
 */

import {
    isMovementLocked,
    getMinXFromAbsolute,
    getMaxXFromAbsolute,
    getMaxEndFromAbsolute,
} from './absoluteConstraints.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Floating point tolerance in pixels */
export const EPSILON_PX = 0.5;

/** Maximum cascade iterations to prevent infinite loops */
export const MAX_CASCADE_ITERATIONS = 100;

/** Dependency types */
export const DEP_TYPES = {
    FS: 'FS',  // Finish-to-Start (default)
    SS: 'SS',  // Start-to-Start
    FF: 'FF',  // Finish-to-Finish
    SF: 'SF',  // Start-to-Finish
};

// ═══════════════════════════════════════════════════════════════════════════════
// RELATIONSHIP INDEX
// Pre-computed indices for O(1) lookup instead of O(n) scans
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build relationship lookup indices for O(1) access.
 * Call once when relationships change, not per drag frame.
 *
 * @param {Array} relationships - All relationships
 * @returns {Object} { bySuccessor: Map, byPredecessor: Map }
 */
export function buildRelationshipIndex(relationships) {
    const bySuccessor = new Map();   // taskId → rels where task is `to` (for predecessor lookups)
    const byPredecessor = new Map(); // taskId → rels where task is `from` (for successor lookups)

    for (const rel of relationships) {
        // Index by successor (to) - used by getMinXFromPredecessors, getMaxXFromPredecessors
        if (!bySuccessor.has(rel.to)) bySuccessor.set(rel.to, []);
        bySuccessor.get(rel.to).push(rel);

        // Index by predecessor (from) - used by getMaxEndFromDownstream, calculateCascadeUpdates
        if (!byPredecessor.has(rel.from)) byPredecessor.set(rel.from, []);
        byPredecessor.get(rel.from).push(rel);
    }

    return { bySuccessor, byPredecessor };
}

// ═══════════════════════════════════════════════════════════════════════════════
// OFFSET PARSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse dependency min/max offset values into pixel units with semantic flags.
 *
 * Gap behavior:
 * - min=0, max=undefined (default): Elastic - push only, gap can grow indefinitely
 * - min=0, max=0: Fixed gap - push AND pull to maintain exact lag
 * - min=0, max=N: Bounded - push always, pull only if gap > lag+max
 *
 * @param {Object} rel - Relationship object with lag, min, max
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {Object} { lag, min, max, minGap, maxGap, isElastic, isFixed }
 */
export function getDepOffsets(rel, pixelsPerHour) {
    const lag = (rel.lag ?? 0) * pixelsPerHour;
    const min = (rel.min ?? 0) * pixelsPerHour;

    // Default is elastic (push only): max=undefined or max=null → Infinity
    // Explicit max=0 means fixed gap (push+pull)
    // Explicit max=N means bounded (push, pull only when gap > N)
    const maxVal = rel.max;
    const max = (maxVal === undefined || maxVal === null) ? Infinity : maxVal * pixelsPerHour;

    return {
        lag,
        min,
        max,
        minGap: lag + min,   // Minimum allowed gap
        maxGap: lag + max,   // Maximum allowed gap (Infinity for elastic)
        isElastic: max === Infinity,  // Can gap grow indefinitely?
        isFixed: max === min,  // Must gap be exact?
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED DEPENDENCY TYPE CALCULATIONS
// Replaces 5 duplicate switch statements with single implementations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get anchor point on predecessor for a given dependency type.
 *
 * @param {string} type - Dependency type (FS, SS, FF, SF)
 * @param {Object} predBar - Predecessor bar { x, width }
 * @returns {number} Anchor X position
 */
export function getPredAnchor(type, predBar) {
    switch (type) {
        case DEP_TYPES.FS:
        case DEP_TYPES.FF:
            return predBar.x + predBar.width;  // Predecessor end
        case DEP_TYPES.SS:
        case DEP_TYPES.SF:
            return predBar.x;  // Predecessor start
        default:
            return predBar.x + predBar.width;  // Default to end
    }
}

/**
 * Get reference point on successor for a given dependency type.
 *
 * @param {string} type - Dependency type (FS, SS, FF, SF)
 * @param {Object} succBar - Successor bar { x, width }
 * @returns {number} Reference X position
 */
export function getSuccRef(type, succBar) {
    switch (type) {
        case DEP_TYPES.FS:
        case DEP_TYPES.SS:
            return succBar.x;  // Successor start
        case DEP_TYPES.FF:
        case DEP_TYPES.SF:
            return succBar.x + succBar.width;  // Successor end
        default:
            return succBar.x;  // Default to start
    }
}

/**
 * Check if dependency type constrains successor's end (vs start).
 *
 * @param {string} type - Dependency type
 * @returns {boolean} True if constrains end
 */
export function constrainsSuccEnd(type) {
    return type === DEP_TYPES.FF || type === DEP_TYPES.SF;
}

/**
 * Check if dependency type constrains predecessor's end (vs start).
 * Used for cascade blocking.
 *
 * @param {string} type - Dependency type
 * @returns {boolean} True if constrains predecessor end
 */
export function constrainsPredEnd(type) {
    return type === DEP_TYPES.FS || type === DEP_TYPES.FF;
}

/**
 * Calculate minimum X position for successor based on predecessor position.
 *
 * @param {string} type - Dependency type (FS, SS, FF, SF)
 * @param {Object} predBar - Predecessor bar { x, width }
 * @param {number} succWidth - Successor width
 * @param {number} gap - Required gap (minGap)
 * @returns {number} Minimum X for successor
 */
export function getMinSuccessorX(type, predBar, succWidth, gap) {
    const anchor = getPredAnchor(type, predBar);
    const minRef = anchor + gap;

    // Convert reference point to X position
    if (constrainsSuccEnd(type)) {
        // FF/SF: reference is successor end
        return minRef - succWidth;
    } else {
        // FS/SS: reference is successor start
        return minRef;
    }
}

/**
 * Calculate maximum X position for successor based on predecessor position.
 * Used for bounded/fixed gap constraints.
 *
 * @param {string} type - Dependency type (FS, SS, FF, SF)
 * @param {Object} predBar - Predecessor bar { x, width }
 * @param {number} succWidth - Successor width
 * @param {number} gap - Maximum gap (maxGap)
 * @returns {number} Maximum X for successor
 */
export function getMaxSuccessorX(type, predBar, succWidth, gap) {
    const anchor = getPredAnchor(type, predBar);
    const maxRef = anchor + gap;

    // Convert reference point to X position
    if (constrainsSuccEnd(type)) {
        // FF/SF: reference is successor end
        return maxRef - succWidth;
    } else {
        // FS/SS: reference is successor start
        return maxRef;
    }
}

/**
 * Calculate maximum predecessor end position based on successor position.
 * Used for downstream constraint checking.
 *
 * @param {string} type - Dependency type (FS, SS, FF, SF)
 * @param {Object} succBar - Successor bar { x, width }
 * @param {number} gap - Required gap (minGap)
 * @returns {number} Maximum end position for predecessor, or Infinity if no constraint
 */
export function getMaxPredEnd(type, succBar, gap) {
    if (!constrainsPredEnd(type)) {
        // SS/SF constrain predecessor start, not end
        return Infinity;
    }

    const succRef = getSuccRef(type, succBar);
    return succRef - gap;
}

/**
 * Calculate maximum predecessor start position based on successor position.
 * Used for SS/SF constraint checking.
 *
 * @param {string} type - Dependency type (FS, SS, FF, SF)
 * @param {Object} succBar - Successor bar { x, width }
 * @param {number} gap - Required gap (minGap)
 * @returns {number} Maximum start position for predecessor, or Infinity if no constraint
 */
export function getMaxPredStart(type, succBar, gap) {
    if (constrainsPredEnd(type)) {
        // FS/FF constrain predecessor end, not start
        return Infinity;
    }

    const succRef = getSuccRef(type, succBar);
    return succRef - gap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRAINT AGGREGATION
// Combines all constraints for a single task
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get minimum X from all predecessor constraints.
 *
 * @param {string} taskId - Task ID
 * @param {Array|Object} relationshipsOrIndex - All relationships array OR relationshipIndex object
 * @param {Function} getBarPosition - Position getter
 * @param {number} pixelsPerHour - Conversion factor
 * @param {number} taskWidth - Task width in pixels
 * @returns {number} Minimum X position
 */
export function getMinXFromPredecessors(taskId, relationshipsOrIndex, getBarPosition, pixelsPerHour, taskWidth = 0) {
    let minX = 0;

    // Support both indexed and legacy array API
    const predecessorRels = Array.isArray(relationshipsOrIndex)
        ? relationshipsOrIndex.filter(rel => rel.to === taskId)  // O(n) legacy
        : (relationshipsOrIndex.bySuccessor?.get(taskId) || []);  // O(1) indexed

    for (const rel of predecessorRels) {
        const predBar = getBarPosition(rel.from);
        if (!predBar) continue;

        const type = rel.type || DEP_TYPES.FS;
        const { minGap } = getDepOffsets(rel, pixelsPerHour);

        const constraint = getMinSuccessorX(type, predBar, taskWidth, minGap);
        minX = Math.max(minX, constraint);
    }

    return minX;
}

/**
 * Get maximum X from all predecessor constraints with max gap defined.
 *
 * @param {string} taskId - Task ID
 * @param {Array|Object} relationshipsOrIndex - All relationships array OR relationshipIndex object
 * @param {Function} getBarPosition - Position getter
 * @param {number} pixelsPerHour - Conversion factor
 * @param {number} taskWidth - Task width in pixels
 * @returns {number} Maximum X position (Infinity if no constraint)
 */
export function getMaxXFromPredecessors(taskId, relationshipsOrIndex, getBarPosition, pixelsPerHour, taskWidth = 0) {
    let maxX = Infinity;

    // Support both indexed and legacy array API
    const predecessorRels = Array.isArray(relationshipsOrIndex)
        ? relationshipsOrIndex.filter(rel => rel.to === taskId)  // O(n) legacy
        : (relationshipsOrIndex.bySuccessor?.get(taskId) || []);  // O(1) indexed

    for (const rel of predecessorRels) {
        const predBar = getBarPosition(rel.from);
        if (!predBar) continue;

        const { maxGap, isElastic } = getDepOffsets(rel, pixelsPerHour);
        if (isElastic) continue;  // Elastic deps don't limit max position

        const type = rel.type || DEP_TYPES.FS;
        const constraint = getMaxSuccessorX(type, predBar, taskWidth, maxGap);
        maxX = Math.min(maxX, constraint);
    }

    return maxX;
}

/**
 * Get maximum end position this task can have based on downstream constraints.
 * Uses iterative breadth-first traversal instead of recursion.
 *
 * For unlocked successors: we can push them, but only up to their own downstream limit.
 * For locked successors: we cannot push at all, this is a hard constraint.
 *
 * Early termination optimizations:
 * - Returns immediately if task has no successors
 * - Stops traversal if a tight constraint is found (can't move at all)
 *
 * @param {string} taskId - Task ID
 * @param {Array|Object} relationshipsOrIndex - All relationships array OR relationshipIndex object
 * @param {Function} getBarPosition - Position getter
 * @param {Function} getTask - Task getter
 * @param {number} pixelsPerHour - Conversion factor
 * @param {Object} currentBar - Current bar position (optional, for early termination check)
 * @returns {number} Maximum end position (Infinity if no constraint)
 */
export function getMaxEndFromDownstream(taskId, relationshipsOrIndex, getBarPosition, getTask, pixelsPerHour, currentBar = null) {
    // Use pre-built index if available, otherwise build successor adjacency
    // The function works with raw relationships directly to avoid object creation overhead
    let getSuccessorRels;
    if (Array.isArray(relationshipsOrIndex)) {
        // Legacy: build successor map from scratch O(n)
        const successorMap = new Map();
        for (const rel of relationshipsOrIndex) {
            if (!successorMap.has(rel.from)) {
                successorMap.set(rel.from, []);
            }
            successorMap.get(rel.from).push(rel);
        }
        getSuccessorRels = (id) => successorMap.get(id) || [];
    } else {
        // Indexed: O(1) lookup from pre-built byPredecessor map
        getSuccessorRels = (id) => relationshipsOrIndex.byPredecessor?.get(id) || [];
    }

    // Early termination: no successors means no downstream constraints
    const directSuccessors = getSuccessorRels(taskId);
    if (directSuccessors.length === 0) {
        return Infinity;
    }

    // Get current end position for tight constraint detection
    const currentEnd = currentBar ? currentBar.x + currentBar.width : null;

    // Track per-task max end constraints discovered during traversal
    const maxEndCache = new Map();  // taskId → maxEnd

    // Iterative traversal using work queue
    // Start with direct successors, propagate constraints backward
    const visited = new Set();
    const queue = [taskId];
    const order = [];  // Topological order for backward pass

    // Forward pass: build traversal order
    while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        order.push(currentId);

        const succs = getSuccessorRels(currentId);
        for (const rel of succs) {
            if (!visited.has(rel.to)) {
                queue.push(rel.to);
            }
        }
    }

    // Backward pass: compute max end for each task
    // Process in reverse topological order
    for (let i = order.length - 1; i >= 0; i--) {
        const currentId = order[i];
        let maxEnd = Infinity;

        const succs = getSuccessorRels(currentId);
        for (const rel of succs) {
            const succId = rel.to;
            const succTask = getTask?.(succId);
            const succBar = getBarPosition(succId);
            if (!succBar) continue;

            const { minGap } = getDepOffsets(rel, pixelsPerHour);
            const type = rel.type || DEP_TYPES.FS;

            // This type must constrain predecessor end
            if (!constrainsPredEnd(type)) continue;

            const isLocked = isMovementLocked(succTask?.constraints?.locked);

            if (isLocked) {
                // Locked successor: hard constraint
                const constraint = getMaxPredEnd(type, succBar, minGap);
                maxEnd = Math.min(maxEnd, constraint);
            } else {
                // Unlocked successor: can push, but limited by their downstream
                const succMaxEnd = maxEndCache.get(succId) ?? Infinity;

                // How far can successor's start go?
                // succ.x + succ.width <= succMaxEnd
                // succ.x <= succMaxEnd - succ.width
                const succMaxX = succMaxEnd - succBar.width;

                // Our end + minGap <= succ.x
                // Our end <= succMaxX - minGap
                const ourMaxEnd = succMaxX - minGap;
                maxEnd = Math.min(maxEnd, ourMaxEnd);
            }
        }

        maxEndCache.set(currentId, maxEnd);

        // Early termination: if we're processing the root task and found a tight constraint
        // (maxEnd <= currentEnd), we can't move at all, no need to continue
        if (currentId === taskId && currentEnd !== null && maxEnd <= currentEnd + EPSILON_PX) {
            return maxEnd;
        }
    }

    return maxEndCache.get(taskId) ?? Infinity;
}

/**
 * Get maximum start position based on locked successors (SS/SF constraints).
 *
 * @param {string} taskId - Task ID
 * @param {Array|Object} relationshipsOrIndex - All relationships array OR relationshipIndex object
 * @param {Function} getBarPosition - Position getter
 * @param {Function} getTask - Task getter
 * @param {number} pixelsPerHour - Conversion factor
 * @returns {number} Maximum start position (Infinity if no constraint)
 */
export function getMaxXFromLockedSuccessors(taskId, relationshipsOrIndex, getBarPosition, getTask, pixelsPerHour) {
    let maxX = Infinity;

    // Support both indexed and legacy array API
    const successorRels = Array.isArray(relationshipsOrIndex)
        ? relationshipsOrIndex.filter(rel => rel.from === taskId)  // O(n) legacy
        : (relationshipsOrIndex.byPredecessor?.get(taskId) || []);  // O(1) indexed

    for (const rel of successorRels) {
        const succTask = getTask?.(rel.to);
        const isLocked = succTask?.constraints?.locked;
        if (!isLocked) continue;

        const succBar = getBarPosition(rel.to);
        if (!succBar) continue;

        const type = rel.type || DEP_TYPES.FS;
        const { minGap } = getDepOffsets(rel, pixelsPerHour);

        const constraint = getMaxPredStart(type, succBar, minGap);
        if (constraint !== Infinity) {
            maxX = Math.min(maxX, constraint);
        }
    }

    return maxX;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE UPDATES
// Iterative constraint relaxation for multi-path dependency graphs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate cascade updates for all affected successors using iterative relaxation.
 *
 * Algorithm:
 * ──────────
 * 1. Find all reachable successors from the dragged task (single BFS traversal)
 * 2. Iteratively relax constraints until convergence:
 *    - For each reachable task, calculate minX from ALL its predecessors
 *    - If minX > current position, update and mark changed
 *    - Repeat until no task needs to move
 *
 * Why iterative relaxation instead of BFS?
 * ─────────────────────────────────────────
 * BFS processes tasks level-by-level, but when multiple dependency paths converge
 * on a single task, BFS may visit that task before all its predecessors are updated.
 *
 * Example: Task T depends on A, B, C via different paths of varying depths.
 * BFS might process T when only A is updated, missing B and C's constraints.
 *
 * Iterative relaxation solves this by re-evaluating ALL predecessors on each pass,
 * guaranteeing convergence for directed acyclic graphs (DAGs).
 *
 * Complexity: O(iterations × reachable_tasks × avg_predecessors)
 * Typical: 2-3 iterations for most graphs
 *
 * @param {string} taskId - ID of the task being dragged
 * @param {number} newX - New X position of the dragged task
 * @param {Object} context - Resolution context
 * @param {Function} context.getBarPosition - Returns bar position { x, width, ... } for task ID
 * @param {Function} context.getTask - Returns task object for task ID (for constraint checks)
 * @param {Array} context.relationships - All relationships array (legacy, used if no index)
 * @param {Object} [context.relationshipIndex] - Pre-built index from buildRelationshipIndex()
 * @param {Map} context.relationshipIndex.bySuccessor - taskId → rels where task is successor
 * @param {Map} context.relationshipIndex.byPredecessor - taskId → rels where task is predecessor
 * @param {number} context.pixelsPerHour - Pixels per hour for gap calculations
 * @param {Date} context.ganttStartDate - Gantt start date for absolute constraint calculations
 * @returns {Map<string, {x: number}>} Map of taskId → { x: newX } for all tasks that need to move
 *
 * @example
 * const context = {
 *     getBarPosition: (id) => taskStore.getBarPosition(id),
 *     getTask: (id) => taskStore.getTask(id),
 *     relationshipIndex: buildRelationshipIndex(relationships),
 *     pixelsPerHour: 45,
 *     ganttStartDate: new Date('2025-01-01')
 * };
 *
 * const updates = calculateCascadeUpdates('task-1', 150, context);
 * // updates = Map { 'task-2' => { x: 200 }, 'task-3' => { x: 280 } }
 *
 * // Apply updates
 * for (const [id, update] of updates) {
 *     taskStore.updateBarPosition(id, update);
 * }
 */
export function calculateCascadeUpdates(taskId, newX, context) {
    const { getBarPosition, getTask, relationships, relationshipIndex, pixelsPerHour, ganttStartDate } = context;

    const updates = new Map();
    updates.set(taskId, { x: newX });

    // Build successor lookup
    let getSuccessorRels;
    if (relationshipIndex?.byPredecessor) {
        getSuccessorRels = (id) => relationshipIndex.byPredecessor.get(id) || [];
    } else {
        const successorRels = new Map();
        for (const rel of relationships) {
            if (!successorRels.has(rel.from)) successorRels.set(rel.from, []);
            successorRels.get(rel.from).push(rel);
        }
        getSuccessorRels = (id) => successorRels.get(id) || [];
    }

    // Build predecessor lookup
    let getPredecessorRels;
    if (relationshipIndex?.bySuccessor) {
        getPredecessorRels = (id) => relationshipIndex.bySuccessor.get(id) || [];
    } else {
        const predecessorRels = new Map();
        for (const rel of relationships) {
            if (!predecessorRels.has(rel.to)) predecessorRels.set(rel.to, []);
            predecessorRels.get(rel.to).push(rel);
        }
        getPredecessorRels = (id) => predecessorRels.get(id) || [];
    }

    // Step 1: Find all reachable successors (single BFS)
    const reachable = new Set();
    const bfsQueue = [taskId];
    while (bfsQueue.length > 0) {
        const current = bfsQueue.shift();
        for (const rel of getSuccessorRels(current)) {
            if (!reachable.has(rel.to)) {
                reachable.add(rel.to);
                bfsQueue.push(rel.to);
            }
        }
    }

    // Step 2: Iterative relaxation until convergence
    // Each iteration, every reachable task recalculates minX from ALL predecessors
    let changed = true;
    let iterations = 0;

    while (changed && iterations < MAX_CASCADE_ITERATIONS) {
        changed = false;
        iterations++;

        for (const succId of reachable) {
            const succTask = getTask?.(succId);

            // Skip locked tasks
            if (isMovementLocked(succTask?.constraints?.locked)) continue;

            // Get current position (with any pending update)
            let succBar = getBarPosition(succId);
            if (!succBar) continue;
            if (updates.has(succId)) {
                succBar = { ...succBar, ...updates.get(succId) };
            }

            // Calculate minX from ALL predecessors
            let minX = 0;
            for (const rel of getPredecessorRels(succId)) {
                let predBar = getBarPosition(rel.from);
                if (!predBar) continue;

                // Use updated position if predecessor was also updated
                if (updates.has(rel.from)) {
                    predBar = { ...predBar, ...updates.get(rel.from) };
                }

                const type = rel.type || DEP_TYPES.FS;
                const { minGap } = getDepOffsets(rel, pixelsPerHour);
                const constraint = getMinSuccessorX(type, predBar, succBar.width, minGap);
                minX = Math.max(minX, constraint);
            }

            // Apply absolute constraints
            const absMinX = getMinXFromAbsolute(succTask?.constraints, ganttStartDate, pixelsPerHour);
            const absMaxX = getMaxXFromAbsolute(succTask?.constraints, ganttStartDate, pixelsPerHour);
            minX = Math.max(absMinX, Math.min(minX, absMaxX));

            // Update if needs to move right
            if (minX > succBar.x + EPSILON_PX) {
                updates.set(succId, { x: minX });
                changed = true;
            }
        }
    }

    // Remove the initial task from updates (caller handles it)
    updates.delete(taskId);

    return updates;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// Single function to resolve all constraints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve constraints for a task move/resize operation.
 *
 * Applies constraints in order:
 * 1. Lock constraints (fully blocked if locked)
 * 2. Early termination if no position change
 * 3. Absolute time constraints (minStart, maxStart, maxEnd)
 * 4. Predecessor constraints (min/max X from dependencies)
 * 5. Downstream constraints (only when moving right - major optimization)
 * 6. Cascade updates (only if position actually changed)
 *
 * @param {string} taskId - Task ID
 * @param {number} proposedX - Proposed X position
 * @param {number} proposedWidth - Proposed width
 * @param {Object} context - Context object
 * @param {Function} context.getBarPosition - Position getter (id → { x, y, width, height })
 * @param {Function} context.getTask - Task getter (id → task)
 * @param {Array} context.relationships - All relationships (legacy, optional if relationshipIndex provided)
 * @param {Object} context.relationshipIndex - Pre-built index (optional, preferred for performance)
 * @param {number} context.pixelsPerHour - Conversion factor
 * @param {Date} context.ganttStartDate - Gantt start date
 * @returns {Object} Resolution result
 */
export function resolveConstraints(taskId, proposedX, proposedWidth, context) {
    const { getBarPosition, getTask, relationships, relationshipIndex, pixelsPerHour, ganttStartDate } = context;

    // Use index if available, otherwise fall back to relationships array
    const relSource = relationshipIndex || relationships;

    const task = getTask?.(taskId);
    const currentBar = getBarPosition(taskId);

    if (!currentBar) {
        return {
            constrainedX: proposedX,
            constrainedWidth: proposedWidth,
            blocked: false,
            blockReason: null,
            cascadeUpdates: new Map(),
        };
    }

    // 1. Check lock constraint
    if (isMovementLocked(task?.constraints?.locked)) {
        return {
            constrainedX: currentBar.x,
            constrainedWidth: currentBar.width,
            blocked: true,
            blockReason: 'locked',
            cascadeUpdates: new Map(),
        };
    }

    // 2. Early termination: no position change
    if (Math.abs(proposedX - currentBar.x) < EPSILON_PX && Math.abs(proposedWidth - currentBar.width) < EPSILON_PX) {
        return {
            constrainedX: currentBar.x,
            constrainedWidth: currentBar.width,
            blocked: false,
            blockReason: null,
            cascadeUpdates: new Map(),
        };
    }

    // Determine movement direction for optimization
    const movingRight = proposedX > currentBar.x + EPSILON_PX;

    let minX = 0;
    let maxX = Infinity;

    // 3. Apply absolute constraints
    const absMinX = getMinXFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);
    const absMaxX = getMaxXFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);
    const absMaxEnd = getMaxEndFromAbsolute(task?.constraints, ganttStartDate, pixelsPerHour);

    minX = Math.max(minX, absMinX);
    if (absMaxX !== Infinity) {
        maxX = Math.min(maxX, absMaxX);
    }
    if (absMaxEnd !== Infinity) {
        maxX = Math.min(maxX, absMaxEnd - proposedWidth);
    }

    // 4. Apply predecessor constraints
    const predMinX = getMinXFromPredecessors(taskId, relSource, getBarPosition, pixelsPerHour, proposedWidth);
    const predMaxX = getMaxXFromPredecessors(taskId, relSource, getBarPosition, pixelsPerHour, proposedWidth);

    minX = Math.max(minX, predMinX);
    if (predMaxX !== Infinity) {
        maxX = Math.min(maxX, predMaxX);
    }

    // 5. Apply downstream constraints ONLY when moving right
    // This is the major optimization - getMaxEndFromDownstream takes 77% of time
    // When moving left, we can't push successors, so no need to check downstream
    if (movingRight) {
        const downstreamMaxEnd = getMaxEndFromDownstream(taskId, relSource, getBarPosition, getTask, pixelsPerHour, currentBar);
        if (downstreamMaxEnd !== Infinity) {
            maxX = Math.min(maxX, downstreamMaxEnd - proposedWidth);
        }

        // SS/SF locked successor constraints on start position
        const sssfMaxX = getMaxXFromLockedSuccessors(taskId, relSource, getBarPosition, getTask, pixelsPerHour);
        if (sssfMaxX !== Infinity) {
            maxX = Math.min(maxX, sssfMaxX);
        }
    }

    // Clamp proposed position
    let constrainedX = Math.max(minX, Math.min(proposedX, maxX));

    // Check if blocked (min > max means conflicting constraints)
    const blocked = minX > maxX + EPSILON_PX;
    if (blocked) {
        constrainedX = currentBar.x;  // Don't move if blocked
    }

    // 6. Calculate cascade updates ONLY if position actually changed
    let cascadeUpdates = new Map();
    if (!blocked && Math.abs(constrainedX - currentBar.x) > EPSILON_PX) {
        cascadeUpdates = calculateCascadeUpdates(taskId, constrainedX, context);
    }

    return {
        constrainedX,
        constrainedWidth: proposedWidth,
        blocked,
        blockReason: blocked ? 'conflicting_constraints' : null,
        cascadeUpdates,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS (for backwards compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

// Legacy alias
export const getMaxEndFromLockedSuccessors = getMaxEndFromDownstream;
