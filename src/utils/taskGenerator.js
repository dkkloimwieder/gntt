/**
 * Task Generator for Gantt Performance Testing
 * Generates calendar data with cross-resource dependency chains.
 */

// Color palette for task groups
export const GROUP_COLORS = [
    '#3b82f6',
    '#ef4444',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#84cc16',
    '#f97316',
    '#6366f1',
    '#14b8a6',
    '#a855f7',
    '#22c55e',
    '#eab308',
    '#e11d48',
];

// Default configuration for calendar generation
export const DEFAULT_CONFIG = {
    totalTasks: 200,
    minGroupSize: 5,
    maxGroupSize: 20,
    startDate: '2025-01-01',
    workdayStartHour: 8,
    workdayEndHour: 17,
    minDuration: 1,
    maxDuration: 8,
    fsPercent: 80,
    ssPercent: 20,
    ssMinLag: 1,
    ssMaxLag: 5,
    resourceCount: 26,
    seed: 12345,
    dense: false, // If true, pack tasks tightly for maximum viewport density
};

/**
 * Generate a seeded random number generator for reproducible results
 */
export function createRandom(seed = 12345) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

/**
 * Generate alphabetic label: 0=A, 25=Z, 26=AA, 27=AB, etc.
 */
export function getResourceLabel(index) {
    let label = '';
    let n = index;
    do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
}

/**
 * Format a Date object as 'YYYY-MM-DD HH:MM' (space separator for date_utils.parse)
 */
export function formatDateTime(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Parse a date string to Date object
 */
export function parseDateTime(dateStr) {
    const [datePart, timePart] = dateStr.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);

    if (timePart) {
        const [hour, minute] = timePart.split(':').map(Number);
        return new Date(year, month - 1, day, hour, minute);
    }
    return new Date(year, month - 1, day);
}

/**
 * Add hours to a date
 */
export function addHours(dateOrStr, hours) {
    const date =
        typeof dateOrStr === 'string' ? parseDateTime(dateOrStr) : new Date(dateOrStr);
    date.setTime(date.getTime() + hours * 60 * 60 * 1000);
    return date;
}

/**
 * Clone a Date object
 */
export function cloneDate(date) {
    return new Date(date.getTime());
}

/**
 * Calculate task start and end times respecting workday boundaries
 */
export function calculateTaskTimes(startDate, durationHours, workdayStart, workdayEnd) {
    let start = cloneDate(startDate);

    // If starting before workday, move to workday start
    if (start.getHours() < workdayStart) {
        start.setHours(workdayStart, 0, 0, 0);
    }
    // If starting after workday, move to next day
    if (start.getHours() >= workdayEnd) {
        start.setDate(start.getDate() + 1);
        start.setHours(workdayStart, 0, 0, 0);
    }

    let end = cloneDate(start);
    let remainingHours = durationHours;

    while (remainingHours > 0) {
        const hoursLeftInDay = workdayEnd - end.getHours();

        if (remainingHours <= hoursLeftInDay) {
            end.setHours(end.getHours() + remainingHours);
            remainingHours = 0;
        } else {
            remainingHours -= hoursLeftInDay;
            end.setDate(end.getDate() + 1);
            end.setHours(workdayStart, 0, 0, 0);
        }
    }

    return { start, end };
}

/**
 * Generate random integer between min and max (inclusive)
 */
function randomBetween(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

/**
 * Shuffle array using Fisher-Yates algorithm with seeded random
 */
function shuffleArray(random, array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * Generate a calendar of tasks with CROSS-RESOURCE dependency chains.
 * Each dependency group spans multiple resources (A -> B -> C -> D, etc.)
 * Ensures no task overlap on the same resource (concurrency = 1).
 *
 * If cfg.dense is true, generates tightly packed tasks for stress testing.
 */
export function generateCalendar(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const random = createRandom(cfg.seed);

    // Use dense mode for tightly packed tasks
    if (cfg.dense) {
        return generateDenseCalendar(cfg, random);
    }

    const tasks = [];

    // Create array of all resource labels (A-Z)
    const allResources = [];
    for (let i = 0; i < cfg.resourceCount; i++) {
        allResources.push(getResourceLabel(i));
    }

    // Track when each resource becomes free (no overlap allowed)
    const resourceFreeAt = {};
    for (const r of allResources) {
        resourceFreeAt[r] = parseDateTime(
            `${cfg.startDate} ${String(cfg.workdayStartHour).padStart(2, '0')}:00`
        );
    }

    let taskNum = 1;
    let groupIndex = 0;
    let currentDate = parseDateTime(
        `${cfg.startDate} ${String(cfg.workdayStartHour).padStart(2, '0')}:00`
    );

    while (taskNum <= cfg.totalTasks) {
        // Determine group size (5-20 tasks)
        const groupSize = Math.min(
            cfg.totalTasks - taskNum + 1,
            randomBetween(random, cfg.minGroupSize, cfg.maxGroupSize)
        );

        // Shuffle resources for this group - each task gets a different resource
        const shuffledResources = shuffleArray(random, allResources);

        // Pick a color for this dependency chain (group)
        const color = GROUP_COLORS[groupIndex % GROUP_COLORS.length];
        const progressColor = color + 'cc';

        groupIndex++;

        // Track the end time of the previous task in this chain (for dependency timing)
        let prevTaskEnd = null;

        // Generate tasks in this group - each on a DIFFERENT resource
        for (let i = 0; i < groupSize && taskNum <= cfg.totalTasks; i++) {
            // Each task in the chain gets a different resource
            const resource = shuffledResources[i % shuffledResources.length];

            // Random duration 1-8 hours
            const duration = randomBetween(random, cfg.minDuration, cfg.maxDuration);

            // Determine earliest start time based on:
            // 1. When the resource is free (no overlap)
            // 2. When the previous task in chain ends (dependency)
            // 3. Group start time (for first task)
            let earliestStart = cloneDate(resourceFreeAt[resource]);

            if (prevTaskEnd !== null) {
                // Must start after previous task ends (FS dependency)
                if (prevTaskEnd > earliestStart) {
                    earliestStart = cloneDate(prevTaskEnd);
                }
            } else {
                // First task in group - use group start time if later
                if (currentDate > earliestStart) {
                    earliestStart = cloneDate(currentDate);
                }
            }

            // Calculate start/end with workday handling
            const { start, end } = calculateTaskTimes(
                earliestStart,
                duration,
                cfg.workdayStartHour,
                cfg.workdayEndHour
            );

            // Update when this resource becomes free
            resourceFreeAt[resource] = cloneDate(end);

            // Dependency logic - creates cross-resource chain
            let dependency = undefined;

            if (i > 0) {
                // Depends on previous task (which is on a DIFFERENT resource)
                const useSSConstraint = random() < cfg.ssPercent / 100;
                if (useSSConstraint) {
                    const lag = randomBetween(random, cfg.ssMinLag, cfg.ssMaxLag);
                    dependency = {
                        id: `task-${taskNum - 1}`,
                        type: 'SS',
                        lag: lag,
                    };
                } else {
                    // FS: depends on previous task finishing
                    dependency = `task-${taskNum - 1}`;
                }
            }

            tasks.push({
                id: `task-${taskNum}`,
                name: `G${groupIndex}-${i + 1}`,
                start: formatDateTime(start),
                end: formatDateTime(end),
                progress: Math.floor(random() * 101),
                color: color,
                color_progress: progressColor,
                dependencies: dependency,
                resource: resource,
            });

            // Track end time for next task's dependency
            prevTaskEnd = cloneDate(end);
            taskNum++;
        }

        // Stagger next group start (1-4 hours offset from original start)
        const groupStagger = randomBetween(random, 1, 4);
        currentDate = addHours(currentDate, groupStagger);
    }

    return tasks;
}

/**
 * Generate densely packed tasks for stress testing.
 * Creates back-to-back tasks on each resource with FS dependencies per row.
 * All resources start at the same time for maximum viewport density.
 */
function generateDenseCalendar(cfg, random) {
    const tasks = [];

    // Create array of all resource labels
    const allResources = [];
    for (let i = 0; i < cfg.resourceCount; i++) {
        allResources.push(getResourceLabel(i));
    }

    // Calculate tasks per resource (distribute evenly)
    const tasksPerResource = Math.ceil(cfg.totalTasks / cfg.resourceCount);

    // Base start time for ALL resources (same start = maximum density)
    const baseStart = parseDateTime(
        `${cfg.startDate} ${String(cfg.workdayStartHour).padStart(2, '0')}:00`
    );

    let taskNum = 1;

    // Generate tasks for each resource
    for (let resourceIndex = 0; resourceIndex < allResources.length && taskNum <= cfg.totalTasks; resourceIndex++) {
        const resource = allResources[resourceIndex];
        const color = GROUP_COLORS[resourceIndex % GROUP_COLORS.length];
        const progressColor = color + 'cc';

        let currentTime = cloneDate(baseStart);
        let prevTaskId = null;

        // Generate back-to-back tasks for this resource
        for (let i = 0; i < tasksPerResource && taskNum <= cfg.totalTasks; i++) {
            // Short duration (1-5 hours for density)
            const duration = randomBetween(random, cfg.minDuration, Math.min(cfg.maxDuration, 5));

            // Calculate start/end (no gaps - tasks are contiguous)
            const { start, end } = calculateTaskTimes(
                currentTime,
                duration,
                cfg.workdayStartHour,
                cfg.workdayEndHour
            );

            // FS dependency on previous task in same row
            let dependency = undefined;
            if (prevTaskId) {
                dependency = prevTaskId;
            }

            tasks.push({
                id: `task-${taskNum}`,
                name: `${resource}-${i + 1}`,
                start: formatDateTime(start),
                end: formatDateTime(end),
                progress: Math.floor(random() * 101),
                color: color,
                color_progress: progressColor,
                dependencies: dependency,
                resource: resource,
            });

            // Next task starts immediately after this one
            currentTime = cloneDate(end);
            prevTaskId = `task-${taskNum}`;
            taskNum++;
        }
    }

    return tasks;
}
