import { createSignal, createMemo, Accessor, Setter } from 'solid-js';
import * as dateUtils from '../utils/dateUtils';
import type { TimeScale } from '../utils/dateUtils';
import { DEFAULT_VIEW_MODES } from '../utils/defaults';
import type { ViewMode, DateInfo } from '../types';
import { DEFAULT_COLUMN_WIDTH } from '../constants';

interface TaskLike {
    _start?: Date;
    _end?: Date;
    start?: string;
    end?: string;
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
 * The timeline window a mutating method computed and committed.
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
    gridWidth: Accessor<number>;
    getAllDateInfos: Accessor<DateInfo[]>;

    // Methods
    setupDates: (tasks: TaskLike[], infinitePadding?: boolean) => DateWindow;
    generateDates: (
        start?: Date,
        end?: Date,
        stepVal?: number,
        unitVal?: TimeScale,
    ) => Date[];
    extendTimeline: (direction: 'left' | 'right', units?: number) => DateWindow;
    changeViewMode: (mode: string | ViewMode) => DateWindow | undefined;
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
    // Timeline boundaries
    const [ganttStart, setGanttStart] = createSignal<Date>(
        options.ganttStart || new Date(),
    );
    const [ganttEnd, setGanttEnd] = createSignal<Date>(
        options.ganttEnd || new Date(),
    );

    // Generated date columns
    const [dates, setDates] = createSignal<Date[]>([]);

    // View mode configuration
    const defaultViewMode =
        DEFAULT_VIEW_MODES.find((m) => m.name === 'Day') ||
        DEFAULT_VIEW_MODES[3]!;

    const initialViewModeName = options.viewMode;
    const initialViewMode = initialViewModeName
        ? DEFAULT_VIEW_MODES.find((m) => m.name === initialViewModeName) ||
          defaultViewMode
        : defaultViewMode;

    const [viewMode, setViewModeSignal] =
        createSignal<ViewMode>(initialViewMode);

    // Available view modes
    const [viewModes] = createSignal<ViewMode[]>(
        options.viewModes || DEFAULT_VIEW_MODES,
    );

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
    const [columnWidthOverride] = createSignal<number | null>(
        options.columnWidth ?? null,
    );
    const columnWidthOf = (mode: ViewMode): number =>
        columnWidthOverride() || mode.columnWidth || DEFAULT_COLUMN_WIDTH;
    const columnWidth = createMemo(() => columnWidthOf(viewMode()));

    // Grid width in pixels
    const gridWidth = createMemo(() => dateCount() * columnWidth());

    /**
     * Setup dates array from tasks and view mode.
     * Calculates ganttStart/ganttEnd from task dates and applies padding.
     *
     * Computes the whole window into locals first, then commits — and returns
     * it, so a caller in the same tick never has to read the signals back.
     */
    const setupDates = (
        tasks: TaskLike[],
        infinitePadding = false,
    ): DateWindow => {
        // One read of the view mode object supplies padding, step, unit and
        // column width; nothing below reads a signal this call is about to
        // write.
        const mode = viewMode();
        const { unit: unitVal, step: stepVal } = scaleOf(mode);
        const colWidth = columnWidthOf(mode);
        const pad = paddingOf(mode);

        let start: Date;
        let end: Date;

        if (!tasks || tasks.length === 0) {
            // Default to today +/- padding
            const today = dateUtils.today();

            start = dateUtils.start_of(
                dateUtils.add(today, -pad.duration, pad.scale),
                unitVal,
            );
            end = dateUtils.add(today, pad.duration, pad.scale);
        } else {
            // Find min/max dates from tasks
            let minDate: Date | null = null;
            let maxDate: Date | null = null;

            for (const task of tasks) {
                const taskStart =
                    task._start || dateUtils.parse(task.start || '');
                const taskEnd = task._end || dateUtils.parse(task.end || '');

                if (!minDate || taskStart < minDate) minDate = taskStart;
                if (!maxDate || taskEnd > maxDate) maxDate = taskEnd;
            }

            // Apply padding from view mode
            start = dateUtils.add(minDate!, -pad.duration, pad.scale);
            end = dateUtils.add(maxDate!, pad.duration, pad.scale);

            // For infinite padding, extend more
            if (infinitePadding) {
                const extendUnits = 30;
                start = dateUtils.add(start, -extendUnits, unitVal);
                end = dateUtils.add(end, extendUnits, unitVal);
            }

            // Align to unit start (don't reset hours/minutes for sub-day views)
            start = dateUtils.start_of(start, unitVal);
            if (unitVal !== 'hour' && unitVal !== 'minute') {
                start.setHours(0, 0, 0, 0);
            }
        }

        setGanttStart(start);
        setGanttEnd(end);
        const newDates = generateDates(start, end, stepVal, unitVal);

        return {
            ganttStart: start,
            ganttEnd: end,
            unit: unitVal,
            step: stepVal,
            columnWidth: colWidth,
            dates: newDates,
        };
    };

    /**
     * Generate the dates array from ganttStart to ganttEnd.
     *
     * Every parameter defaults to the corresponding signal/memo, so the public
     * no-arg form is unchanged. Internal callers pass their own locals instead,
     * because the signals they just wrote are not yet readable under deferred
     * writes.
     */
    const generateDates = (
        start: Date = ganttStart(),
        end: Date = ganttEnd(),
        stepVal: number = step(),
        unitVal: TimeScale = unit(),
    ): Date[] => {
        const newDates: Date[] = [];
        let current = new Date(start);

        while (current < end) {
            newDates.push(new Date(current));
            current = dateUtils.add(current, stepVal, unitVal);
        }

        setDates(newDates);
        return newDates;
    };

    /**
     * Extend timeline in a direction (for infinite padding).
     */
    const extendTimeline = (
        direction: 'left' | 'right',
        units = 10,
    ): DateWindow => {
        // Captured before any write; the view mode is untouched here, so the
        // memos are the correct source for step/unit/columnWidth.
        const stepVal = step();
        const unitVal = unit();
        const colWidth = columnWidth();

        let newStart = ganttStart();
        let newEnd = ganttEnd();

        if (direction === 'left') {
            newStart = dateUtils.add(newStart, -units * stepVal, unitVal);
            setGanttStart(newStart);
        } else {
            newEnd = dateUtils.add(newEnd, units * stepVal, unitVal);
            setGanttEnd(newEnd);
        }

        const newDates = generateDates(newStart, newEnd, stepVal, unitVal);

        return {
            ganttStart: newStart,
            ganttEnd: newEnd,
            unit: unitVal,
            step: stepVal,
            columnWidth: colWidth,
            dates: newDates,
        };
    };

    /**
     * Change view mode by name or object.
     *
     * Returns the regenerated window, or `undefined` for an unknown mode name
     * (a silent no-op, as before).
     */
    const changeViewMode = (
        mode: string | ViewMode,
    ): DateWindow | undefined => {
        let resolved: ViewMode | undefined;
        if (typeof mode === 'string') {
            resolved = viewModes().find((m) => m.name === mode);
        } else if (mode && mode.name) {
            resolved = mode;
        }
        if (!resolved) return undefined;

        // Derived from the resolved mode OBJECT, never from the
        // viewMode-derived memos: those still report the OLD mode until the
        // staged setViewModeSignal write commits.
        const { unit: unitVal, step: stepVal } = scaleOf(resolved);
        const colWidth = columnWidthOf(resolved);

        // The window itself is untouched by a mode change — only its
        // granularity changes.
        const start = ganttStart();
        const end = ganttEnd();

        setViewModeSignal(resolved);
        const newDates = generateDates(start, end, stepVal, unitVal);

        return {
            ganttStart: start,
            ganttEnd: end,
            unit: unitVal,
            step: stepVal,
            columnWidth: colWidth,
            dates: newDates,
        };
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
     * NOTE (E4.5): under 2.0 memos are eager, so this formats a string pair per
     * timeline column whether or not a header is mounted. `{ lazy: true }` is
     * the candidate fix, but that is E4.5's measured decision — not applied
     * here.
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

    /**
     * Convert a date to X pixel position.
     */
    const dateToX = (date: Date): number => {
        const start = ganttStart();
        const stepVal = step();
        const unitVal = unit();
        const colWidth = columnWidth();

        const diff = dateUtils.diff(date, start, unitVal);
        return (diff / stepVal) * colWidth;
    };

    /**
     * Convert X pixel position to date.
     */
    const xToDate = (x: number): Date => {
        const start = ganttStart();
        const stepVal = step();
        const unitVal = unit();
        const colWidth = columnWidth();

        const units = (x / colWidth) * stepVal;
        return dateUtils.add(start, units, unitVal);
    };

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
        gridWidth,
        getAllDateInfos,

        // Methods
        setupDates,
        generateDates,
        extendTimeline,
        changeViewMode,
        getDateInfo,
        dateToX,
        xToDate,
    };
}
