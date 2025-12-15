import { createSignal } from 'solid-js';

/**
 * Reactive store for Gantt configuration.
 * Holds all configuration needed for bar positioning and rendering.
 */
export function createGanttConfigStore(options = {}) {
    // Time configuration
    const [ganttStart, setGanttStart] = createSignal(options.ganttStart || new Date());
    const [ganttEnd, setGanttEnd] = createSignal(options.ganttEnd || new Date());
    const [unit, setUnit] = createSignal(options.unit || 'day');
    const [step, setStep] = createSignal(options.step || 1);

    // Layout configuration - support both snake_case and camelCase
    const [columnWidth, setColumnWidth] = createSignal(options.columnWidth || options.column_width || 45);
    const [barHeight, setBarHeight] = createSignal(options.barHeight || options.bar_height || 30);
    const [headerHeight, setHeaderHeight] = createSignal(options.headerHeight || 75);
    const [padding, setPadding] = createSignal(options.padding || 18);
    const [barCornerRadius, setBarCornerRadius] = createSignal(options.barCornerRadius || options.bar_corner_radius || 3);

    // Feature flags
    const [readonly, setReadonly] = createSignal(options.readonly || false);
    const [readonlyDates, setReadonlyDates] = createSignal(options.readonlyDates || false);
    const [readonlyProgress, setReadonlyProgress] = createSignal(options.readonlyProgress || false);
    const [showExpectedProgress, setShowExpectedProgress] = createSignal(options.showExpectedProgress || false);
    const [autoMoveLabel, setAutoMoveLabel] = createSignal(options.autoMoveLabel || false);

    // Ignored dates (weekends, holidays)
    const [ignoredDates, setIgnoredDates] = createSignal(options.ignoredDates || []);
    const [ignoredFunction, setIgnoredFunction] = createSignal(options.ignoredFunction || null);

    // Computed ignored positions (pixel X values)
    const [ignoredPositions, setIgnoredPositions] = createSignal([]);

    // Subtask configuration
    const [subtaskHeightRatio, setSubtaskHeightRatio] = createSignal(
        options.subtaskHeightRatio || 0.5
    );

    // Expanded tasks (for variable row heights)
    const [expandedTasks, setExpandedTasks] = createSignal(
        new Set(options.expandedTasks || [])
    );

    // Expansion management methods
    const isTaskExpanded = (taskId) => expandedTasks().has(taskId);

    const toggleTaskExpansion = (taskId) => {
        setExpandedTasks((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            return next;
        });
    };

    const expandTask = (taskId) => {
        setExpandedTasks((prev) => {
            if (prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.add(taskId);
            return next;
        });
    };

    const collapseTask = (taskId) => {
        setExpandedTasks((prev) => {
            if (!prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.delete(taskId);
            return next;
        });
    };

    const expandAllTasks = (taskIds) => {
        setExpandedTasks(new Set(taskIds));
    };

    const collapseAllTasks = () => {
        setExpandedTasks(new Set());
    };

    // Update all options at once
    const updateOptions = (newOptions) => {
        if (newOptions.ganttStart !== undefined) setGanttStart(newOptions.ganttStart);
        if (newOptions.ganttEnd !== undefined) setGanttEnd(newOptions.ganttEnd);
        if (newOptions.unit !== undefined) setUnit(newOptions.unit);
        if (newOptions.step !== undefined) setStep(newOptions.step);
        if (newOptions.columnWidth !== undefined) setColumnWidth(newOptions.columnWidth);
        if (newOptions.barHeight !== undefined) setBarHeight(newOptions.barHeight);
        if (newOptions.headerHeight !== undefined) setHeaderHeight(newOptions.headerHeight);
        if (newOptions.padding !== undefined) setPadding(newOptions.padding);
        if (newOptions.barCornerRadius !== undefined) setBarCornerRadius(newOptions.barCornerRadius);
        if (newOptions.readonly !== undefined) setReadonly(newOptions.readonly);
        if (newOptions.readonlyDates !== undefined) setReadonlyDates(newOptions.readonlyDates);
        if (newOptions.readonlyProgress !== undefined) setReadonlyProgress(newOptions.readonlyProgress);
        if (newOptions.showExpectedProgress !== undefined) setShowExpectedProgress(newOptions.showExpectedProgress);
        if (newOptions.autoMoveLabel !== undefined) setAutoMoveLabel(newOptions.autoMoveLabel);
        if (newOptions.ignoredDates !== undefined) setIgnoredDates(newOptions.ignoredDates);
        if (newOptions.ignoredFunction !== undefined) setIgnoredFunction(newOptions.ignoredFunction);
        if (newOptions.ignoredPositions !== undefined) setIgnoredPositions(newOptions.ignoredPositions);
        if (newOptions.subtaskHeightRatio !== undefined) setSubtaskHeightRatio(newOptions.subtaskHeightRatio);
        if (newOptions.expandedTasks !== undefined) setExpandedTasks(new Set(newOptions.expandedTasks));
    };

    // Get current configuration snapshot
    const getConfig = () => ({
        ganttStart: ganttStart(),
        ganttEnd: ganttEnd(),
        unit: unit(),
        step: step(),
        columnWidth: columnWidth(),
        barHeight: barHeight(),
        headerHeight: headerHeight(),
        padding: padding(),
        barCornerRadius: barCornerRadius(),
        readonly: readonly(),
        readonlyDates: readonlyDates(),
        readonlyProgress: readonlyProgress(),
        showExpectedProgress: showExpectedProgress(),
        autoMoveLabel: autoMoveLabel(),
        ignoredDates: ignoredDates(),
        ignoredFunction: ignoredFunction(),
        ignoredPositions: ignoredPositions(),
        subtaskHeightRatio: subtaskHeightRatio(),
        expandedTasks: expandedTasks(),
    });

    return {
        // Getters (signals)
        ganttStart,
        ganttEnd,
        unit,
        step,
        columnWidth,
        barHeight,
        headerHeight,
        padding,
        barCornerRadius,
        readonly,
        readonlyDates,
        readonlyProgress,
        showExpectedProgress,
        autoMoveLabel,
        ignoredDates,
        ignoredFunction,
        ignoredPositions,
        subtaskHeightRatio,
        expandedTasks,

        // Setters
        setGanttStart,
        setGanttEnd,
        setUnit,
        setStep,
        setColumnWidth,
        setBarHeight,
        setHeaderHeight,
        setPadding,
        setBarCornerRadius,
        setReadonly,
        setReadonlyDates,
        setReadonlyProgress,
        setShowExpectedProgress,
        setAutoMoveLabel,
        setIgnoredDates,
        setIgnoredFunction,
        setIgnoredPositions,
        setSubtaskHeightRatio,
        setExpandedTasks,

        // Task expansion methods
        isTaskExpanded,
        toggleTaskExpansion,
        expandTask,
        collapseTask,
        expandAllTasks,
        collapseAllTasks,

        // Batch operations
        updateOptions,
        getConfig,
    };
}
