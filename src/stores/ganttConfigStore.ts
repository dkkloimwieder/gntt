import { Accessor, createSignal } from 'solid-js';
import { createStore } from 'solid-js';
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

/**
 * Committed shape of the config store.
 *
 * `expandedTasks` is deliberately NOT a field here: a `Set` inside a store is
 * not proxied, so it lives in its own signal over an immutable Set (decision
 * D6 — see `createGanttConfigStore`).
 *
 * `ganttStart`, `ganttEnd` and the entries of `ignoredDates` are UNPROXIED
 * `Date`s: the store hands back the very instance it was given. REPLACE them,
 * never mutate one in place — an in-place `setDate()`/`setHours()` edits
 * committed state behind the store's back and notifies nobody. The same rule
 * covers `ProcessedTask._start` / `_end` / `_baselineStart` / `_baselineEnd`
 * (see the note on those fields in `src/types.ts`).
 */
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
}

/**
 * Setter shape for the 20 config fields (decision D13).
 *
 * Deliberately `void`-returning, unlike solid's `Setter<T>`: a setter cannot
 * honestly return the value it just staged once writes are deferred — reading
 * the store back inside the setter would yield the PRE-write committed value.
 * No caller in this repo uses the return value.
 *
 * As with solid's `Setter<T>`, the value overload excludes `Function`, so a
 * function argument is always taken as an updater and function-valued fields
 * (`ignoredFunction`) cannot be assigned through the value form; pass
 * `() => fn` instead. Dropping that `Exclude` would turn a compile error into
 * a runtime crash (the updater path calls the value with `prev`).
 */
export type ConfigSetter<T> = (
    // Mirrors solid's own `Setter<T>`, which excludes the bare `Function`
    // type so that any function argument is unambiguously an updater.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    value: Exclude<T, Function> | ((prev: T) => T),
) => void;

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
    setGanttStart: ConfigSetter<Date>;
    setGanttEnd: ConfigSetter<Date>;
    setUnit: ConfigSetter<string>;
    setStep: ConfigSetter<number>;
    setColumnWidth: ConfigSetter<number>;
    setBarHeight: ConfigSetter<number>;
    setHeaderHeight: ConfigSetter<number>;
    setPadding: ConfigSetter<number>;
    setBarCornerRadius: ConfigSetter<number>;
    setReadonly: ConfigSetter<boolean>;
    setReadonlyDates: ConfigSetter<boolean>;
    setReadonlyProgress: ConfigSetter<boolean>;
    setShowExpectedProgress: ConfigSetter<boolean>;
    setAutoMoveLabel: ConfigSetter<boolean>;
    setIgnoredDates: ConfigSetter<Date[]>;
    setIgnoredFunction: ConfigSetter<((date: Date) => boolean) | null>;
    setIgnoredPositions: ConfigSetter<number[]>;
    setSubtaskHeightRatio: ConfigSetter<number>;
    setRenderMode: ConfigSetter<RenderMode>;
    setExpandedTasks: ConfigSetter<Set<string>>;

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
 *
 * One field sits outside that store: `expandedTasks` is a signal over an
 * immutable `Set` (decision D6), because a `Set` is not wrappable and so
 * would never be proxied inside the store. `updateOptions` is therefore the
 * one writer that touches two reactive cells; see its note.
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
    });

    // `expandedTasks` lives OUTSIDE the store (decision D6). A `Set` is not
    // wrappable, so it is never proxied: mutating one in place notifies
    // nothing, and `produce` will not even invoke its callback on it. So it is
    // a signal over an IMMUTABLE Set — every mutator below builds a NEW Set
    // and replaces it, which is a plain reference write and always notifies.
    // `ReadonlySet` keeps that honest inside this module; the public accessor
    // and setter keep their `Set<string>` shape (D6: public option and
    // accessor types unchanged).
    const [expandedTasks, setExpandedTasks] = createSignal<ReadonlySet<string>>(
        new Set(options.expandedTasks ?? []),
    );

    // Builds a ConfigSetter<T> that targets a single store field (decision
    // D13: void-returning). Accepts either a value or an updater function.
    // The updater's `prev` is read from the DRAFT, not from the committed
    // store proxy, so two updater calls in the same turn compose (30 → 40 →
    // 50) both today and once writes are deferred.
    function makeSetter<K extends keyof GanttConfigState>(
        key: K,
    ): ConfigSetter<GanttConfigState[K]> {
        return (value) => {
            setState((draft: GanttConfigState) => {
                draft[key] =
                    typeof value === 'function'
                        ? (
                              value as (
                                  prev: GanttConfigState[K],
                              ) => GanttConfigState[K]
                          )(draft[key])
                        : (value as GanttConfigState[K]);
            });
        };
    }

    // Expansion management methods. None of them guards on committed state
    // first: building a fresh Set is idempotent on its own, and a guard that
    // reads state the caller may have written earlier in the same turn is
    // exactly the shape deferred writes break.
    const isTaskExpanded = (taskId: string): boolean =>
        expandedTasks().has(taskId);

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
            const next = new Set(prev);
            next.add(taskId);
            return next;
        });
    };

    const collapseTask = (taskId: string): void => {
        setExpandedTasks((prev) => {
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

    // Public `setExpandedTasks`: same value-or-updater contract as the other
    // 19 setters, over the signal instead of the store. The Set handed in is
    // stored as-is (no defensive copy) — mutate it after the call and the
    // store shows the mutation without notifying anyone.
    const setExpandedTasksValue: ConfigSetter<Set<string>> = (value) => {
        setExpandedTasks((prev) =>
            typeof value === 'function' ? value(prev as Set<string>) : value,
        );
    };

    // Update many options atomically. Two reactive cells are written now that
    // `expandedTasks` is a signal; SolidJS 2.0 stages every write until the
    // microtask flush, so no explicit batch is needed to keep them one flush.
    const updateOptions = (newOptions: Partial<GanttConfigOptions>): void => {
        if (newOptions.expandedTasks !== undefined) {
            setExpandedTasks(new Set(newOptions.expandedTasks));
        }
        setState((s: GanttConfigState) => {
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
        });
    };

    /**
     * Snapshot of the COMMITTED configuration.
     *
     * Reads committed state, never a staged write: a caller that calls a
     * setter and snapshots in the same turn sees the PRE-write values once
     * writes are deferred, so settle (E3: `flush()`) in between if the write
     * must be visible here.
     *
     * Fields are projected, not deep-copied: `ganttStart`/`ganttEnd` and the
     * `ignoredDates` entries are the caller's own `Date` instances, and
     * `ignoredFunction` passes straight through. `expandedTasks` is the one
     * field whose shape differs from its accessor — `string[]` here,
     * `Set<string>` off the store — and it is re-projected on every call.
     *
     * Reading it inside a tracked scope subscribes to every field it touches.
     */
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
        expandedTasks: Array.from(expandedTasks()),
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
        // Cast, not a copy: the signal holds the exact Set instance and this
        // module never mutates it in place. The `Set<string>` face is the
        // published one (D6) and is what consumers such as
        // `calculateRowLayouts` are typed against.
        expandedTasks: () => expandedTasks() as Set<string>,

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
        setExpandedTasks: setExpandedTasksValue,

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
