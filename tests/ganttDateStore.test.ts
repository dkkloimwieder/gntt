import { describe, it, expect, afterEach, vi } from 'vitest';
import { createGanttDateStore } from '../src/stores/ganttDateStore';
import * as dateUtils from '../src/utils/dateUtils';
import { settle } from './helpers/settle';

// CHARACTERIZATION SUITE — solid-js 1.9 (SolidJS 2.0 migration, epic E1.2).
//
// `ganttDateStore` is the worst offender in the "write then immediately read
// back" audit (digest-t2 lines 25-28: ganttDateStore.ts:193/195/237/247).
// Every public method here stages a signal write and then calls a helper that
// reads the SAME signal back in the same tick:
//
//   setupDates      -> setGanttStart/setGanttEnd, then generateDates() reads
//                      ganttStart()/ganttEnd()                        (:193/:195)
//   extendTimeline  -> setGanttStart/setGanttEnd, then generateDates()      (:237)
//   changeViewMode  -> setViewModeSignal, then generateDates() reads the
//                      viewMode-derived unit()/step()                       (:247)
//
// On 1.9 a setter runs the update cascade synchronously, so the read-back sees
// the fresh value and everything below is green. Under SolidJS 2.0's deferred
// writes the read-back returns the PREVIOUS value, so `generateDates` would
// walk the stale (or `new Date()`-default) window and emit an empty or wrong
// `dates()` array — a blank first paint with every bar positioned against
// today. These assertions are the tripwire for that: when the runtime flips in
// E3, whatever goes red here is the named regression list for E2.1 (the
// compute-then-apply rewrite that parameterizes `generateDates` and makes
// setupDates/changeViewMode/extendTimeline return the window they computed).
//
// EXPECTED VALUES ARE HAND-DERIVED LITERALS, not re-computations of the
// implementation's own expression and not snapshots of an observed run: every
// window bound and every column count below is written out as an explicit
// `new Date(...)` / integer with the derivation spelled out in the comment
// above it, from the fixture dates plus the view mode's declared padding/step
// in src/utils/defaults.ts. A wrong implementation therefore cannot stay
// self-consistent, and a deleted line cannot be masked by a default that
// happens to agree.
//
// All literals are local-midnight `new Date(y, m, d)` values and every step is
// `dateUtils.add`, which is calendar-based (dateUtils.ts:275-296), so nothing
// here depends on the runner's timezone or on a DST boundary.

// The store's TaskLike accepts a bare `{ start, end }`. Both must be present:
// a missing `end` makes `dateUtils.parse('')` an Invalid Date, `maxDate` stays
// null and `add()` propagates NaN, so `dates()` silently comes back empty.
const NARROW = [{ start: '2025-01-01 08:00', end: '2025-01-10 16:00' }];
const WIDE = [
    { start: '2025-01-01 08:00', end: '2025-01-10 16:00' },
    { start: '2025-03-01 08:00', end: '2025-03-20 16:00' },
];

// `Day` (the default view mode) declares padding '7d', step '1d' and no
// columnWidth, so it falls through to DEFAULT_COLUMN_WIDTH = 45.
const DAY_PADDING = 7;
const DAY_COLUMN_WIDTH = 45;
// `Month` declares padding '2m', step '1m', columnWidth 120.
const MONTH_COLUMN_WIDTH = 120;
// `Week` declares padding '1m', step '7d', columnWidth 140 — the only fixture
// in this file with step !== 1, which is what pins the `units * step` factor.
const WEEK_COLUMN_WIDTH = 140;
// `extendTimeline`'s default `units`.
const EXTEND_UNITS = 10;

// --- NARROW in Day mode -----------------------------------------------------
// min 2025-01-01 08:00 - 7d = 2024-12-25 08:00, start_of('day') + setHours(0)
// => 2024-12-25 00:00. max 2025-01-10 16:00 + 7d = 2025-01-17 16:00, which is
// NOT floored. Columns are one calendar day apart from the window start while
// `current < end`, so Dec 25..Jan 17 inclusive = 7 + 17 = 24.
const NARROW_DAY_START = new Date(2024, 11, 25);
const NARROW_DAY_END = new Date(2025, 0, 17, 16, 0);
const NARROW_DAY_COLUMNS = 24;

// --- WIDE in Day mode -------------------------------------------------------
// Same start (same earliest task); max 2025-03-20 16:00 + 7d = 2025-03-27 16:00.
// Dec 25-31 (7) + Jan (31) + Feb (28) + Mar 1-27 (27) = 93.
const WIDE_DAY_START = new Date(2024, 11, 25);
const WIDE_DAY_END = new Date(2025, 2, 27, 16, 0);
const WIDE_DAY_COLUMNS = 93;
// changeViewMode keeps that window and re-walks it a month at a time from the
// same start: Dec 25, Jan 25, Feb 25, Mar 25 — Apr 25 is past the end. = 4.
const WIDE_MONTH_COLUMNS = 4;

// --- NARROW in Week mode ----------------------------------------------------
// padding '1m': min 2025-01-01 08:00 - 1 month = 2024-12-01 08:00 -> midnight;
// max 2025-01-10 16:00 + 1 month = 2025-02-10 16:00. Step is 7 days, so the
// columns are Dec 1, 8, 15, 22, 29, Jan 5, 12, 19, 26, Feb 2, 9 = 11.
const WEEK_START = new Date(2024, 11, 1);
const WEEK_END = new Date(2025, 1, 10, 16, 0);
const WEEK_COLUMNS = 11;

describe('createGanttDateStore.setupDates — the window is committed before generateDates reads it back', () => {
    it('derives ganttStart/ganttEnd from the task bounds plus the view mode padding', () => {
        const store = createGanttDateStore({});
        store.setupDates(NARROW);
        settle();

        // The Day view mode is what supplies the padding and the step.
        expect(store.viewMode().name).toBe('Day');
        expect(store.unit()).toBe('day');
        expect(store.step()).toBe(1);
        expect(store.columnWidth()).toBe(DAY_COLUMN_WIDTH);

        // ganttStart = start_of(earliest - 7d, 'day'), then hours zeroed.
        expect(store.ganttStart().getTime()).toBe(NARROW_DAY_START.getTime());
        // ganttEnd = latest + 7d, NOT aligned to anything.
        expect(store.ganttEnd().getTime()).toBe(NARROW_DAY_END.getTime());

        // The window strictly contains the tasks.
        expect(store.ganttStart().getTime()).toBeLessThanOrEqual(
            dateUtils.parse(NARROW[0]!.start).getTime(),
        );
        expect(store.ganttEnd().getTime()).toBeGreaterThanOrEqual(
            dateUtils.parse(NARROW[0]!.end).getTime(),
        );
    });

    it('fills that window with one column per step, each exactly one unit after the last', () => {
        const store = createGanttDateStore({});
        store.setupDates(NARROW);
        settle();

        const dates = store.dates();
        expect(dates).toHaveLength(NARROW_DAY_COLUMNS);

        // generateDates starts at ganttStart and loops `while (current < end)`,
        // so the first column IS the window start and the last one falls short
        // of the window end by less than a step.
        expect(dates[0]!.getTime()).toBe(NARROW_DAY_START.getTime());
        expect(dates[NARROW_DAY_COLUMNS - 1]!.getTime()).toBe(
            new Date(2025, 0, 17).getTime(),
        );

        for (let i = 1; i < dates.length; i++) {
            expect(dates[i]!.getTime()).toBe(
                dateUtils.add(dates[i - 1]!, 1, 'day').getTime(),
            );
        }

        // The two memos downstream of dates(). Pinned to the same hand-derived
        // count, NOT to `dates.length` — `dateCount` IS `dates().length`, so
        // reading it back through the accessor it wraps could never fail.
        expect(store.dateCount()).toBe(NARROW_DAY_COLUMNS);
        expect(store.gridWidth()).toBe(NARROW_DAY_COLUMNS * DAY_COLUMN_WIDTH);
        expect(store.gridWidth()).toBe(1080);
    });

    it('maps the window start to x=0 and round-trips a column through dateToX/xToDate', () => {
        const store = createGanttDateStore({});
        store.setupDates(NARROW);
        settle();

        const dates = store.dates();
        expect(store.dateToX(store.ganttStart())).toBe(0);
        expect(store.dateToX(dates[1]!)).toBe(DAY_COLUMN_WIDTH);
        expect(store.dateToX(dates[3]!)).toBe(3 * DAY_COLUMN_WIDTH);
        expect(store.xToDate(DAY_COLUMN_WIDTH).getTime()).toBe(
            new Date(2024, 11, 26).getTime(),
        );
        expect(store.xToDate(3 * DAY_COLUMN_WIDTH).getTime()).toBe(
            new Date(2024, 11, 28).getTime(),
        );
    });

    it('takes the pre-processed _start/_end when a task carries them, ignoring the strings', () => {
        const store = createGanttDateStore({});
        // `start`/`end` are unparseable on purpose: if setupDates stopped
        // preferring `_start`/`_end` (ganttDateStore.ts:163-164) minDate/maxDate
        // become Invalid Dates, `current < end` is false immediately and
        // dates() comes back EMPTY.
        store.setupDates([
            {
                _start: new Date(2025, 4, 1, 8, 0),
                _end: new Date(2025, 4, 3, 16, 0),
                start: 'not-a-date',
                end: 'not-a-date',
            },
        ]);
        settle();

        // May 1 - 7d -> Apr 24 midnight; May 3 16:00 + 7d -> May 10 16:00.
        // Apr 24-30 (7) + May 1-10 (10) = 17 columns.
        expect(store.ganttStart().getTime()).toBe(
            new Date(2025, 3, 24).getTime(),
        );
        expect(store.ganttEnd().getTime()).toBe(
            new Date(2025, 4, 10, 16, 0).getTime(),
        );
        expect(store.dates()).toHaveLength(17);
    });

    it('extends the window by 30 more units on each side when infinitePadding is set', () => {
        const store = createGanttDateStore({});
        store.setupDates(NARROW, true);
        settle();

        // The '7d' padding first, then 30 units of the CURRENT unit ('day') on
        // each side: 2024-12-25 - 30d = 2024-11-25 (floored to midnight) and
        // 2025-01-17 16:00 + 30d = 2025-02-16 16:00.
        expect(store.ganttStart().getTime()).toBe(
            new Date(2024, 10, 25).getTime(),
        );
        expect(store.ganttEnd().getTime()).toBe(
            new Date(2025, 1, 16, 16, 0).getTime(),
        );
        // Nov 25-30 (6) + Dec (31) + Jan (31) + Feb 1-16 (16) = 84.
        expect(store.dates()).toHaveLength(84);
        expect(store.dates()).toHaveLength(NARROW_DAY_COLUMNS + 60);
    });
});

describe('createGanttDateStore.setupDates — empty task list falls back to today', () => {
    // `today()` is read at call time, so freeze the clock: without this a run
    // that straddles local midnight compares a window built before midnight
    // against a `today()` evaluated after it.
    const FROZEN_NOW = new Date(2025, 5, 15, 10, 30, 0);

    afterEach(() => {
        vi.useRealTimers();
    });

    it('falls back to today ± the view mode padding when the task list is empty', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(FROZEN_NOW);

        const store = createGanttDateStore({});
        store.setupDates([]);
        settle();

        // today() = 2025-06-15 00:00; ± the Day mode's '7d'.
        expect(store.ganttStart().getTime()).toBe(
            new Date(2025, 5, 8).getTime(),
        );
        expect(store.ganttEnd().getTime()).toBe(
            new Date(2025, 5, 22).getTime(),
        );
        // Both bounds are midnight-aligned, so the end is excluded: Jun 8..21.
        expect(store.dates()).toHaveLength(2 * DAY_PADDING);
        expect(store.dates()[0]!.getTime()).toBe(
            new Date(2025, 5, 8).getTime(),
        );
        expect(store.dates()[13]!.getTime()).toBe(
            new Date(2025, 5, 21).getTime(),
        );
    });
});

describe('createGanttDateStore.changeViewMode — regenerates the existing window at the new granularity', () => {
    it('switches Day -> Month and re-emits the same window as month columns', () => {
        const store = createGanttDateStore({});
        store.setupDates(WIDE);
        settle();

        expect(store.dates()).toHaveLength(WIDE_DAY_COLUMNS);
        expect(store.ganttStart().getTime()).toBe(WIDE_DAY_START.getTime());
        expect(store.ganttEnd().getTime()).toBe(WIDE_DAY_END.getTime());

        store.changeViewMode('Month');
        settle();

        expect(store.viewMode().name).toBe('Month');
        expect(store.unit()).toBe('month');
        expect(store.step()).toBe(1);
        expect(store.columnWidth()).toBe(MONTH_COLUMN_WIDTH);

        // changeViewMode regenerates over the EXISTING window — it never
        // realigns or re-pads the bounds to the new unit.
        expect(store.ganttStart().getTime()).toBe(WIDE_DAY_START.getTime());
        expect(store.ganttEnd().getTime()).toBe(WIDE_DAY_END.getTime());

        const dates = store.dates();
        expect(dates).toHaveLength(WIDE_MONTH_COLUMNS);
        expect(dates.map((d) => d.getTime())).toEqual([
            new Date(2024, 11, 25).getTime(),
            new Date(2025, 0, 25).getTime(),
            new Date(2025, 1, 25).getTime(),
            new Date(2025, 2, 25).getTime(),
        ]);

        // The loop bound, both sides: the last column is inside the window and
        // one more step would leave it. Without the upper half a generateDates
        // that stopped early would still satisfy every count above.
        const last = dates[dates.length - 1]!;
        expect(last.getTime()).toBeLessThan(WIDE_DAY_END.getTime());
        expect(
            dateUtils.add(last, 1, 'month').getTime(),
        ).toBeGreaterThanOrEqual(WIDE_DAY_END.getTime());

        expect(store.gridWidth()).toBe(WIDE_MONTH_COLUMNS * MONTH_COLUMN_WIDTH);
    });

    it('switching back to Day restores the original column count', () => {
        const store = createGanttDateStore({});
        store.setupDates(WIDE);
        settle();
        expect(store.dates()).toHaveLength(WIDE_DAY_COLUMNS);

        store.changeViewMode('Month');
        settle();
        expect(store.dates()).toHaveLength(WIDE_MONTH_COLUMNS);

        store.changeViewMode('Day');
        settle();

        expect(store.viewMode().name).toBe('Day');
        expect(store.unit()).toBe('day');
        expect(store.columnWidth()).toBe(DAY_COLUMN_WIDTH);
        expect(store.dates()).toHaveLength(WIDE_DAY_COLUMNS);
        expect(store.dates()[0]!.getTime()).toBe(WIDE_DAY_START.getTime());
    });

    it('accepts a view mode object as well as a name', () => {
        const store = createGanttDateStore({});
        store.setupDates(WIDE);
        settle();

        const month = store.viewModes().find((m) => m.name === 'Month')!;
        store.changeViewMode(month);
        settle();

        expect(store.viewMode()).toBe(month);
        expect(store.unit()).toBe('month');
        expect(store.dates()).toHaveLength(WIDE_MONTH_COLUMNS);
    });

    it('ignores an unknown mode name — a silent no-op, not a throw', () => {
        const store = createGanttDateStore({});
        store.setupDates(NARROW);
        settle();
        const dates = store.dates();

        store.changeViewMode('NotAMode');
        settle();

        expect(store.viewMode().name).toBe('Day');
        // Nothing was written, so dates() is the very same array instance.
        expect(store.dates()).toBe(dates);
        expect(store.dates()).toHaveLength(NARROW_DAY_COLUMNS);
    });

    it('setViewMode is the mode-changing method, not a bare signal setter', () => {
        const store = createGanttDateStore({});
        store.setupDates(WIDE);
        settle();

        // Behavioural, not an identity check against the object literal at
        // ganttDateStore.ts:358: calling the PUBLIC `setViewMode` must also
        // regenerate the columns. If E2.1 rewires it to the raw
        // `setViewModeSignal`, unit() would still flip to 'month' but dates()
        // would still hold the 93 day columns.
        store.setViewMode('Month');
        settle();

        expect(store.viewMode().name).toBe('Month');
        expect(store.unit()).toBe('month');
        expect(store.dates()).toHaveLength(WIDE_MONTH_COLUMNS);
        expect(store.gridWidth()).toBe(WIDE_MONTH_COLUMNS * MONTH_COLUMN_WIDTH);
    });
});

describe('createGanttDateStore.generateDates — walks the current window directly', () => {
    it('re-emits the columns for a window written through the raw signal setters', () => {
        const store = createGanttDateStore({});
        // No setupDates: the public generateDates() is otherwise only reachable
        // through setupDates/extendTimeline/changeViewMode.
        expect(store.dates()).toHaveLength(0);

        store.setGanttStart(new Date(2025, 0, 1));
        store.setGanttEnd(new Date(2025, 0, 6, 12, 0));
        settle();
        // The setters alone do NOT regenerate — dates() is still empty.
        expect(store.dates()).toHaveLength(0);

        store.generateDates();
        settle();

        // Jan 1..Jan 6 (Jan 6 00:00 < Jan 6 12:00), so 6 columns.
        expect(store.dates().map((d) => d.getTime())).toEqual([
            new Date(2025, 0, 1).getTime(),
            new Date(2025, 0, 2).getTime(),
            new Date(2025, 0, 3).getTime(),
            new Date(2025, 0, 4).getTime(),
            new Date(2025, 0, 5).getTime(),
            new Date(2025, 0, 6).getTime(),
        ]);
    });
});

describe('createGanttDateStore.extendTimeline — grows the window in place', () => {
    // Day mode has step 1, so these first three cases pin the DEFAULT unit
    // count and the direction only — `units * step` is pinned by the Week
    // cases below, where the two factors are distinguishable.
    it('extends right by the default 10 units, appending that many columns', () => {
        const store = createGanttDateStore({});
        store.setupDates(NARROW);
        settle();
        expect(store.dates()).toHaveLength(NARROW_DAY_COLUMNS);

        store.extendTimeline('right');
        settle();

        // Day mode: step 1, so 10 units = 10 days. 2025-01-17 16:00 + 10d.
        expect(store.ganttEnd().getTime()).toBe(
            new Date(2025, 0, 27, 16, 0).getTime(),
        );
        expect(store.ganttStart().getTime()).toBe(NARROW_DAY_START.getTime());
        expect(store.dates()).toHaveLength(NARROW_DAY_COLUMNS + EXTEND_UNITS);
        expect(store.dates()[0]!.getTime()).toBe(NARROW_DAY_START.getTime());
        expect(
            store.dates()[NARROW_DAY_COLUMNS + EXTEND_UNITS - 1]!.getTime(),
        ).toBe(new Date(2025, 0, 27).getTime());
    });

    it('extends left, moving ganttStart back and prepending columns', () => {
        const store = createGanttDateStore({});
        store.setupDates(NARROW);
        settle();

        store.extendTimeline('left');
        settle();

        // 2024-12-25 - 10d.
        expect(store.ganttStart().getTime()).toBe(
            new Date(2024, 11, 15).getTime(),
        );
        expect(store.ganttEnd().getTime()).toBe(NARROW_DAY_END.getTime());
        expect(store.dates()).toHaveLength(NARROW_DAY_COLUMNS + EXTEND_UNITS);
        expect(store.dates()[0]!.getTime()).toBe(
            new Date(2024, 11, 15).getTime(),
        );
    });

    it('honours an explicit unit count', () => {
        const store = createGanttDateStore({});
        store.setupDates(NARROW);
        settle();

        store.extendTimeline('right', 3);
        settle();

        expect(store.ganttEnd().getTime()).toBe(
            new Date(2025, 0, 20, 16, 0).getTime(),
        );
        expect(store.dates()).toHaveLength(NARROW_DAY_COLUMNS + 3);
    });

    it('multiplies units by the view mode step — Week moves 7 days per unit', () => {
        // The ONLY fixture in this file where step !== 1. In Day and Month mode
        // `units * step` is indistinguishable from `units`, so without this
        // case the `* stepVal` factor at ganttDateStore.ts:228/:233 could be
        // deleted with the whole suite still green.
        const store = createGanttDateStore({ viewMode: 'Week' });
        store.setupDates(NARROW);
        settle();

        expect(store.unit()).toBe('day');
        expect(store.step()).toBe(7);
        expect(store.columnWidth()).toBe(WEEK_COLUMN_WIDTH);
        expect(store.ganttStart().getTime()).toBe(WEEK_START.getTime());
        expect(store.ganttEnd().getTime()).toBe(WEEK_END.getTime());
        expect(store.dates()).toHaveLength(WEEK_COLUMNS);
        for (let i = 1; i < store.dates().length; i++) {
            expect(store.dates()[i]!.getTime()).toBe(
                dateUtils.add(store.dates()[i - 1]!, 7, 'day').getTime(),
            );
        }

        store.extendTimeline('right', 2);
        settle();

        // 2 units x step 7 = 14 days: 2025-02-10 16:00 -> 2025-02-24 16:00,
        // appending exactly the Feb 16 and Feb 23 columns. A step-blind
        // implementation would land on 2025-02-12 16:00 and append none.
        expect(store.ganttEnd().getTime()).toBe(
            new Date(2025, 1, 24, 16, 0).getTime(),
        );
        expect(store.dates()).toHaveLength(WEEK_COLUMNS + 2);
        expect(store.dates()[WEEK_COLUMNS]!.getTime()).toBe(
            new Date(2025, 1, 16).getTime(),
        );
        expect(store.dates()[WEEK_COLUMNS + 1]!.getTime()).toBe(
            new Date(2025, 1, 23).getTime(),
        );
    });

    it('multiplies units by the view mode step on the left edge too', () => {
        const store = createGanttDateStore({ viewMode: 'Week' });
        store.setupDates(NARROW);
        settle();

        store.extendTimeline('left', 2);
        settle();

        // 2024-12-01 - 14d = 2024-11-17, prepending Nov 17 and Nov 24.
        expect(store.ganttStart().getTime()).toBe(
            new Date(2024, 10, 17).getTime(),
        );
        expect(store.ganttEnd().getTime()).toBe(WEEK_END.getTime());
        expect(store.dates()).toHaveLength(WEEK_COLUMNS + 2);
        expect(store.dates()[0]!.getTime()).toBe(
            new Date(2024, 10, 17).getTime(),
        );
        expect(store.dates()[1]!.getTime()).toBe(
            new Date(2024, 10, 24).getTime(),
        );
    });

    it('extends in the CURRENT unit, not in days', () => {
        const store = createGanttDateStore({});
        store.setupDates(WIDE);
        settle();
        store.changeViewMode('Month');
        settle();
        expect(store.dates()).toHaveLength(WIDE_MONTH_COLUMNS);

        store.extendTimeline('right', 2);
        settle();

        // 2 MONTHS past 2025-03-27 16:00, not 2 days: 2025-05-27 16:00, which
        // adds the Apr 25 and May 25 columns.
        expect(store.ganttEnd().getTime()).toBe(
            new Date(2025, 4, 27, 16, 0).getTime(),
        );
        expect(store.dates()).toHaveLength(WIDE_MONTH_COLUMNS + 2);
        expect(store.dates()[WIDE_MONTH_COLUMNS]!.getTime()).toBe(
            new Date(2025, 3, 25).getTime(),
        );
        expect(store.dates()[WIDE_MONTH_COLUMNS + 1]!.getTime()).toBe(
            new Date(2025, 4, 25).getTime(),
        );
    });
});
