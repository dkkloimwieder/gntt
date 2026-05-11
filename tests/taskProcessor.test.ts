import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    processTask,
    processTasks,
    findDateBounds,
    buildDependencyMap,
} from '../src/utils/taskProcessor';
import {
    setDiagnosticHandler,
    type DiagnosticLevel,
} from '../src/utils/diagnostics';
import type { GanttTask } from '../src/types';

interface DiagnosticEntry {
    level: DiagnosticLevel;
    message: string;
    args: unknown[];
}

let captured: DiagnosticEntry[] = [];

beforeEach(() => {
    captured = [];
    setDiagnosticHandler((level, message, ...args) => {
        captured.push({ level, message, args });
    });
});

afterEach(() => {
    setDiagnosticHandler(null);
});

const config = {
    ganttStart: new Date('2025-01-01T00:00:00'),
    unit: 'hour',
    step: 1,
    columnWidth: 10,
    barHeight: 30,
    padding: 18,
};

function task(overrides: Partial<GanttTask> = {}): GanttTask {
    return {
        id: overrides.id ?? 't',
        name: overrides.name ?? 'task',
        start: overrides.start ?? '2025-01-01 08:00',
        end: overrides.end ?? '2025-01-01 16:00',
        ...overrides,
    };
}

describe('processTask — single task processing', () => {
    it('parses dates from strings', () => {
        const r = processTask(
            task({ start: '2025-01-01 08:00', end: '2025-01-01 16:00' }),
            0,
        );
        expect(r).not.toBeNull();
        expect(r!._start.getHours()).toBe(8);
        expect(r!._end.getHours()).toBe(16);
    });

    it('generates an ID when missing', () => {
        const r = processTask(task({ id: undefined, name: 'My Task' }), 3);
        expect(r!.id).toMatch(/^task-My-Task-3-\d+$/);
    });

    it('clamps progress to 0–100', () => {
        const tooHigh = processTask(task({ progress: 250 }), 0);
        const tooLow = processTask(task({ progress: -50 }), 1);
        const noNumber = processTask(
            task({ progress: 'oops' as unknown as number }),
            2,
        );
        expect(tooHigh!.progress).toBe(100);
        expect(tooLow!.progress).toBe(0);
        expect(noNumber!.progress).toBe(0);
    });

    it('defaults locked to false in normalized constraints', () => {
        const r = processTask(task(), 0);
        expect(r!.constraints.locked).toBe(false);
    });

    it('preserves provided constraint fields and merges locked default', () => {
        const r = processTask(task({ constraints: { minDuration: 2 } }), 0);
        expect(r!.constraints.locked).toBe(false);
        expect(r!.constraints.minDuration).toBe(2);
    });

    it('swaps and warns when end is before start', () => {
        const r = processTask(
            task({
                name: 'reversed',
                start: '2025-01-05 16:00',
                end: '2025-01-05 08:00',
            }),
            0,
        );
        expect(r!._start.getHours()).toBe(8);
        expect(r!._end.getHours()).toBe(16);
        expect(captured.some((e) => /end before start/.test(e.message))).toBe(
            true,
        );
    });

    it('returns null and emits error when duration exceeds 10 years', () => {
        const r = processTask(
            task({ start: '2010-01-01 00:00', end: '2030-01-01 00:00' }),
            0,
        );
        expect(r).toBeNull();
        expect(captured.some((e) => e.level === 'error')).toBe(true);
    });

    it('parses both baseline dates when provided', () => {
        const r = processTask(
            task({
                baselineStart: '2025-01-01 09:00',
                baselineEnd: '2025-01-01 17:00',
            }),
            0,
        );
        expect(r!._baselineStart?.getHours()).toBe(9);
        expect(r!._baselineEnd?.getHours()).toBe(17);
    });

    it('silently ignores half-specified baseline (start only)', () => {
        // gantt-yd4 behavior: both required, otherwise both dropped silently.
        const r = processTask(task({ baselineStart: '2025-01-01 09:00' }), 0);
        expect(r!._baselineStart).toBeUndefined();
        expect(r!._baselineEnd).toBeUndefined();
        expect(captured.some((e) => /baseline/i.test(e.message))).toBe(false);
    });

    it('silently ignores half-specified baseline (end only)', () => {
        const r = processTask(task({ baselineEnd: '2025-01-01 17:00' }), 0);
        expect(r!._baselineStart).toBeUndefined();
        expect(r!._baselineEnd).toBeUndefined();
    });

    it('swaps baseline dates if reversed', () => {
        const r = processTask(
            task({
                baselineStart: '2025-01-01 17:00',
                baselineEnd: '2025-01-01 09:00',
            }),
            0,
        );
        expect(r!._baselineStart?.getHours()).toBe(9);
        expect(r!._baselineEnd?.getHours()).toBe(17);
    });

    it('parses dependency objects with defaults', () => {
        const r = processTask(
            task({
                dependencies: [{ id: 'a' }, { id: 'b', type: 'SS', lag: 4 }],
            }),
            0,
        );
        expect(r!.dependencies).toHaveLength(2);
        expect(r!.dependencies[0]).toEqual({
            id: 'a',
            type: 'FS',
            lag: 0,
            max: undefined,
        });
        expect(r!.dependencies[1]).toEqual({
            id: 'b',
            type: 'SS',
            lag: 4,
            max: undefined,
        });
    });

    it('drops malformed dependency entries silently', () => {
        const r = processTask(
            task({
                dependencies: [
                    { id: 'good' },
                    null as unknown as never,
                    {} as unknown as never,
                ],
            }),
            0,
        );
        expect(r!.dependencies).toHaveLength(1);
        expect(r!.dependencies[0]?.id).toBe('good');
    });

    it('warns when dependencies is not an array', () => {
        const r = processTask(
            task({ dependencies: 'a,b,c' as unknown as never }),
            0,
        );
        expect(r!.dependencies).toEqual([]);
        expect(captured.some((e) => /must be an array/.test(e.message))).toBe(
            true,
        );
    });

    it('uses duration string when end is omitted', () => {
        const r = processTask(
            task({ start: '2025-01-01 08:00', end: undefined, duration: '4h' }),
            0,
        );
        // 8:00 + 4h = 12:00
        expect(r!._end.getHours()).toBe(12);
    });
});

describe('processTasks — batch pipeline', () => {
    it('computes _bar position from dates and config', () => {
        const result = processTasks(
            [
                task({
                    id: 'a',
                    start: '2025-01-01 02:00',
                    end: '2025-01-01 06:00',
                    resource: 'R1',
                }),
            ],
            config,
        );
        expect(result.tasks).toHaveLength(1);
        const t = result.tasks[0]!;
        // x = (2 hours from gantt start) * columnWidth(10) = 20
        expect(t._bar.x).toBeCloseTo(20, 1);
        // width = 4 hours * 10 = 40
        expect(t._bar.width).toBeCloseTo(40, 1);
        expect(t._bar.height).toBe(config.barHeight);
    });

    it('builds relationships from dependencies', () => {
        const result = processTasks(
            [
                task({ id: 'a' }),
                task({
                    id: 'b',
                    dependencies: [{ id: 'a', type: 'FS', lag: 1 }],
                }),
            ],
            config,
        );
        expect(result.relationships).toHaveLength(1);
        expect(result.relationships[0]).toMatchObject({
            from: 'a',
            to: 'b',
            type: 'FS',
            lag: 1,
        });
    });

    it('drops relationships pointing at unknown predecessors', () => {
        const result = processTasks(
            [task({ id: 'b', dependencies: [{ id: 'ghost' }] })],
            config,
        );
        expect(result.relationships).toHaveLength(0);
    });

    it('maps each unique resource to a row index in first-appearance order', () => {
        const result = processTasks(
            [
                task({ id: 'a', resource: 'B' }),
                task({ id: 'b', resource: 'A' }),
                task({ id: 'c', resource: 'B' }),
            ],
            config,
        );
        expect(result.resources).toEqual(['B', 'A']);
        const a = result.tasks.find((t) => t.id === 'a')!;
        const c = result.tasks.find((t) => t.id === 'c')!;
        expect(a._resourceIndex).toBe(0);
        expect(c._resourceIndex).toBe(0);
        expect(a._bar.y).toBe(c._bar.y);
    });

    it('hides tasks whose resource is not in external map (y = -1000)', () => {
        const externalMap = new Map<string, number>([['Visible', 0]]);
        const result = processTasks(
            [
                task({ id: 'shown', resource: 'Visible' }),
                task({ id: 'hidden', resource: 'Collapsed' }),
            ],
            config,
            externalMap,
        );
        const hidden = result.tasks.find((t) => t.id === 'hidden')!;
        expect(hidden._isHidden).toBe(true);
        expect(hidden._bar.y).toBe(-1000);
        expect(hidden._resourceIndex).toBe(-1);

        const shown = result.tasks.find((t) => t.id === 'shown')!;
        expect(shown._isHidden).toBe(false);
        expect(shown._bar.y).toBeGreaterThanOrEqual(0);
    });

    it('treats missing resource as "Unassigned"', () => {
        const result = processTasks([task({ id: 'a' })], config);
        expect(result.resources).toContain('Unassigned');
    });

    it('warns on circular dependency', () => {
        const result = processTasks(
            [
                task({ id: 'a', dependencies: [{ id: 'c' }] }),
                task({ id: 'b', dependencies: [{ id: 'a' }] }),
                task({ id: 'c', dependencies: [{ id: 'b' }] }),
            ],
            config,
        );
        expect(result.relationships.length).toBeGreaterThan(0);
        expect(captured.some((e) => /Circular/.test(e.message))).toBe(true);
    });

    it('computes _baselineBar when both baseline dates present', () => {
        const result = processTasks(
            [
                task({
                    id: 'a',
                    start: '2025-01-01 04:00',
                    end: '2025-01-01 08:00',
                    baselineStart: '2025-01-01 02:00',
                    baselineEnd: '2025-01-01 06:00',
                }),
            ],
            config,
        );
        const t = result.tasks[0]!;
        expect(t._baselineBar?.x).toBeCloseTo(20, 1);
        expect(t._baselineBar?.width).toBeCloseTo(40, 1);
    });

    it('omits _baselineBar when baseline incomplete', () => {
        const result = processTasks(
            [task({ id: 'a', baselineStart: '2025-01-01 02:00' })],
            config,
        );
        expect(result.tasks[0]?._baselineBar).toBeUndefined();
    });

    it('skips tasks rejected by processTask (e.g. >10y duration)', () => {
        const result = processTasks(
            [
                task({ id: 'good' }),
                task({
                    id: 'bad',
                    start: '2010-01-01 00:00',
                    end: '2030-01-01 00:00',
                }),
            ],
            config,
        );
        expect(result.tasks.map((t) => t.id)).toEqual(['good']);
    });
});

describe('findDateBounds', () => {
    it('returns min/max across tasks', () => {
        const bounds = findDateBounds([
            { _start: new Date('2025-03-01'), _end: new Date('2025-03-05') },
            { _start: new Date('2025-01-15'), _end: new Date('2025-02-10') },
            { _start: new Date('2025-02-20'), _end: new Date('2025-04-30') },
        ]);
        expect(bounds.minDate.toISOString().slice(0, 10)).toBe('2025-01-15');
        expect(bounds.maxDate.toISOString().slice(0, 10)).toBe('2025-04-30');
    });

    it('returns now-now style fallback for empty input', () => {
        const bounds = findDateBounds([]);
        expect(bounds.minDate).toBeInstanceOf(Date);
        expect(bounds.maxDate).toBeInstanceOf(Date);
    });
});

describe('buildDependencyMap', () => {
    it('inverts task → predecessors into predecessor → successors', () => {
        const map = buildDependencyMap([
            { id: 'a', dependencies: [] },
            { id: 'b', dependencies: [{ id: 'a', type: 'FS', lag: 0 }] },
            { id: 'c', dependencies: [{ id: 'a', type: 'SS', lag: 0 }] },
            { id: 'd', dependencies: [{ id: 'b', type: 'FS', lag: 0 }] },
        ]);
        expect(map.get('a')).toEqual(['b', 'c']);
        expect(map.get('b')).toEqual(['d']);
        expect(map.has('c')).toBe(false); // no successors
    });

    it('returns empty map for tasks without deps', () => {
        const map = buildDependencyMap([
            { id: 'a', dependencies: [] },
            { id: 'b', dependencies: [] },
        ]);
        expect(map.size).toBe(0);
    });
});
