import { createSignal, Accessor, Setter } from 'solid-js';

type RenderMode = 'simple' | 'detailed';

interface GanttConfigOptions {
    ganttStart?: Date;
    ganttEnd?: Date;
    unit?: string;
    step?: number;
    columnWidth?: number;
    column_width?: number;
    barHeight?: number;
    bar_height?: number;
    headerHeight?: number;
    padding?: number;
    barCornerRadius?: number;
    bar_corner_radius?: number;
    readonly?: boolean;
    readonlyDates?: boolean;
    readonlyProgress?: boolean;
    showExpectedProgress?: boolean;
    autoMoveLabel?: boolean;
    ignoredDates?: Date[];
    ignoredFunction?: ((date: Date) => boolean) | null;
    ignoredPositions?: number[];
    subtaskHeightRatio?: number;
    renderMode?: RenderMode;
    expandedTasks?: string[];
}

export interface GanttConfigStore {
    // Getters (signals)
    ganttStart: Accessor<Date>;
    ganttEnd: Accessor<Date>;
    unit: Accessor<string>;
    step: Accessor<number>;
    columnWidth: Accessor<number>;
    barHeight: Accessor<number>;
    headerHeight: Accessor<number>;
    padding: Accessor<number>;
    barCornerRadius: Accessor<number>;
    readonly: Accessor<boolean>;
    readonlyDates: Accessor<boolean>;
    readonlyProgress: Accessor<boolean>;
    showExpectedProgress: Accessor<boolean>;
    autoMoveLabel: Accessor<boolean>;
    ignoredDates: Accessor<Date[]>;
    ignoredFunction: Accessor<((date: Date) => boolean) | null>;
    ignoredPositions: Accessor<number[]>;
    subtaskHeightRatio: Accessor<number>;
    renderMode: Accessor<RenderMode>;
    expandedTasks: Accessor<Set<string>>;

    // Setters
    setGanttStart: Setter<Date>;
    setGanttEnd: Setter<Date>;
    setUnit: Setter<string>;
    setStep: Setter<number>;
    setColumnWidth: Setter<number>;
    setBarHeight: Setter<number>;
    setHeaderHeight: Setter<number>;
    setPadding: Setter<number>;
    setBarCornerRadius: Setter<number>;
    setReadonly: Setter<boolean>;
    setReadonlyDates: Setter<boolean>;
    setReadonlyProgress: Setter<boolean>;
    setShowExpectedProgress: Setter<boolean>;
    setAutoMoveLabel: Setter<boolean>;
    setIgnoredDates: Setter<Date[]>;
    setIgnoredFunction: Setter<((date: Date) => boolean) | null>;
    setIgnoredPositions: Setter<number[]>;
    setSubtaskHeightRatio: Setter<number>;
    setRenderMode: Setter<RenderMode>;
    setExpandedTasks: Setter<Set<string>>;

    // Task expansion methods
    isTaskExpanded: (taskId: string) => boolean;
    toggleTaskExpansion: (taskId: string) => void;
    expandTask: (taskId: string) => void;
    collapseTask: (taskId: string) => void;
    expandAllTasks: (taskIds: string[]) => void;
    collapseAllTasks: () => void;

    // Batch operations
    updateOptions: (newOptions: Partial<GanttConfigOptions>) => void;
    getConfig: () => GanttConfigOptions;
}

/**
 * Reactive store for Gantt configuration.
 * Holds all configuration needed for bar positioning and rendering.
 */
export function createGanttConfigStore(options: GanttConfigOptions = {}): GanttConfigStore {
    // Time configuration
    const [ganttStart, setGanttStart] = createSignal<Date>(options.ganttStart || new Date());
    const [ganttEnd, setGanttEnd] = createSignal<Date>(options.ganttEnd || new Date());
    const [unit, setUnit] = createSignal<string>(options.unit || 'day');
    const [step, setStep] = createSignal<number>(options.step || 1);

    // Layout configuration - support both snake_case and camelCase
    const [columnWidth, setColumnWidth] = createSignal<number>(options.columnWidth || options.column_width || 45);
    const [barHeight, setBarHeight] = createSignal<number>(options.barHeight || options.bar_height || 30);
    const [headerHeight, setHeaderHeight] = createSignal<number>(options.headerHeight || 75);
    const [padding, setPadding] = createSignal<number>(options.padding || 18);
    const [barCornerRadius, setBarCornerRadius] = createSignal<number>(options.barCornerRadius || options.bar_corner_radius || 3);

    // Feature flags
    const [readonly, setReadonly] = createSignal<boolean>(options.readonly || false);
    const [readonlyDates, setReadonlyDates] = createSignal<boolean>(options.readonlyDates || false);
    const [readonlyProgress, setReadonlyProgress] = createSignal<boolean>(options.readonlyProgress || false);
    const [showExpectedProgress, setShowExpectedProgress] = createSignal<boolean>(options.showExpectedProgress || false);
    const [autoMoveLabel, setAutoMoveLabel] = createSignal<boolean>(options.autoMoveLabel || false);

    // Ignored dates (weekends, holidays)
    const [ignoredDates, setIgnoredDates] = createSignal<Date[]>(options.ignoredDates || []);
    const [ignoredFunction, setIgnoredFunction] = createSignal<((date: Date) => boolean) | null>(options.ignoredFunction || null);

    // Computed ignored positions (pixel X values)
    const [ignoredPositions, setIgnoredPositions] = createSignal<number[]>([]);

    // Subtask configuration
    const [subtaskHeightRatio, setSubtaskHeightRatio] = createSignal<number>(
        options.subtaskHeightRatio || 0.5
    );

    // Render mode: 'simple' (flat tasks, static heights) or 'detailed' (hierarchy, variable heights)
    // Simple mode skips subtask/expansion logic for maximum performance
    const [renderMode, setRenderMode] = createSignal<RenderMode>(options.renderMode || 'simple');

    // Expanded tasks (for variable row heights) - only used in detailed mode
    const [expandedTasks, setExpandedTasks] = createSignal<Set<string>>(
        new Set(options.expandedTasks || [])
    );

    // Expansion management methods
    const isTaskExpanded = (taskId: string): boolean => expandedTasks().has(taskId);

    const toggleTaskExpansion = (taskId: string): void => {
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

    const expandTask = (taskId: string): void => {
        setExpandedTasks((prev) => {
            if (prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.add(taskId);
            return next;
        });
    };

    const collapseTask = (taskId: string): void => {
        setExpandedTasks((prev) => {
            if (!prev.has(taskId)) return prev;
            const next = new Set(prev);
            next.delete(taskId);
            return next;
        });
    };

    const expandAllTasks = (taskIds: string[]): void => {
        setExpandedTasks(new Set(taskIds));
    };

    const collapseAllTasks = (): void => {
        setExpandedTasks(new Set<string>());
    };

    // Update all options at once
    const updateOptions = (newOptions: Partial<GanttConfigOptions>): void => {
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
        if (newOptions.ignoredFunction !== undefined) {
            const fn = newOptions.ignoredFunction;
            setIgnoredFunction(() => fn);
        }
        if (newOptions.ignoredPositions !== undefined) setIgnoredPositions(newOptions.ignoredPositions);
        if (newOptions.subtaskHeightRatio !== undefined) setSubtaskHeightRatio(newOptions.subtaskHeightRatio);
        if (newOptions.renderMode !== undefined) setRenderMode(newOptions.renderMode);
        if (newOptions.expandedTasks !== undefined) setExpandedTasks(new Set(newOptions.expandedTasks));
    };

    // Get current configuration snapshot
    const getConfig = (): GanttConfigOptions => ({
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
        renderMode: renderMode(),
        expandedTasks: Array.from(expandedTasks()),
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
        renderMode,
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
        setRenderMode,
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
