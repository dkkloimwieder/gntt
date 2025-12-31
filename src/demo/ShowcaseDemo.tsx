// @ts-nocheck
import {
    createSignal,
    createMemo,
    For,
    Show,
    onMount,
    onCleanup,
    batch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { Bar } from '../components/Bar';
import { Arrow } from '../components/Arrow';
import { TaskDataPopup } from '../components/TaskDataPopup';
import { TaskDataModal } from '../components/TaskDataModal';
import { createTaskStore } from '../stores/taskStore.js';
import { createGanttConfigStore } from '../stores/ganttConfigStore.js';
import {
    resolveConstraints,
    buildRelationshipIndex,
    DEP_TYPES as DEPENDENCY_TYPES,
} from '../utils/constraintEngine.js';

// ============================================================================
// PRESETS
// ============================================================================
const PRESETS = {
    default: {
        name: 'Default',
        taskConfig: {
            name: 'Task',
            color: '#b8c2cc',
            color_progress: '#a3a3ff',
            progress: 50,
            cornerRadius: 3,
            locked: false,
            invalid: false,
        },
        arrowConfig: {
            startAnchor: 'auto',
            endAnchor: 'auto',
            startOffset: null, // null = auto (use smart calculation)
            endOffset: 0.5,
            routing: 'orthogonal',
            curveRadius: 5,
            stroke: '#666',
            strokeWidth: 1.4,
            strokeOpacity: 1,
            strokeDasharray: '',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            headShape: 'chevron',
            headSize: 5,
            headFill: false,
        },
        constraintConfig: {
            type: 'FS', // FS, SS, FF, SF
            lag: 0, // Offset (positive = delay, negative = lead)
            elastic: true, // true = minimum distance, false = fixed distance
        },
        globalConfig: {
            readonly: false,
            readonlyDates: false,
            readonlyProgress: false,
            showExpectedProgress: false,
            snapToGrid: true,
            columnWidth: 45,
        },
    },
    colorful: {
        name: 'Colorful',
        taskConfig: {
            name: 'Colorful Task',
            color: '#e74c3c',
            color_progress: '#c0392b',
            progress: 75,
            cornerRadius: 6,
            locked: false,
            invalid: false,
        },
        arrowConfig: {
            startAnchor: 'auto',
            endAnchor: 'auto',
            startOffset: null, // null = auto
            endOffset: 0.5,
            routing: 'orthogonal',
            curveRadius: 10,
            stroke: '#9b59b6',
            strokeWidth: 2.5,
            strokeOpacity: 1,
            strokeDasharray: '',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            headShape: 'triangle',
            headSize: 8,
            headFill: true,
        },
        constraintConfig: {
            type: 'FS',
            lag: 0,
            elastic: true,
        },
        globalConfig: {
            readonly: false,
            readonlyDates: false,
            readonlyProgress: false,
            showExpectedProgress: false,
            snapToGrid: true,
            columnWidth: 45,
        },
    },
    minimal: {
        name: 'Minimal',
        taskConfig: {
            name: 'Minimal',
            color: '#95a5a6',
            color_progress: '#7f8c8d',
            progress: 30,
            cornerRadius: 0,
            locked: false,
            invalid: false,
        },
        arrowConfig: {
            startAnchor: 'right',
            endAnchor: 'left',
            startOffset: 0.5,
            endOffset: 0.5,
            routing: 'straight',
            curveRadius: 0,
            stroke: '#bdc3c7',
            strokeWidth: 1,
            strokeOpacity: 0.6,
            strokeDasharray: '',
            strokeLinecap: 'butt',
            strokeLinejoin: 'miter',
            headShape: 'none',
            headSize: 5,
            headFill: false,
        },
        constraintConfig: {
            type: 'FS',
            lag: 0,
            elastic: true,
        },
        globalConfig: {
            readonly: false,
            readonlyDates: false,
            readonlyProgress: false,
            showExpectedProgress: false,
            snapToGrid: true,
            columnWidth: 45,
        },
    },
    constrained: {
        name: 'Constrained',
        taskConfig: {
            name: 'Constrained',
            color: '#3498db',
            color_progress: '#2980b9',
            progress: 60,
            cornerRadius: 3,
            locked: false,
            invalid: false,
        },
        arrowConfig: {
            startAnchor: 'auto',
            endAnchor: 'auto',
            startOffset: null, // null = auto
            endOffset: 0.5,
            routing: 'orthogonal',
            curveRadius: 5,
            stroke: '#e67e22',
            strokeWidth: 2,
            strokeOpacity: 1,
            strokeDasharray: '',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            headShape: 'chevron',
            headSize: 6,
            headFill: false,
        },
        constraintConfig: {
            type: 'FS',
            lag: 20,
            elastic: true,
        },
        globalConfig: {
            readonly: false,
            readonlyDates: false,
            readonlyProgress: false,
            showExpectedProgress: false,
            snapToGrid: true,
            columnWidth: 45,
        },
    },
    locked: {
        name: 'Locked',
        taskConfig: {
            name: 'Locked Task',
            color: '#7f8c8d',
            color_progress: '#95a5a6',
            progress: 50,
            cornerRadius: 3,
            locked: true,
            invalid: false,
        },
        arrowConfig: {
            startAnchor: 'auto',
            endAnchor: 'auto',
            startOffset: null, // null = auto
            endOffset: 0.5,
            routing: 'orthogonal',
            curveRadius: 5,
            stroke: '#c0392b',
            strokeWidth: 1.5,
            strokeOpacity: 1,
            strokeDasharray: '4,4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            headShape: 'chevron',
            headSize: 5,
            headFill: false,
        },
        constraintConfig: {
            type: 'FS',
            lag: 0,
            elastic: true,
        },
        globalConfig: {
            readonly: false,
            readonlyDates: false,
            readonlyProgress: false,
            showExpectedProgress: false,
            snapToGrid: true,
            columnWidth: 45,
        },
    },
    fixedOffset: {
        name: 'Fixed Offset',
        taskConfig: {
            name: 'Linked Task',
            color: '#9b59b6',
            color_progress: '#8e44ad',
            progress: 40,
            cornerRadius: 3,
            locked: false,
            invalid: false,
        },
        arrowConfig: {
            startAnchor: 'auto',
            endAnchor: 'auto',
            startOffset: null, // null = auto
            endOffset: 0.5,
            routing: 'orthogonal',
            curveRadius: 5,
            stroke: '#9b59b6',
            strokeWidth: 2,
            strokeOpacity: 1,
            strokeDasharray: '8,4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            headShape: 'none',
            headSize: 5,
            headFill: false,
        },
        constraintConfig: {
            type: 'FS',
            lag: 80, // Fixed gap between tasks
            elastic: false, // Fixed = tasks move together
        },
        globalConfig: {
            readonly: false,
            readonlyDates: false,
            readonlyProgress: false,
            showExpectedProgress: false,
            snapToGrid: true,
            columnWidth: 45,
        },
    },
    // New presets for other dependency types
    startToStart: {
        name: 'Start-to-Start',
        taskConfig: {
            name: 'Parallel Start',
            color: '#2ecc71',
            color_progress: '#27ae60',
            progress: 50,
            cornerRadius: 3,
            locked: false,
            invalid: false,
        },
        arrowConfig: {
            startAnchor: 'auto',
            endAnchor: 'auto',
            startOffset: null,
            endOffset: 0.5,
            routing: 'orthogonal',
            curveRadius: 5,
            stroke: '#27ae60',
            strokeWidth: 2,
            strokeOpacity: 1,
            strokeDasharray: '',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            headShape: 'chevron',
            headSize: 5,
            headFill: false,
        },
        constraintConfig: {
            type: 'SS',
            lag: 0,
            elastic: true,
        },
        globalConfig: {
            readonly: false,
            readonlyDates: false,
            readonlyProgress: false,
            showExpectedProgress: false,
            snapToGrid: true,
            columnWidth: 45,
        },
    },
    finishToFinish: {
        name: 'Finish-to-Finish',
        taskConfig: {
            name: 'Sync End',
            color: '#e74c3c',
            color_progress: '#c0392b',
            progress: 50,
            cornerRadius: 3,
            locked: false,
            invalid: false,
        },
        arrowConfig: {
            startAnchor: 'auto',
            endAnchor: 'auto',
            startOffset: null,
            endOffset: 0.5,
            routing: 'orthogonal',
            curveRadius: 5,
            stroke: '#c0392b',
            strokeWidth: 2,
            strokeOpacity: 1,
            strokeDasharray: '',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            headShape: 'chevron',
            headSize: 5,
            headFill: false,
        },
        constraintConfig: {
            type: 'FF',
            lag: 0,
            elastic: true,
        },
        globalConfig: {
            readonly: false,
            readonlyDates: false,
            readonlyProgress: false,
            showExpectedProgress: false,
            snapToGrid: true,
            columnWidth: 45,
        },
    },
};

// ============================================================================
// STYLES
// ============================================================================
const styles = {
    container: {
        'font-family':
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    header: {
        'text-align': 'center',
        'margin-bottom': '20px',
    },
    title: {
        margin: '0 0 8px 0',
        'font-size': '28px',
        'font-weight': '600',
    },
    subtitle: {
        margin: 0,
        color: '#666',
        'font-size': '14px',
    },
    presetBar: {
        display: 'flex',
        gap: '8px',
        'justify-content': 'center',
        'margin-bottom': '20px',
        'flex-wrap': 'wrap',
    },
    presetButton: {
        padding: '8px 16px',
        'border-radius': '4px',
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        'font-size': '13px',
        transition: 'all 0.2s',
    },
    presetButtonActive: {
        background: '#3498db',
        color: '#fff',
        'border-color': '#3498db',
    },
    configRow: {
        display: 'grid',
        'grid-template-columns': '1fr 1fr',
        gap: '20px',
        'margin-bottom': '20px',
    },
    panel: {
        background: '#f8f9fa',
        padding: '15px',
        'border-radius': '8px',
    },
    panelTitle: {
        margin: '0 0 12px 0',
        'font-size': '14px',
        'font-weight': '600',
        color: '#333',
    },
    fieldset: {
        border: '1px solid #dee2e6',
        padding: '10px',
        'border-radius': '4px',
        'margin-bottom': '10px',
    },
    legend: {
        'font-size': '11px',
        'font-weight': 'bold',
        color: '#6c757d',
        padding: '0 5px',
    },
    control: {
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        'margin-bottom': '8px',
        'font-size': '12px',
    },
    label: {
        'min-width': '100px',
        color: '#555',
    },
    input: {
        flex: 1,
    },
    textInput: {
        padding: '4px 8px',
        border: '1px solid #ddd',
        'border-radius': '3px',
        'font-size': '12px',
        width: '100%',
    },
    colorInput: {
        width: '40px',
        height: '24px',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
    },
    select: {
        padding: '4px 8px',
        border: '1px solid #ddd',
        'border-radius': '3px',
        'font-size': '12px',
        width: '100%',
    },
    slider: {
        width: '100%',
    },
    checkbox: {
        cursor: 'pointer',
    },
    sliderValue: {
        'min-width': '40px',
        'text-align': 'right',
        color: '#888',
        'font-size': '11px',
    },
    constraintSection: {
        background: '#fff3cd',
        padding: '15px',
        'border-radius': '8px',
        'border-left': '4px solid #ffc107',
        'margin-bottom': '20px',
    },
    constraintTitle: {
        margin: '0 0 12px 0',
        'font-size': '14px',
        'font-weight': '600',
    },
    constraintRow: {
        display: 'flex',
        gap: '20px',
        'flex-wrap': 'wrap',
    },
    constraintControl: {
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
    },
    numberInput: {
        width: '60px',
        padding: '4px 8px',
        border: '1px solid #ddd',
        'border-radius': '3px',
        'font-size': '12px',
    },
    svgContainer: {
        background: '#fff',
        border: '1px solid #ddd',
        'border-radius': '8px',
        'margin-bottom': '20px',
        overflow: 'hidden',
    },
    infoBox: {
        background: '#e7f5ff',
        padding: '15px',
        'border-radius': '8px',
        'border-left': '4px solid #339af0',
    },
    infoTitle: {
        margin: '0 0 8px 0',
        'font-size': '14px',
        'font-weight': '600',
    },
    infoText: {
        margin: 0,
        'font-size': '13px',
        'line-height': '1.5',
    },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ShowcaseDemo() {
    // Task store and config store
    const taskStore = createTaskStore();
    const ganttConfig = createGanttConfigStore({
        columnWidth: 45,
        barHeight: 30,
    });

    // Configuration state
    const [taskConfig, setTaskConfig] = createStore({
        ...PRESETS.default.taskConfig,
    });
    const [taskBConfig, setTaskBConfig] = createStore({
        name: 'Task B',
        color: '#27ae60',
        color_progress: '#2ecc71',
        progress: 50,
        locked: false,
    });
    const [taskCConfig, setTaskCConfig] = createStore({
        name: 'Task C',
        color: '#3498db',
        color_progress: '#2980b9',
        progress: 50,
        locked: false,
    });
    const [taskDConfig, setTaskDConfig] = createStore({
        name: 'Task D',
        color: '#9b59b6',
        color_progress: '#8e44ad',
        progress: 50,
        locked: false,
    });
    const [arrowConfig, setArrowConfig] = createStore({
        ...PRESETS.default.arrowConfig,
    });
    const [constraintConfig, setConstraintConfig] = createStore({
        ...PRESETS.default.constraintConfig,
    });
    const [globalConfig, setGlobalConfig] = createStore({
        ...PRESETS.default.globalConfig,
    });
    const [activePreset, setActivePreset] = createSignal('default');

    // Task data popup/modal state
    const [hoveredTaskId, setHoveredTaskId] = createSignal(null);
    const [popupPosition, setPopupPosition] = createSignal({ x: 0, y: 0 });
    const [popupVisible, setPopupVisible] = createSignal(false);
    const [modalTaskId, setModalTaskId] = createSignal(null);
    const [modalVisible, setModalVisible] = createSignal(false);

    // Computed values for popup/modal
    const hoveredTask = createMemo(() => {
        const id = hoveredTaskId();
        return id ? taskStore.getTask(id) : null;
    });
    const hoveredBarPosition = createMemo(() => {
        const id = hoveredTaskId();
        return id ? taskStore.getBarPosition(id) : null;
    });
    const modalTask = createMemo(() => {
        const id = modalTaskId();
        return id ? taskStore.getTask(id) : null;
    });
    const modalBarPosition = createMemo(() => {
        const id = modalTaskId();
        return id ? taskStore.getBarPosition(id) : null;
    });

    // Initialize tasks - positions for FS (Finish-to-Start) demo
    const initializeTasks = () => {
        const tasks = [
            {
                id: 'task-a',
                name: 'Task A',
                progress: taskConfig.progress,
                color: taskConfig.color,
                color_progress: taskConfig.color_progress,
                constraints: { locked: taskConfig.locked },
                invalid: taskConfig.invalid,
                _index: 0,
                _bar: { x: 80, y: 70, width: 120, height: 30 },
            },
            {
                id: 'task-b',
                name: taskBConfig.name,
                progress: taskBConfig.progress,
                color: taskBConfig.color,
                color_progress: taskBConfig.color_progress,
                constraints: { locked: taskBConfig.locked },
                _index: 1,
                _bar: { x: 200, y: 120, width: 120, height: 30 },
            },
            {
                id: 'task-c',
                name: taskCConfig.name,
                progress: taskCConfig.progress,
                color: taskCConfig.color,
                color_progress: taskCConfig.color_progress,
                constraints: { locked: taskCConfig.locked },
                _index: 2,
                _bar: { x: 320, y: 170, width: 120, height: 30 },
            },
            {
                id: 'task-d',
                name: taskDConfig.name,
                progress: taskDConfig.progress,
                color: taskDConfig.color,
                color_progress: taskDConfig.color_progress,
                constraints: { locked: taskDConfig.locked },
                _index: 3,
                _bar: { x: 440, y: 220, width: 120, height: 30 },
            },
        ];
        taskStore.updateTasks(tasks);
    };

    onMount(() => {
        initializeTasks();
    });

    // Update Task A when config changes
    const updateTaskA = () => {
        const taskA = taskStore.getTask('task-a');
        if (taskA) {
            taskStore.updateTask('task-a', {
                ...taskA,
                name: taskConfig.name,
                progress: taskConfig.progress,
                color: taskConfig.color,
                color_progress: taskConfig.color_progress,
                constraints: { locked: taskConfig.locked },
                invalid: taskConfig.invalid,
            });
        }
    };

    // Update Task B when config changes
    const updateTaskB = () => {
        const taskB = taskStore.getTask('task-b');
        if (taskB) {
            taskStore.updateTask('task-b', {
                ...taskB,
                name: taskBConfig.name,
                progress: taskBConfig.progress,
                color: taskBConfig.color,
                color_progress: taskBConfig.color_progress,
                constraints: { locked: taskBConfig.locked },
            });
        }
    };

    // Relationships based on constraint config using new dependency type API
    // Chain: A → B → C → D
    const relationships = createMemo(() => {
        const type = constraintConfig.type || 'FS';
        const lag = constraintConfig.lag || 0;
        const elastic = constraintConfig.elastic !== false;

        return [
            { from: 'task-a', to: 'task-b', type, lag, elastic },
            { from: 'task-b', to: 'task-c', type, lag, elastic },
            { from: 'task-c', to: 'task-d', type, lag, elastic },
        ];
    });

    // Pre-build relationship index for O(1) lookups
    const relationshipIndex = createMemo(() => buildRelationshipIndex(relationships()));

    // Task positions for each constraint type to demonstrate behavior
    const PRESET_POSITIONS = {
        // FS: Tasks chained end-to-start (B starts where A ends)
        default: {
            'task-a': { x: 80, y: 70, width: 120 },
            'task-b': { x: 200, y: 120, width: 120 },
            'task-c': { x: 320, y: 170, width: 120 },
            'task-d': { x: 440, y: 220, width: 120 },
        },
        colorful: {
            'task-a': { x: 80, y: 70, width: 120 },
            'task-b': { x: 200, y: 120, width: 120 },
            'task-c': { x: 320, y: 170, width: 120 },
            'task-d': { x: 440, y: 220, width: 120 },
        },
        minimal: {
            'task-a': { x: 80, y: 70, width: 120 },
            'task-b': { x: 200, y: 120, width: 120 },
            'task-c': { x: 320, y: 170, width: 120 },
            'task-d': { x: 440, y: 220, width: 120 },
        },
        constrained: {
            'task-a': { x: 80, y: 70, width: 120 },
            'task-b': { x: 220, y: 120, width: 120 },
            'task-c': { x: 360, y: 170, width: 120 },
            'task-d': { x: 500, y: 220, width: 120 },
        },
        locked: {
            'task-a': { x: 80, y: 70, width: 120 },
            'task-b': { x: 200, y: 120, width: 120 },
            'task-c': { x: 320, y: 170, width: 120 },
            'task-d': { x: 440, y: 220, width: 120 },
        },
        fixedOffset: {
            'task-a': { x: 80, y: 70, width: 120 },
            'task-b': { x: 280, y: 120, width: 120 },
            'task-c': { x: 480, y: 170, width: 120 },
            'task-d': { x: 680, y: 220, width: 120 },
        },
        // SS: Tasks start at same position (parallel work)
        startToStart: {
            'task-a': { x: 80, y: 70, width: 150 },
            'task-b': { x: 80, y: 120, width: 120 },
            'task-c': { x: 80, y: 170, width: 100 },
            'task-d': { x: 80, y: 220, width: 80 },
        },
        // FF: Tasks end at same position (synchronized finish)
        finishToFinish: {
            'task-a': { x: 80, y: 70, width: 150 },
            'task-b': { x: 110, y: 120, width: 120 },
            'task-c': { x: 150, y: 170, width: 80 },
            'task-d': { x: 180, y: 220, width: 50 },
        },
    };

    // Apply preset
    const applyPreset = (presetKey) => {
        const preset = PRESETS[presetKey];
        const positions =
            PRESET_POSITIONS[presetKey] || PRESET_POSITIONS.default;

        // Batch all store updates to prevent timing issues
        batch(() => {
            setTaskConfig(preset.taskConfig);
            setArrowConfig(preset.arrowConfig);
            setConstraintConfig(preset.constraintConfig);
            setGlobalConfig(preset.globalConfig);
            setActivePreset(presetKey);
            // Reset task configs to defaults
            setTaskBConfig({
                name: 'Task B',
                color: '#27ae60',
                color_progress: '#2ecc71',
                progress: 50,
                locked: false,
            });
            setTaskCConfig({
                name: 'Task C',
                color: '#3498db',
                color_progress: '#2980b9',
                progress: 50,
                locked: false,
            });
            setTaskDConfig({
                name: 'Task D',
                color: '#9b59b6',
                color_progress: '#8e44ad',
                progress: 50,
                locked: false,
            });
        });

        // Reset task positions based on preset
        taskStore.updateBarPosition('task-a', {
            ...positions['task-a'],
            y: 70,
            height: 30,
        });
        taskStore.updateBarPosition('task-b', {
            ...positions['task-b'],
            y: 120,
            height: 30,
        });
        taskStore.updateBarPosition('task-c', {
            ...positions['task-c'],
            y: 170,
            height: 30,
        });
        taskStore.updateBarPosition('task-d', {
            ...positions['task-d'],
            y: 220,
            height: 30,
        });

        // Directly update task A with preset values
        const taskA = taskStore.getTask('task-a');
        if (taskA) {
            taskStore.updateTask('task-a', {
                ...taskA,
                name: preset.taskConfig.name,
                progress: preset.taskConfig.progress,
                color: preset.taskConfig.color,
                color_progress: preset.taskConfig.color_progress,
                constraints: { locked: preset.taskConfig.locked },
                invalid: preset.taskConfig.invalid,
            });
        }

        // Reset Tasks B, C, D in store
        const taskB = taskStore.getTask('task-b');
        if (taskB) {
            taskStore.updateTask('task-b', {
                ...taskB,
                name: 'Task B',
                progress: 50,
                color: '#27ae60',
                color_progress: '#2ecc71',
                constraints: { locked: false },
            });
        }
        const taskC = taskStore.getTask('task-c');
        if (taskC) {
            taskStore.updateTask('task-c', {
                ...taskC,
                name: 'Task C',
                progress: 50,
                color: '#3498db',
                color_progress: '#2980b9',
                constraints: { locked: false },
            });
        }
        const taskD = taskStore.getTask('task-d');
        if (taskD) {
            taskStore.updateTask('task-d', {
                ...taskD,
                name: 'Task D',
                progress: 50,
                color: '#9b59b6',
                color_progress: '#8e44ad',
                constraints: { locked: false },
            });
        }
    };

    // Constraint callback for Bar components - uses the constraint engine
    const handleConstrainPosition = (taskId, newX, newY) => {
        const taskBar = taskStore.getBarPosition(taskId);
        const width = taskBar?.width ?? 100;

        // Build context for constraint engine
        const context = {
            getBarPosition: taskStore.getBarPosition.bind(taskStore),
            getTask: taskStore.getTask.bind(taskStore),
            relationships: relationships(),
            relationshipIndex: relationshipIndex(),
            pixelsPerHour: 1, // Using 1:1 pixel mapping
        };

        const result = resolveConstraints(taskId, newX, width, context);

        if (result.blocked) {
            return null;
        }

        // Apply cascade updates to successors
        if (result.cascadeUpdates) {
            for (const [succId, update] of result.cascadeUpdates) {
                taskStore.updateBarPosition(succId, update);
            }
        }

        return { x: result.constrainedX, y: newY };
    };

    // Handle resize end - trigger constraint resolution after duration change
    const handleResizeEnd = (taskId) => {
        const taskBar = taskStore.getBarPosition(taskId);
        if (taskBar) {
            const context = {
                getBarPosition: taskStore.getBarPosition.bind(taskStore),
                getTask: taskStore.getTask.bind(taskStore),
                relationships: relationships(),
                relationshipIndex: relationshipIndex(),
                pixelsPerHour: 1,
            };
            const result = resolveConstraints(taskId, taskBar.x, taskBar.width, context);
            if (result.cascadeUpdates) {
                for (const [succId, update] of result.cascadeUpdates) {
                    taskStore.updateBarPosition(succId, update);
                }
            }
        }
    };

    // Handle task hover (show popup)
    const handleTaskHover = (taskId, x, y) => {
        setHoveredTaskId(taskId);
        setPopupPosition({ x, y });
        setPopupVisible(true);
    };

    // Handle task hover end (hide popup)
    const handleTaskHoverEnd = () => {
        setPopupVisible(false);
        setHoveredTaskId(null);
    };

    // Handle task click (show modal)
    const handleTaskClick = (taskId) => {
        setModalTaskId(taskId);
        setModalVisible(true);
        setPopupVisible(false); // Hide popup when modal opens
    };

    // Handle modal close
    const handleModalClose = () => {
        setModalVisible(false);
        setModalTaskId(null);
    };

    // Get positions for arrows
    const getTaskAPos = () =>
        taskStore.getBarPosition('task-a') || {
            x: 80,
            y: 70,
            width: 120,
            height: 30,
        };
    const getTaskBPos = () =>
        taskStore.getBarPosition('task-b') || {
            x: 200,
            y: 120,
            width: 120,
            height: 30,
        };
    const getTaskCPos = () =>
        taskStore.getBarPosition('task-c') || {
            x: 320,
            y: 170,
            width: 120,
            height: 30,
        };
    const getTaskDPos = () =>
        taskStore.getBarPosition('task-d') || {
            x: 440,
            y: 220,
            width: 120,
            height: 30,
        };

    // Info text based on constraints
    const getInfoText = () => {
        const parts = [];
        const type = constraintConfig.type || 'FS';
        const lag = constraintConfig.lag || 0;
        const elastic = constraintConfig.elastic !== false;

        // Dependency type description with constraint edge explanation
        const typeDescriptions = {
            FS: 'Finish-to-Start: Each successor starts after predecessor finishes (B.start >= A.end)',
            SS: 'Start-to-Start: Each successor starts when predecessor starts (B.start >= A.start)',
            FF: 'Finish-to-Finish: Each successor finishes when predecessor finishes (B.end >= A.end)',
            SF: 'Start-to-Finish: Each successor finishes when predecessor starts (B.end >= A.start)',
        };
        parts.push(`${type} - ${typeDescriptions[type]}.`);

        // Chain description
        parts.push('Chain: A→B→C→D. Drag A right to push the whole chain.');

        // Lag description
        if (lag !== 0) {
            if (lag > 0) {
                parts.push(`Lag: +${lag}px delay between tasks.`);
            } else {
                parts.push(`Lead: ${lag}px overlap allowed.`);
            }
        }

        // Elastic vs fixed
        if (elastic) {
            parts.push(
                'Elastic: Lag is a minimum distance. Tasks can be further apart.',
            );
        } else {
            parts.push(
                'Fixed: Exact distance maintained. All linked tasks move together.',
            );
        }

        // Locked tasks
        if (taskConfig.locked) {
            parts.push('Task A Locked: Cannot be moved.');
        }
        if (taskBConfig.locked) {
            parts.push('Task B Locked: Cannot be moved.');
        }

        return parts.join(' ');
    };

    return (
        <div style={styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <h1 style={styles.title}>Props Showcase</h1>
                <p style={styles.subtitle}>
                    Interactive demonstration of all task and connector
                    configuration options
                </p>
            </div>

            {/* Preset Buttons */}
            <div style={styles.presetBar}>
                <For each={Object.entries(PRESETS)}>
                    {([key, preset]) => (
                        <button
                            style={{
                                ...styles.presetButton,
                                ...(activePreset() === key
                                    ? styles.presetButtonActive
                                    : {}),
                            }}
                            onClick={() => applyPreset(key)}
                        >
                            {preset.name}
                        </button>
                    )}
                </For>
            </div>

            {/* Configuration Panels */}
            <div style={styles.configRow}>
                {/* Task Configuration */}
                <div style={styles.panel}>
                    <h3 style={styles.panelTitle}>Task Configuration</h3>

                    <fieldset style={styles.fieldset}>
                        <legend style={styles.legend}>Visual</legend>

                        <div style={styles.control}>
                            <span style={styles.label}>Name:</span>
                            <input
                                type="text"
                                value={taskConfig.name}
                                onInput={(e) => {
                                    setTaskConfig('name', e.target.value);
                                    updateTaskA();
                                }}
                                style={styles.textInput}
                            />
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Color:</span>
                            <input
                                type="color"
                                value={taskConfig.color}
                                onInput={(e) => {
                                    setTaskConfig('color', e.target.value);
                                    updateTaskA();
                                }}
                                style={styles.colorInput}
                            />
                            <span
                                style={{ color: '#888', 'font-size': '11px' }}
                            >
                                {taskConfig.color}
                            </span>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Progress Color:</span>
                            <input
                                type="color"
                                value={taskConfig.color_progress}
                                onInput={(e) => {
                                    setTaskConfig(
                                        'color_progress',
                                        e.target.value,
                                    );
                                    updateTaskA();
                                }}
                                style={styles.colorInput}
                            />
                            <span
                                style={{ color: '#888', 'font-size': '11px' }}
                            >
                                {taskConfig.color_progress}
                            </span>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Progress:</span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={taskConfig.progress}
                                onInput={(e) => {
                                    setTaskConfig(
                                        'progress',
                                        parseInt(e.target.value),
                                    );
                                    updateTaskA();
                                }}
                                style={styles.slider}
                            />
                            <span style={styles.sliderValue}>
                                {taskConfig.progress}%
                            </span>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Corner Radius:</span>
                            <input
                                type="range"
                                min="0"
                                max="15"
                                value={taskConfig.cornerRadius}
                                onInput={(e) =>
                                    setTaskConfig(
                                        'cornerRadius',
                                        parseInt(e.target.value),
                                    )
                                }
                                style={styles.slider}
                            />
                            <span style={styles.sliderValue}>
                                {taskConfig.cornerRadius}px
                            </span>
                        </div>
                    </fieldset>

                    <fieldset style={styles.fieldset}>
                        <legend style={styles.legend}>State</legend>

                        <div style={styles.control}>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={taskConfig.locked}
                                    onChange={(e) => {
                                        setTaskConfig(
                                            'locked',
                                            e.target.checked,
                                        );
                                        updateTaskA();
                                    }}
                                    style={styles.checkbox}
                                />
                                <span>Locked</span>
                            </label>
                        </div>

                        <div style={styles.control}>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={taskConfig.invalid}
                                    onChange={(e) => {
                                        setTaskConfig(
                                            'invalid',
                                            e.target.checked,
                                        );
                                        updateTaskA();
                                    }}
                                    style={styles.checkbox}
                                />
                                <span>Invalid</span>
                            </label>
                        </div>
                    </fieldset>

                    <fieldset style={styles.fieldset}>
                        <legend style={styles.legend}>Interactions</legend>

                        <div style={styles.control}>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={globalConfig.readonly}
                                    onChange={(e) =>
                                        setGlobalConfig(
                                            'readonly',
                                            e.target.checked,
                                        )
                                    }
                                    style={styles.checkbox}
                                />
                                <span>Readonly (all)</span>
                            </label>
                        </div>

                        <div style={styles.control}>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={globalConfig.readonlyDates}
                                    onChange={(e) =>
                                        setGlobalConfig(
                                            'readonlyDates',
                                            e.target.checked,
                                        )
                                    }
                                    style={styles.checkbox}
                                />
                                <span>Readonly Dates</span>
                            </label>
                        </div>

                        <div style={styles.control}>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={globalConfig.readonlyProgress}
                                    onChange={(e) =>
                                        setGlobalConfig(
                                            'readonlyProgress',
                                            e.target.checked,
                                        )
                                    }
                                    style={styles.checkbox}
                                />
                                <span>Readonly Progress</span>
                            </label>
                        </div>

                        <div style={styles.control}>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={globalConfig.showExpectedProgress}
                                    onChange={(e) =>
                                        setGlobalConfig(
                                            'showExpectedProgress',
                                            e.target.checked,
                                        )
                                    }
                                    style={styles.checkbox}
                                />
                                <span>Show Expected Progress</span>
                            </label>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Grid Snap:</span>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '4px',
                                    cursor: 'pointer',
                                    'min-width': '60px',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={globalConfig.snapToGrid}
                                    onChange={(e) =>
                                        setGlobalConfig(
                                            'snapToGrid',
                                            e.target.checked,
                                        )
                                    }
                                    style={styles.checkbox}
                                />
                                <span style={{ 'font-size': '11px' }}>
                                    Enable
                                </span>
                            </label>
                            <input
                                type="range"
                                min="1"
                                max="90"
                                step="1"
                                value={globalConfig.columnWidth}
                                disabled={!globalConfig.snapToGrid}
                                onInput={(e) =>
                                    setGlobalConfig(
                                        'columnWidth',
                                        parseInt(e.target.value),
                                    )
                                }
                                style={{
                                    ...styles.slider,
                                    opacity: globalConfig.snapToGrid ? 1 : 0.5,
                                }}
                            />
                            <span style={styles.sliderValue}>
                                {globalConfig.snapToGrid
                                    ? `${globalConfig.columnWidth}px`
                                    : 'off'}
                            </span>
                        </div>
                    </fieldset>
                </div>

                {/* Arrow Configuration */}
                <div style={styles.panel}>
                    <h3 style={styles.panelTitle}>Connector Configuration</h3>

                    <fieldset style={styles.fieldset}>
                        <legend style={styles.legend}>Anchoring</legend>

                        <div style={styles.control}>
                            <span style={styles.label}>Start Anchor:</span>
                            <select
                                value={arrowConfig.startAnchor}
                                onChange={(e) =>
                                    setArrowConfig(
                                        'startAnchor',
                                        e.target.value,
                                    )
                                }
                                style={styles.select}
                            >
                                <option value="auto">Auto</option>
                                <option value="top">Top</option>
                                <option value="bottom">Bottom</option>
                                <option value="left">Left</option>
                                <option value="right">Right</option>
                                <option value="center">Center</option>
                            </select>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>End Anchor:</span>
                            <select
                                value={arrowConfig.endAnchor}
                                onChange={(e) =>
                                    setArrowConfig('endAnchor', e.target.value)
                                }
                                style={styles.select}
                            >
                                <option value="auto">Auto</option>
                                <option value="left">Left</option>
                                <option value="top">Top</option>
                                <option value="bottom">Bottom</option>
                                <option value="right">Right</option>
                                <option value="center">Center</option>
                            </select>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Start Offset:</span>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '4px',
                                    cursor: 'pointer',
                                    'min-width': '50px',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={arrowConfig.startOffset === null}
                                    onChange={() =>
                                        setArrowConfig(
                                            'startOffset',
                                            arrowConfig.startOffset === null
                                                ? 0.5
                                                : null,
                                        )
                                    }
                                    style={styles.checkbox}
                                />
                                <span style={{ 'font-size': '11px' }}>
                                    Auto
                                </span>
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={arrowConfig.startOffset ?? 0.9}
                                disabled={arrowConfig.startOffset === null}
                                onInput={(e) =>
                                    setArrowConfig(
                                        'startOffset',
                                        parseFloat(e.target.value),
                                    )
                                }
                                style={{
                                    ...styles.slider,
                                    opacity:
                                        arrowConfig.startOffset === null
                                            ? 0.5
                                            : 1,
                                }}
                            />
                            <span style={styles.sliderValue}>
                                {arrowConfig.startOffset === null
                                    ? 'auto'
                                    : arrowConfig.startOffset.toFixed(2)}
                            </span>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>End Offset:</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={arrowConfig.endOffset}
                                onInput={(e) =>
                                    setArrowConfig(
                                        'endOffset',
                                        parseFloat(e.target.value),
                                    )
                                }
                                style={styles.slider}
                            />
                            <span style={styles.sliderValue}>
                                {arrowConfig.endOffset.toFixed(2)}
                            </span>
                        </div>
                    </fieldset>

                    <fieldset style={styles.fieldset}>
                        <legend style={styles.legend}>Path Shape</legend>

                        <div style={styles.control}>
                            <span style={styles.label}>Routing:</span>
                            <select
                                value={arrowConfig.routing}
                                onChange={(e) =>
                                    setArrowConfig('routing', e.target.value)
                                }
                                style={styles.select}
                            >
                                <option value="orthogonal">Orthogonal</option>
                                <option value="straight">Straight</option>
                            </select>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Curve Radius:</span>
                            <input
                                type="range"
                                min="0"
                                max="30"
                                value={arrowConfig.curveRadius}
                                onInput={(e) =>
                                    setArrowConfig(
                                        'curveRadius',
                                        parseInt(e.target.value),
                                    )
                                }
                                style={styles.slider}
                            />
                            <span style={styles.sliderValue}>
                                {arrowConfig.curveRadius}px
                            </span>
                        </div>
                    </fieldset>

                    <fieldset style={styles.fieldset}>
                        <legend style={styles.legend}>Line Style</legend>

                        <div style={styles.control}>
                            <span style={styles.label}>Color:</span>
                            <input
                                type="color"
                                value={arrowConfig.stroke}
                                onInput={(e) =>
                                    setArrowConfig('stroke', e.target.value)
                                }
                                style={styles.colorInput}
                            />
                            <span
                                style={{ color: '#888', 'font-size': '11px' }}
                            >
                                {arrowConfig.stroke}
                            </span>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Width:</span>
                            <input
                                type="range"
                                min="0.5"
                                max="6"
                                step="0.5"
                                value={arrowConfig.strokeWidth}
                                onInput={(e) =>
                                    setArrowConfig(
                                        'strokeWidth',
                                        parseFloat(e.target.value),
                                    )
                                }
                                style={styles.slider}
                            />
                            <span style={styles.sliderValue}>
                                {arrowConfig.strokeWidth}px
                            </span>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Opacity:</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={arrowConfig.strokeOpacity}
                                onInput={(e) =>
                                    setArrowConfig(
                                        'strokeOpacity',
                                        parseFloat(e.target.value),
                                    )
                                }
                                style={styles.slider}
                            />
                            <span style={styles.sliderValue}>
                                {arrowConfig.strokeOpacity.toFixed(1)}
                            </span>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Dash Pattern:</span>
                            <select
                                value={arrowConfig.strokeDasharray}
                                onChange={(e) =>
                                    setArrowConfig(
                                        'strokeDasharray',
                                        e.target.value,
                                    )
                                }
                                style={styles.select}
                            >
                                <option value="">Solid</option>
                                <option value="8,4">Dashed (8,4)</option>
                                <option value="4,4">Dashed (4,4)</option>
                                <option value="2,4">Dotted (2,4)</option>
                                <option value="12,4,4,4">Dash-Dot</option>
                            </select>
                        </div>
                    </fieldset>

                    <fieldset style={styles.fieldset}>
                        <legend style={styles.legend}>Arrow Head</legend>

                        <div style={styles.control}>
                            <span style={styles.label}>Shape:</span>
                            <select
                                value={arrowConfig.headShape}
                                onChange={(e) =>
                                    setArrowConfig('headShape', e.target.value)
                                }
                                style={styles.select}
                            >
                                <option value="chevron">Chevron</option>
                                <option value="triangle">Triangle</option>
                                <option value="diamond">Diamond</option>
                                <option value="circle">Circle</option>
                                <option value="none">None</option>
                            </select>
                        </div>

                        <div style={styles.control}>
                            <span style={styles.label}>Size:</span>
                            <input
                                type="range"
                                min="0"
                                max="15"
                                value={arrowConfig.headSize}
                                onInput={(e) =>
                                    setArrowConfig(
                                        'headSize',
                                        parseInt(e.target.value),
                                    )
                                }
                                style={styles.slider}
                            />
                            <span style={styles.sliderValue}>
                                {arrowConfig.headSize}px
                            </span>
                        </div>

                        <div style={styles.control}>
                            <label
                                style={{
                                    display: 'flex',
                                    'align-items': 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={arrowConfig.headFill}
                                    onChange={(e) =>
                                        setArrowConfig(
                                            'headFill',
                                            e.target.checked,
                                        )
                                    }
                                    style={styles.checkbox}
                                />
                                <span>Fill Head</span>
                            </label>
                        </div>
                    </fieldset>
                </div>
            </div>

            {/* Relationship Constraints */}
            <div style={styles.constraintSection}>
                <h3 style={styles.constraintTitle}>Dependency Constraint</h3>
                <div style={styles.constraintRow}>
                    <div style={styles.constraintControl}>
                        <span style={{ 'min-width': '40px' }}>Type:</span>
                        <select
                            value={constraintConfig.type || 'FS'}
                            onChange={(e) =>
                                setConstraintConfig('type', e.target.value)
                            }
                            style={styles.select}
                        >
                            <option value="FS">FS (Finish-to-Start)</option>
                            <option value="SS">SS (Start-to-Start)</option>
                            <option value="FF">FF (Finish-to-Finish)</option>
                            <option value="SF">SF (Start-to-Finish)</option>
                        </select>
                    </div>

                    <div style={styles.constraintControl}>
                        <span style={{ 'min-width': '30px' }}>Lag:</span>
                        <input
                            type="number"
                            min="-200"
                            max="200"
                            value={constraintConfig.lag ?? 0}
                            onInput={(e) =>
                                setConstraintConfig(
                                    'lag',
                                    e.target.value
                                        ? parseInt(e.target.value)
                                        : 0,
                                )
                            }
                            style={styles.numberInput}
                        />
                        <span style={{ color: '#666', 'font-size': '11px' }}>
                            px (negative = lead)
                        </span>
                    </div>

                    <div style={styles.constraintControl}>
                        <label
                            style={{
                                display: 'flex',
                                'align-items': 'center',
                                gap: '6px',
                                cursor: 'pointer',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={constraintConfig.elastic !== false}
                                onChange={(e) =>
                                    setConstraintConfig(
                                        'elastic',
                                        e.target.checked,
                                    )
                                }
                                style={styles.checkbox}
                            />
                            <span>Elastic (lag is minimum)</span>
                        </label>
                    </div>

                    <div
                        style={{
                            ...styles.constraintControl,
                            'border-left': '1px solid #ffc107',
                            'padding-left': '12px',
                        }}
                    >
                        <label
                            style={{
                                display: 'flex',
                                'align-items': 'center',
                                gap: '6px',
                                cursor: 'pointer',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={taskBConfig.locked}
                                onChange={(e) => {
                                    setTaskBConfig('locked', e.target.checked);
                                    updateTaskB();
                                }}
                                style={styles.checkbox}
                            />
                            <span>Task B Locked</span>
                        </label>
                    </div>
                </div>
            </div>

            {/* Live Preview */}
            <div style={styles.svgContainer}>
                <svg
                    width="100%"
                    height="300"
                    viewBox="0 0 900 300"
                    style={{ display: 'block' }}
                >
                    {/* Grid pattern */}
                    <defs>
                        <pattern
                            id="showcase-grid"
                            width="45"
                            height="45"
                            patternUnits="userSpaceOnUse"
                        >
                            <path
                                d="M 45 0 L 0 0 0 45"
                                fill="none"
                                stroke="#f0f0f0"
                                stroke-width="0.5"
                            />
                        </pattern>
                    </defs>
                    <rect
                        width="100%"
                        height="100%"
                        fill="url(#showcase-grid)"
                    />

                    {/* Header area */}
                    <rect x="0" y="0" width="800" height="50" fill="#f8f9fa" />
                    <text
                        x="400"
                        y="30"
                        text-anchor="middle"
                        font-size="12"
                        fill="#666"
                    >
                        Drag tasks to test interactions and constraints
                    </text>

                    {/* Arrow A→B */}
                    <Arrow
                        from={getTaskAPos()}
                        to={getTaskBPos()}
                        dependencyType={constraintConfig.type || 'FS'}
                        startAnchor={arrowConfig.startAnchor}
                        endAnchor={arrowConfig.endAnchor}
                        startOffset={arrowConfig.startOffset ?? undefined}
                        endOffset={arrowConfig.endOffset}
                        routing={arrowConfig.routing}
                        curveRadius={arrowConfig.curveRadius}
                        stroke={arrowConfig.stroke}
                        strokeWidth={arrowConfig.strokeWidth}
                        strokeOpacity={arrowConfig.strokeOpacity}
                        strokeDasharray={arrowConfig.strokeDasharray}
                        strokeLinecap={arrowConfig.strokeLinecap}
                        strokeLinejoin={arrowConfig.strokeLinejoin}
                        headShape={arrowConfig.headShape}
                        headSize={arrowConfig.headSize}
                        headFill={arrowConfig.headFill}
                    />

                    {/* Arrow B→C */}
                    <Arrow
                        from={getTaskBPos()}
                        to={getTaskCPos()}
                        dependencyType={constraintConfig.type || 'FS'}
                        startAnchor={arrowConfig.startAnchor}
                        endAnchor={arrowConfig.endAnchor}
                        startOffset={arrowConfig.startOffset ?? undefined}
                        endOffset={arrowConfig.endOffset}
                        routing={arrowConfig.routing}
                        curveRadius={arrowConfig.curveRadius}
                        stroke={arrowConfig.stroke}
                        strokeWidth={arrowConfig.strokeWidth}
                        strokeOpacity={arrowConfig.strokeOpacity}
                        strokeDasharray={arrowConfig.strokeDasharray}
                        strokeLinecap={arrowConfig.strokeLinecap}
                        strokeLinejoin={arrowConfig.strokeLinejoin}
                        headShape={arrowConfig.headShape}
                        headSize={arrowConfig.headSize}
                        headFill={arrowConfig.headFill}
                    />

                    {/* Arrow C→D */}
                    <Arrow
                        from={getTaskCPos()}
                        to={getTaskDPos()}
                        dependencyType={constraintConfig.type || 'FS'}
                        startAnchor={arrowConfig.startAnchor}
                        endAnchor={arrowConfig.endAnchor}
                        startOffset={arrowConfig.startOffset ?? undefined}
                        endOffset={arrowConfig.endOffset}
                        routing={arrowConfig.routing}
                        curveRadius={arrowConfig.curveRadius}
                        stroke={arrowConfig.stroke}
                        strokeWidth={arrowConfig.strokeWidth}
                        strokeOpacity={arrowConfig.strokeOpacity}
                        strokeDasharray={arrowConfig.strokeDasharray}
                        strokeLinecap={arrowConfig.strokeLinecap}
                        strokeLinejoin={arrowConfig.strokeLinejoin}
                        headShape={arrowConfig.headShape}
                        headSize={arrowConfig.headSize}
                        headFill={arrowConfig.headFill}
                    />

                    {/* Task A */}
                    <Bar
                        task={{
                            id: 'task-a',
                            name: taskConfig.name,
                            progress: taskConfig.progress,
                            color: taskConfig.color,
                            color_progress: taskConfig.color_progress,
                            constraints: { locked: taskConfig.locked },
                            invalid: taskConfig.invalid,
                        }}
                        taskStore={taskStore}
                        cornerRadius={taskConfig.cornerRadius}
                        readonly={globalConfig.readonly}
                        readonlyDates={globalConfig.readonlyDates}
                        readonlyProgress={globalConfig.readonlyProgress}
                        showExpectedProgress={globalConfig.showExpectedProgress}
                        columnWidth={
                            globalConfig.snapToGrid
                                ? globalConfig.columnWidth
                                : 1
                        }
                        onConstrainPosition={handleConstrainPosition}
                        onResizeEnd={handleResizeEnd}
                        onHover={handleTaskHover}
                        onHoverEnd={handleTaskHoverEnd}
                        onTaskClick={handleTaskClick}
                    />

                    {/* Task B */}
                    <Bar
                        task={{
                            id: 'task-b',
                            name: taskBConfig.name,
                            progress: taskBConfig.progress,
                            color: taskBConfig.color,
                            color_progress: taskBConfig.color_progress,
                            constraints: { locked: taskBConfig.locked },
                        }}
                        taskStore={taskStore}
                        cornerRadius={3}
                        readonly={globalConfig.readonly}
                        readonlyDates={globalConfig.readonlyDates}
                        readonlyProgress={globalConfig.readonlyProgress}
                        columnWidth={
                            globalConfig.snapToGrid
                                ? globalConfig.columnWidth
                                : 1
                        }
                        onConstrainPosition={handleConstrainPosition}
                        onResizeEnd={handleResizeEnd}
                        onHover={handleTaskHover}
                        onHoverEnd={handleTaskHoverEnd}
                        onTaskClick={handleTaskClick}
                    />

                    {/* Task C */}
                    <Bar
                        task={{
                            id: 'task-c',
                            name: taskCConfig.name,
                            progress: taskCConfig.progress,
                            color: taskCConfig.color,
                            color_progress: taskCConfig.color_progress,
                            constraints: { locked: taskCConfig.locked },
                        }}
                        taskStore={taskStore}
                        cornerRadius={3}
                        readonly={globalConfig.readonly}
                        readonlyDates={globalConfig.readonlyDates}
                        readonlyProgress={globalConfig.readonlyProgress}
                        columnWidth={
                            globalConfig.snapToGrid
                                ? globalConfig.columnWidth
                                : 1
                        }
                        onConstrainPosition={handleConstrainPosition}
                        onResizeEnd={handleResizeEnd}
                        onHover={handleTaskHover}
                        onHoverEnd={handleTaskHoverEnd}
                        onTaskClick={handleTaskClick}
                    />

                    {/* Task D */}
                    <Bar
                        task={{
                            id: 'task-d',
                            name: taskDConfig.name,
                            progress: taskDConfig.progress,
                            color: taskDConfig.color,
                            color_progress: taskDConfig.color_progress,
                            constraints: { locked: taskDConfig.locked },
                        }}
                        taskStore={taskStore}
                        cornerRadius={3}
                        readonly={globalConfig.readonly}
                        readonlyDates={globalConfig.readonlyDates}
                        readonlyProgress={globalConfig.readonlyProgress}
                        columnWidth={
                            globalConfig.snapToGrid
                                ? globalConfig.columnWidth
                                : 1
                        }
                        onConstrainPosition={handleConstrainPosition}
                        onResizeEnd={handleResizeEnd}
                        onHover={handleTaskHover}
                        onHoverEnd={handleTaskHoverEnd}
                        onTaskClick={handleTaskClick}
                    />
                </svg>
            </div>

            {/* Info Box */}
            <div style={styles.infoBox}>
                <h4 style={styles.infoTitle}>Current Behavior</h4>
                <p style={styles.infoText}>{getInfoText()}</p>
            </div>

            {/* Task Data Popup (hover) */}
            <TaskDataPopup
                visible={popupVisible}
                position={popupPosition}
                task={hoveredTask}
                barPosition={hoveredBarPosition}
            />

            {/* Task Data Modal (click) */}
            <TaskDataModal
                visible={modalVisible}
                task={modalTask}
                barPosition={modalBarPosition}
                relationships={relationships}
                onClose={handleModalClose}
            />
        </div>
    );
}
