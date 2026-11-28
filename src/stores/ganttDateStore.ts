import { Accessor, createMemo, createSignal, Setter } from 'solid-js';
import * as dateUtils from '../utils/dateUtils';
import type { TimeScale } from '../utils/dateUtils';
import { DEFAULT_VIEW_MODES } from '../utils/defaults';
import type { ViewMode, DateInfo } from '../types';
import { DEFAULT_COLUMN_WIDTH } from '../constants';
import { resolveTaskEnd } from '../utils/taskProcessor';
import { createTimelineScale } from '../utils/timelineScale';

interface TaskLike {
    _start?: Date;
    _end?: Date;
    start?: string;
    end?: string;
    duration?: string;
}

interface GanttDateStoreOptions {
    ganttStart?: Date;
    ganttEnd?: Date;
    viewMode?: string;
    viewModes?: ViewMode[];
    language?: string;
    columnWidth?: number;
}

/**
 * The timeline window a mutating method computed and staged.
 *
 * `setupDates`, `changeViewMode` and `extendTimeline` return this so callers
 * consume the values that were just staged instead of reading the signals
 * back. Under SolidJS 2.0 deferred writes a read-back in the same tick still
 * returns the PREVIOUS value, so the returned window is the only correct
 * source for a same-stack consumer (see utils/ganttSetup.ts).
 */
export interface DateWindow {
    ganttStart: Date;
    ganttEnd: Date;
    unit: TimeScale;
    step: number;
    columnWidth: number;
    dates: Date[];
}

/** step/unit resolved from a view mode OBJECT — no signal or memo is read. */
function scaleOf(mode: ViewMode): { unit: TimeScale; step: number } {
    const parsed = dateUtils.parse_duration(mode.step);
    return {
        unit: parsed?.scale || 'day',
        step: parsed?.duration || 1,
    };
}

/** Timeline edge padding resolved from a view mode OBJECT. */
function paddingOf(mode: ViewMode): { duration: number; scale: TimeScale } {
    const parsed = dateUtils.parse_duration(mode.padding || '7d');
    return {
        duration: parsed?.duration || 7,
        scale: parsed?.scale || 'day',
    };
}

export interface GanttDateStore {
    // Signals
    ganttStart: Accessor<Date>;
    ganttEnd: Accessor<Date>;
    dates: Accessor<Date[]>;
    viewMode: Accessor<ViewMode>;
    viewModes: Accessor<ViewMode[]>;
    language: Accessor<string>;

    // Setters
    setGanttStart: Setter<Date>;
    setGanttEnd: Setter<Date>;
    setViewMode: (mode: string | ViewMode) => void;
    setLanguage: Setter<string>;

    // Computed
    dateCount: Accessor<number>;
    unit: Accessor<TimeScale>;
    step: Accessor<number>;
    columnWidth: Accessor<number>;
    /** Pixel length of an hour at the active view's duration scale. */
    pixelsPerHour: Accessor<number>;
    gridWidth: Accessor<number>;
    getAllDateInfos: Accessor<DateInfo[]>;

    // Methods
    setupDates: (
        tasks: TaskLike[],
        infinitePadding?: boolean,
        mode?: ViewMode,
    ) => DateWindow;
    generateDates: (
        start?: Date,
        end?: Date,
        stepVal?: number,
        unitVal?: TimeScale,
    ) => Date[];
    extendTimeline: (direction: 'left' | 'right', units?: number) => DateWindow;
    changeViewMode: (mode: string | ViewMode) => DateWindow | undefined;
    setColumnWidthOverride: (width: number | undefined) => DateWindow;
    getDateInfo: (
        date: Date,
        index: number,
        lastDate?: Date | null,
    ) => DateInfo;
    dateToX: (date: Date) => number;
    xToDate: (x: number) => Date;
}

/**
 * Reactive store for timeline/date management.
 * Handles view mode, date generation, and timeline boundaries.
 */
export function createGanttDateStore(
    options: GanttDateStoreOptions = {},
): GanttDateStore {
    const availableModes = options.viewModes ?? DEFAULT_VIEW_MODES;
    const defaultMode = DEFAULT_VIEW_MODES.find((mode) => mode.name === 'Day')!;
    const initialMode =
        availableModes.find((mode) => mode.name === options.viewMode) ??
        DEFAULT_VIEW_MODES.find((mode) => mode.name === options.viewMode) ??
        defaultMode;

    // One state lets commands compose against staged bounds and mode in their
    // functional updates. The field memos still isolate committed readers.
    const [timeline, setTimeline] = createSignal({
        ganttStart: options.ganttStart ?? new Date(),
        ganttEnd: options.ganttEnd ?? new Date(),
        dates: [] as Date[],
        viewMode: initialMode,
        columnWidthOverride: undefined as number | undefined,
    });
    const ganttStart = createMemo(() => timeline().ganttStart);
    const ganttEnd = createMemo(() => timeline().ganttEnd);
    const dates = createMemo(() => timeline().dates);
    const viewMode = createMemo(() => timeline().viewMode);
    const viewModes = () => availableModes;

    function setGanttStart<T extends Date>(value: T | ((prev: Date) => T)): T {
        let next!: T;
        setTimeline((prev) => {
            next = typeof value === 'function' ? value(prev.ganttStart) : value;
            return { ...prev, ganttStart: next };
        });
        return next;
    }

    function setGanttEnd<T extends Date>(value: T | ((prev: Date) => T)): T {
        let next!: T;
        setTimeline((prev) => {
            next = typeof value === 'function' ? value(prev.ganttEnd) : value;
            return { ...prev, ganttEnd: next };
        });
        return next;
    }

    // Language for date formatting
    const [language, setLanguage] = createSignal<string>(
        options.language || 'en',
    );

    // Computed values
    const dateCount = createMemo(() => dates().length);

    // Unit and step accessors. Both derive from the SAME pure `scaleOf`
    // helper the mutating methods use on a mode object, so a locally resolved
    // unit/step and these memos cannot drift apart.
    const modeScale = createMemo(() => scaleOf(viewMode()));
    const unit = createMemo<TimeScale>(() => modeScale().unit);
    const step = createMemo(() => modeScale().step);

    // Column width - use options override if provided, else view mode default
    const initialWidth = options.columnWidth;
    const columnWidthOf = (mode: ViewMode, width?: number): number =>
        (width ?? initialWidth) || mode.columnWidth || DEFAULT_COLUMN_WIDTH;
    const columnWidth = createMemo(() => {
        const state = timeline();
        return columnWidthOf(state.viewMode, state.columnWidthOverride);
    });

    // Grid width in pixels
    const gridWidth = createMemo(() => dateCount() * columnWidth());

    const scale = createMemo(() =>
        createTimelineScale(ganttStart(), unit(), step(), columnWidth()),
    );

    const calculateDates = (
        start: Date,
        end: Date,
        stepVal: number,
        unitVal: TimeScale,
    ): Date[] => {
        const columns: Date[] = [];
        if (!Number.isFinite(stepVal) || stepVal <= 0) return columns;

        const { columnDate } = createTimelineScale(start, unitVal, stepVal, 1);
        let current = columnDate(0);
        while (current < end) {
            columns.push(current);
            const next = columnDate(columns.length);
            if (!(next > current)) break;
            current = next;
        }

        return columns;
    };

    type Timeline = ReturnType<typeof timeline>;

    // Mutators return their calculated window while staging the same values.
    const updateWindow = (
        update: (
            prev: Timeline,
            mode: ViewMode,
            scale: ReturnType<typeof scaleOf>,
        ) => Pick<Timeline, 'ganttStart' | 'ganttEnd'>,
        mode?: ViewMode,
    ): DateWindow => {
        let window!: DateWindow;
        setTimeline((prev) => {
            const nextMode = mode ?? prev.viewMode;
            const scale = scaleOf(nextMode);
            const bounds = update(prev, nextMode, scale);
            const { unit, step } = scale;
            const dates = calculateDates(
                bounds.ganttStart,
                bounds.ganttEnd,
                step,
                unit,
            );
            window = {
                ...bounds,
                dates,
                unit,
                step,
                columnWidth: columnWidthOf(nextMode, prev.columnWidthOverride),
            };
            return { ...prev, ...bounds, dates, viewMode: nextMode };
        });
        return window;
    };

    const setColumnWidthOverride = (width: number | undefined): DateWindow => {
        const { ganttStart, ganttEnd, dates, viewMode, columnWidthOverride } =
            setTimeline((prev) => ({ ...prev, columnWidthOverride: width }));
        return {
            ganttStart,
            ganttEnd,
            dates,
            ...scaleOf(viewMode),
            columnWidth: columnWidthOf(viewMode, columnWidthOverride),
        };
    };

    /**
     * Calculate the window from task dates and apply view mode padding.
     */
    const setupDates = (
        tasks: TaskLike[],
        infinitePadding = false,
        nextMode?: ViewMode,
    ): DateWindow =>
        updateWindow((_prev, mode, { unit }) => {
            const pad = paddingOf(mode);

            let minDate: Date | null = null;
            let maxDate: Date | null = null;

            for (const task of tasks ?? []) {
                const taskStart =
                    task._start || dateUtils.parse(task.start || '');
                const taskEnd =
                    task._end ||
                    resolveTaskEnd(taskStart, task.end, task.duration);

                if (!minDate || taskStart < minDate) minDate = taskStart;
                if (!maxDate || taskEnd > maxDate) maxDate = taskEnd;
            }

            if (!minDate || !maxDate) {
                const today = dateUtils.today();
                return {
                    ganttStart: dateUtils.start_of(
                        dateUtils.add(today, -pad.duration, pad.scale),
                        unit,
                    ),
                    ganttEnd: dateUtils.add(today, pad.duration, pad.scale),
                };
            }

            let start = dateUtils.add(minDate, -pad.duration, pad.scale);
            let end = dateUtils.add(maxDate, pad.duration, pad.scale);

            if (infinitePadding) {
                start = dateUtils.add(start, -30, unit);
                end = dateUtils.add(end, 30, unit);
            }

            return {
                ganttStart: dateUtils.start_of(start, unit),
                ganttEnd: end,
            };
        }, nextMode);

    /**
     * Regenerate columns from the supplied values or staged timeline.
     */
    const generateDates = (
        start?: Date,
        end?: Date,
        stepVal?: number,
        unitVal?: TimeScale,
    ): Date[] =>
        setTimeline((prev) => {
            const { unit, step } = scaleOf(prev.viewMode);
            const dates = calculateDates(
                start ?? prev.ganttStart,
                end ?? prev.ganttEnd,
                stepVal ?? step,
                unitVal ?? unit,
            );
            return { ...prev, dates };
        }).dates;

    /**
     * Extend the timeline for infinite padding.
     */
    const extendTimeline = (
        direction: 'left' | 'right',
        units = 10,
    ): DateWindow =>
        updateWindow((prev, _mode, { unit, step }) => {
            return {
                ganttStart:
                    direction === 'left'
                        ? createTimelineScale(
                              prev.ganttStart,
                              unit,
                              step,
                              1,
                          ).columnDate(-units)
                        : prev.ganttStart,
                ganttEnd:
                    direction === 'right'
                        ? createTimelineScale(
                              prev.ganttEnd,
                              unit,
                              step,
                              1,
                          ).columnDate(units)
                        : prev.ganttEnd,
            };
        });

    /**
     * Regenerate the existing timeline at the requested granularity.
     */
    const changeViewMode = (
        mode: string | ViewMode,
    ): DateWindow | undefined => {
        const resolved =
            typeof mode === 'string'
                ? availableModes.find((m) => m.name === mode)
                : mode;
        if (!resolved?.name) return undefined;

        return updateWindow(
            (prev) => ({
                ganttStart: prev.ganttStart,
                ganttEnd: prev.ganttEnd,
            }),
            resolved,
        );
    };

    /**
     * Get date info for header rendering.
     * Returns x position and text for upper/lower headers.
     */
    const getDateInfo = (
        date: Date,
        index: number,
        lastDate: Date | null = null,
    ): DateInfo => {
        const mode = viewMode();
        const lang = language();
        const colWidth = columnWidth();

        const x = index * colWidth;

        // Get lower text (day number, hour, etc.)
        let lowerText = '';
        if (typeof mode.lowerText === 'function') {
            lowerText = mode.lowerText(date, lastDate, lang);
        } else if (typeof mode.lowerText === 'string') {
            lowerText = dateUtils.format(date, mode.lowerText, lang);
        }

        // Get upper text (month, year, etc.) - only when it changes
        let upperText = '';
        if (typeof mode.upperText === 'function') {
            upperText = mode.upperText(date, lastDate, lang);
        } else if (typeof mode.upperText === 'string') {
            upperText = dateUtils.format(date, mode.upperText, lang);
        }

        // Check if this should be a thick line
        const isThickLine = mode.thickLine ? mode.thickLine(date) : false;

        return {
            date,
            x,
            width: colWidth,
            lowerText,
            upperText,
            isThickLine,
        };
    };

    /**
     * Get all date infos for rendering headers.
     *
     * Eager on purpose (D7, measured in E4.5): `Gantt.tsx` wraps this in its
     * own eager `dateInfos` memo, whose creation-time compute subscribes to
     * this one before any JSX runs, so this memo always has a tracked
     * subscriber and `{ lazy: true }` here would change nothing — the wrapper
     * pulls it in the tick it is created (tests/memoLaziness.test.ts case 9).
     * Saving the per-column formatting for header-less consumers would need
     * the whole chain restructured, not an option flag.
     */
    const getAllDateInfos = createMemo<DateInfo[]>(() => {
        const allDates = dates();
        const infos: DateInfo[] = [];
        let lastDate: Date | null = null;

        for (let i = 0; i < allDates.length; i++) {
            const date = allDates[i];
            if (date) {
                const info = getDateInfo(date, i, lastDate);
                infos.push(info);
                lastDate = date;
            }
        }

        return infos;
    });

    const dateToX = (date: Date): number => scale().dateToX(date);
    const xToDate = (x: number): Date => scale().xToDate(x);

    return {
        // Signals
        ganttStart,
        ganttEnd,
        dates,
        viewMode,
        viewModes,
        language,

        // Setters
        setGanttStart,
        setGanttEnd,
        setViewMode: changeViewMode,
        setLanguage,

        // Computed
        dateCount,
        unit,
        step,
        columnWidth,
        pixelsPerHour: () =>
            (dateUtils.convertScales('1h', unit()) * columnWidth()) / step(),
        gridWidth,
        getAllDateInfos,

        // Methods
        setupDates,
        generateDates,
        extendTimeline,
        changeViewMode,
        setColumnWidthOverride,
        getDateInfo,
        dateToX,
        xToDate,
    };
}
