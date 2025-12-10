import date_utils from '../../date_utils.js';
import { computeX, computeY, computeWidth } from './barCalculations.js';

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
 * Parse dependencies from string, object, or array.
 * Returns array of dependency objects with { id, type, lag }.
 * @param {string | Object | Array | undefined} dependencies
 * @returns {Array<{id: string, type: string, lag: number}>}
 */
function parseDependencies(dependencies) {
    if (!dependencies) return [];

    // Object with constraint metadata: { id, type, lag }
    if (typeof dependencies === 'object' && !Array.isArray(dependencies)) {
        return [
            {
                id: dependencies.id,
                type: dependencies.type || 'FS',
                lag: dependencies.lag || 0,
            },
        ];
    }

    // String: simple task ID (FS, lag=0) - can be comma-separated
    if (typeof dependencies === 'string') {
        return dependencies
            .split(',')
            .map((d) => d.trim())
            .filter((d) => d.length > 0)
            .map((id) => ({ id, type: 'FS', lag: 0 }));
    }

    // Array: mixed format (strings or objects)
    if (Array.isArray(dependencies)) {
        return dependencies
            .filter((d) => d)
            .map((d) => {
                if (typeof d === 'string') {
                    return { id: d, type: 'FS', lag: 0 };
                }
                return {
                    id: d.id,
                    type: d.type || 'FS',
                    lag: d.lag || 0,
                };
            });
    }

    return [];
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

    return processed;
}

/**
 * Process all tasks and compute their initial positions.
 * @param {Object[]} tasks - Raw task array
 * @param {Object} config - Configuration with ganttStart, unit, step, columnWidth, headerHeight, barHeight, padding
 * @returns {{tasks: Object[], relationships: Object[], resources: string[]}}
 */
export function processTasks(tasks, config) {
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
    const resourceSet = new Set();
    const resources = [];
    for (const task of processedTasks) {
        const resource = task.resource || 'Unassigned';
        if (!resourceSet.has(resource)) {
            resourceSet.add(resource);
            resources.push(resource);
        }
    }

    // Create resource index map for Y positioning
    const resourceIndex = new Map();
    resources.forEach((r, i) => resourceIndex.set(r, i));

    // Second pass: compute positions and build relationships
    for (const task of processedTasks) {
        // Get row index based on resource (swimlane layout)
        const resource = task.resource || 'Unassigned';
        const rowIndex = resourceIndex.get(resource);

        // Compute bar position
        const x = computeX(
            task._start,
            config.ganttStart,
            config.unit,
            config.step,
            config.columnWidth,
        );

        const y = computeY(
            rowIndex,
            config.headerHeight,
            config.barHeight,
            config.padding,
        );

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
        task._resourceIndex = rowIndex;

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
