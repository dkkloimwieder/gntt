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

/**
 * Convert hex color to rgba string.
 * Pre-computed at generation time to avoid runtime conversion.
 */
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Pre-compute all rgba variants for a hex color.
 * Returns object with all color values needed for rendering.
 */
function computeColorVariants(hex) {
    return {
        color: hex,
        color_progress: hex + 'cc',
        color_bg: hexToRgba(hex, 0.15),      // Background fill
        color_fill: hexToRgba(hex, 0.3),     // Progress fill
    };
}

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
    realistic: false, // If true, generate realistic arrow patterns (75% same-row, 20% adjacent)
    arrowDensity: 20, // Percentage of tasks with cross-row dependencies (dense mode)
    maxRowDistance: 2, // Max row distance for cross-row dependencies (dense mode)
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
 * If cfg.realistic is true, generates realistic arrow patterns (75% same-row).
 */
export function generateCalendar(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const random = createRandom(cfg.seed);

    // Use realistic mode for realistic arrow patterns
    if (cfg.realistic) {
        return generateRealisticCalendar(cfg, random);
    }

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

        // Pick a color for this dependency chain (group) - pre-compute all variants
        const colors = computeColorVariants(GROUP_COLORS[groupIndex % GROUP_COLORS.length]);

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
                ...colors,
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
 * Creates back-to-back tasks on each resource WITHOUT default dependencies.
 * All resources start at the same time for maximum viewport density.
 * Then adds arrowDensity% deps within maxRowDistance rows.
 */
function generateDenseCalendar(cfg, random) {
    const tasks = [];

    // Create array of all resource labels
    const allResources = [];
    for (let i = 0; i < cfg.resourceCount; i++) {
        allResources.push(getResourceLabel(i));
    }

    // Build resource index map for row distance calculation
    const resourceIndex = {};
    allResources.forEach((r, i) => resourceIndex[r] = i);

    // Calculate tasks per resource (distribute evenly)
    const tasksPerResource = Math.ceil(cfg.totalTasks / cfg.resourceCount);

    // Base start time for ALL resources (same start = maximum density)
    const baseStart = parseDateTime(
        `${cfg.startDate} ${String(cfg.workdayStartHour).padStart(2, '0')}:00`
    );

    let taskNum = 1;

    // Generate tasks for each resource - NO dependencies yet
    for (let resourceIdx = 0; resourceIdx < allResources.length && taskNum <= cfg.totalTasks; resourceIdx++) {
        const resource = allResources[resourceIdx];
        const colors = computeColorVariants(GROUP_COLORS[resourceIdx % GROUP_COLORS.length]);

        let currentTime = cloneDate(baseStart);

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

            tasks.push({
                id: `task-${taskNum}`,
                name: `${resource}-${i + 1}`,
                start: formatDateTime(start),
                end: formatDateTime(end),
                progress: Math.floor(random() * 101),
                ...colors,
                dependencies: undefined, // No default dep - added below
                resource: resource,
                _rowIdx: resourceIdx, // Store for quick lookup
            });

            // Next task starts immediately after this one
            currentTime = cloneDate(end);
            taskNum++;
        }
    }

    // Add dependencies: arrowDensity% of tasks get a dep within maxRowDistance
    // Simple: iterate in time order, pick 1 out of every N tasks
    const maxRowDist = cfg.maxRowDistance;
    const pickInterval = Math.floor(100 / cfg.arrowDensity); // 20% = 1 in 5

    // Sort tasks by start time
    const tasksByTime = [...tasks].sort((a, b) => {
        return parseDateTime(a.start).getTime() - parseDateTime(b.start).getTime();
    });

    let depCount = 0;

    for (let i = 0; i < tasksByTime.length; i++) {
        // Pick 1 out of every N tasks
        if (i % pickInterval !== 0) continue;

        const task = tasksByTime[i];
        const taskRowIdx = task._rowIdx;

        // Find a valid source: ends before this task starts, 1-maxRowDistance away
        const taskStart = parseDateTime(task.start);
        const candidates = tasks.filter((t) => {
            if (t.id === task.id) return false;
            const rowDist = Math.abs(t._rowIdx - taskRowIdx);
            if (rowDist < 1 || rowDist > maxRowDist) return false;
            const tEnd = parseDateTime(t.end);
            return tEnd <= taskStart;
        });

        if (candidates.length > 0) {
            const source = candidates[Math.floor(random() * candidates.length)];
            task.dependencies = source.id;
            depCount++;
        }
    }

    // Verify and log row distances
    let violations = 0;
    const resourceToRow = {};
    allResources.forEach((r, i) => resourceToRow[r] = i);

    for (const task of tasks) {
        if (task.dependencies) {
            const depTask = tasks.find(t => t.id === task.dependencies);
            if (depTask) {
                const fromRow = resourceToRow[depTask.resource];
                const toRow = resourceToRow[task.resource];
                const dist = Math.abs(toRow - fromRow);
                if (dist > maxRowDist) {
                    violations++;
                    if (violations <= 5) {
                        console.log(`VIOLATION: ${depTask.id} (row ${fromRow}) -> ${task.id} (row ${toRow}), dist=${dist}`);
                    }
                }
            }
        }
    }
    if (violations > 0) {
        console.log(`Total row distance violations: ${violations}`);
    }

    // Clean up temp field
    for (const task of tasks) {
        delete task._rowIdx;
    }

    return tasks;
}

/**
 * Find a valid predecessor task on the given resource that ends before the specified date.
 * Returns the most recent valid predecessor or null if none found.
 */
function findValidPredecessor(tasks, resource, beforeDate) {
    const candidates = tasks.filter(
        (t) => t.resource === resource && parseDateTime(t.end) <= beforeDate
    );
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

/**
 * Generate tasks with REALISTIC arrow patterns.
 * - 75% same-row dependencies (sequential tasks on same resource)
 * - 20% adjacent-row dependencies (1-3 rows away)
 * - 5% no dependency (parallel work)
 *
 * This produces arrow patterns that match real project management:
 * most dependencies are within a team (same row), with occasional handoffs
 * to nearby teams (adjacent rows).
 */
function generateRealisticCalendar(cfg, random) {
    const tasks = [];

    // Create array of all resource labels
    const allResources = [];
    for (let i = 0; i < cfg.resourceCount; i++) {
        allResources.push(getResourceLabel(i));
    }

    // Track when each resource becomes free
    const resourceFreeAt = {};
    for (const r of allResources) {
        resourceFreeAt[r] = parseDateTime(
            `${cfg.startDate} ${String(cfg.workdayStartHour).padStart(2, '0')}:00`
        );
    }

    // Distribute tasks across resources
    const tasksPerResource = Math.ceil(cfg.totalTasks / cfg.resourceCount);
    let taskNum = 1;

    for (
        let resIdx = 0;
        resIdx < allResources.length && taskNum <= cfg.totalTasks;
        resIdx++
    ) {
        const resource = allResources[resIdx];
        const colors = computeColorVariants(GROUP_COLORS[resIdx % GROUP_COLORS.length]);
        let prevTaskId = null;

        for (let i = 0; i < tasksPerResource && taskNum <= cfg.totalTasks; i++) {
            const duration = randomBetween(random, cfg.minDuration, cfg.maxDuration);
            const { start, end } = calculateTaskTimes(
                resourceFreeAt[resource],
                duration,
                cfg.workdayStartHour,
                cfg.workdayEndHour
            );

            // Determine dependency type based on probability
            let dependency = undefined;
            const roll = random();

            if (roll < 0.75 && prevTaskId) {
                // 75%: Same-row (FS dependency on previous task in this row)
                dependency = prevTaskId;
            } else if (roll < 0.95 && resIdx > 0) {
                // 20%: Adjacent row (1-3 rows away)
                const maxSpan = Math.min(3, resIdx);
                const rowOffset = randomBetween(random, 1, maxSpan);
                const adjacentRes = allResources[resIdx - rowOffset];
                // Find a task on adjacent resource that ends before this starts
                const candidate = findValidPredecessor(tasks, adjacentRes, start);
                if (candidate) {
                    dependency = candidate.id;
                }
            }
            // 5%: No dependency (parallel work) - already undefined

            tasks.push({
                id: `task-${taskNum}`,
                name: `${resource}-${i + 1}`,
                start: formatDateTime(start),
                end: formatDateTime(end),
                progress: Math.floor(random() * 101),
                ...colors,
                dependencies: dependency,
                resource,
            });

            resourceFreeAt[resource] = cloneDate(end);
            prevTaskId = `task-${taskNum}`;
            taskNum++;
        }
    }

    return tasks;
}
