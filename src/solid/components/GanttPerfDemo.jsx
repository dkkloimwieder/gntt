import { createSignal, createEffect, onMount } from 'solid-js';
import { Gantt } from './Gantt.jsx';

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
 * Generate tasks with dependency chains in groups
 * @param {number} count - Total number of tasks
 * @param {number} minGroupSize - Minimum tasks per group
 * @param {number} maxGroupSize - Maximum tasks per group
 * @param {number} seed - Random seed for reproducibility
 * @param {number} ssPercent - Percentage of tasks with SS+lag constraints (0-100)
 * @param {number} maxLag - Maximum lag days for SS constraints (1-maxLag)
 */
function generateTasks(
    count = 100,
    minGroupSize = 5,
    maxGroupSize = 15,
    seed = 12345,
    ssPercent = 20,
    maxLag = 5,
) {
    const random = createRandom(seed);
    const tasks = [];
    let taskNum = 1;
    let groupStartDate = '2024-01-01';
    let groupIndex = 0;

    while (taskNum <= count) {
        // Random group size between min and max
        const groupSize =
            Math.floor(random() * (maxGroupSize - minGroupSize + 1)) +
            minGroupSize;
        const groupColor = GROUP_COLORS[groupIndex % GROUP_COLORS.length];
        const progressColor = groupColor + 'cc'; // Slightly transparent version

        // Track previous task info for dependency calculations
        let prevTaskStart = groupStartDate;
        let prevTaskEnd = groupStartDate;

        for (let i = 0; i < groupSize && taskNum <= count; i++) {
            // Random duration 2-5 days (longer durations allow visible SS overlap)
            const duration = Math.floor(random() * 4) + 2;

            // Determine dependency type and calculate start date
            let dependency = undefined;
            let taskStartDate;

            if (i === 0) {
                // First task in group - no dependency
                taskStartDate = groupStartDate;
            } else {
                const useSSConstraint = random() < ssPercent / 100;
                if (useSSConstraint) {
                    // SS+lag: successor starts X days after predecessor STARTS
                    // For visible overlap, lag must be < predecessor duration
                    // prevDuration = days between prevTaskStart and prevTaskEnd
                    const prevDuration = Math.round(
                        (new Date(prevTaskEnd) - new Date(prevTaskStart)) /
                            (1000 * 60 * 60 * 24),
                    );
                    // Lag is 1 to min(maxLag, prevDuration-1), ensuring overlap
                    const effectiveMaxLag = Math.min(
                        maxLag,
                        Math.max(1, prevDuration - 1),
                    );
                    const lag = Math.floor(random() * effectiveMaxLag) + 1;
                    dependency = {
                        id: `task-${taskNum - 1}`,
                        type: 'SS',
                        lag: lag,
                    };
                    // Position task: predecessor START + lag days
                    taskStartDate = addDays(prevTaskStart, lag);
                } else {
                    // Simple FS: successor starts when predecessor finishes
                    dependency = `task-${taskNum - 1}`;
                    // Position task: predecessor END
                    taskStartDate = prevTaskEnd;
                }
            }

            const endDate = addDays(taskStartDate, duration);

            tasks.push({
                id: `task-${taskNum}`,
                name: `${taskNum}`,
                start: taskStartDate,
                end: endDate,
                progress: Math.floor(random() * 101), // 0-100
                color: groupColor,
                color_progress: progressColor,
                dependencies: dependency,
            });

            // Update previous task tracking for next iteration
            prevTaskStart = taskStartDate;
            prevTaskEnd = endDate;
            taskNum++;
        }

        // Stagger groups by 2 days
        groupStartDate = addDays(groupStartDate, 2);
        groupIndex++;
    }

    return tasks;
}

/**
 * GanttPerfDemo - Performance testing component for Gantt chart
 */
export function GanttPerfDemo() {
    // State
    const [taskCount, setTaskCount] = createSignal(100);
    const [seed, setSeed] = createSignal(12345);
    const [ssPercent, setSSPercent] = createSignal(20); // % of tasks with SS+lag
    const [maxLag, setMaxLag] = createSignal(5); // max lag days (1-maxLag)
    const [tasks, setTasks] = createSignal([]);
    const [renderTime, setRenderTime] = createSignal(null);
    const [domStats, setDomStats] = createSignal({ tasks: 0, arrows: 0 });

    // Gantt options
    const [options] = createSignal({
        view_mode: 'Day',
        bar_height: 20, // Smaller bars for 1000 tasks
        padding: 8, // Less padding
        column_width: 30, // Narrower columns
        upper_header_height: 35,
        lower_header_height: 25,
        lines: 'both',
        scroll_to: 'start',
    });

    // Generate tasks
    const regenerate = () => {
        const startTime = performance.now();

        const newTasks = generateTasks(
            taskCount(),
            5,
            15,
            seed(),
            ssPercent(),
            maxLag(),
        );
        setTasks(newTasks);

        // Measure render time after DOM updates
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const endTime = performance.now();
                setRenderTime((endTime - startTime).toFixed(1));

                // Count DOM elements
                const taskElements =
                    document.querySelectorAll('.bar-wrapper').length;
                const arrowElements =
                    document.querySelectorAll('.arrow-layer > g').length;
                setDomStats({ tasks: taskElements, arrows: arrowElements });
            });
        });
    };

    // Initial generation
    onMount(() => {
        regenerate();
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
        margin: '0 auto',
        padding: '10px',
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
                </div>

                <div style={controlsStyle}>
                    <label style={{ 'font-size': '13px' }}>
                        Tasks:
                        <input
                            type="number"
                            value={taskCount()}
                            onInput={(e) =>
                                setTaskCount(parseInt(e.target.value) || 1000)
                            }
                            style={inputStyle}
                        />
                    </label>
                    <label style={{ 'font-size': '13px' }}>
                        Seed:
                        <input
                            type="number"
                            value={seed()}
                            onInput={(e) =>
                                setSeed(parseInt(e.target.value) || 12345)
                            }
                            style={inputStyle}
                        />
                    </label>
                    <label style={{ 'font-size': '13px' }}>
                        SS%:
                        <input
                            type="number"
                            value={ssPercent()}
                            min="0"
                            max="100"
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
                    <label style={{ 'font-size': '13px' }}>
                        Max Lag:
                        <input
                            type="number"
                            value={maxLag()}
                            min="1"
                            max="10"
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
