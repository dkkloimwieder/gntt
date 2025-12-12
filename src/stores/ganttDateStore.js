import { createSignal, createMemo } from 'solid-js';
import date_utils from '../utils/date_utils.js';
import { DEFAULT_VIEW_MODES } from '../utils/defaults.js';

/**
 * Reactive store for timeline/date management.
 * Handles view mode, date generation, and timeline boundaries.
 */
export function createGanttDateStore(options = {}) {
    // Timeline boundaries
    const [ganttStart, setGanttStart] = createSignal(
        options.ganttStart || new Date(),
    );
    const [ganttEnd, setGanttEnd] = createSignal(
        options.ganttEnd || new Date(),
    );

    // Generated date columns
    const [dates, setDates] = createSignal([]);

    // View mode configuration
    const defaultViewMode =
        DEFAULT_VIEW_MODES.find((m) => m.name === 'Day') ||
        DEFAULT_VIEW_MODES[3];

    // Support both viewMode and view_mode options
    const initialViewModeName = options.viewMode || options.view_mode;
    const initialViewMode = initialViewModeName
        ? DEFAULT_VIEW_MODES.find((m) => m.name === initialViewModeName) ||
          defaultViewMode
        : defaultViewMode;

    const [viewMode, setViewMode] = createSignal(initialViewMode);

    // Available view modes
    const [viewModes] = createSignal(options.viewModes || DEFAULT_VIEW_MODES);

    // Language for date formatting
    const [language, setLanguage] = createSignal(options.language || 'en');

    // Computed values
    const dateCount = createMemo(() => dates().length);

    // Get parsed step from view mode (e.g., "1d" -> {duration: 1, scale: "day"})
    const parsedStep = createMemo(() => {
        const mode = viewMode();
        return date_utils.parse_duration(mode.step);
    });

    // Unit and step accessors
    const unit = createMemo(() => parsedStep().scale);
    const step = createMemo(() => parsedStep().duration);

    // Column width - use options override if provided, else view mode default
    const [columnWidthOverride] = createSignal(options.columnWidth || options.column_width || null);
    const columnWidth = createMemo(() => columnWidthOverride() || viewMode().column_width || 45);

    // Grid width in pixels
    const gridWidth = createMemo(() => dateCount() * columnWidth());

    /**
     * Setup dates array from tasks and view mode.
     * Calculates ganttStart/ganttEnd from task dates and applies padding.
     */
    const setupDates = (tasks, infinitePadding = false) => {
        if (!tasks || tasks.length === 0) {
            // Default to today +/- padding
            const today = date_utils.today();
            const mode = viewMode();
            const { duration, scale } = date_utils.parse_duration(
                mode.padding || '7d',
            );

            const start = date_utils.add(today, -duration, scale);
            const end = date_utils.add(today, duration, scale);

            setGanttStart(date_utils.start_of(start, unit()));
            setGanttEnd(end);
            generateDates();
            return;
        }

        // Find min/max dates from tasks
        let minDate = null;
        let maxDate = null;

        for (const task of tasks) {
            const taskStart = task._start || date_utils.parse(task.start);
            const taskEnd = task._end || date_utils.parse(task.end);

            if (!minDate || taskStart < minDate) minDate = taskStart;
            if (!maxDate || taskEnd > maxDate) maxDate = taskEnd;
        }

        // Apply padding from view mode
        const mode = viewMode();
        const { duration: padDuration, scale: padScale } =
            date_utils.parse_duration(mode.padding || '7d');

        let start = date_utils.add(minDate, -padDuration, padScale);
        let end = date_utils.add(maxDate, padDuration, padScale);

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
    const generateDates = () => {
        const start = ganttStart();
        const end = ganttEnd();
        const stepVal = step();
        const unitVal = unit();

        const newDates = [];
        let current = new Date(start);

        while (current < end) {
            newDates.push(new Date(current));
            current = date_utils.add(current, stepVal, unitVal);
        }

        setDates(newDates);
    };

    /**
     * Extend timeline in a direction (for infinite padding).
     * @param {'left' | 'right'} direction
     * @param {number} units - Number of step units to add
     */
    const extendTimeline = (direction, units = 10) => {
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
    const changeViewMode = (mode) => {
        if (typeof mode === 'string') {
            const found = viewModes().find((m) => m.name === mode);
            if (found) {
                setViewMode(found);
                generateDates();
            }
        } else if (mode && mode.name) {
            setViewMode(mode);
            generateDates();
        }
    };

    /**
     * Get date info for header rendering.
     * Returns x position and text for upper/lower headers.
     */
    const getDateInfo = (date, index, lastDate = null) => {
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
    const getAllDateInfos = createMemo(() => {
        const allDates = dates();
        const infos = [];
        let lastDate = null;

        for (let i = 0; i < allDates.length; i++) {
            const info = getDateInfo(allDates[i], i, lastDate);
            infos.push(info);
            lastDate = allDates[i];
        }

        return infos;
    });

    /**
     * Convert a date to X pixel position.
     */
    const dateToX = (date) => {
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
    const xToDate = (x) => {
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
