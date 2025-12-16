/**
 * Subtask Generator
 *
 * Generates random tasks with subtasks for testing the Gantt chart.
 * Supports seeded random for reproducibility.
 */

// Seeded random number generator (mulberry32)
function createRandom(seed) {
    let state = seed;
    return function () {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Helper to pick random item from array
function pick(random, array) {
    return array[Math.floor(random() * array.length)];
}

// Helper to get random int in range [min, max]
function randInt(random, min, max) {
    return Math.floor(random() * (max - min + 1)) + min;
}

// Add days to a date
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

// Format date as YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Lighten a hex color
function lightenColor(hex, percent = 20) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * percent / 100));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * percent / 100));
    const b = Math.min(255, (num & 0xff) + Math.round(255 * percent / 100));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// Default configuration
const DEFAULT_CONFIG = {
    totalTasks: 100,
    parentTaskRatio: 0.7,        // 70% are parents with subtasks
    minSubtasks: 2,
    maxSubtasks: 4,
    subtaskLayouts: ['sequential', 'parallel', 'mixed'],
    startDate: '2024-01-01',
    taskDurationDays: { min: 7, max: 14 },
    subtaskDurationDays: { min: 2, max: 5 },
    dependencyChance: 0.3,       // Lower to reduce arrow clutter
    seed: 12345,
};

// Resource definitions
const RESOURCES = [
    { id: 'alice', name: 'Alice', color: '#3b82f6' },
    { id: 'bob', name: 'Bob', color: '#10b981' },
    { id: 'charlie', name: 'Charlie', color: '#f59e0b' },
    { id: 'diana', name: 'Diana', color: '#8b5cf6' },
    { id: 'eve', name: 'Eve', color: '#ec4899' },
];

// Task name prefixes for variety
const TASK_NAMES = [
    'Feature', 'Sprint', 'Phase', 'Module', 'Component',
    'Update', 'Release', 'Build', 'Deploy', 'Review',
    'Design', 'Implement', 'Test', 'Fix', 'Refactor',
];

const SUBTASK_NAMES = [
    'Setup', 'Research', 'Design', 'Develop', 'Test',
    'Review', 'Document', 'Deploy', 'Monitor', 'Optimize',
];

/**
 * Generate random tasks with subtasks for demo/testing.
 *
 * @param {Object} config - Configuration options
 * @returns {{ tasks: Array, resources: Array, expandedTasks: Array }}
 */
export function generateSubtaskDemo(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const random = createRandom(cfg.seed);

    const tasks = [];
    const expandedTasks = [];
    let taskId = 1;
    let currentDate = new Date(cfg.startDate);

    // Track tasks per resource for scheduling
    const resourceSchedule = new Map();
    RESOURCES.forEach(r => resourceSchedule.set(r.id, new Date(cfg.startDate)));

    // Calculate how many parent tasks we need
    // With 70% ratio and avg 3 subtasks per parent:
    // - Each parent group = 1 parent + 3 subtasks = 4 tasks
    // - For 100 tasks: ~17 parent groups (68 tasks) + ~32 standalone
    const avgSubtasks = (cfg.minSubtasks + cfg.maxSubtasks) / 2;
    const avgTasksPerParent = 1 + avgSubtasks;
    const targetParents = Math.ceil(cfg.totalTasks * cfg.parentTaskRatio / avgTasksPerParent);
    const estimatedSubtasks = targetParents * avgSubtasks;
    const targetStandalone = Math.max(0, cfg.totalTasks - targetParents - estimatedSubtasks);

    // Generate parent tasks with subtasks
    for (let i = 0; i < targetParents; i++) {
        const resource = RESOURCES[i % RESOURCES.length];
        const layout = pick(random, cfg.subtaskLayouts);
        const numSubtasks = randInt(random, cfg.minSubtasks, cfg.maxSubtasks);

        // For FS dependencies: start immediately after previous task ends (no gap)
        const lastEndDate = resourceSchedule.get(resource.id);
        const startDate = addDays(lastEndDate, 1); // Just 1 day gap for visual clarity

        // Parent task duration based on subtasks
        const parentDuration = randInt(random, cfg.taskDurationDays.min, cfg.taskDurationDays.max);
        const endDate = addDays(startDate, parentDuration);

        const parentId = `task-${taskId++}`;
        const parentTask = {
            id: parentId,
            name: `${pick(random, TASK_NAMES)} ${i + 1}`,
            resource: resource.id,
            color: resource.color,
            start: formatDate(startDate),
            end: formatDate(endDate),
            progress: randInt(random, 0, 100),
            subtaskLayout: layout,
        };

        tasks.push(parentTask);
        expandedTasks.push(parentId);

        // Generate subtasks within parent's date range
        const subtaskColor = lightenColor(resource.color, 15);
        let subtaskStart = new Date(startDate);

        // Calculate subtask duration that fits within parent
        const availableDays = parentDuration;
        const daysPerSubtask = Math.max(1, Math.floor(availableDays / numSubtasks));

        // For sequential: calculate duration per subtask to fit within parent
        const seqDurationPerSubtask = Math.max(1, Math.floor(availableDays / numSubtasks));

        for (let j = 0; j < numSubtasks; j++) {
            let subtaskEnd;

            if (layout === 'sequential') {
                // Sequential: subtasks are back-to-back, no time overlap
                // Each starts when the previous ends → all fit in single row
                // Use calculated duration that fits within parent
                const subtaskDuration = Math.max(1, seqDurationPerSubtask);
                subtaskEnd = addDays(subtaskStart, subtaskDuration);

                // Clamp to parent bounds (shouldn't need this but safety)
                if (subtaskEnd > endDate) {
                    subtaskEnd = new Date(endDate);
                }
            } else if (layout === 'parallel') {
                const subtaskDuration = randInt(random, cfg.subtaskDurationDays.min, cfg.subtaskDurationDays.max);
                // Parallel: ALL subtasks start at the same time (parent start)
                // Full time overlap → each subtask needs its own row (stacked vertically)
                subtaskStart = new Date(startDate);
                subtaskEnd = addDays(subtaskStart, Math.max(1, subtaskDuration));

                // Clamp to parent bounds
                if (subtaskEnd > endDate) {
                    subtaskEnd = new Date(endDate);
                }
            } else {
                // Mixed: some overlap, some don't → auto-computed rows
                // Strategy: first half start together (overlap), second half stagger
                const subtaskDuration = randInt(random, cfg.subtaskDurationDays.min, cfg.subtaskDurationDays.max);
                const halfPoint = Math.floor(numSubtasks / 2);

                if (j < halfPoint) {
                    // First half: start at or near parent start (creates overlap)
                    const smallOffset = randInt(random, 0, 1); // 0-1 day offset for variety
                    subtaskStart = addDays(startDate, smallOffset);
                } else {
                    // Second half: start after first batch would end
                    const baseOffset = Math.floor(availableDays / 2) + randInt(random, 0, 2);
                    subtaskStart = addDays(startDate, Math.min(baseOffset, availableDays - subtaskDuration));
                }

                subtaskEnd = addDays(subtaskStart, Math.max(1, subtaskDuration));

                // Clamp to parent bounds
                if (subtaskEnd > endDate) {
                    subtaskEnd = new Date(endDate);
                }
            }

            // Ensure valid date range
            if (subtaskStart >= subtaskEnd) {
                subtaskStart = addDays(subtaskEnd, -1);
            }

            const subtask = {
                id: `task-${taskId++}`,
                name: `${pick(random, SUBTASK_NAMES)} ${j + 1}`,
                parentId: parentId,
                resource: resource.id,
                color: subtaskColor,
                start: formatDate(subtaskStart),
                end: formatDate(subtaskEnd),
                progress: randInt(random, 0, 100),
            };

            tasks.push(subtask);

            // For sequential, move start to end of current subtask
            if (layout === 'sequential') {
                subtaskStart = subtaskEnd;
            }
        }

        // Update resource schedule
        resourceSchedule.set(resource.id, endDate);
    }

    // Generate standalone tasks (no subtasks)
    for (let i = 0; i < targetStandalone; i++) {
        const resource = RESOURCES[(targetParents + i) % RESOURCES.length];
        // FS constraint: start after previous task ends
        const lastEndDate = resourceSchedule.get(resource.id);
        const startDate = addDays(lastEndDate, 1); // 1 day gap

        const duration = randInt(random, cfg.taskDurationDays.min, cfg.taskDurationDays.max);
        const endDate = addDays(startDate, duration);

        const task = {
            id: `task-${taskId++}`,
            name: `${pick(random, TASK_NAMES)} ${targetParents + i + 1}`,
            resource: resource.id,
            color: resource.color,
            start: formatDate(startDate),
            end: formatDate(endDate),
            progress: randInt(random, 0, 100),
        };

        tasks.push(task);
        resourceSchedule.set(resource.id, endDate);
    }

    // Add dependencies between parent/standalone tasks on the SAME resource only
    // Group top-level tasks by resource
    const topLevelTasks = tasks.filter(t => !t.parentId);
    const tasksByResource = new Map();

    for (const task of topLevelTasks) {
        if (!tasksByResource.has(task.resource)) {
            tasksByResource.set(task.resource, []);
        }
        tasksByResource.get(task.resource).push(task);
    }

    // Add dependencies within each resource
    for (const [resource, resourceTasks] of tasksByResource) {
        // Sort by start date
        resourceTasks.sort((a, b) => new Date(a.start) - new Date(b.start));

        for (let i = 1; i < resourceTasks.length; i++) {
            if (random() < cfg.dependencyChance) {
                const currentTask = resourceTasks[i];
                // Find preceding task that ends before this starts
                const candidates = resourceTasks
                    .slice(0, i)
                    .filter(t => new Date(t.end) <= new Date(currentTask.start));

                if (candidates.length > 0) {
                    // Pick the most recent predecessor
                    const predecessor = candidates[candidates.length - 1];
                    currentTask.dependencies = predecessor.id;
                }
            }
        }
    }

    return {
        tasks,
        resources: RESOURCES,
        expandedTasks,
    };
}

export default { generateSubtaskDemo };
