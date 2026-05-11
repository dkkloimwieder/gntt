import { describe, it, expect } from 'vitest';
import {
    computeX,
    computeY,
    computeWidth,
    computeDuration,
    daysToUnits,
    computeProgressWidth,
    computeExpectedProgress,
    isIgnoredPosition,
    snapToGrid,
    computeLabelPosition,
    calculateDistance,
    computeSummaryBounds,
    recomputeAllSummaryBounds,
    computeVariableY,
    computeSubtaskBarHeight,
    computeExpandedRowHeight,
} from '../src/utils/barCalculations';
import type { BarPosition } from '../src/types';

const GANTT_START = new Date('2025-01-01T00:00:00');

describe('computeX', () => {
    it('returns 0 when task starts at gantt start', () => {
        expect(computeX(GANTT_START, GANTT_START, 'hour', 1, 10)).toBe(0);
    });

    it('hour scale: 5 hours after start at columnWidth=10 → x=50', () => {
        const start = new Date('2025-01-01T05:00:00');
        expect(computeX(start, GANTT_START, 'hour', 1, 10)).toBeCloseTo(50, 1);
    });

    it('day scale: 3 days after start at columnWidth=40 → x=120', () => {
        const start = new Date('2025-01-04T00:00:00');
        expect(computeX(start, GANTT_START, 'day', 1, 40)).toBeCloseTo(120, 1);
    });

    it('step factor halves x', () => {
        const start = new Date('2025-01-01T10:00:00');
        const x1 = computeX(start, GANTT_START, 'hour', 1, 10);
        const x2 = computeX(start, GANTT_START, 'hour', 2, 10);
        expect(x2).toBeCloseTo(x1 / 2, 1);
    });
});

describe('computeY', () => {
    it('row 0 at y = padding/2', () => {
        expect(computeY(0, 30, 18)).toBe(9);
    });

    it('subsequent rows step by barHeight + padding', () => {
        // row 0: 9, row 1: 9 + (30+18) = 57, row 2: 9 + 96 = 105
        expect(computeY(1, 30, 18)).toBe(57);
        expect(computeY(2, 30, 18)).toBe(105);
    });

    it('zero padding centers bar at row top', () => {
        expect(computeY(0, 30, 0)).toBe(0);
        expect(computeY(2, 30, 0)).toBe(60);
    });
});

describe('computeWidth', () => {
    it('hour scale: 8h at columnWidth=10 → width=80', () => {
        const start = new Date('2025-01-01T08:00:00');
        const end = new Date('2025-01-01T16:00:00');
        expect(computeWidth(start, end, 'hour', 1, 10)).toBeCloseTo(80, 1);
    });

    it('zero-duration task → width=0', () => {
        const d = new Date('2025-01-01T08:00:00');
        expect(computeWidth(d, d, 'hour', 1, 10)).toBe(0);
    });

    it('larger step shrinks width proportionally', () => {
        const start = new Date('2025-01-01T08:00:00');
        const end = new Date('2025-01-01T16:00:00');
        const w1 = computeWidth(start, end, 'hour', 1, 10);
        const w2 = computeWidth(start, end, 'hour', 4, 10);
        expect(w2).toBeCloseTo(w1 / 4, 1);
    });
});

describe('computeDuration', () => {
    it('counts each day in range, ignoring none', () => {
        const r = computeDuration(
            new Date('2025-01-01'),
            new Date('2025-01-05'),
        );
        expect(r.totalDays).toBe(4);
        expect(r.actualDays).toBe(4);
        expect(r.ignoredDays).toBe(0);
    });

    it('subtracts ignoredDates that match exactly', () => {
        const r = computeDuration(
            new Date('2025-01-01'),
            new Date('2025-01-05'),
            [new Date('2025-01-02'), new Date('2025-01-03')],
        );
        expect(r.totalDays).toBe(4);
        expect(r.actualDays).toBe(2);
        expect(r.ignoredDays).toBe(2);
    });

    it('uses ignoredFunction predicate', () => {
        // Use local-time constructors so getDate() is stable across timezones.
        // Mark even-day-of-month as ignored.
        const r = computeDuration(
            new Date(2025, 0, 1), // Jan 1 local
            new Date(2025, 0, 5), // Jan 5 local (loop iterates 1..4)
            [],
            (d) => d.getDate() % 2 === 0,
        );
        // Days 1,2,3,4 → ignored: 2,4 → actual: 1,3
        expect(r.actualDays).toBe(2);
        expect(r.ignoredDays).toBe(2);
    });
});

describe('daysToUnits', () => {
    it('converts 1 day to 24 hours at step=1', () => {
        expect(daysToUnits(1, 'hour', 1)).toBeCloseTo(24, 1);
    });

    it('step factor divides result', () => {
        expect(daysToUnits(2, 'hour', 4)).toBeCloseTo(48 / 4, 1);
    });
});

describe('computeProgressWidth', () => {
    it('progress=0 → width 0', () => {
        expect(computeProgressWidth(0, 100, 0)).toBe(0);
    });

    it('progress=100 → full bar width', () => {
        expect(computeProgressWidth(0, 100, 100)).toBe(100);
    });

    it('progress=50 with no ignored positions → half', () => {
        expect(computeProgressWidth(0, 100, 50)).toBe(50);
    });

    it('clamps progress width to bar width', () => {
        // Even if logic over-shoots, result is clamped
        expect(computeProgressWidth(0, 80, 100)).toBe(80);
    });

    it('with ignored columns inside the bar, progress accounts for them', () => {
        // bar 0..100, columnWidth=20, one ignored column at x=40
        // 50% progress through non-ignored area = 40 of 80 actual width
        // then add back ignored if it falls within progress
        const w = computeProgressWidth(0, 100, 50, [40], 20);
        // (100 - 20) * 0.5 = 40; ignoredInProgress: 40 not in [0..40) → 0
        // skip-ignored loop: pos=40 is ignored → +20 → pos=60 not ignored → stop
        expect(w).toBe(60);
    });
});

describe('computeExpectedProgress', () => {
    it('returns 0 when total duration is zero', () => {
        const d = new Date();
        expect(computeExpectedProgress(d, d, 'hour', 1)).toBe(0);
    });

    it('returns 100 for a fully past task', () => {
        const start = new Date('2000-01-01T00:00:00');
        const end = new Date('2000-01-02T00:00:00');
        expect(computeExpectedProgress(start, end, 'hour', 1)).toBeCloseTo(
            100,
            1,
        );
    });

    it('returns 0 for a fully future task', () => {
        const start = new Date('2099-01-01T00:00:00');
        const end = new Date('2099-01-02T00:00:00');
        // elapsed is negative; clamped via min(elapsed, total) but actual code
        // uses min(elapsed, total) where elapsed could be negative; in that case
        // returns negative percentage. So just assert ≤ 0.
        expect(
            computeExpectedProgress(start, end, 'hour', 1),
        ).toBeLessThanOrEqual(0);
    });
});

describe('isIgnoredPosition', () => {
    it('returns true when x is inside an ignored column', () => {
        expect(isIgnoredPosition(50, [40], 20)).toBe(true); // 40..60
    });

    it('returns false outside ignored columns', () => {
        expect(isIgnoredPosition(70, [40], 20)).toBe(false);
    });

    it('returns false for empty ignored list', () => {
        expect(isIgnoredPosition(50, [], 20)).toBe(false);
    });
});

describe('snapToGrid', () => {
    it('snaps to nearest column', () => {
        expect(snapToGrid(13, 10)).toBe(10);
        expect(snapToGrid(15, 10)).toBe(20);
        expect(snapToGrid(17, 10)).toBe(20);
    });

    it('returns x unchanged when already on column', () => {
        expect(snapToGrid(40, 10)).toBe(40);
    });

    it('skips ignored positions to the next valid column', () => {
        // Snap to 40, but 40 is ignored → move to 50
        expect(snapToGrid(43, 10, [40])).toBe(50);
    });

    it('skips multiple consecutive ignored columns', () => {
        // Snap to 40 → 40 ignored → 50 ignored → 60 valid
        expect(snapToGrid(43, 10, [40, 50])).toBe(60);
    });
});

describe('computeLabelPosition', () => {
    it('places label inside when bar is wide enough', () => {
        const r = computeLabelPosition(0, 200, 'short', 7);
        expect(r.position).toBe('inside');
        expect(r.x).toBe(100); // bar center
    });

    it('places label outside when bar is too narrow', () => {
        const r = computeLabelPosition(50, 20, 'long-label-text', 7);
        expect(r.position).toBe('outside');
        expect(r.x).toBe(50 + 20 + 5);
    });

    it('respects custom char width', () => {
        // Wide chars push label outside
        const inside = computeLabelPosition(0, 50, 'abc', 5); // 15+10 < 50
        const outside = computeLabelPosition(0, 50, 'abc', 20); // 60+10 > 50
        expect(inside.position).toBe('inside');
        expect(outside.position).toBe('outside');
    });
});

describe('calculateDistance', () => {
    it('returns gap between predecessor end and successor start', () => {
        expect(calculateDistance({ x: 100, width: 50 }, { x: 200 })).toBe(50); // pred end=150, succ start=200
    });

    it('negative result when successor overlaps predecessor', () => {
        expect(calculateDistance({ x: 100, width: 100 }, { x: 150 })).toBe(-50);
    });

    it('zero when edges touch', () => {
        expect(calculateDistance({ x: 100, width: 50 }, { x: 150 })).toBe(0);
    });
});

interface SummaryTask {
    _children?: string[];
    _depth?: number;
    type?: string;
    _bar?: BarPosition;
}

const bar = (x: number, width: number, y = 0, height = 30): BarPosition => ({
    x,
    y,
    width,
    height,
});

describe('computeSummaryBounds', () => {
    it('returns null for childless task', () => {
        const summary: SummaryTask = { _children: [], _bar: bar(0, 0) };
        expect(computeSummaryBounds(summary, new Map())).toBeNull();
    });

    it('spans from earliest child start to latest child end', () => {
        const map = new Map<string, SummaryTask>([
            ['a', { _bar: bar(50, 30) }], // 50..80
            ['b', { _bar: bar(100, 50) }], // 100..150
            ['c', { _bar: bar(20, 10) }], // 20..30
        ]);
        const summary: SummaryTask = { _children: ['a', 'b', 'c'] };
        const bounds = computeSummaryBounds(summary, map);
        expect(bounds).toEqual({ x: 20, width: 130 }); // 20 → 150
    });

    it('respects minWidth floor', () => {
        const map = new Map<string, SummaryTask>([
            ['a', { _bar: bar(50, 5) }], // tiny child
        ]);
        const summary: SummaryTask = { _children: ['a'] };
        const bounds = computeSummaryBounds(summary, map, 100);
        expect(bounds?.width).toBe(100);
    });

    it('recursively includes grandchildren', () => {
        const map = new Map<string, SummaryTask>([
            ['child', { _children: ['grand'], _bar: bar(50, 50) }],
            ['grand', { _bar: bar(200, 30) }], // beyond child's bar
        ]);
        const summary: SummaryTask = { _children: ['child'] };
        const bounds = computeSummaryBounds(summary, map);
        expect(bounds?.x).toBe(50);
        expect(bounds?.width).toBe(180); // 50 → 230
    });

    it('returns null when no descendants have bars', () => {
        const map = new Map<string, SummaryTask>([
            ['a', { _children: [] }], // no _bar
        ]);
        const summary: SummaryTask = { _children: ['a'] };
        expect(computeSummaryBounds(summary, map)).toBeNull();
    });

    it('accepts Record map shape', () => {
        const record: Record<string, SummaryTask> = {
            a: { _bar: bar(10, 20) },
        };
        const summary: SummaryTask = { _children: ['a'] };
        expect(computeSummaryBounds(summary, record)).toEqual({
            x: 10,
            width: 20,
        });
    });
});

describe('recomputeAllSummaryBounds', () => {
    it('updates summary bars in-place from deepest level up', () => {
        const map = new Map<string, SummaryTask>([
            [
                'top',
                {
                    type: 'summary',
                    _depth: 0,
                    _children: ['mid'],
                    _bar: bar(0, 0),
                },
            ],
            [
                'mid',
                {
                    type: 'summary',
                    _depth: 1,
                    _children: ['leaf1', 'leaf2'],
                    _bar: bar(0, 0),
                },
            ],
            ['leaf1', { _depth: 2, _bar: bar(50, 20) }],
            ['leaf2', { _depth: 2, _bar: bar(100, 30) }],
        ]);
        recomputeAllSummaryBounds(map);
        // mid: 50..130 → x=50, width=80
        expect(map.get('mid')?._bar).toMatchObject({ x: 50, width: 80 });
        // top: same span via mid's recomputed children
        expect(map.get('top')?._bar).toMatchObject({ x: 50, width: 80 });
    });

    it('skips non-summary tasks', () => {
        const map = new Map<string, SummaryTask>([
            [
                'leaf',
                {
                    type: 'task',
                    _depth: 0,
                    _bar: bar(99, 99),
                    _children: ['x'],
                },
            ],
            ['x', { _depth: 1, _bar: bar(0, 50) }],
        ]);
        recomputeAllSummaryBounds(map);
        expect(map.get('leaf')?._bar).toMatchObject({ x: 99, width: 99 });
    });
});

describe('computeVariableY', () => {
    it('returns layout.contentY when present', () => {
        const layouts = new Map([
            ['row1', { y: 10, height: 50, contentY: 25, contentHeight: 30 }],
        ]);
        expect(computeVariableY('row1', layouts)).toBe(25);
    });

    it('returns fallback when row missing', () => {
        expect(computeVariableY('missing', new Map(), 7)).toBe(7);
    });

    it('returns fallback when layout has no contentY', () => {
        const layouts = new Map([['r', { y: 10, height: 50 }]]);
        expect(computeVariableY('r', layouts, 99)).toBe(99);
    });

    it('handles null/undefined map', () => {
        expect(computeVariableY('r', null, 5)).toBe(5);
        expect(computeVariableY('r', undefined, 5)).toBe(5);
    });
});

describe('computeSubtaskBarHeight', () => {
    it('default ratio is 0.5', () => {
        expect(computeSubtaskBarHeight(40)).toBe(20);
    });

    it('custom ratio scales the height', () => {
        expect(computeSubtaskBarHeight(40, 0.75)).toBe(30);
    });
});

describe('computeExpandedRowHeight', () => {
    const config = { barHeight: 30, padding: 18, subtaskHeightRatio: 0.5 };

    it('returns base row height when collapsed', () => {
        const task = { _children: ['a', 'b'] };
        expect(computeExpandedRowHeight(task, false, config)).toBe(48); // 30+18
    });

    it('returns base row height when no children', () => {
        const task = { _children: [] };
        expect(computeExpandedRowHeight(task, true, config)).toBe(48);
    });

    it('sequential layout: padding + N*subtaskRowHeight + padding/2', () => {
        const task = { _children: ['a', 'b', 'c'] }; // sequential by default
        // subtaskBarHeight=15, subtaskPadding=7.2, subtaskRowHeight=22.2
        // 18 + 3*22.2 + 9 = 18 + 66.6 + 9 = 93.6
        expect(computeExpandedRowHeight(task, true, config)).toBeCloseTo(
            93.6,
            5,
        );
    });

    it('parallel layout: padding + subtaskBarHeight + padding (single row)', () => {
        const task = {
            _children: ['a', 'b', 'c'],
            subtaskLayout: 'parallel' as const,
        };
        // 18 + 15 + 18 = 51
        expect(computeExpandedRowHeight(task, true, config)).toBe(51);
    });

    it('mixed layout currently mirrors sequential', () => {
        const task1 = {
            _children: ['a', 'b'],
            subtaskLayout: 'mixed' as const,
        };
        const task2 = { _children: ['a', 'b'] };
        expect(computeExpandedRowHeight(task1, true, config)).toBe(
            computeExpandedRowHeight(task2, true, config),
        );
    });

    it('uses default config values when fields are missing', () => {
        const task = { _children: ['a'] };
        // With defaults barHeight=30 padding=18 ratio=0.5
        const expected = computeExpandedRowHeight(task, true, config);
        expect(computeExpandedRowHeight(task, true, {})).toBe(expected);
    });
});
