import { describe, it, expect } from 'vitest';
import {
    calculateRowLayouts,
    calculateExpandedRowHeight,
    findRowAtY,
    rowLayoutsToSortedArray,
    getVisibleRowRange,
    computeSubtaskY,
    calculateSimpleRowLayouts,
    type RowLayout,
} from '../src/utils/rowLayoutCalculator';

interface TaskLike {
    id: string;
    resource?: string;
    parentId?: string;
    type?: string;
    _start?: Date | number;
    _end?: Date | number;
    _children?: string[];
    subtaskLayout?: 'sequential' | 'parallel' | 'mixed';
    order?: number;
    _bar?: { x: number; y: number; width: number; height: number };
}

const config = { barHeight: 30, padding: 18, subtaskHeightRatio: 0.5 };
const baseRowHeight = config.barHeight + config.padding; // 48

describe('calculateSimpleRowLayouts', () => {
    it('returns one layout per row plus __total__', () => {
        const rows = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
        const layouts = calculateSimpleRowLayouts(rows, config);
        expect(layouts.size).toBe(4); // 3 rows + total
        expect(layouts.get('A')?.y).toBe(0);
        expect(layouts.get('B')?.y).toBe(baseRowHeight);
        expect(layouts.get('C')?.y).toBe(baseRowHeight * 2);
    });

    it('contentY is offset by padding/2; contentHeight equals barHeight', () => {
        const layouts = calculateSimpleRowLayouts([{ id: 'A' }], config);
        const a = layouts.get('A')!;
        expect(a.contentY).toBe(9);
        expect(a.contentHeight).toBe(30);
    });

    it('__total__ records cumulative height', () => {
        const layouts = calculateSimpleRowLayouts(
            [{ id: 'A' }, { id: 'B' }],
            config,
        );
        expect(layouts.get('__total__')).toEqual({
            y: 0,
            height: baseRowHeight * 2,
        });
    });

    it('preserves type metadata on each row', () => {
        const layouts = calculateSimpleRowLayouts(
            [
                { id: 'A', type: 'group' },
                { id: 'B', type: 'resource' },
            ],
            config,
        );
        expect(layouts.get('A')?.type).toBe('group');
        expect(layouts.get('B')?.type).toBe('resource');
    });

    it('uses default config values when fields omitted', () => {
        const layouts = calculateSimpleRowLayouts([{ id: 'A' }], {});
        // Default: barHeight=30, padding=18 → rowHeight=48
        expect(layouts.get('A')?.height).toBe(48);
    });

    it('empty rows → only __total__ with height=0', () => {
        const layouts = calculateSimpleRowLayouts([], config);
        expect(layouts.size).toBe(1);
        expect(layouts.get('__total__')).toEqual({ y: 0, height: 0 });
    });
});

describe('calculateExpandedRowHeight', () => {
    it('childless task → baseRowHeight', () => {
        expect(
            calculateExpandedRowHeight(
                { id: 'a', _children: [] },
                config,
                null,
            ),
        ).toBe(baseRowHeight);
    });

    it('sequential layout → baseRowHeight regardless of child count', () => {
        const task: TaskLike = {
            id: 'a',
            _children: ['b', 'c', 'd'],
            subtaskLayout: 'sequential',
        };
        expect(calculateExpandedRowHeight(task, config, null)).toBe(
            baseRowHeight,
        );
    });

    it('parallel layout: stacks child rows with padding', () => {
        const task: TaskLike = {
            id: 'a',
            _children: ['b', 'c', 'd'],
            subtaskLayout: 'parallel',
        };
        // verticalPadding=(30-15)/2=7.5, rowCount=3
        // 7.5*2 + 3*15 + 2*(18*0.4) = 15 + 45 + 14.4 = 74.4
        expect(calculateExpandedRowHeight(task, config, null)).toBeCloseTo(
            74.4,
            5,
        );
    });

    it('mixed layout uses subtask overlap analysis', () => {
        // Two children that don't overlap → 1 row
        const task: TaskLike = {
            id: 'a',
            _children: ['b', 'c'],
            subtaskLayout: 'mixed',
        };
        const map: Record<string, TaskLike> = {
            a: task,
            b: { id: 'b', _start: 0, _end: 50 },
            c: { id: 'c', _start: 60, _end: 100 }, // no overlap
        };
        const h1 = calculateExpandedRowHeight(task, config, map);
        // 1 row: 7.5*2 + 1*15 + 0 = 30
        expect(h1).toBeCloseTo(30, 5);
    });

    it('mixed layout: overlapping subtasks → multiple rows', () => {
        const task: TaskLike = {
            id: 'a',
            _children: ['b', 'c'],
            subtaskLayout: 'mixed',
        };
        const map: Record<string, TaskLike> = {
            a: task,
            b: { id: 'b', _start: 0, _end: 100 },
            c: { id: 'c', _start: 50, _end: 150 }, // overlaps b
        };
        const h = calculateExpandedRowHeight(task, config, map);
        // 2 rows: 7.5*2 + 2*15 + 1*7.2 = 15 + 30 + 7.2 = 52.2
        expect(h).toBeCloseTo(52.2, 5);
    });

    it('unknown layout → baseRowHeight fallback', () => {
        const task = {
            id: 'a',
            _children: ['b'],
            subtaskLayout: 'weird' as 'sequential',
        };
        expect(calculateExpandedRowHeight(task, config, null)).toBe(
            baseRowHeight,
        );
    });
});

describe('calculateRowLayouts — simple cases', () => {
    it('rows with no tasks default to baseRowHeight', () => {
        const layouts = calculateRowLayouts(
            [{ id: 'R1' }, { id: 'R2' }],
            config,
            null,
            null,
        );
        expect(layouts.get('R1')?.height).toBe(baseRowHeight);
        expect(layouts.get('R2')?.y).toBe(baseRowHeight);
    });

    it('always emits __total__', () => {
        const layouts = calculateRowLayouts([{ id: 'R1' }], config, null, null);
        expect(layouts.get('__total__')?.height).toBe(baseRowHeight);
    });

    it('row with a single task: height = padding/2 + baseRowHeight, task at padding/2', () => {
        const tasks: Record<string, TaskLike> = {
            t1: { id: 't1', resource: 'R1', _start: 0, _end: 100 },
        };
        const layouts = calculateRowLayouts(
            [{ id: 'R1' }],
            config,
            null,
            tasks,
        );
        // sub-row starts at baseY=padding/2=9 with height=baseRowHeight=48,
        // bottom is 57 → actualRowHeight = max(baseRowHeight=48, 57) = 57.
        expect(layouts.get('R1')?.height).toBe(57);
        const t1pos = layouts.get('R1')?.taskPositions?.get('t1');
        expect(t1pos?.y).toBe(9);
    });

    it('overlapping tasks stack into sub-rows, growing the row', () => {
        const tasks: Record<string, TaskLike> = {
            t1: { id: 't1', resource: 'R1', _start: 0, _end: 100 },
            t2: { id: 't2', resource: 'R1', _start: 50, _end: 150 }, // overlaps t1
        };
        const layouts = calculateRowLayouts(
            [{ id: 'R1' }],
            config,
            null,
            tasks,
        );
        const r1 = layouts.get('R1')!;
        // Two stacked sub-rows of height baseRowHeight each → row height grows
        expect(r1.height).toBeGreaterThan(baseRowHeight);
        const t1y = r1.taskPositions?.get('t1')?.y ?? 0;
        const t2y = r1.taskPositions?.get('t2')?.y ?? 0;
        expect(t2y).toBeGreaterThan(t1y); // t2 placed below t1
    });

    it('expanded sequential parent: children get the same y as parent + verticalPadding', () => {
        const tasks: Record<string, TaskLike> = {
            p: {
                id: 'p',
                resource: 'R1',
                _start: 0,
                _end: 100,
                _children: ['c1', 'c2'],
                subtaskLayout: 'sequential',
            },
            c1: { id: 'c1', parentId: 'p', _start: 0, _end: 40 },
            c2: { id: 'c2', parentId: 'p', _start: 50, _end: 100 },
        };
        const expanded = new Set(['p']);
        const layouts = calculateRowLayouts(
            [{ id: 'R1' }],
            config,
            expanded,
            tasks,
        );
        const r1 = layouts.get('R1')!;
        const py = r1.taskPositions?.get('p')?.y ?? 0;
        const c1y = r1.taskPositions?.get('c1')?.y ?? 0;
        const c2y = r1.taskPositions?.get('c2')?.y ?? 0;
        // sequential: children share same y (parent + verticalPadding)
        expect(c1y).toBe(c2y);
        expect(c1y).toBeGreaterThan(py);
    });

    it('expanded parallel parent: children stack vertically', () => {
        const tasks: Record<string, TaskLike> = {
            p: {
                id: 'p',
                resource: 'R1',
                _start: 0,
                _end: 100,
                _children: ['c1', 'c2', 'c3'],
                subtaskLayout: 'parallel',
            },
            c1: { id: 'c1', parentId: 'p' },
            c2: { id: 'c2', parentId: 'p' },
            c3: { id: 'c3', parentId: 'p' },
        };
        const layouts = calculateRowLayouts(
            [{ id: 'R1' }],
            config,
            new Set(['p']),
            tasks,
        );
        const r1 = layouts.get('R1')!;
        const ys = ['c1', 'c2', 'c3'].map(
            (id) => r1.taskPositions?.get(id)?.y ?? 0,
        );
        expect(ys[1]).toBeGreaterThan(ys[0]!);
        expect(ys[2]).toBeGreaterThan(ys[1]!);
    });

    it('records expanded task ids in row.expandedTasks', () => {
        const tasks: Record<string, TaskLike> = {
            p: {
                id: 'p',
                resource: 'R1',
                _children: ['c'],
                subtaskLayout: 'sequential',
            },
            c: { id: 'c', parentId: 'p' },
        };
        const layouts = calculateRowLayouts(
            [{ id: 'R1' }],
            config,
            new Set(['p']),
            tasks,
        );
        expect(layouts.get('R1')?.expandedTasks).toEqual(['p']);
    });

    it('skips project-type tasks in the expanded list', () => {
        const tasks: Record<string, TaskLike> = {
            proj: {
                id: 'proj',
                resource: 'R1',
                type: 'project',
                _children: ['c'],
            },
            c: { id: 'c', parentId: 'proj' },
        };
        const layouts = calculateRowLayouts(
            [{ id: 'R1' }],
            config,
            new Set(['proj']),
            tasks,
        );
        expect(layouts.get('R1')?.expandedTasks).toEqual([]);
    });

    it('cumulativeY accumulates across rows', () => {
        const tasks: Record<string, TaskLike> = {
            t1: { id: 't1', resource: 'R1', _start: 0, _end: 50 },
            t2: { id: 't2', resource: 'R2', _start: 0, _end: 50 },
        };
        const layouts = calculateRowLayouts(
            [{ id: 'R1' }, { id: 'R2' }],
            config,
            null,
            tasks,
        );
        expect(layouts.get('R2')?.y).toBe(layouts.get('R1')?.height ?? 0);
    });
});

describe('findRowAtY', () => {
    const rows: RowLayout[] = [
        { y: 0, height: 50 },
        { y: 50, height: 50 },
        { y: 100, height: 100 },
    ];

    it('returns -1 for empty input', () => {
        expect(findRowAtY([], 25)).toBe(-1);
    });

    it('returns 0 for negative y', () => {
        expect(findRowAtY(rows, -10)).toBe(0);
    });

    it('finds row containing the given y', () => {
        expect(findRowAtY(rows, 25)).toBe(0);
        expect(findRowAtY(rows, 75)).toBe(1);
        expect(findRowAtY(rows, 150)).toBe(2);
    });

    it('returns last row for y past the end', () => {
        expect(findRowAtY(rows, 9999)).toBe(rows.length - 1);
    });

    it('binary search handles edge boundaries (inclusive start, exclusive end)', () => {
        expect(findRowAtY(rows, 50)).toBe(1);
        expect(findRowAtY(rows, 100)).toBe(2);
    });
});

describe('rowLayoutsToSortedArray', () => {
    it('omits __total__ entry and sorts by y', () => {
        const layouts = new Map<string, RowLayout>([
            ['B', { y: 100, height: 50 }],
            ['__total__', { y: 0, height: 200 }],
            ['A', { y: 0, height: 100 }],
            ['C', { y: 150, height: 50 }],
        ]);
        const arr = rowLayoutsToSortedArray(layouts);
        expect(arr.map((r) => r.id)).toEqual(['A', 'B', 'C']);
    });

    it('returns empty array for layouts containing only __total__', () => {
        const layouts = new Map<string, RowLayout>([
            ['__total__', { y: 0, height: 0 }],
        ]);
        expect(rowLayoutsToSortedArray(layouts)).toEqual([]);
    });
});

describe('getVisibleRowRange', () => {
    const rows: RowLayout[] = Array.from({ length: 10 }, (_, i) => ({
        y: i * 50,
        height: 50,
    }));

    it('returns 0..0 for empty rows', () => {
        const r = getVisibleRowRange([], 0, 100);
        expect(r).toEqual({ startIndex: 0, endIndex: 0 });
    });

    it('viewport at start with default overscan=2', () => {
        const r = getVisibleRowRange(rows, 0, 100);
        // findRowAtY(0)=0; -overscan→0; findRowAtY(100)=2; +1+overscan→5
        expect(r.startIndex).toBe(0);
        expect(r.endIndex).toBe(5);
    });

    it('viewport mid-list', () => {
        const r = getVisibleRowRange(rows, 200, 100);
        // findRowAtY(200)=4; -2 → 2; findRowAtY(300)=6; +1+2 → 9
        expect(r.startIndex).toBe(2);
        expect(r.endIndex).toBe(9);
    });

    it('clamps endIndex at rows.length', () => {
        const r = getVisibleRowRange(rows, 450, 100);
        expect(r.endIndex).toBeLessThanOrEqual(rows.length);
    });

    it('overscan=0 returns minimal range', () => {
        const r = getVisibleRowRange(rows, 100, 100, 0);
        expect(r.startIndex).toBe(2);
        expect(r.endIndex).toBe(5);
    });
});

describe('computeSubtaskY', () => {
    it('sequential: returns parentContentY unchanged', () => {
        expect(computeSubtaskY(2, 50, 'sequential', config)).toBe(50);
    });

    it('parallel: stacks by index', () => {
        // subtaskBarHeight=15, subtaskPadding=7.2, subtaskRowHeight=22.2
        // index=2: parent + padding/2 + 2*22.2 = 50 + 9 + 44.4 = 103.4
        expect(computeSubtaskY(2, 50, 'parallel', config)).toBeCloseTo(
            103.4,
            5,
        );
    });

    it('mixed: uses provided subtaskRow', () => {
        // subtaskRow=1: 50 + 9 + 1*22.2 = 81.2
        expect(computeSubtaskY(0, 50, 'mixed', config, 1)).toBeCloseTo(81.2, 5);
    });

    it('uses default config when fields missing', () => {
        // Defaults: barHeight=30 padding=18 ratio=0.5 — same numbers
        const a = computeSubtaskY(1, 0, 'parallel', {});
        const b = computeSubtaskY(1, 0, 'parallel', config);
        expect(a).toBe(b);
    });
});
