import { createSignal, createMemo, Accessor, Setter } from 'solid-js';
import date_utils from '../utils/date_utils';
import type { TimeScale } from '../utils/date_utils';
import { DEFAULT_VIEW_MODES } from '../utils/defaults';
import type { ViewMode, DateInfo } from '../types';

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
    view_mode?: string;
    viewModes?: ViewMode[];
    language?: string;
    columnWidth?: number;
    column_width?: number;
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
    setupDates: (tasks: TaskLike[], infinitePadding?: boolean) => void;
    generateDates: () => void;
    extendTimeline: (direction: 'left' | 'right', units?: number) => void;
    changeViewMode: (mode: string | ViewMode) => void;
    getDateInfo: (date: Date, index: number, lastDate?: Date | null) => DateInfo;
    dateToX: (date: Date) => number;
    xToDate: (x: number) => Date;
}

/**
 * Reactive store for timeline/date management.
 * Handles view mode, date generation, and timeline boundaries.
 */
export function createGanttDateStore(options: GanttDateStoreOptions = {}): GanttDateStore {
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

    // Support both viewMode and view_mode options
    const initialViewModeName = options.viewMode || options.view_mode;
    const initialViewMode = initialViewModeName
        ? DEFAULT_VIEW_MODES.find((m) => m.name === initialViewModeName) ||
          defaultViewMode
        : defaultViewMode;

    const [viewMode, setViewModeSignal] = createSignal<ViewMode>(initialViewMode);

    // Available view modes
    const [viewModes] = createSignal<ViewMode[]>(options.viewModes || DEFAULT_VIEW_MODES);

    // Language for date formatting
    const [language, setLanguage] = createSignal<string>(options.language || 'en');

    // Computed values
    const dateCount = createMemo(() => dates().length);

    // Get parsed step from view mode (e.g., "1d" -> {duration: 1, scale: "day"})
    const parsedStep = createMemo(() => {
        const mode = viewMode();
        return date_utils.parse_duration(mode.step);
    });

    // Unit and step accessors
    const unit = createMemo<TimeScale>(() => {
        const parsed = parsedStep();
        return parsed?.scale || 'day';
    });
    const step = createMemo(() => {
        const parsed = parsedStep();
        return parsed?.duration || 1;
    });

    // Column width - use options override if provided, else view mode default
    const [columnWidthOverride] = createSignal<number | null>(options.columnWidth || options.column_width || null);
    const columnWidth = createMemo(() => columnWidthOverride() || viewMode().column_width || 45);

    // Grid width in pixels
    const gridWidth = createMemo(() => dateCount() * columnWidth());

    /**
     * Setup dates array from tasks and view mode.
     * Calculates ganttStart/ganttEnd from task dates and applies padding.
     */
    const setupDates = (tasks: TaskLike[], infinitePadding = false): void => {
        if (!tasks || tasks.length === 0) {
            // Default to today +/- padding
            const today = date_utils.today();
            const mode = viewMode();
            const parsed = date_utils.parse_duration(mode.padding || '7d');
            const duration = parsed?.duration || 7;
            const scale = parsed?.scale || 'day';

            const start = date_utils.add(today, -duration, scale);
            const end = date_utils.add(today, duration, scale);

            setGanttStart(date_utils.start_of(start, unit()));
            setGanttEnd(end);
            generateDates();
            return;
        }

        // Find min/max dates from tasks
        let minDate: Date | null = null;
        let maxDate: Date | null = null;

        for (const task of tasks) {
            const taskStart = task._start || date_utils.parse(task.start || '');
            const taskEnd = task._end || date_utils.parse(task.end || '');

            if (!minDate || taskStart < minDate) minDate = taskStart;
            if (!maxDate || taskEnd > maxDate) maxDate = taskEnd;
        }

        // Apply padding from view mode
        const mode = viewMode();
        const parsed = date_utils.parse_duration(mode.padding || '7d');
        const padDuration = parsed?.duration || 7;
        const padScale = parsed?.scale || 'day';

        let start = date_utils.add(minDate!, -padDuration, padScale);
        let end = date_utils.add(maxDate!, padDuration, padScale);

        // For infinite padding, extend more
        if (infinitePadding) {
            const extendUnits = 30;
            start = date_utils.add(start, -extendUnits, unit());
            end = date_utils.add(end, extendUnits, unit());
        }

        // Align to unit start (don't reset hours/minutes for sub-day views)
        start = date_utils.start_of(start, unit());
        const u = unit();
        if (u !== 'hour' && u !== 'minute') {
            start.setHours(0, 0, 0, 0);
        }

        setGanttStart(start);
        setGanttEnd(end);
        generateDates();
    };

    /**
     * Generate the dates array from ganttStart to ganttEnd.
     */
    const generateDates = (): void => {
        const start = ganttStart();
        const end = ganttEnd();
        const stepVal = step();
        const unitVal = unit();

        const newDates: Date[] = [];
        let current = new Date(start);

        while (current < end) {
            newDates.push(new Date(current));
            current = date_utils.add(current, stepVal, unitVal);
        }

        setDates(newDates);
    };

    /**
     * Extend timeline in a direction (for infinite padding).
     */
    const extendTimeline = (direction: 'left' | 'right', units = 10): void => {
        const stepVal = step();
        const unitVal = unit();

        if (direction === 'left') {
            const newStart = date_utils.add(
                ganttStart(),
                -units * stepVal,
                unitVal,
            );
            setGanttStart(newStart);
        } else {
            const newEnd = date_utils.add(ganttEnd(), units * stepVal, unitVal);
            setGanttEnd(newEnd);
        }

        generateDates();
    };

    /**
     * Change view mode by name or object.
     */
    const changeViewMode = (mode: string | ViewMode): void => {
        if (typeof mode === 'string') {
            const found = viewModes().find((m) => m.name === mode);
            if (found) {
                setViewModeSignal(found);
                generateDates();
            }
        } else if (mode && mode.name) {
            setViewModeSignal(mode);
            generateDates();
        }
    };

    /**
     * Get date info for header rendering.
     * Returns x position and text for upper/lower headers.
     */
    const getDateInfo = (date: Date, index: number, lastDate: Date | null = null): DateInfo => {
        const mode = viewMode();
        const lang = language();
        const colWidth = columnWidth();

        const x = index * colWidth;

        // Get lower text (day number, hour, etc.)
        let lowerText = '';
        if (typeof mode.lower_text === 'function') {
            lowerText = mode.lower_text(date, lastDate, lang);
        } else if (typeof mode.lower_text === 'string') {
            lowerText = date_utils.format(date, mode.lower_text, lang);
        }

        // Get upper text (month, year, etc.) - only when it changes
        let upperText = '';
        if (typeof mode.upper_text === 'function') {
            upperText = mode.upper_text(date, lastDate, lang);
        } else if (typeof mode.upper_text === 'string') {
            upperText = date_utils.format(date, mode.upper_text, lang);
        }

        // Check if this should be a thick line
        const isThickLine = mode.thick_line ? mode.thick_line(date) : false;

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

        const diff = date_utils.diff(date, start, unitVal);
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
        return date_utils.add(start, units, unitVal);
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
