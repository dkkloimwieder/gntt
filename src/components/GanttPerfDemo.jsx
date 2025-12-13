import { createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { createRAF } from '@solid-primitives/raf';
import { Gantt } from './Gantt.jsx';
import calendarData from '../data/calendar.json';

// Color palette for task groups
const GROUP_COLORS = [
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
 * Generate a seeded random number generator for reproducible results
 */
function createRandom(seed = 12345) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

/**
 * Add days to a date string
 */
function addDays(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
}

/**
 * Generate alphabetic label: 0=A, 25=Z, 26=AA, 27=AB, etc.
 * Similar to Excel column naming
 */
function getResourceLabel(index) {
    let label = '';
    let n = index;
    do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
}

/**
 * Add hours to a datetime string
 */
function addHours(dateStr, hours) {
    const date = new Date(dateStr);
    date.setTime(date.getTime() + hours * 60 * 60 * 1000);
    // Format as 'YYYY-MM-DD HH:MM' (space separator, not T - required by date_utils.parse)
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Generate tasks in groups with dependency chains.
 * Each group is independent - dependencies only within a group.
 * @param {number} count - Total number of tasks
 * @param {number} minGroupSize - Minimum tasks per group (default 5)
 * @param {number} maxGroupSize - Maximum tasks per group (default 20)
 * @param {number} seed - Random seed for reproducibility
 * @param {number} ssPercent - Percentage of tasks with SS+lag constraints (0-100)
 * @param {number} maxLag - Maximum lag hours for SS constraints (1-maxLag)
 */
function generateTasks(
    count = 100,
    minGroupSize = 5,
    maxGroupSize = 20,
    seed = 12345,
    ssPercent = 20,
    maxLag = 5,
) {
    const random = createRandom(seed);
    const tasks = [];
    const resourceCount = 26; // Full alphabet A-Z

    // Start from today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const baseDate = `${yyyy}-${mm}-${dd} 08:00`;

    let taskNum = 1;
    let groupStartDate = baseDate;

    while (taskNum <= count) {
        // Determine group size (5-20 tasks)
        const groupSize = Math.min(
            count - taskNum + 1,
            minGroupSize + Math.floor(random() * (maxGroupSize - minGroupSize + 1))
        );

        // Pick a random resource for this group
        const resourceIndex = Math.floor(random() * resourceCount);
        const resource = getResourceLabel(resourceIndex);
        const color = GROUP_COLORS[resourceIndex % GROUP_COLORS.length];
        const progressColor = color + 'cc';

        // Track the first task ID in this group for dependencies
        const groupFirstTaskId = taskNum;
        let groupCurrentDate = groupStartDate;

        // Generate tasks in this group
        for (let i = 0; i < groupSize && taskNum <= count; i++) {
            // Random duration 1-8 hours
            const duration = Math.floor(random() * 8) + 1;

            // Dependency logic - only within the group
            let dependency = undefined;

            if (i > 0) {
                // Not the first task in group - depends on previous task in group
                const useSSConstraint = random() < ssPercent / 100;
                if (useSSConstraint) {
                    const lag = Math.floor(random() * maxLag) + 1;
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
            // First task in group has no dependency

            const endDate = addHours(groupCurrentDate, duration);

            tasks.push({
                id: `task-${taskNum}`,
                name: `${taskNum}`,
                start: groupCurrentDate,
                end: endDate,
                progress: Math.floor(random() * 101),
                color: color,
                color_progress: progressColor,
                dependencies: dependency,
                resource: resource,
            });

            // Move time forward by 1-3 hours for next task in group
            const gap = Math.floor(random() * 3) + 1;
            groupCurrentDate = addHours(endDate, gap);
            taskNum++;
        }

        // Move group start date forward for the next group (stagger groups)
        const groupGap = Math.floor(random() * 5) + 2; // 2-6 hours between groups
        groupStartDate = addHours(groupStartDate, groupGap);
    }

    return tasks;
}

/**
 * GanttPerfDemo - Performance testing component for Gantt chart
 */
export function GanttPerfDemo() {
    // State
    const [dataSource, setDataSource] = createSignal('json'); // 'json' | 'generated'
    const [taskCount, setTaskCount] = createSignal(100);
    const [seed, setSeed] = createSignal(12345);
    const [ssPercent, setSSPercent] = createSignal(20); // % of tasks with SS+lag
    const [maxLag, setMaxLag] = createSignal(5); // max lag days (1-maxLag)
    const [tasks, setTasks] = createSignal([]);
    const [renderTime, setRenderTime] = createSignal(null);
    const [domStats, setDomStats] = createSignal({ tasks: 0, arrows: 0 });
    const [viewMode, setViewMode] = createSignal('Hour'); // Hour, Day, Week, Month, Year
    const [fps, setFps] = createSignal(0);

    // FPS counter using RAF
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    const [, startFpsCounter] = createRAF((timestamp) => {
        frameCount++;
        const elapsed = timestamp - lastFpsUpdate;
        if (elapsed >= 1000) {
            setFps(Math.round((frameCount * 1000) / elapsed));
            frameCount = 0;
            lastFpsUpdate = timestamp;
        }
    });

    // Gantt options - reactive based on viewMode
    const upperHeaderHeight = 35;
    const lowerHeaderHeight = 25;
    const options = createMemo(() => ({
        view_mode: viewMode(),
        bar_height: 20, // Smaller bars for 1000 tasks
        padding: 8, // Less padding
        column_width: viewMode() === 'Hour' ? 25 : 30, // Narrower for hour view
        upper_header_height: upperHeaderHeight,
        lower_header_height: lowerHeaderHeight,
        headerHeight: upperHeaderHeight + lowerHeaderHeight, // Must match!
        lines: 'both',
        scroll_to: 'start',
    }));

    // Generate or load tasks
    const regenerate = () => {
        const startTime = performance.now();

        let newTasks;
        if (dataSource() === 'json') {
            // Load from JSON file
            newTasks = calendarData.tasks;
        } else {
            // Generate on-the-fly
            newTasks = generateTasks(
                taskCount(),
                5,
                15,
                seed(),
                ssPercent(),
                maxLag(),
            );
        }
        setTasks(newTasks);

        // Measure render time after DOM updates
        // Use multiple RAF cycles + setTimeout to ensure SolidJS has fully rendered
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                // Additional microtask to ensure all reactive updates complete
                setTimeout(() => {
                    const endTime = performance.now();
                    setRenderTime((endTime - startTime).toFixed(1));

                    // Count DOM elements in visible viewport
                    const taskElements =
                        document.querySelectorAll('.bar-wrapper').length;
                    const arrowElements =
                        document.querySelectorAll('.arrow-layer > g').length;
                    setDomStats({ tasks: taskElements, arrows: arrowElements });
                }, 0);
            });
        });
    };

    // Initial generation and FPS counter
    onMount(() => {
        regenerate();
        startFpsCounter();
    });

    // Event handlers
    const handleDateChange = (taskId, position) => {
        console.log('Date changed:', taskId, position);
    };

    const handleProgressChange = (taskId, progress) => {
        console.log('Progress changed:', taskId, progress);
    };

    const handleTaskClick = (taskId) => {
        console.log('Task clicked:', taskId);
    };

    // Styles
    const containerStyle = {
        'max-width': '100%',
        height: '100vh',
        margin: 0,
        padding: '10px',
        display: 'flex',
        'flex-direction': 'column',
        'box-sizing': 'border-box',
        overflow: 'hidden', // Prevent page scroll
        'font-family':
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    };

    const headerStyle = {
        'margin-bottom': '10px',
        display: 'flex',
        'align-items': 'center',
        gap: '20px',
        'flex-wrap': 'wrap',
    };

    const statsStyle = {
        display: 'flex',
        gap: '15px',
        padding: '10px 15px',
        'background-color': '#1f2937',
        color: '#fff',
        'border-radius': '6px',
        'font-size': '13px',
        'font-family': 'monospace',
    };

    const statItemStyle = {
        display: 'flex',
        gap: '5px',
    };

    const statLabelStyle = {
        color: '#9ca3af',
    };

    const statValueStyle = {
        color: '#10b981',
        'font-weight': 'bold',
    };

    const controlsStyle = {
        display: 'flex',
        gap: '10px',
        'align-items': 'center',
    };

    const inputStyle = {
        padding: '6px 10px',
        border: '1px solid #d1d5db',
        'border-radius': '4px',
        width: '80px',
        'font-size': '13px',
    };

    const buttonStyle = {
        padding: '6px 12px',
        'background-color': '#3b82f6',
        color: '#fff',
        border: 'none',
        'border-radius': '4px',
        cursor: 'pointer',
        'font-size': '13px',
    };

    const ganttWrapperStyle = {
        border: '1px solid #e0e0e0',
        'border-radius': '8px',
        overflow: 'hidden',
        'background-color': '#fff',
        flex: 1,
        'min-height': 0, // Important for flex child to respect overflow
    };

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <h1 style={{ margin: 0, 'font-size': '20px' }}>
                    Performance Test
                </h1>

                <div style={statsStyle}>
                    <div style={statItemStyle}>
                        <span style={statLabelStyle}>Tasks:</span>
                        <span style={statValueStyle}>{domStats().tasks}</span>
                    </div>
                    <div style={statItemStyle}>
                        <span style={statLabelStyle}>Arrows:</span>
                        <span style={statValueStyle}>{domStats().arrows}</span>
                    </div>
                    <div style={statItemStyle}>
                        <span style={statLabelStyle}>Render:</span>
                        <span style={statValueStyle}>
                            {renderTime() ? `${renderTime()}ms` : '...'}
                        </span>
                    </div>
                    <div style={statItemStyle}>
                        <span style={statLabelStyle}>FPS:</span>
                        <span style={{
                            ...statValueStyle,
                            color: fps() >= 55 ? '#10b981' : fps() >= 30 ? '#f59e0b' : '#ef4444'
                        }}>
                            {fps()}
                        </span>
                    </div>
                </div>

                <div style={controlsStyle}>
                    <label style={{ 'font-size': '13px' }}>
                        Source:
                        <select
                            value={dataSource()}
                            onChange={(e) => {
                                setDataSource(e.target.value);
                                regenerate();
                            }}
                            style={{
                                ...inputStyle,
                                width: '120px',
                                cursor: 'pointer',
                            }}
                        >
                            <option value="json">JSON ({calendarData.tasks.length})</option>
                            <option value="generated">Generate</option>
                        </select>
                    </label>
                    <label style={{ 'font-size': '13px', opacity: dataSource() === 'json' ? 0.5 : 1 }}>
                        Tasks:
                        <input
                            type="number"
                            value={taskCount()}
                            disabled={dataSource() === 'json'}
                            onInput={(e) =>
                                setTaskCount(parseInt(e.target.value) || 1000)
                            }
                            style={inputStyle}
                        />
                    </label>
                    <label style={{ 'font-size': '13px', opacity: dataSource() === 'json' ? 0.5 : 1 }}>
                        Seed:
                        <input
                            type="number"
                            value={seed()}
                            disabled={dataSource() === 'json'}
                            onInput={(e) =>
                                setSeed(parseInt(e.target.value) || 12345)
                            }
                            style={inputStyle}
                        />
                    </label>
                    <label style={{ 'font-size': '13px', opacity: dataSource() === 'json' ? 0.5 : 1 }}>
                        SS%:
                        <input
                            type="number"
                            value={ssPercent()}
                            min="0"
                            max="100"
                            disabled={dataSource() === 'json'}
                            onInput={(e) =>
                                setSSPercent(
                                    Math.max(
                                        0,
                                        Math.min(
                                            100,
                                            parseInt(e.target.value) || 0,
                                        ),
                                    ),
                                )
                            }
                            style={{ ...inputStyle, width: '60px' }}
                        />
                    </label>
                    <label style={{ 'font-size': '13px', opacity: dataSource() === 'json' ? 0.5 : 1 }}>
                        Max Lag:
                        <input
                            type="number"
                            value={maxLag()}
                            min="1"
                            max="10"
                            disabled={dataSource() === 'json'}
                            onInput={(e) =>
                                setMaxLag(
                                    Math.max(
                                        1,
                                        Math.min(
                                            10,
                                            parseInt(e.target.value) || 1,
                                        ),
                                    ),
                                )
                            }
                            style={{ ...inputStyle, width: '60px' }}
                        />
                    </label>
                    <label style={{ 'font-size': '13px' }}>
                        View:
                        <select
                            value={viewMode()}
                            onChange={(e) => setViewMode(e.target.value)}
                            style={{
                                ...inputStyle,
                                width: '90px',
                                cursor: 'pointer',
                            }}
                        >
                            <option value="Minute">Minute</option>
                            <option value="Quarter Hour">Quarter Hour</option>
                            <option value="Hour">Hour</option>
                            <option value="Day">Day</option>
                            <option value="Week">Week</option>
                            <option value="Month">Month</option>
                        </select>
                    </label>
                    <button onClick={regenerate} style={buttonStyle}>
                        Regenerate
                    </button>
                    <button
                        onClick={() => console.clear()}
                        style={{
                            ...buttonStyle,
                            'background-color': '#6b7280',
                        }}
                    >
                        Clear Console
                    </button>
                </div>
            </div>

            <div style={ganttWrapperStyle}>
                <Gantt
                    tasks={tasks()}
                    options={options()}
                    onDateChange={handleDateChange}
                    onProgressChange={handleProgressChange}
                    onTaskClick={handleTaskClick}
                />
            </div>
        </div>
    );
}

export default GanttPerfDemo;
