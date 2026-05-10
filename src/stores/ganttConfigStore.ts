import { Accessor, Setter } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import {
    DEFAULT_COLUMN_WIDTH,
    DEFAULT_BAR_HEIGHT,
    DEFAULT_PADDING,
} from '../constants';

type RenderMode = 'simple' | 'detailed';

interface GanttConfigOptions {
    ganttStart?: Date;
    ganttEnd?: Date;
    unit?: string;
    step?: number;
    columnWidth?: number;
    barHeight?: number;
    headerHeight?: number;
    padding?: number;
    barCornerRadius?: number;
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

interface GanttConfigState {
    ganttStart: Date;
    ganttEnd: Date;
    unit: string;
    step: number;
    columnWidth: number;
    barHeight: number;
    headerHeight: number;
    padding: number;
    barCornerRadius: number;
    readonly: boolean;
    readonlyDates: boolean;
    readonlyProgress: boolean;
    showExpectedProgress: boolean;
    autoMoveLabel: boolean;
    ignoredDates: Date[];
    ignoredFunction: ((date: Date) => boolean) | null;
    ignoredPositions: number[];
    subtaskHeightRatio: number;
    renderMode: RenderMode;
    expandedTasks: Set<string>;
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
 *
 * Backed by a single createStore for path-level reactivity (only the
 * specific field's readers re-run on change), atomic batch updates, and
 * to keep the store-pattern consistent with taskStore.
 */
export function createGanttConfigStore(
    options: GanttConfigOptions = {},
): GanttConfigStore {
    const [state, setState] = createStore<GanttConfigState>({
        ganttStart: options.ganttStart || new Date(),
        ganttEnd: options.ganttEnd || new Date(),
        unit: options.unit || 'day',
        step: options.step || 1,
        columnWidth: options.columnWidth ?? DEFAULT_COLUMN_WIDTH,
        barHeight: options.barHeight ?? DEFAULT_BAR_HEIGHT,
        headerHeight: options.headerHeight ?? 75,
        padding: options.padding ?? DEFAULT_PADDING,
        barCornerRadius: options.barCornerRadius ?? 3,
        readonly: options.readonly || false,
        readonlyDates: options.readonlyDates || false,
        readonlyProgress: options.readonlyProgress || false,
        showExpectedProgress: options.showExpectedProgress || false,
        autoMoveLabel: options.autoMoveLabel || false,
        ignoredDates: options.ignoredDates || [],
        ignoredFunction: options.ignoredFunction || null,
        ignoredPositions: [],
        subtaskHeightRatio: options.subtaskHeightRatio || 0.5,
        renderMode: options.renderMode || 'simple',
        expandedTasks: new Set(options.expandedTasks || []),
    });

    // Builds a Setter<T>-compatible function that targets a single store path.
    // Accepts either a value or an updater function — same contract as createSignal's setter.
    function makeSetter<K extends keyof GanttConfigState>(
        key: K,
    ): Setter<GanttConfigState[K]> {
        return ((value: unknown) => {
            const next =
                typeof value === 'function'
                    ? (
                          value as (
                              prev: GanttConfigState[K],
                          ) => GanttConfigState[K]
                      )(state[key])
                    : (value as GanttConfigState[K]);
            setState(key, next as never);
            return state[key];
        }) as Setter<GanttConfigState[K]>;
    }

    // Expansion management methods
    const isTaskExpanded = (taskId: string): boolean =>
        state.expandedTasks.has(taskId);

    const toggleTaskExpansion = (taskId: string): void => {
        setState(
            'expandedTasks',
            produce((set: Set<string>) => {
                if (set.has(taskId)) {
                    set.delete(taskId);
                } else {
                    set.add(taskId);
                }
            }),
        );
    };

    const expandTask = (taskId: string): void => {
        if (state.expandedTasks.has(taskId)) return;
        setState(
            'expandedTasks',
            produce((set: Set<string>) => {
                set.add(taskId);
            }),
        );
    };

    const collapseTask = (taskId: string): void => {
        if (!state.expandedTasks.has(taskId)) return;
        setState(
            'expandedTasks',
            produce((set: Set<string>) => {
                set.delete(taskId);
            }),
        );
    };

    const expandAllTasks = (taskIds: string[]): void => {
        setState('expandedTasks', new Set(taskIds));
    };

    const collapseAllTasks = (): void => {
        setState('expandedTasks', new Set<string>());
    };

    // Update many options atomically (single reactivity flush)
    const updateOptions = (newOptions: Partial<GanttConfigOptions>): void => {
        setState(
            produce((s: GanttConfigState) => {
                if (newOptions.ganttStart !== undefined)
                    s.ganttStart = newOptions.ganttStart;
                if (newOptions.ganttEnd !== undefined)
                    s.ganttEnd = newOptions.ganttEnd;
                if (newOptions.unit !== undefined) s.unit = newOptions.unit;
                if (newOptions.step !== undefined) s.step = newOptions.step;
                if (newOptions.columnWidth !== undefined)
                    s.columnWidth = newOptions.columnWidth;
                if (newOptions.barHeight !== undefined)
                    s.barHeight = newOptions.barHeight;
                if (newOptions.headerHeight !== undefined)
                    s.headerHeight = newOptions.headerHeight;
                if (newOptions.padding !== undefined)
                    s.padding = newOptions.padding;
                if (newOptions.barCornerRadius !== undefined)
                    s.barCornerRadius = newOptions.barCornerRadius;
                if (newOptions.readonly !== undefined)
                    s.readonly = newOptions.readonly;
                if (newOptions.readonlyDates !== undefined)
                    s.readonlyDates = newOptions.readonlyDates;
                if (newOptions.readonlyProgress !== undefined)
                    s.readonlyProgress = newOptions.readonlyProgress;
                if (newOptions.showExpectedProgress !== undefined)
                    s.showExpectedProgress = newOptions.showExpectedProgress;
                if (newOptions.autoMoveLabel !== undefined)
                    s.autoMoveLabel = newOptions.autoMoveLabel;
                if (newOptions.ignoredDates !== undefined)
                    s.ignoredDates = newOptions.ignoredDates;
                if (newOptions.ignoredFunction !== undefined)
                    s.ignoredFunction = newOptions.ignoredFunction;
                if (newOptions.ignoredPositions !== undefined)
                    s.ignoredPositions = newOptions.ignoredPositions;
                if (newOptions.subtaskHeightRatio !== undefined)
                    s.subtaskHeightRatio = newOptions.subtaskHeightRatio;
                if (newOptions.renderMode !== undefined)
                    s.renderMode = newOptions.renderMode;
                if (newOptions.expandedTasks !== undefined)
                    s.expandedTasks = new Set(newOptions.expandedTasks);
            }),
        );
    };

    // Get current configuration snapshot
    const getConfig = (): GanttConfigOptions => ({
        ganttStart: state.ganttStart,
        ganttEnd: state.ganttEnd,
        unit: state.unit,
        step: state.step,
        columnWidth: state.columnWidth,
        barHeight: state.barHeight,
        headerHeight: state.headerHeight,
        padding: state.padding,
        barCornerRadius: state.barCornerRadius,
        readonly: state.readonly,
        readonlyDates: state.readonlyDates,
        readonlyProgress: state.readonlyProgress,
        showExpectedProgress: state.showExpectedProgress,
        autoMoveLabel: state.autoMoveLabel,
        ignoredDates: state.ignoredDates,
        ignoredFunction: state.ignoredFunction,
        ignoredPositions: state.ignoredPositions,
        subtaskHeightRatio: state.subtaskHeightRatio,
        renderMode: state.renderMode,
        expandedTasks: Array.from(state.expandedTasks),
    });

    return {
        // Getters — path-tracked accessors over the single store
        ganttStart: () => state.ganttStart,
        ganttEnd: () => state.ganttEnd,
        unit: () => state.unit,
        step: () => state.step,
        columnWidth: () => state.columnWidth,
        barHeight: () => state.barHeight,
        headerHeight: () => state.headerHeight,
        padding: () => state.padding,
        barCornerRadius: () => state.barCornerRadius,
        readonly: () => state.readonly,
        readonlyDates: () => state.readonlyDates,
        readonlyProgress: () => state.readonlyProgress,
        showExpectedProgress: () => state.showExpectedProgress,
        autoMoveLabel: () => state.autoMoveLabel,
        ignoredDates: () => state.ignoredDates,
        ignoredFunction: () => state.ignoredFunction,
        ignoredPositions: () => state.ignoredPositions,
        subtaskHeightRatio: () => state.subtaskHeightRatio,
        renderMode: () => state.renderMode,
        expandedTasks: () => state.expandedTasks,

        // Setters
        setGanttStart: makeSetter('ganttStart'),
        setGanttEnd: makeSetter('ganttEnd'),
        setUnit: makeSetter('unit'),
        setStep: makeSetter('step'),
        setColumnWidth: makeSetter('columnWidth'),
        setBarHeight: makeSetter('barHeight'),
        setHeaderHeight: makeSetter('headerHeight'),
        setPadding: makeSetter('padding'),
        setBarCornerRadius: makeSetter('barCornerRadius'),
        setReadonly: makeSetter('readonly'),
        setReadonlyDates: makeSetter('readonlyDates'),
        setReadonlyProgress: makeSetter('readonlyProgress'),
        setShowExpectedProgress: makeSetter('showExpectedProgress'),
        setAutoMoveLabel: makeSetter('autoMoveLabel'),
        setIgnoredDates: makeSetter('ignoredDates'),
        setIgnoredFunction: makeSetter('ignoredFunction'),
        setIgnoredPositions: makeSetter('ignoredPositions'),
        setSubtaskHeightRatio: makeSetter('subtaskHeightRatio'),
        setRenderMode: makeSetter('renderMode'),
        setExpandedTasks: makeSetter('expandedTasks'),

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
