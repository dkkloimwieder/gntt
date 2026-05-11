import { describe, it, expect } from 'vitest';
import { findBoxHits } from '../src/hooks/useBoxSelect';
import type { ProcessedTask } from '../src/types';

/**
 * Pure-function coverage for the box-select intersection helper.
 * The hook itself wires DOM events (covered by the demo / playwright);
 * here we just lock in the geometry rules.
 */

function makeTask(
    id: string,
    bar: { x: number; y: number; width: number; height: number } | null,
    extra: Partial<ProcessedTask> = {},
): ProcessedTask {
    return {
        id,
        name: id,
        start: '2025-01-01',
        _start: new Date(2025, 0, 1),
        _end: new Date(2025, 0, 2),
        _index: 0,
        progress: 0,
        constraints: { locked: false },
        dependencies: [],
        _children: [],
        _depth: 0,
        _bar: bar ?? undefined,
        _resourceIndex: 0,
        _isHidden: false,
        ...extra,
    } as unknown as ProcessedTask;
}

describe('findBoxHits', () => {
    it('returns an empty array when no tasks exist', () => {
        expect(
            findBoxHits({ x: 0, y: 0, width: 100, height: 100 }, {}),
        ).toEqual([]);
    });

    it('returns ids for bars fully inside the box', () => {
        const tasks = {
            a: makeTask('a', { x: 10, y: 10, width: 20, height: 20 }),
            b: makeTask('b', { x: 200, y: 200, width: 20, height: 20 }),
        };
        expect(
            findBoxHits({ x: 0, y: 0, width: 100, height: 100 }, tasks).sort(),
        ).toEqual(['a']);
    });

    it('returns ids for bars partially overlapping the box', () => {
        const tasks = {
            a: makeTask('a', { x: 90, y: 90, width: 30, height: 30 }),
        };
        // Box ends at x=100, y=100; bar starts at 90,90 — overlap of 10x10.
        expect(
            findBoxHits({ x: 0, y: 0, width: 100, height: 100 }, tasks),
        ).toEqual(['a']);
    });

    it('excludes bars that touch the edge but do not overlap (open intervals)', () => {
        // Bar at x=100; box ends at x=100. They share only the line x=100.
        const tasks = {
            a: makeTask('a', { x: 100, y: 0, width: 20, height: 20 }),
        };
        expect(
            findBoxHits({ x: 0, y: 0, width: 100, height: 100 }, tasks),
        ).toEqual([]);
    });

    it('excludes hidden tasks', () => {
        const tasks = {
            shown: makeTask('shown', { x: 10, y: 10, width: 20, height: 20 }),
            hidden: makeTask(
                'hidden',
                { x: 10, y: 10, width: 20, height: 20 },
                { _isHidden: true },
            ),
        };
        expect(
            findBoxHits({ x: 0, y: 0, width: 100, height: 100 }, tasks).sort(),
        ).toEqual(['shown']);
    });

    it('excludes tasks with no _bar', () => {
        const tasks = {
            withBar: makeTask('withBar', {
                x: 10,
                y: 10,
                width: 20,
                height: 20,
            }),
            noBar: makeTask('noBar', null),
        };
        expect(
            findBoxHits({ x: 0, y: 0, width: 100, height: 100 }, tasks).sort(),
        ).toEqual(['withBar']);
    });

    it('zero-area box inside a bar: still reports the bar (open-interval rule)', () => {
        // The hook gates this: it never invokes findBoxHits unless the
        // user moved past the threshold. So the math itself can stay
        // permissive — a box at (10,10) of size 0 still satisfies
        // x1<bx2 && x2>bx1 && y1<by2 && y2>by1 against bar (0..50, 0..50).
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 50, height: 50 }),
        };
        expect(
            findBoxHits({ x: 10, y: 10, width: 0, height: 0 }, tasks),
        ).toEqual(['a']);
    });

    it('returns multiple ids when several bars intersect', () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 50, height: 50 }),
            b: makeTask('b', { x: 60, y: 60, width: 30, height: 30 }),
            c: makeTask('c', { x: 200, y: 200, width: 10, height: 10 }),
        };
        const hits = findBoxHits(
            { x: 0, y: 0, width: 150, height: 150 },
            tasks,
        ).sort();
        expect(hits).toEqual(['a', 'b']);
    });

    it('honors negative-width / inverted boxes only when caller normalizes', () => {
        // findBoxHits is documented to assume width/height ≥ 0 (the hook
        // normalizes before calling). With negative width, the math
        // collapses (x1 > x2 ⇒ no overlap). Lock that behavior in.
        const tasks = {
            a: makeTask('a', { x: 10, y: 10, width: 20, height: 20 }),
        };
        expect(
            findBoxHits({ x: 100, y: 0, width: -100, height: 100 }, tasks),
        ).toEqual([]);
    });

    it('includes a bar that wholly contains the box', () => {
        // Tiny box drawn entirely inside a giant bar — still an intersection.
        const tasks = {
            big: makeTask('big', { x: 0, y: 0, width: 500, height: 500 }),
        };
        expect(
            findBoxHits({ x: 100, y: 100, width: 10, height: 10 }, tasks),
        ).toEqual(['big']);
    });
});
