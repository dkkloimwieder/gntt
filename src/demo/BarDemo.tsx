// @ts-nocheck
import { createSignal, createMemo, For, Index, onMount, Show } from 'solid-js';
import { createTaskStore } from '../stores/taskStore.js';
import { createGanttConfigStore } from '../stores/ganttConfigStore.js';
import { Bar } from '../components/Bar';
import { Arrow } from '../components/Arrow';
import { resolveConstraints, buildRelationshipIndex } from '../utils/constraintEngine.js';

/**
 * Bar Demo - Interactive Test Page for Bar Component
 *
 * Tests:
 * - Static bar rendering
 * - Progress bars
 * - Expected progress
 * - Multiple bar configurations
 * - Integration with taskStore and Arrow components
 */
export function BarDemo() {
    const taskStore = createTaskStore();
    const ganttConfig = createGanttConfigStore({
        columnWidth: 45,
        barHeight: 30,
        headerHeight: 50,
        padding: 18,
        barCornerRadius: 4,
        showExpectedProgress: false,
    });

    // Demo state
    const [showExpected, setShowExpected] = createSignal(false);
    const [showDebug, setShowDebug] = createSignal(false);

    // Helper to create dates relative to today
    const daysFromNow = (days) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        date.setHours(0, 0, 0, 0);
        return date;
    };

    // Sample tasks with start/end dates for expected progress calculation
    // Dates are set so some tasks are ahead, some behind schedule
    const sampleTasks = [
        {
            id: 'task-1',
            name: 'Design',
            progress: 100,  // Complete
            _start: daysFromNow(-10),  // Started 10 days ago
            _end: daysFromNow(-1),     // Ended yesterday
            color: '#3498db',
            color_progress: '#2980b9',
            _index: 0,
        },
        // Start-to-start: Documentation starts when Design starts (parallel with predecessor)
        {
            id: 'task-1b',
            name: 'Documentation',
            progress: 80,   // 80% done
            _start: daysFromNow(-10),  // Started 10 days ago
            _end: daysFromNow(2),      // Ends in 2 days (expected ~83%)
            color: '#9b59b6',
            color_progress: '#8e44ad',
            _index: 1,
        },
        // Finish-to-start parallel: both start after Design ends
        {
            id: 'task-2a',
            name: 'Frontend Dev',
            progress: 60,   // 60% done
            _start: daysFromNow(-5),   // Started 5 days ago
            _end: daysFromNow(3),      // Ends in 3 days (expected ~63%)
            color: '#27ae60',
            color_progress: '#1e8449',
            _index: 2,
        },
        {
            id: 'task-2b',
            name: 'Backend Dev',
            progress: 45,   // 45% done - behind schedule!
            _start: daysFromNow(-5),   // Started 5 days ago
            _end: daysFromNow(2),      // Ends in 2 days (expected ~71%)
            color: '#16a085',
            color_progress: '#1abc9c',
            _index: 3,
        },
        // Depends on both parallel tasks
        {
            id: 'task-3',
            name: 'Integration',
            progress: 10,   // Just started
            _start: daysFromNow(-1),   // Started yesterday
            _end: daysFromNow(5),      // Ends in 5 days (expected ~17%)
            color: '#e67e22',
            color_progress: '#d35400',
            _index: 4,
        },
        {
            id: 'task-4',
            name: 'Locked Task',
            progress: 50,
            _start: daysFromNow(-7),
            _end: daysFromNow(7),      // 14 day task, halfway (expected 50%)
            color: '#7f8c8d',
            constraints: { locked: true },
            _index: 5,
        },
        // Fixed-offset demo: these tasks move together
        {
            id: 'sync-a',
            name: 'Sync A',
            progress: 70,   // Ahead of schedule
            _start: daysFromNow(-3),
            _end: daysFromNow(3),      // 6 day task (expected 50%)
            color: '#e74c3c',
            color_progress: '#c0392b',
            _index: 6,
        },
        {
            id: 'sync-b',
            name: 'Sync B',
            progress: 40,   // Behind schedule
            _start: daysFromNow(-3),
            _end: daysFromNow(3),      // 6 day task (expected 50%)
            color: '#e74c3c',
            color_progress: '#c0392b',
            _index: 7,
        },
    ];

    // Relationships with full constraint properties:
    // - minDistance: minimum gap (push if closer) - default 10
    // - maxDistance: maximum gap (pull if further)
    // - fixedOffset: tasks move together as a unit
    const relationships = [
        // Start-to-start: Documentation can overlap with Design (no min gap)
        { from: 'task-1', to: 'task-1b', minDistance: -Infinity },

        // Finish-to-start: Frontend/Backend start after Design ends (default gap)
        { from: 'task-1', to: 'task-2a', minDistance: 0 },
        { from: 'task-1', to: 'task-2b', minDistance: 0 },

        // Frontend → Integration: with tether (can't drift too far)
        { from: 'task-2a', to: 'task-3', minDistance: 0, maxDistance: 90 },

        // Backend → Integration: standard FS
        { from: 'task-2b', to: 'task-3', minDistance: 0 },

        // Fixed-offset: Sync A and Sync B move together
        { from: 'sync-a', to: 'sync-b', fixedOffset: true },
    ];

    // Pre-build relationship index for O(1) lookups
    const relationshipIndex = buildRelationshipIndex(relationships);

    // Bar positions showing different relationship types
    // Grid: columnWidth=45, so valid x positions are 0, 45, 90, 135, 180, 225, 270, 315, 360, 405...
    const barPositions = [
        { x: 90, width: 135 },    // Design: columns 2-5 (ends at 225)
        { x: 90, width: 180 },    // Documentation: SAME START as Design (start-to-start)
        { x: 225, width: 180 },   // Frontend Dev: starts at Design end (finish-to-start)
        { x: 225, width: 135 },   // Backend Dev: starts at Design end (finish-to-start, parallel)
        { x: 405, width: 135 },   // Integration: starts when both parallel tasks end
        { x: 90, width: 135 },    // Locked Task: independent
        { x: 495, width: 90 },    // Sync A: fixed-offset pair
        { x: 630, width: 90 },    // Sync B: fixed-offset pair (linked to Sync A)
    ];

    // Initialize tasks
    onMount(() => {
        const tasks = sampleTasks.map((task, i) => ({
            ...task,
            _bar: {
                x: barPositions[i].x,
                y: 60 + task._index * 48,
                width: barPositions[i].width,
                height: 30,
            },
        }));
        taskStore.updateTasks(tasks);
    });

    // Get all tasks for rendering
    const allTasks = createMemo(() => {
        return Object.values(taskStore.tasks);
    });

    // Toggle expected progress
    const toggleExpected = () => {
        const newValue = !showExpected();
        setShowExpected(newValue);
        ganttConfig.setShowExpectedProgress(newValue);
    };

    // Simulate progress update
    const updateProgress = (taskId, delta) => {
        const task = taskStore.getTask(taskId);
        if (task) {
            const newProgress = Math.max(0, Math.min(100, (task.progress || 0) + delta));
            taskStore.updateTask(taskId, { ...task, progress: newProgress });
        }
    };

    // Reset positions (same as initial)
    const resetPositions = () => {
        const tasks = sampleTasks.map((task, i) => ({
            ...task,
            _bar: {
                x: barPositions[i].x,
                y: 60 + task._index * 48,
                width: barPositions[i].width,
                height: 30,
            },
        }));
        taskStore.updateTasks(tasks);
    };

    return (
        <div style={{ padding: '20px', 'font-family': 'system-ui, sans-serif', 'max-width': '900px', margin: '0 auto' }}>
            <h1 style={{ 'margin-bottom': '10px' }}>Bar Component Demo</h1>
            <p style={{ color: '#666', 'margin-bottom': '20px' }}>
                Interactive bar component with drag, resize, and progress editing.
            </p>

            {/* Controls */}
            <div style={{
                'margin-bottom': '20px',
                padding: '15px',
                'background-color': '#f8f9fa',
                'border-radius': '8px',
                display: 'flex',
                gap: '15px',
                'align-items': 'center',
                'flex-wrap': 'wrap',
            }}>
                <label style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                    <input
                        type="checkbox"
                        checked={showExpected()}
                        onChange={toggleExpected}
                    />
                    <span style={{ 'font-size': '13px' }}>Show Expected Progress</span>
                </label>

                <label style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                    <input
                        type="checkbox"
                        checked={showDebug()}
                        onChange={(e) => setShowDebug(e.target.checked)}
                    />
                    <span style={{ 'font-size': '13px' }}>Show Debug</span>
                </label>

                <button
                    onClick={resetPositions}
                    style={{
                        padding: '6px 12px',
                        'border-radius': '4px',
                        border: '1px solid #ddd',
                        'background': '#fff',
                        cursor: 'pointer',
                    }}
                >
                    Reset Positions
                </button>

                <button
                    onClick={() => updateProgress('task-2a', 10)}
                    style={{
                        padding: '6px 12px',
                        'border-radius': '4px',
                        border: '1px solid #27ae60',
                        'background': '#27ae60',
                        color: '#fff',
                        cursor: 'pointer',
                    }}
                >
                    +10% Frontend
                </button>

                <button
                    onClick={() => updateProgress('task-2a', -10)}
                    style={{
                        padding: '6px 12px',
                        'border-radius': '4px',
                        border: '1px solid #e74c3c',
                        'background': '#e74c3c',
                        color: '#fff',
                        cursor: 'pointer',
                    }}
                >
                    -10% Frontend
                </button>
            </div>

            {/* SVG Canvas */}
            <svg
                width="800"
                height="500"
                style={{
                    border: '2px solid #dee2e6',
                    'border-radius': '8px',
                    'background-color': '#fff',
                    display: 'block',
                }}
            >
                {/* Grid */}
                <defs>
                    <pattern id="grid" width="45" height="48" patternUnits="userSpaceOnUse">
                        <path d="M 45 0 L 0 0 0 48" fill="none" stroke="#f0f0f0" stroke-width="0.5" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Header area */}
                <rect x="0" y="0" width="100%" height="50" fill="#f8f9fa" />
                <line x1="0" y1="50" x2="800" y2="50" stroke="#ddd" />

                {/* Column labels */}
                <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]}>
                    {(i) => (
                        <text x={i * 45 + 22} y="30" text-anchor="middle" font-size="10" fill="#999">
                            {i}
                        </text>
                    )}
                </For>

                {/* Arrows layer */}
                <g class="arrows">
                    <For each={relationships}>
                        {(rel) => (
                            <Arrow
                                taskStore={taskStore}
                                fromId={rel.from}
                                toId={rel.to}
                                stroke="#999"
                                strokeWidth={2}
                                curveRadius={8}
                            />
                        )}
                    </For>
                </g>

                {/* Bars layer - use Index instead of For to prevent component recreation on position updates */}
                <g class="bars">
                    <Index each={allTasks()}>
                        {(task) => (
                            <Bar
                                task={task()}
                                taskStore={taskStore}
                                ganttConfig={ganttConfig}
                                onConstrainPosition={(taskId, newX, newY) => {
                                    const taskBar = taskStore.getBarPosition(taskId);
                                    const width = taskBar?.width ?? 100;

                                    // Build context for constraint engine
                                    const context = {
                                        getBarPosition: taskStore.getBarPosition.bind(taskStore),
                                        getTask: taskStore.getTask.bind(taskStore),
                                        relationships,
                                        relationshipIndex,
                                        pixelsPerHour: 45, // columnWidth
                                    };

                                    const result = resolveConstraints(taskId, newX, width, context);

                                    if (result.blocked) {
                                        return null;
                                    }

                                    // Update main task
                                    taskStore.updateBarPosition(taskId, { x: result.constrainedX });

                                    // Apply cascade updates to successors
                                    if (result.cascadeUpdates) {
                                        for (const [succId, update] of result.cascadeUpdates) {
                                            taskStore.updateBarPosition(succId, update);
                                        }
                                    }

                                    return null;
                                }}
                            />
                        )}
                    </Index>
                </g>

                {/* Debug overlay - shows constraints under each bar */}
                <Show when={showDebug()}>
                    <g class="debug">
                        <For each={allTasks()}>
                            {(task) => {
                                const pos = taskStore.getBarPosition(task.id);
                                if (!pos) return null;

                                // Find relationships involving this task
                                const asSuccessor = relationships.filter(r => r.to === task.id);
                                const asPredecessor = relationships.filter(r => r.from === task.id);

                                // Build constraint info string
                                const constraintParts = [];

                                // Show predecessors with constraint type
                                asSuccessor.forEach(r => {
                                    const predPos = taskStore.getBarPosition(r.from);
                                    if (!predPos) return;

                                    if (r.fixedOffset) {
                                        constraintParts.push(`←${r.from}[fixed]`);
                                    } else {
                                        const gap = pos.x - (predPos.x + predPos.width);
                                        const minD = r.minDistance ?? 10;
                                        const maxD = r.maxDistance;
                                        const type = minD === -Infinity ? 'SS' : 'FS';
                                        const maxStr = maxD !== undefined ? ` max:${maxD}` : '';
                                        constraintParts.push(`←${r.from}(${type} gap:${gap}${maxStr})`);
                                    }
                                });

                                // Show if this task is part of fixed-offset group
                                asPredecessor.forEach(r => {
                                    if (r.fixedOffset) {
                                        constraintParts.push(`→${r.to}[fixed]`);
                                    }
                                });

                                const constraintStr = constraintParts.length > 0
                                    ? constraintParts.join(' ')
                                    : 'no deps';

                                return (
                                    <text
                                        x={pos.x}
                                        y={pos.y + pos.height + 12}
                                        font-size="8"
                                        fill="#666"
                                        font-family="monospace"
                                    >
                                        {task.id} | x:{pos.x} w:{pos.width} | {constraintStr}
                                    </text>
                                );
                            }}
                        </For>
                    </g>
                </Show>
            </svg>

            {/* Legend */}
            <div style={{
                'margin-top': '20px',
                padding: '15px',
                'background-color': '#f8f9fa',
                'border-radius': '8px',
            }}>
                <h3 style={{ margin: '0 0 12px 0', 'font-size': '14px' }}>Task List</h3>
                <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', 'font-size': '12px' }}>
                    <For each={allTasks()}>
                        {(task) => (
                            <div style={{
                                display: 'flex',
                                'align-items': 'center',
                                gap: '8px',
                                padding: '4px 8px',
                                'background': task.invalid ? '#fee2e2' : task.constraints?.locked ? '#e5e5e5' : '#fff',
                                'border-radius': '4px',
                                border: '1px solid #ddd',
                            }}>
                                <span style={{
                                    width: '16px',
                                    height: '16px',
                                    'background': task.color,
                                    'border-radius': '3px',
                                }}></span>
                                <span style={{ flex: 1 }}>{task.name}</span>
                                <span style={{ color: '#666' }}>{task.progress}%</span>
                                {task.constraints?.locked && <span>🔒</span>}
                                {task.invalid && <span>⚠️</span>}
                            </div>
                        )}
                    </For>
                </div>
            </div>

            {/* Features */}
            <div style={{
                'margin-top': '15px',
                padding: '15px',
                'background-color': '#e7f5ff',
                'border-radius': '8px',
                'border-left': '4px solid #339af0',
            }}>
                <h3 style={{ margin: '0 0 8px 0', 'font-size': '14px' }}>Implemented Features</h3>
                <ul style={{ margin: 0, 'padding-left': '20px', 'font-size': '13px', color: '#495057' }}>
                    <li>✅ Static bar rendering with colors</li>
                    <li>✅ Progress bars with correct width calculation</li>
                    <li>✅ Expected progress (toggle checkbox)</li>
                    <li>✅ Labels (centered or outside based on width)</li>
                    <li>✅ Locked task styling (gray + dashed border + 🔒)</li>
                    <li>✅ Invalid task state</li>
                    <li>✅ Integration with taskStore (reactive)</li>
                    <li>✅ Integration with Arrow component</li>
                    <li>✅ Bar drag with grid snapping</li>
                    <li>✅ Left/right resize handles</li>
                    <li>✅ Progress handle drag</li>
                    <li>✅ Locked tasks prevent interaction</li>
                </ul>
                <h3 style={{ margin: '12px 0 8px 0', 'font-size': '14px' }}>Constraint System</h3>
                <ul style={{ margin: 0, 'padding-left': '20px', 'font-size': '13px', color: '#495057' }}>
                    <li>✅ <b>minDistance</b>: Push successor when gap becomes too small</li>
                    <li>✅ <b>maxDistance</b>: Pull successor when gap becomes too large (Frontend → Integration)</li>
                    <li>✅ <b>fixedOffset</b>: Tasks move together (drag Sync A or Sync B)</li>
                    <li>✅ <b>locked</b>: Movement blocked at locked task boundary</li>
                    <li>✅ <b>SS/FS</b>: Start-to-start vs Finish-to-start constraints</li>
                    <li>✅ Successor cannot move before predecessor start</li>
                    <li>✅ Real-time constraint resolution during drag</li>
                </ul>
            </div>
        </div>
    );
}
