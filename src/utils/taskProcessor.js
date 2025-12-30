import date_utils from './date_utils.js';
import { computeX, computeY, computeWidth } from './barCalculations.js';
import { detectCycles } from './constraintEngine.js';

/**
 * Generate a unique ID for a task.
 */
function generateTaskId(task, index) {
    return `task-${task.name || ''}-${index}-${Date.now()}`.replace(
        /\s+/g,
        '-',
    );
}

/**
 * Parse dependencies array.
 * Dependencies must be an array of objects with { id, type?, lag?, max? }.
 *
 * @param {Array<{id: string, type?: string, lag?: number, max?: number}> | undefined} dependencies
 * @returns {Array<{id: string, type: string, lag: number, max?: number}>}
 */
function parseDependencies(dependencies) {
    // No dependencies
    if (!dependencies) return [];

    // Type check: must be array
    if (!Array.isArray(dependencies)) {
        console.warn(
            'parseDependencies: dependencies must be an array, got:',
            typeof dependencies,
            dependencies
        );
        return [];
    }

    // Parse array of dependency objects
    return dependencies
        .filter((d) => d && typeof d === 'object')
        .map((d) => ({
            id: d.id,
            type: d.type || 'FS',
            lag: d.lag || 0,
            max: d.max,  // Preserve max for gap behavior (undefined = elastic)
        }));
}

/**
 * Process a single task - parse dates, validate, normalize.
 * @param {Object} task - Raw task object
 * @param {number} index - Task index
 * @returns {Object | null} - Processed task or null if invalid
 */
export function processTask(task, index) {
    const processed = { ...task };

    // Generate ID if missing
    if (!processed.id) {
        processed.id = generateTaskId(task, index);
    }

    // Parse start date
    processed._start = date_utils.parse(task.start);

    // Parse or calculate end date
    if (task.end) {
        processed._end = date_utils.parse(task.end);
    } else if (task.duration) {
        // Calculate end from duration
        const { duration, scale } = date_utils.parse_duration(task.duration);
        processed._end = date_utils.add(processed._start, duration, scale);
    } else {
        // Default to same day
        processed._end = new Date(processed._start);
    }

    // Validate date range (max 10 years)
    const yearDiff = date_utils.diff(processed._end, processed._start, 'year');
    if (yearDiff > 10) {
        console.error(`Task "${processed.name}" has duration > 10 years`);
        return null;
    }

    // Ensure end is after start
    if (processed._end < processed._start) {
        console.warn(`Task "${processed.name}" has end before start, swapping`);
        [processed._start, processed._end] = [processed._end, processed._start];
    }

    // Parse dependencies
    processed.dependencies = parseDependencies(task.dependencies);

    // Assign index
    processed._index = index;

    // Default progress
    if (typeof processed.progress !== 'number') {
        processed.progress = 0;
    }
    processed.progress = Math.max(0, Math.min(100, processed.progress));

    // Default constraints
    processed.constraints = {
        locked: false,
        ...task.constraints,
    };

    // Preserve hierarchy fields (parentId, type)
    // These will be processed by buildHierarchy in Gantt.jsx
    if (task.parentId !== undefined) {
        processed.parentId = task.parentId;
    }
    if (task.type !== undefined) {
        processed.type = task.type;
    }

    // Initialize hierarchy fields (will be populated by buildHierarchy)
    processed._children = [];
    processed._depth = 0;

    return processed;
}

/**
 * Process all tasks and compute their initial positions.
 * @param {Object[]} tasks - Raw task array
 * @param {Object} config - Configuration with ganttStart, unit, step, columnWidth, headerHeight, barHeight, padding
 * @param {Map<string, number>} [externalResourceIndexMap] - Optional resource index map from resourceStore
 * @returns {{tasks: Object[], relationships: Object[], resources: string[]}}
 */
export function processTasks(tasks, config, externalResourceIndexMap = null) {
    const processedTasks = [];
    const relationships = [];

    // First pass: process tasks
    for (let i = 0; i < tasks.length; i++) {
        const processed = processTask(tasks[i], i);
        if (processed) {
            processedTasks.push(processed);
        }
    }

    // Build resource list - unique resources in order of first appearance
    // Used for backward compatibility when no resourceStore is provided
    const resourceSet = new Set();
    const resources = [];
    for (const task of processedTasks) {
        const resource = task.resource || 'Unassigned';
        if (!resourceSet.has(resource)) {
            resourceSet.add(resource);
            resources.push(resource);
        }
    }

    // Use external resource index map if provided, otherwise build from tasks
    // External map comes from resourceStore and respects collapse state
    let resourceIndex;
    if (externalResourceIndexMap) {
        resourceIndex = externalResourceIndexMap;
    } else {
        resourceIndex = new Map();
        resources.forEach((r, i) => resourceIndex.set(r, i));
    }

    // Second pass: compute positions and build relationships
    for (const task of processedTasks) {
        // Get row index based on resource (swimlane layout)
        const resource = task.resource || 'Unassigned';
        const rowIndex = resourceIndex.get(resource);

        // Handle case where resource is not in map (e.g., collapsed group)
        // Use -1 to indicate hidden/off-screen
        const effectiveRowIndex = rowIndex !== undefined ? rowIndex : -1;
        const isHidden = effectiveRowIndex < 0;

        // Compute bar position
        const x = computeX(
            task._start,
            config.ganttStart,
            config.unit,
            config.step,
            config.columnWidth,
        );

        // Use negative Y for hidden tasks (won't be rendered by TaskLayer)
        const y = isHidden
            ? -1000
            : computeY(effectiveRowIndex, config.barHeight, config.padding);

        const width = computeWidth(
            task._start,
            task._end,
            config.unit,
            config.step,
            config.columnWidth,
        );

        // Store position on task
        task.$bar = {
            x,
            y,
            width,
            height: config.barHeight,
        };
        task._resourceIndex = effectiveRowIndex;
        task._isHidden = isHidden;

        // Build relationships from dependencies
        for (const dep of task.dependencies) {
            // Find the predecessor task
            const predecessor = processedTasks.find((t) => t.id === dep.id);
            if (predecessor) {
                relationships.push({
                    from: dep.id, // Predecessor task ID
                    to: task.id, // Successor task ID
                    type: dep.type || 'FS',
                    lag: dep.lag || 0,
                    elastic: true, // Elastic = minimum distance constraint
                });
            }
        }
    }

    // Check for cycles in dependency graph
    const cycleResult = detectCycles(relationships);
    if (cycleResult.hasCycle) {
        console.warn(
            `Circular dependency detected: ${cycleResult.cycle.join(' → ')}`,
            '\nThis may cause unexpected behavior during task dragging.'
        );
    }

    return { tasks: processedTasks, relationships, resources };
}

/**
 * Find min and max dates from tasks.
 * @param {Object[]} tasks - Processed tasks with _start and _end
 * @returns {{minDate: Date, maxDate: Date}}
 */
export function findDateBounds(tasks) {
    let minDate = null;
    let maxDate = null;

    for (const task of tasks) {
        const start = task._start;
        const end = task._end;

        if (!minDate || start < minDate) minDate = start;
        if (!maxDate || end > maxDate) maxDate = end;
    }

    return {
        minDate: minDate || new Date(),
        maxDate: maxDate || new Date(),
    };
}

/**
 * Build dependency map from tasks.
 * @param {Object[]} tasks - Processed tasks
 * @returns {Map<string, string[]>} - Map of task ID to dependent task IDs
 */
export function buildDependencyMap(tasks) {
    const map = new Map();

    for (const task of tasks) {
        for (const dep of task.dependencies) {
            const depId = dep.id;
            if (!map.has(depId)) {
                map.set(depId, []);
            }
            map.get(depId).push(task.id);
        }
    }

    return map;
}

export default {
    processTask,
    processTasks,
    findDateBounds,
    buildDependencyMap,
    parseDependencies,
};
