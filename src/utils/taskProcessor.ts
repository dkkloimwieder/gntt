import date_utils from './date_utils';
import { computeX, computeY, computeWidth } from './barCalculations';
import { detectCycles } from './constraintEngine';
import type {
    DependencyType,
    Dependency,
    NormalizedDependency,
    Relationship,
    BarPosition,
    TaskConstraints,
    NormalizedConstraints,
    GanttTask,
    ProcessedTask,
} from '../types';

interface ProcessConfig {
    ganttStart: Date;
    unit: string;
    step: number;
    columnWidth: number;
    headerHeight?: number;
    barHeight: number;
    padding: number;
}

interface ProcessResult {
    tasks: ProcessedTask[];
    relationships: Relationship[];
    resources: string[];
}

interface DateBounds {
    minDate: Date;
    maxDate: Date;
}

/**
 * Generate a unique ID for a task.
 */
function generateTaskId(task: GanttTask, index: number): string {
    return `task-${task.name || ''}-${index}-${Date.now()}`.replace(
        /\s+/g,
        '-',
    );
}

/**
 * Parse dependencies array.
 * Dependencies must be an array of objects with { id, type?, lag?, max? }.
 */
function parseDependencies(dependencies: Dependency[] | undefined): NormalizedDependency[] {
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
        .filter((d): d is Dependency => d != null && typeof d === 'object' && typeof d.id === 'string')
        .map((d) => ({
            id: d.id,
            type: d.type || 'FS',
            lag: d.lag || 0,
            max: d.max,  // Preserve max for gap behavior (undefined = elastic)
        }));
}

/**
 * Process a single task - parse dates, validate, normalize.
 * Returns a partially processed task (without _bar position - added in processTasks).
 */
export function processTask(task: GanttTask, index: number): Omit<ProcessedTask, '_bar' | '_resourceIndex' | '_isHidden'> | null {
    // Generate ID if missing
    const id = task.id || generateTaskId(task, index);

    // Parse start date
    const _start = date_utils.parse(task.start);

    // Parse or calculate end date
    let _end: Date;
    if (task.end) {
        _end = date_utils.parse(task.end);
    } else if (task.duration) {
        // Calculate end from duration
        const durationResult = date_utils.parse_duration(task.duration);
        if (durationResult) {
            const { duration, scale } = durationResult;
            _end = date_utils.add(_start, duration, scale);
        } else {
            _end = new Date(_start);
        }
    } else {
        // Default to same day
        _end = new Date(_start);
    }

    // Validate date range (max 10 years)
    const yearDiff = date_utils.diff(_end, _start, 'year');
    if (yearDiff > 10) {
        console.error(`Task "${task.name}" has duration > 10 years`);
        return null;
    }

    // Ensure end is after start
    let startDate = _start;
    let endDate = _end;
    if (_end < _start) {
        console.warn(`Task "${task.name}" has end before start, swapping`);
        [startDate, endDate] = [_end, _start];
    }

    // Parse dependencies
    const dependencies = parseDependencies(task.dependencies);

    // Default progress (clamped to 0-100)
    const rawProgress = typeof task.progress === 'number' ? task.progress : 0;
    const progress = Math.max(0, Math.min(100, rawProgress));

    // Default constraints with locked: false
    const constraints: NormalizedConstraints = {
        locked: false,
        ...task.constraints,
    };

    // Build the processed task (without position fields - added later)
    return {
        // Required fields
        id,
        name: task.name || '',
        start: task.start,
        _start: startDate,
        _end: endDate,
        _index: index,
        progress,
        constraints,
        dependencies,
        _children: [],
        _depth: 0,
        // Optional fields from input
        end: task.end,
        duration: task.duration,
        resource: task.resource,
        parentId: task.parentId,
        type: task.type,
        color: task.color,
        color_progress: task.color_progress,
        color_bg: task.color_bg,
        color_fill: task.color_fill,
        subtaskLayout: task.subtaskLayout,
        order: task.order,
    };
}

/**
 * Process all tasks and compute their initial positions.
 */
export function processTasks(
    tasks: GanttTask[],
    config: ProcessConfig,
    externalResourceIndexMap: Map<string, number> | null = null
): ProcessResult {
    // Partial tasks (without position info yet)
    type PartialTask = Omit<ProcessedTask, '_bar' | '_resourceIndex' | '_isHidden'>;
    const partialTasks: PartialTask[] = [];
    const relationships: Relationship[] = [];

    // First pass: process tasks
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (!task) continue;
        const processed = processTask(task, i);
        if (processed) {
            partialTasks.push(processed);
        }
    }

    // Build resource list - unique resources in order of first appearance
    // Used for backward compatibility when no resourceStore is provided
    const resourceSet = new Set<string>();
    const resources: string[] = [];
    for (const task of partialTasks) {
        const resource = task.resource || 'Unassigned';
        if (!resourceSet.has(resource)) {
            resourceSet.add(resource);
            resources.push(resource);
        }
    }

    // Use external resource index map if provided, otherwise build from tasks
    // External map comes from resourceStore and respects collapse state
    let resourceIndex: Map<string, number>;
    if (externalResourceIndexMap) {
        resourceIndex = externalResourceIndexMap;
    } else {
        resourceIndex = new Map<string, number>();
        resources.forEach((r, i) => resourceIndex.set(r, i));
    }

    // Second pass: compute positions and build relationships
    const processedTasks: ProcessedTask[] = [];
    for (const task of partialTasks) {
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

        // Build complete ProcessedTask with position
        const completeTask: ProcessedTask = {
            ...task,
            _bar: {
                x,
                y,
                width,
                height: config.barHeight,
            },
            _resourceIndex: effectiveRowIndex,
            _isHidden: isHidden,
        };
        processedTasks.push(completeTask);

        // Build relationships from dependencies
        for (const dep of task.dependencies) {
            // Find the predecessor task
            const predecessor = partialTasks.find((t) => t.id === dep.id);
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

/** Minimal interface for findDateBounds - just needs parsed dates */
interface TaskWithDates {
    _start: Date;
    _end: Date;
}

/**
 * Find min and max dates from tasks.
 */
export function findDateBounds(tasks: TaskWithDates[]): DateBounds {
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

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

/** Minimal interface for buildDependencyMap */
interface TaskWithDependencies {
    id: string;
    dependencies: NormalizedDependency[];
}

/**
 * Build dependency map from tasks.
 */
export function buildDependencyMap(tasks: TaskWithDependencies[]): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const task of tasks) {
        for (const dep of task.dependencies) {
            const depId = dep.id;
            if (!map.has(depId)) {
                map.set(depId, []);
            }
            map.get(depId)!.push(task.id);
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
