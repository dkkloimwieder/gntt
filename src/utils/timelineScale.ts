import type { TimeScale } from './dateUtils';

const MILLISECONDS_PER_DAY = 86_400_000;
const ELAPSED_UNIT_MS: Partial<Record<TimeScale, number>> = {
    hour: 3_600_000,
    minute: 60_000,
    second: 1_000,
    millisecond: 1,
};

function civilDay(date: Date): number {
    const year = date.getFullYear();
    // Date.UTC shifts years 0–99 into the twentieth century.
    const shift = year >= 0 && year < 100 ? 400 : 0;
    return (
        Date.UTC(year + shift, date.getMonth(), date.getDate()) /
            MILLISECONDS_PER_DAY -
        (shift ? 146_097 : 0)
    );
}

function daysInMonth(year: number, month: number): number {
    if (month === 1) {
        return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
            ? 29
            : 28;
    }
    return month === 3 || month === 5 || month === 8 || month === 10 ? 30 : 31;
}

/**
 * Project timeline dates using the same column boundaries as the headers.
 * Day and larger columns keep local calendar boundaries. Within a column,
 * pixels represent elapsed time so dates in a repeated DST hour stay distinct.
 */
export function createTimelineScale(
    start: Date,
    unit: TimeScale,
    step: number,
    columnWidth: number,
) {
    const startTime = start.getTime();
    const validStep = Number.isFinite(step) && step > 0;
    const startDay = start.getDate();
    const originMonth = start.getFullYear() * 12 + start.getMonth();
    const originDay = unit === 'day' ? civilDay(start) : 0;
    const monthStep = unit === 'year' ? step * 12 : step;
    const elapsedUnit = ELAPSED_UNIT_MS[unit];
    const elapsedColumn =
        elapsedUnit === undefined ? undefined : elapsedUnit * step;

    function columnDate(index: number): Date {
        if (elapsedColumn !== undefined) {
            return new Date(startTime + index * elapsedColumn);
        }

        const date = new Date(startTime);
        if (index === 0) return date;
        if (unit === 'day') {
            date.setDate(startDay + index * step);
        } else {
            // Always count from the origin. A short month clamps the date
            // for that boundary without shifting later columns.
            const totalMonths = originMonth + index * monthStep;
            const year = Math.floor(totalMonths / 12);
            const month = totalMonths - year * 12;
            date.setFullYear(
                year,
                month,
                Math.min(startDay, daysInMonth(year, month)),
            );
        }
        return date;
    }

    function dateToX(date: Date): number {
        const time = date.getTime();
        if (
            !Number.isFinite(time) ||
            !Number.isFinite(startTime) ||
            !validStep
        ) {
            return NaN;
        }
        if (elapsedColumn !== undefined) {
            return ((time - startTime) / elapsedColumn) * columnWidth;
        }

        const offset =
            unit === 'day'
                ? (civilDay(date) - originDay) / step
                : (date.getFullYear() * 12 + date.getMonth() - originMonth) /
                  monthStep;
        let column = Math.floor(offset);
        let left = columnDate(column).getTime();
        let right = columnDate(column + 1).getTime();

        // The estimate uses calendar dates. The actual boundary can fall
        // later in the same day or month because it preserves the origin time.
        while (time < left) {
            right = left;
            left = columnDate(--column).getTime();
        }
        while (time >= right) {
            left = right;
            right = columnDate(++column + 1).getTime();
        }
        return (
            column * columnWidth +
            ((time - left) / (right - left)) * columnWidth
        );
    }

    function xToDate(x: number): Date {
        const offset = x / columnWidth;
        if (!Number.isFinite(offset) || !validStep) return new Date(NaN);
        if (elapsedColumn !== undefined) {
            return new Date(Math.round(startTime + offset * elapsedColumn));
        }

        const column = Math.floor(offset);
        const left = columnDate(column).getTime();
        if (offset === column) return new Date(left);
        const right = columnDate(column + 1).getTime();
        return new Date(Math.round(left + (offset - column) * (right - left)));
    }

    return { columnDate, dateToX, xToDate };
}
