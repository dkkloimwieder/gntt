import { describe, it, expect } from 'vitest';
import {
    isMovementLocked,
    isLeftResizeLocked,
    isRightResizeLocked,
    getMinXFromAbsolute,
    getMaxXFromAbsolute,
    getMinEndFromAbsolute,
    getMaxEndFromAbsolute,
    getMinWidth,
    getMaxWidth,
    applyAbsoluteConstraints,
    wouldViolateAbsolute,
    getMaxPushX,
    getMinPullX,
} from '../src/utils/absoluteConstraints';
import { resolveConstraints } from '../src/utils/constraintEngine';
import type { TaskConstraints, Relationship, BarPosition } from '../src/types';

const PPH = 10;
const GANTT_START = new Date('2025-01-01T00:00:00');

// 24h => 240px, 12h => 120px at PPH=10

describe('lock predicates', () => {
    it('isMovementLocked: true for true, "start", "end"', () => {
        expect(isMovementLocked(true)).toBe(true);
        expect(isMovementLocked('start')).toBe(true);
        expect(isMovementLocked('end')).toBe(true);
    });

    it('isMovementLocked: false for undefined, false, "duration"', () => {
        expect(isMovementLocked(undefined)).toBe(false);
        expect(isMovementLocked(false)).toBe(false);
        expect(isMovementLocked('duration')).toBe(false);
    });

    it('isLeftResizeLocked: true for true, "start", "duration"', () => {
        expect(isLeftResizeLocked(true)).toBe(true);
        expect(isLeftResizeLocked('start')).toBe(true);
        expect(isLeftResizeLocked('duration')).toBe(true);
    });

    it('isLeftResizeLocked: false for "end" and unset', () => {
        expect(isLeftResizeLocked('end')).toBe(false);
        expect(isLeftResizeLocked(undefined)).toBe(false);
    });

    it('isRightResizeLocked: true for true, "end", "duration"', () => {
        expect(isRightResizeLocked(true)).toBe(true);
        expect(isRightResizeLocked('end')).toBe(true);
        expect(isRightResizeLocked('duration')).toBe(true);
    });

    it('isRightResizeLocked: false for "start" and unset', () => {
        expect(isRightResizeLocked('start')).toBe(false);
        expect(isRightResizeLocked(undefined)).toBe(false);
    });
});

describe('absolute date → pixel converters', () => {
    it('getMinXFromAbsolute: returns 0 when no constraint', () => {
        expect(getMinXFromAbsolute(null, GANTT_START, PPH)).toBe(0);
        expect(getMinXFromAbsolute({}, GANTT_START, PPH)).toBe(0);
    });

    it('getMinXFromAbsolute: 5 hours after start → 50px', () => {
        const c: TaskConstraints = { minStart: '2025-01-01 05:00' };
        expect(getMinXFromAbsolute(c, GANTT_START, PPH)).toBeCloseTo(50, 1);
    });

    it('getMinXFromAbsolute: accepts Date instance at runtime', () => {
        // Type declares string-only, but runtime narrows: 'string' → parse,
        // otherwise pass through as Date. Cast to exercise that branch.
        const c = {
            minStart: new Date('2025-01-01T05:00:00') as unknown as string,
        } as TaskConstraints;
        expect(getMinXFromAbsolute(c, GANTT_START, PPH)).toBeCloseTo(50, 1);
    });

    it('getMinXFromAbsolute: invalid date string falls back to 0', () => {
        const c: TaskConstraints = { minStart: 'not-a-date' };
        expect(getMinXFromAbsolute(c, GANTT_START, PPH)).toBe(0);
    });

    it('getMaxXFromAbsolute: Infinity when missing', () => {
        expect(getMaxXFromAbsolute(null, GANTT_START, PPH)).toBe(Infinity);
        expect(getMaxXFromAbsolute({}, GANTT_START, PPH)).toBe(Infinity);
    });

    it('getMaxXFromAbsolute: returns pixel position', () => {
        const c: TaskConstraints = { maxStart: '2025-01-02 00:00' };
        expect(getMaxXFromAbsolute(c, GANTT_START, PPH)).toBeCloseTo(240, 1);
    });

    it('getMinEndFromAbsolute: pixel position from minEnd', () => {
        const c: TaskConstraints = { minEnd: '2025-01-01 12:00' };
        expect(getMinEndFromAbsolute(c, GANTT_START, PPH)).toBeCloseTo(120, 1);
    });

    it('getMaxEndFromAbsolute: pixel position from maxEnd', () => {
        const c: TaskConstraints = { maxEnd: '2025-01-02 00:00' };
        expect(getMaxEndFromAbsolute(c, GANTT_START, PPH)).toBeCloseTo(240, 1);
    });
});

describe('width / duration constraints', () => {
    it('getMinWidth: defaults to 1 hour worth of pixels', () => {
        expect(getMinWidth(null, PPH)).toBe(PPH);
    });

    it('getMinWidth: minDuration overrides default', () => {
        const c: TaskConstraints = { minDuration: 4 }; // 4h
        expect(getMinWidth(c, PPH)).toBe(40);
    });

    it('getMinWidth: explicit defaultMin wins over default', () => {
        expect(getMinWidth(null, PPH, 25)).toBe(25);
    });

    it('getMinWidth: takes max of defaultMin and minDuration', () => {
        const c: TaskConstraints = { minDuration: 2 }; // 20px
        expect(getMinWidth(c, PPH, 50)).toBe(50);
    });

    it('getMaxWidth: Infinity when missing', () => {
        expect(getMaxWidth(null, PPH)).toBe(Infinity);
    });

    it('getMaxWidth: maxDuration scales by PPH', () => {
        const c: TaskConstraints = { maxDuration: 8 };
        expect(getMaxWidth(c, PPH)).toBe(80);
    });
});

describe('applyAbsoluteConstraints', () => {
    it('returns identity when no constraints', () => {
        const r = applyAbsoluteConstraints(100, 50, null, GANTT_START, PPH);
        expect(r).toEqual({ x: 100, width: 50, blocked: false });
    });

    it('blocks when locked=true', () => {
        const c: TaskConstraints = { locked: true };
        const r = applyAbsoluteConstraints(200, 100, c, GANTT_START, PPH);
        expect(r.blocked).toBe(true);
        expect(r.x).toBe(200); // identity x/width on lock per current impl
    });

    it('clamps x up to minStart', () => {
        const c: TaskConstraints = { minStart: '2025-01-01 05:00' };
        const r = applyAbsoluteConstraints(0, 50, c, GANTT_START, PPH);
        expect(r.x).toBeCloseTo(50, 1);
    });

    it('clamps x down to maxStart', () => {
        const c: TaskConstraints = { maxStart: '2025-01-01 05:00' };
        const r = applyAbsoluteConstraints(200, 50, c, GANTT_START, PPH);
        expect(r.x).toBeCloseTo(50, 1);
    });

    it('extends width up to minEnd', () => {
        const c: TaskConstraints = { minEnd: '2025-01-01 10:00' };
        // x=0, width=10 → end=10; minEnd=100 → width pushed to 100
        const r = applyAbsoluteConstraints(0, 10, c, GANTT_START, PPH);
        expect(r.width).toBeCloseTo(100, 1);
    });

    it('shrinks width when end exceeds maxEnd', () => {
        const c: TaskConstraints = { maxEnd: '2025-01-01 05:00' };
        // x=0, width=200 → end=200; maxEnd=50 → width=50
        const r = applyAbsoluteConstraints(0, 200, c, GANTT_START, PPH);
        expect(r.width).toBeCloseTo(50, 1);
    });

    it('clamps width to [minWidth, maxWidth]', () => {
        const c: TaskConstraints = { minDuration: 4, maxDuration: 8 };
        const tooSmall = applyAbsoluteConstraints(0, 10, c, GANTT_START, PPH);
        const tooLarge = applyAbsoluteConstraints(0, 500, c, GANTT_START, PPH);
        expect(tooSmall.width).toBe(40); // 4h
        expect(tooLarge.width).toBe(80); // 8h
    });

    it('blocks when fixedDuration and proposed width changed', () => {
        // fixedDuration is typed as number but runtime checks for truthiness.
        const c: TaskConstraints = {
            fixedDuration: 1,
            minDuration: 4,
            maxDuration: 4,
        };
        // Propose 50px → clamped to 40 (4h) → mismatch → blocked
        const r = applyAbsoluteConstraints(0, 50, c, GANTT_START, PPH);
        expect(r.blocked).toBe(true);
        expect(r.width).toBe(50); // returns proposed width on block
    });
});

describe('wouldViolateAbsolute', () => {
    it('false when no constraints', () => {
        expect(wouldViolateAbsolute(100, 50, null, GANTT_START, PPH)).toBe(
            false,
        );
    });

    it('true when below minStart', () => {
        const c: TaskConstraints = { minStart: '2025-01-01 05:00' };
        expect(wouldViolateAbsolute(0, 50, c, GANTT_START, PPH)).toBe(true);
    });

    it('true when above maxStart', () => {
        const c: TaskConstraints = { maxStart: '2025-01-01 05:00' };
        expect(wouldViolateAbsolute(100, 50, c, GANTT_START, PPH)).toBe(true);
    });

    it('true when end exceeds maxEnd', () => {
        const c: TaskConstraints = { maxEnd: '2025-01-01 05:00' };
        expect(wouldViolateAbsolute(0, 100, c, GANTT_START, PPH)).toBe(true);
    });

    it('false within all bounds', () => {
        const c: TaskConstraints = {
            minStart: '2025-01-01 02:00',
            maxStart: '2025-01-01 10:00',
            maxEnd: '2025-01-01 20:00',
        };
        expect(wouldViolateAbsolute(50, 100, c, GANTT_START, PPH)).toBe(false);
    });
});

describe('getMaxPushX / getMinPullX', () => {
    it('getMaxPushX: Infinity with no constraints', () => {
        expect(getMaxPushX(null, 50, GANTT_START, PPH)).toBe(Infinity);
    });

    it('getMaxPushX: respects maxStart', () => {
        const c: TaskConstraints = { maxStart: '2025-01-01 05:00' };
        expect(getMaxPushX(c, 50, GANTT_START, PPH)).toBeCloseTo(50, 1);
    });

    it('getMaxPushX: respects maxEnd minus width', () => {
        const c: TaskConstraints = { maxEnd: '2025-01-01 10:00' };
        // maxEnd=100, width=20 → maxPush x = 80
        expect(getMaxPushX(c, 20, GANTT_START, PPH)).toBeCloseTo(80, 1);
    });

    it('getMaxPushX: takes minimum of maxStart and (maxEnd - width)', () => {
        const c: TaskConstraints = {
            maxStart: '2025-01-01 03:00', // 30
            maxEnd: '2025-01-01 10:00', // 100, minus width 20 → 80
        };
        expect(getMaxPushX(c, 20, GANTT_START, PPH)).toBeCloseTo(30, 1);
    });

    it('getMinPullX: 0 with no constraints', () => {
        expect(getMinPullX(null, GANTT_START, PPH)).toBe(0);
    });

    it('getMinPullX: returns minStart in pixels', () => {
        const c: TaskConstraints = { minStart: '2025-01-01 05:00' };
        expect(getMinPullX(c, GANTT_START, PPH)).toBeCloseTo(50, 1);
    });
});

describe('integration with resolveConstraints (lock → absolute → dependency ordering)', () => {
    interface T {
        id: string;
        constraints: TaskConstraints;
        _bar: BarPosition;
    }
    const makeTask = (
        id: string,
        x: number,
        width = 50,
        constraints: TaskConstraints = { locked: false },
    ): T => ({
        id,
        constraints,
        _bar: { x, y: 0, width, height: 30 },
    });

    it('lock takes precedence over absolute and dependency constraints', () => {
        const tasks: Record<string, T> = {
            a: makeTask('a', 100, 50, { locked: true }),
        };
        const result = resolveConstraints('a', 500, 50, {
            getBarPosition: (id) => tasks[id]?._bar,
            getTask: (id) => tasks[id],
            relationships: [],
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.blocked).toBe(true);
        expect(result.blockReason).toBe('locked');
        expect(result.constrainedX).toBe(100);
    });

    it('absolute minStart wins when stricter than dependency min', () => {
        const tasks: Record<string, T> = {
            pred: makeTask('pred', 0, 30), // end=30
            target: makeTask('target', 200, 50, {
                locked: false,
                minStart: '2025-01-01 10:00', // = 100
            }),
        };
        const rels: Relationship[] = [
            { from: 'pred', to: 'target', type: 'FS', lag: 0 },
        ];
        // Try to drag target backward to 0; predecessor would allow x≥30,
        // but absolute minStart requires x≥100 → constrained to 100.
        const result = resolveConstraints('target', 0, 50, {
            getBarPosition: (id) => tasks[id]?._bar,
            getTask: (id) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.constrainedX).toBeCloseTo(100, 1);
    });

    it('dependency min wins when stricter than absolute', () => {
        const tasks: Record<string, T> = {
            pred: makeTask('pred', 200, 30), // end=230
            target: makeTask('target', 250, 50, {
                locked: false,
                minStart: '2025-01-01 05:00', // = 50
            }),
        };
        const rels: Relationship[] = [
            { from: 'pred', to: 'target', type: 'FS', lag: 0 },
        ];
        // Try to drag target backward to 0; predecessor min=230, absolute min=50 → 230 wins.
        const result = resolveConstraints('target', 0, 50, {
            getBarPosition: (id) => tasks[id]?._bar,
            getTask: (id) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.constrainedX).toBeCloseTo(230, 1);
    });

    it('conflicting absolute bounds (min > max) flag the move as blocked', () => {
        const tasks: Record<string, T> = {
            target: makeTask('target', 100, 50, {
                locked: false,
                minStart: '2025-01-01 10:00', // 100
                maxStart: '2025-01-01 05:00', // 50 — impossible
            }),
        };
        const result = resolveConstraints('target', 200, 50, {
            getBarPosition: (id) => tasks[id]?._bar,
            getTask: (id) => tasks[id],
            relationships: [],
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.blocked).toBe(true);
        expect(result.blockReason).toBe('conflicting_constraints');
    });
});
