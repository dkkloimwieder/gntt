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
 * Parse dependencies from string or array.
 * @param {string | string[] | undefined} dependencies
 * @returns {string[]}
 */
function parseDependencies(dependencies) {
    if (!dependencies) return [];

    if (typeof dependencies === 'string') {
        return dependencies
            .split(',')
            .map((d) => d.trim())
            .filter((d) => d.length > 0);
    }

    if (Array.isArray(dependencies)) {
        return dependencies.filter((d) => d && typeof d === 'string');
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
 * @returns {{tasks: Object[], relationships: Object[]}}
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

    // Second pass: compute positions and build relationships
    for (const task of processedTasks) {
        // Compute bar position
        const x = computeX(
            task._start,
            config.ganttStart,
            config.unit,
            config.step,
            config.columnWidth,
        );

        const y = computeY(
            task._index,
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

        // Build relationships from dependencies
        for (const depId of task.dependencies) {
            // Find the predecessor task
            const predecessor = processedTasks.find((t) => t.id === depId);
            if (predecessor) {
                relationships.push({
                    from: depId, // Predecessor task ID (constraintResolver expects 'from')
                    to: task.id, // Successor task ID (constraintResolver expects 'to')
                    type: 'FS', // Default Finish-to-Start
                    lag: 0, // No lag by default
                    elastic: true, // Elastic = minimum distance constraint
                });
            }
        }
    }

    return { tasks: processedTasks, relationships };
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
        for (const depId of task.dependencies) {
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
