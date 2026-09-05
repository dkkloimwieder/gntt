import { describe, it, expect } from 'vitest';
import {
    EPSILON_PX,
    MAX_CASCADE_ITERATIONS,
    DEP_TYPES,
    buildRelationshipIndex,
    getDepOffsets,
    getPredAnchor,
    getSuccRef,
    constrainsSuccEnd,
    constrainsPredEnd,
    getMinSuccessorX,
    getMaxSuccessorX,
    getMaxPredEnd,
    getMaxPredStart,
    getMinXFromPredecessors,
    getMaxXFromPredecessors,
    getMaxEndFromDownstream,
    getMaxXFromLockedSuccessors,
    calculateCascadeUpdates,
    resolveResizeCascade,
    resolveConstraints,
    detectCycles,
    collectDependentTasks,
    clampBatchDeltaX,
    getMaxEndFromLockedSuccessors,
} from '../src/utils/constraintEngine';
import {
    generateLinearChain,
    generateFanOut,
    generateDenseGraph,
    generateWithLocks,
    buildContext,
} from '../benchmarks/constraint/generateBenchData';
import type { Relationship } from '../src/types';

const PPH = 10; // pixels per hour
const GANTT_START = new Date('2025-01-01');

// Tiny helper to make a BarLike
const bar = (x: number, width: number) => ({ x, width });

// Build a tiny task lookup the engine accepts
function makeTasks(
    rows: Array<{
        id: string;
        x: number;
        width?: number;
        locked?: boolean;
    }>,
) {
    const tasks: Record<
        string,
        {
            id: string;
            _bar: { x: number; y: number; width: number; height: number };
            constraints: { locked: boolean };
        }
    > = {};
    for (const r of rows) {
        tasks[r.id] = {
            id: r.id,
            _bar: { x: r.x, y: 0, width: r.width ?? 80, height: 30 },
            constraints: { locked: r.locked ?? false },
        };
    }
    return tasks;
}

describe('constants', () => {
    it('EPSILON_PX is a small positive number', () => {
        expect(EPSILON_PX).toBeGreaterThan(0);
        expect(EPSILON_PX).toBeLessThan(1);
    });

    it('MAX_CASCADE_ITERATIONS guards against infinite loops', () => {
        expect(MAX_CASCADE_ITERATIONS).toBeGreaterThanOrEqual(10);
    });

    it('DEP_TYPES exposes FS/SS/FF/SF', () => {
        expect(DEP_TYPES.FS).toBe('FS');
        expect(DEP_TYPES.SS).toBe('SS');
        expect(DEP_TYPES.FF).toBe('FF');
        expect(DEP_TYPES.SF).toBe('SF');
    });
});

describe('buildRelationshipIndex', () => {
    it('indexes by predecessor and successor', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'a', to: 'c', type: 'SS', lag: 0 },
            { from: 'b', to: 'c', type: 'FF', lag: 0 },
        ];
        const idx = buildRelationshipIndex(rels);
        expect(idx.byPredecessor.get('a')).toHaveLength(2);
        expect(idx.byPredecessor.get('b')).toHaveLength(1);
        expect(idx.bySuccessor.get('c')).toHaveLength(2);
        expect(idx.bySuccessor.get('b')).toHaveLength(1);
    });

    it('returns empty maps for empty input', () => {
        const idx = buildRelationshipIndex([]);
        expect(idx.bySuccessor.size).toBe(0);
        expect(idx.byPredecessor.size).toBe(0);
    });
});

describe('getDepOffsets', () => {
    it('default elastic: max=undefined → Infinity, isElastic true', () => {
        const off = getDepOffsets(
            { from: 'a', to: 'b', type: 'FS', lag: 2 },
            PPH,
        );
        expect(off.lag).toBe(20);
        expect(off.min).toBe(0);
        expect(off.max).toBe(Infinity);
        expect(off.minGap).toBe(20);
        expect(off.maxGap).toBe(Infinity);
        expect(off.isElastic).toBe(true);
        expect(off.isFixed).toBe(false);
    });

    it('explicit max=null also treated as elastic', () => {
        const off = getDepOffsets(
            {
                from: 'a',
                to: 'b',
                type: 'FS',
                lag: 1,
                min: 0,
                max: null as unknown as number,
            },
            PPH,
        );
        expect(off.isElastic).toBe(true);
        expect(off.maxGap).toBe(Infinity);
    });

    it('max=0 → fixed gap (push and pull)', () => {
        const off = getDepOffsets(
            { from: 'a', to: 'b', type: 'FS', lag: 3, min: 0, max: 0 },
            PPH,
        );
        expect(off.max).toBe(0);
        expect(off.isFixed).toBe(true);
        expect(off.isElastic).toBe(false);
        expect(off.maxGap).toBe(30);
    });

    it('max=N → bounded', () => {
        const off = getDepOffsets(
            { from: 'a', to: 'b', type: 'FS', lag: 1, min: 0, max: 5 },
            PPH,
        );
        expect(off.max).toBe(50);
        expect(off.maxGap).toBe(60);
        expect(off.isElastic).toBe(false);
        expect(off.isFixed).toBe(false);
    });

    it('non-zero min and lag', () => {
        const off = getDepOffsets(
            { from: 'a', to: 'b', type: 'FS', lag: 2, min: 1, max: 5 },
            PPH,
        );
        expect(off.lag).toBe(20);
        expect(off.min).toBe(10);
        expect(off.minGap).toBe(30);
        expect(off.maxGap).toBe(70);
    });
});

describe('anchor / ref selectors', () => {
    const predBar = bar(100, 50); // end = 150
    const succBar = bar(200, 80); // end = 280

    it('FS/FF anchor on predecessor end', () => {
        expect(getPredAnchor('FS', predBar)).toBe(150);
        expect(getPredAnchor('FF', predBar)).toBe(150);
    });

    it('SS/SF anchor on predecessor start', () => {
        expect(getPredAnchor('SS', predBar)).toBe(100);
        expect(getPredAnchor('SF', predBar)).toBe(100);
    });

    it('FS/SS reference on successor start', () => {
        expect(getSuccRef('FS', succBar)).toBe(200);
        expect(getSuccRef('SS', succBar)).toBe(200);
    });

    it('FF/SF reference on successor end', () => {
        expect(getSuccRef('FF', succBar)).toBe(280);
        expect(getSuccRef('SF', succBar)).toBe(280);
    });

    it('constrainsSuccEnd is true only for FF/SF', () => {
        expect(constrainsSuccEnd('FF')).toBe(true);
        expect(constrainsSuccEnd('SF')).toBe(true);
        expect(constrainsSuccEnd('FS')).toBe(false);
        expect(constrainsSuccEnd('SS')).toBe(false);
    });

    it('constrainsPredEnd is true only for FS/FF', () => {
        expect(constrainsPredEnd('FS')).toBe(true);
        expect(constrainsPredEnd('FF')).toBe(true);
        expect(constrainsPredEnd('SS')).toBe(false);
        expect(constrainsPredEnd('SF')).toBe(false);
    });
});

describe('getMinSuccessorX (single-edge semantics)', () => {
    const predBar = bar(100, 50); // end=150

    it('FS: succ.start ≥ pred.end + gap', () => {
        // pred.end=150, gap=20 → succ.start ≥ 170
        expect(getMinSuccessorX('FS', predBar, 80, 20)).toBe(170);
    });

    it('SS: succ.start ≥ pred.start + gap', () => {
        // pred.start=100, gap=20 → succ.start ≥ 120
        expect(getMinSuccessorX('SS', predBar, 80, 20)).toBe(120);
    });

    it('FF: succ.end ≥ pred.end + gap → succ.start ≥ pred.end + gap - succ.width', () => {
        // pred.end=150, gap=20, succ.width=80 → succ.start ≥ 90
        expect(getMinSuccessorX('FF', predBar, 80, 20)).toBe(90);
    });

    it('SF: succ.end ≥ pred.start + gap → succ.start ≥ pred.start + gap - succ.width', () => {
        // pred.start=100, gap=20, succ.width=80 → succ.start ≥ 40
        expect(getMinSuccessorX('SF', predBar, 80, 20)).toBe(40);
    });
});

describe('getMaxSuccessorX (bounded gap)', () => {
    const predBar = bar(100, 50);

    it('FS bounded: succ.start ≤ pred.end + maxGap', () => {
        expect(getMaxSuccessorX('FS', predBar, 80, 60)).toBe(210);
    });

    it('FF bounded: succ.end ≤ pred.end + maxGap → start ≤ ... - width', () => {
        expect(getMaxSuccessorX('FF', predBar, 80, 60)).toBe(130);
    });
});

describe('getMaxPredEnd / getMaxPredStart', () => {
    const succBar = bar(200, 80); // end=280

    it('FS: pred.end ≤ succ.start - gap', () => {
        expect(getMaxPredEnd('FS', succBar, 20)).toBe(180);
    });

    it('FF: pred.end ≤ succ.end - gap', () => {
        expect(getMaxPredEnd('FF', succBar, 20)).toBe(260);
    });

    it('SS/SF do not constrain pred end → Infinity', () => {
        expect(getMaxPredEnd('SS', succBar, 20)).toBe(Infinity);
        expect(getMaxPredEnd('SF', succBar, 20)).toBe(Infinity);
    });

    it('SS: pred.start ≤ succ.start - gap', () => {
        expect(getMaxPredStart('SS', succBar, 20)).toBe(180);
    });

    it('SF: pred.start ≤ succ.end - gap', () => {
        expect(getMaxPredStart('SF', succBar, 20)).toBe(260);
    });

    it('FS/FF do not constrain pred start → Infinity', () => {
        expect(getMaxPredStart('FS', succBar, 20)).toBe(Infinity);
        expect(getMaxPredStart('FF', succBar, 20)).toBe(Infinity);
    });
});

describe('getMinXFromPredecessors', () => {
    const tasks = makeTasks([
        { id: 'a', x: 100, width: 50 }, // end 150
        { id: 'b', x: 50, width: 30 }, // end 80
        { id: 'c', x: 0, width: 80 },
    ]);
    const getBar = (id: string) => tasks[id]?._bar;

    it('returns 0 with no predecessors', () => {
        const minX = getMinXFromPredecessors('c', [], getBar, PPH, 80);
        expect(minX).toBe(0);
    });

    it('takes max across predecessors (array API)', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'c', type: 'FS', lag: 0 },
            { from: 'b', to: 'c', type: 'FS', lag: 5 }, // pred.end=80 + 50px gap = 130
        ];
        // a → c: 150; b → c: 80 + 50 = 130; max = 150
        const minX = getMinXFromPredecessors('c', rels, getBar, PPH, 80);
        expect(minX).toBe(150);
    });

    it('matches indexed and array API', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'c', type: 'SS', lag: 1 },
            { from: 'b', to: 'c', type: 'FS', lag: 0 },
        ];
        const idx = buildRelationshipIndex(rels);
        const fromArray = getMinXFromPredecessors('c', rels, getBar, PPH, 80);
        const fromIndex = getMinXFromPredecessors('c', idx, getBar, PPH, 80);
        expect(fromArray).toBe(fromIndex);
    });

    it('skips relationships whose predecessor has no bar', () => {
        const rels: Relationship[] = [
            { from: 'ghost', to: 'c', type: 'FS', lag: 99 },
        ];
        expect(getMinXFromPredecessors('c', rels, getBar, PPH, 80)).toBe(0);
    });
});

describe('getMaxXFromPredecessors', () => {
    const tasks = makeTasks([
        { id: 'a', x: 100, width: 50 },
        { id: 'b', x: 50, width: 30 },
    ]);
    const getBar = (id: string) => tasks[id]?._bar;

    it('Infinity when only elastic edges (max=undefined)', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        expect(getMaxXFromPredecessors('b', rels, getBar, PPH, 30)).toBe(
            Infinity,
        );
    });

    it('bounded edge tightens max', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0, min: 0, max: 5 },
        ];
        // pred.end=150, maxGap=50 → max succ.start = 200
        expect(getMaxXFromPredecessors('b', rels, getBar, PPH, 30)).toBe(200);
    });

    it('takes min across multiple bounded edges', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0, min: 0, max: 5 }, // 200
            { from: 'a', to: 'b', type: 'SS', lag: 0, min: 0, max: 2 }, // pred.start=100 + 20px = 120
        ];
        expect(getMaxXFromPredecessors('b', rels, getBar, PPH, 30)).toBe(120);
    });
});

describe('getMaxEndFromDownstream', () => {
    it('Infinity when no successors', () => {
        const tasks = makeTasks([{ id: 'a', x: 100 }]);
        const result = getMaxEndFromDownstream(
            'a',
            [],
            (id) => tasks[id]?._bar,
            (id) => tasks[id],
            PPH,
        );
        expect(result).toBe(Infinity);
    });

    it('locked successor is hard stop', () => {
        const tasks = makeTasks([
            { id: 'a', x: 100, width: 50 }, // end 150
            { id: 'b', x: 200, width: 80, locked: true },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        // FS: pred.end ≤ succ.start - gap = 200
        const result = getMaxEndFromDownstream(
            'a',
            rels,
            (id) => tasks[id]?._bar,
            (id) => tasks[id],
            PPH,
        );
        expect(result).toBe(200);
    });

    it('legacy alias getMaxEndFromLockedSuccessors === getMaxEndFromDownstream', () => {
        expect(getMaxEndFromLockedSuccessors).toBe(getMaxEndFromDownstream);
    });

    it('matches indexed and array APIs', () => {
        const tasks = makeTasks([
            { id: 'a', x: 100, width: 50 },
            { id: 'b', x: 300, width: 80, locked: true },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        const idx = buildRelationshipIndex(rels);
        const arr = getMaxEndFromDownstream(
            'a',
            rels,
            (id) => tasks[id]?._bar,
            (id) => tasks[id],
            PPH,
        );
        const indexed = getMaxEndFromDownstream(
            'a',
            idx,
            (id) => tasks[id]?._bar,
            (id) => tasks[id],
            PPH,
        );
        expect(arr).toBe(indexed);
    });
});

describe('getMaxXFromLockedSuccessors (SS/SF)', () => {
    it('returns Infinity when successors are unlocked', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0 },
            { id: 'b', x: 200 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'SS', lag: 0 },
        ];
        const result = getMaxXFromLockedSuccessors(
            'a',
            rels,
            (id) => tasks[id]?._bar,
            (id) => tasks[id],
            PPH,
        );
        expect(result).toBe(Infinity);
    });

    it('locked SS successor caps predecessor start', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0 },
            { id: 'b', x: 200, locked: true },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'SS', lag: 5 }, // gap=50
        ];
        // SS: pred.start ≤ succ.start - gap = 200 - 50 = 150
        const result = getMaxXFromLockedSuccessors(
            'a',
            rels,
            (id) => tasks[id]?._bar,
            (id) => tasks[id],
            PPH,
        );
        expect(result).toBe(150);
    });

    it('FS-locked successor is ignored (handled by getMaxEndFromDownstream)', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0 },
            { id: 'b', x: 200, locked: true },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        const result = getMaxXFromLockedSuccessors(
            'a',
            rels,
            (id) => tasks[id]?._bar,
            (id) => tasks[id],
            PPH,
        );
        expect(result).toBe(Infinity);
    });
});

describe('calculateCascadeUpdates', () => {
    it('propagates push along a small linear chain', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0, width: 50 },
            { id: 'b', x: 60, width: 50 },
            { id: 'c', x: 120, width: 50 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'b', to: 'c', type: 'FS', lag: 0 },
        ];
        const ctx = {
            getBarPosition: (id: string) => tasks[id]?._bar,
            getTask: (id: string) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        };
        // Push a from x=0 to x=200 → b min = 250, c min = 300
        const updates = calculateCascadeUpdates('a', 200, ctx);
        expect(updates.has('a')).toBe(false); // caller handles initial
        expect(updates.get('b')?.x).toBe(250);
        expect(updates.get('c')?.x).toBe(300);
    });

    it('skips locked tasks during cascade', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0, width: 50 },
            { id: 'b', x: 60, width: 50, locked: true },
            { id: 'c', x: 120, width: 50 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'b', to: 'c', type: 'FS', lag: 0 },
        ];
        const ctx = {
            getBarPosition: (id: string) => tasks[id]?._bar,
            getTask: (id: string) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        };
        const updates = calculateCascadeUpdates('a', 200, ctx);
        // b is locked, stays at 60 → no entry; c constrained only by b which didn't move
        expect(updates.has('b')).toBe(false);
    });

    it('converges on a fan-out topology', () => {
        // root → 5 children, push root forward, all children get min = root.end + 0
        const data = generateFanOut(6); // 1 root + 5 children
        const ctx = buildContext(data, {
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
            useIndex: true,
        });
        const updates = calculateCascadeUpdates('task-0', 500, ctx);
        // children should all be pushed to >= 580 (root width 80, FS lag 0)
        for (let i = 1; i < 6; i++) {
            const u = updates.get(`task-${i}`);
            expect(u?.x).toBeGreaterThanOrEqual(580);
        }
    });

    it('converges on a dense graph without hitting MAX_CASCADE_ITERATIONS', () => {
        const data = generateDenseGraph(20, 4);
        const ctx = buildContext(data, {
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
            useIndex: true,
        });
        const updates = calculateCascadeUpdates('task-0', 1000, ctx);
        // Should produce updates without throwing or hanging
        expect(updates).toBeInstanceOf(Map);
    });

    it('early-returns when neither relationships nor index provided', () => {
        // When no graph data is supplied, cascade can't compute successors;
        // the initial seed entry is returned untouched (caller cleanup is skipped
        // on the early-return path).
        const ctx = {
            getBarPosition: () => null,
            getTask: () => null,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        };
        const updates = calculateCascadeUpdates('a', 200, ctx);
        expect(updates.has('a')).toBe(true);
        expect(updates.get('a')?.x).toBe(200);
    });
});

/**
 * The resize entry. Its whole reason to exist is that the caller already knows
 * the new rect and the store may not: a drag stages its write and reads back
 * the PRE-gesture geometry in the same turn. So the geometry travels as a
 * VALUE and is overlaid on the resized task's bar, and only on that one.
 */
describe('resolveResizeCascade', () => {
    it('the passed geometry overrides the store read for the resized task', () => {
        // The store still reports the pre-resize width; the caller knows better.
        const tasks = makeTasks([
            { id: 'a', x: 0, width: 50 }, // end 50
            { id: 's', x: 10, width: 50 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 's', type: 'FS', lag: 0 },
        ];
        const ctx = {
            getBarPosition: (id: string) => tasks[id]?._bar,
            getTask: (id: string) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        };

        const updates = resolveResizeCascade('a', { x: 0, width: 200 }, ctx);

        // Successor relaxed against the NEW right edge (0 + 200), not the
        // stored one (0 + 50), which would have left `s` at 10.
        expect(updates.get('s')?.x).toBe(200);
        // The store was never written; the overlay is read-only.
        expect(tasks['a']?._bar.width).toBe(50);
    });

    it('overlays the resized task only — every other bar is read as stored', () => {
        // `s` has two predecessors. If the overlay leaked to `b`, b.end would
        // read 200 and `s` would land at 200; b's real end of 300 must win.
        const tasks = makeTasks([
            { id: 'a', x: 0, width: 50 },
            { id: 'b', x: 0, width: 300 }, // end 300
            { id: 's', x: 10, width: 50 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 's', type: 'FS', lag: 0 },
            { from: 'b', to: 's', type: 'FS', lag: 0 },
        ];
        const ctx = {
            getBarPosition: (id: string) => tasks[id]?._bar,
            getTask: (id: string) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        };

        const updates = resolveResizeCascade('a', { x: 0, width: 200 }, ctx);

        expect(updates.get('s')?.x).toBe(300);
    });

    it('cascades a width-only change, which resolveConstraints cannot', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0, width: 50 }, // end 50
            { id: 'b', x: 60, width: 50 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        const ctx = {
            getBarPosition: (id: string) => tasks[id]?._bar,
            getTask: (id: string) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        };

        // X did not move, so `resolveConstraints`'s cascade gate never opens
        // even though the right edge went from 50 to 100.
        const viaResolve = resolveConstraints('a', 0, 100, ctx);
        expect(viaResolve.cascadeUpdates.size).toBe(0);

        // The resize entry has no such gate: b's min becomes a's new end.
        const updates = resolveResizeCascade('a', { x: 0, width: 100 }, ctx);
        expect(updates.get('b')?.x).toBe(100);
    });

    it('never returns the resized task itself', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0, width: 50 },
            { id: 'b', x: 60, width: 50 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        const updates = resolveResizeCascade(
            'a',
            { x: 200, width: 100 },
            {
                getBarPosition: (id: string) => tasks[id]?._bar,
                getTask: (id: string) => tasks[id],
                relationships: rels,
                pixelsPerHour: PPH,
                ganttStartDate: GANTT_START,
            },
        );
        expect(updates.has('a')).toBe(false);
        expect(updates.get('b')?.x).toBe(300); // 200 + 100, FS lag 0
    });
});

describe('resolveConstraints', () => {
    it('blocks locked task move', () => {
        const tasks = makeTasks([{ id: 'a', x: 100, width: 50, locked: true }]);
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

    it('early termination when proposal is identical', () => {
        const tasks = makeTasks([{ id: 'a', x: 100, width: 50 }]);
        const result = resolveConstraints('a', 100, 50, {
            getBarPosition: (id) => tasks[id]?._bar,
            getTask: (id) => tasks[id],
            relationships: [],
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.blocked).toBe(false);
        expect(result.cascadeUpdates.size).toBe(0);
        expect(result.constrainedX).toBe(100);
    });

    it('clamps to predecessor min when moving left', () => {
        const tasks = makeTasks([
            { id: 'a', x: 100, width: 50 }, // end 150
            { id: 'b', x: 200, width: 50 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        // Try to drag b backward to 0; min = pred.end = 150
        const result = resolveConstraints('b', 0, 50, {
            getBarPosition: (id) => tasks[id]?._bar,
            getTask: (id) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.constrainedX).toBe(150);
        expect(result.blocked).toBe(false);
    });

    it('no cascade when moving left and successor already satisfies the constraint', () => {
        const tasks = makeTasks([
            { id: 'a', x: 100, width: 50 }, // end 150
            { id: 'b', x: 500, width: 50 }, // far ahead of pred.end
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        // Move a from 100 → 50; new pred.end=100, b still at 500 → no push needed.
        // Also: moving left short-circuits the downstream check entirely.
        const result = resolveConstraints('a', 50, 50, {
            getBarPosition: (id) => tasks[id]?._bar,
            getTask: (id) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.constrainedX).toBe(50);
        expect(result.cascadeUpdates.size).toBe(0);
    });

    it('cascades when moving right pushes successor', () => {
        const tasks = makeTasks([
            { id: 'a', x: 100, width: 50 },
            { id: 'b', x: 200, width: 50 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        const result = resolveConstraints('a', 300, 50, {
            getBarPosition: (id) => tasks[id]?._bar,
            getTask: (id) => tasks[id],
            relationships: rels,
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.constrainedX).toBe(300); // unbounded forward
        expect(result.cascadeUpdates.get('b')?.x).toBe(350);
    });

    it('returns proposed values gracefully when task has no bar', () => {
        const result = resolveConstraints('missing', 999, 50, {
            getBarPosition: () => null,
            getTask: () => null,
            relationships: [],
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
        });
        expect(result.constrainedX).toBe(999);
        expect(result.cascadeUpdates.size).toBe(0);
    });
});

describe('detectCycles', () => {
    it('reports no cycle on empty graph', () => {
        expect(detectCycles([])).toEqual({ hasCycle: false, cycle: [] });
    });

    it('detects simple 2-cycle', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'b', to: 'a', type: 'FS', lag: 0 },
        ];
        const result = detectCycles(rels);
        expect(result.hasCycle).toBe(true);
        expect(result.cycle.length).toBeGreaterThanOrEqual(2);
    });

    it('detects 3-cycle and reconstructs path', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'b', to: 'c', type: 'FS', lag: 0 },
            { from: 'c', to: 'a', type: 'FS', lag: 0 },
        ];
        const result = detectCycles(rels);
        expect(result.hasCycle).toBe(true);
        expect(result.cycle).toContain('a');
    });

    it('handles disconnected DAG components without false positive', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'c', to: 'd', type: 'FS', lag: 0 },
        ];
        expect(detectCycles(rels).hasCycle).toBe(false);
    });

    it('finds cycle in second component', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'c', to: 'd', type: 'FS', lag: 0 },
            { from: 'd', to: 'c', type: 'FS', lag: 0 },
        ];
        expect(detectCycles(rels).hasCycle).toBe(true);
    });

    it('reports no cycle for a long linear chain (bench fixture)', () => {
        const data = generateLinearChain(50);
        expect(detectCycles(data.relationships).hasCycle).toBe(false);
    });
});

describe('collectDependentTasks', () => {
    it('collects forward transitive successors', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'b', to: 'c', type: 'FS', lag: 0 },
            { from: 'c', to: 'd', type: 'FS', lag: 0 },
        ];
        const visited = collectDependentTasks('a', rels);
        expect(visited).toContain('a');
        expect(visited).toContain('b');
        expect(visited).toContain('c');
        expect(visited).toContain('d');
    });

    it('does not traverse backward', () => {
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'b', to: 'c', type: 'FS', lag: 0 },
        ];
        const visited = collectDependentTasks('b', rels);
        expect(visited).not.toContain('a');
        expect(visited).toContain('c');
    });

    it('stops at locked tasks (does not include them or their dependents)', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0 },
            { id: 'b', x: 100, locked: true },
            { id: 'c', x: 200 },
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
            { from: 'b', to: 'c', type: 'FS', lag: 0 },
        ];
        const visited = collectDependentTasks(
            'a',
            rels,
            (id) => tasks[id] ?? null,
        );
        expect(visited).toContain('a');
        expect(visited).not.toContain('b');
        expect(visited).not.toContain('c');
    });
});

describe('clampBatchDeltaX', () => {
    it('returns proposed delta unchanged when moving forward', () => {
        const result = clampBatchDeltaX(
            new Map([['a', { originalX: 100 }]]),
            50,
            [],
            () => null,
        );
        expect(result).toBe(50);
    });

    it('clamps backward move when external predecessor blocks', () => {
        const tasks = makeTasks([
            { id: 'pred', x: 0, width: 50 }, // end 50
            { id: 'a', x: 100, width: 50 },
        ]);
        const batch = new Map([['a', { originalX: 100 }]]);
        const rels: Relationship[] = [
            { from: 'pred', to: 'a', type: 'FS', lag: 0 },
        ];
        // a is at 100, FS pred end=50 → minSuccX=50; backward delta=-100 → newX=0 < 50
        // maxBackwardDelta = 50 - 100 = -50 → clamp to -50
        const result = clampBatchDeltaX(batch, -100, rels, (id) => tasks[id]);
        expect(result).toBe(-50);
    });

    it('respects pixelsPerTimeUnit option for lag scaling', () => {
        const tasks = makeTasks([
            { id: 'pred', x: 0, width: 50 },
            { id: 'a', x: 200, width: 50 },
        ]);
        const batch = new Map([['a', { originalX: 200 }]]);
        const rels: Relationship[] = [
            { from: 'pred', to: 'a', type: 'FS', lag: 2 },
        ];
        // With pixelsPerTimeUnit=10: lagPx=20, minSuccX = pred.end + 20 = 70
        // Try -200 backward → newX=0 < 70; max backward = 70-200 = -130
        const result = clampBatchDeltaX(batch, -200, rels, (id) => tasks[id], {
            pixelsPerTimeUnit: 10,
        });
        expect(result).toBe(-130);
    });

    it('ignores predecessors that are also in the batch', () => {
        const tasks = makeTasks([
            { id: 'a', x: 0, width: 50 },
            { id: 'b', x: 100, width: 50 },
        ]);
        // Both in batch → b's predecessor a is internal, no clamp
        const batch = new Map([
            ['a', { originalX: 0 }],
            ['b', { originalX: 100 }],
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0 },
        ];
        const result = clampBatchDeltaX(batch, -50, rels, (id) => tasks[id]);
        expect(result).toBe(-50);
    });
});

describe('integration with bench fixtures', () => {
    it('linear chain: cascade pushes every task forward by the same amount', () => {
        const data = generateLinearChain(10, { spacing: 100 });
        const ctx = buildContext(data, {
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
            useIndex: true,
        }) as unknown as Parameters<typeof calculateCascadeUpdates>[2];
        // Push task-0 from 0 to 200 → each task min advances by ≥ delta
        const updates: Map<string, { x: number }> = calculateCascadeUpdates(
            'task-0',
            200,
            ctx,
        );
        // task-1 was at 100, should now be ≥ 280 (task-0 width 80 + lag 0 = 280)
        const t1 = updates.get('task-1');
        expect(t1?.x ?? 0).toBeGreaterThanOrEqual(280);
        // task-9 should also have been updated
        expect(updates.get('task-9')).toBeDefined();
    });

    it('with-locks: locked task blocks downstream end position', () => {
        // generateWithLocks's default `[]` parameter narrows to never[]; cast.
        const data = (
            generateWithLocks as unknown as (
                count: number,
                locked: number[],
            ) => ReturnType<typeof generateWithLocks>
        )(5, [4]); // task-4 locked
        const ctx = buildContext(data, {
            pixelsPerHour: PPH,
            ganttStartDate: GANTT_START,
            useIndex: true,
        }) as unknown as Parameters<
            typeof getMaxEndFromDownstream
        >[1] extends infer _R
            ? {
                  getBarPosition: Parameters<typeof getMaxEndFromDownstream>[2];
                  getTask: Parameters<typeof getMaxEndFromDownstream>[3];
                  relationshipIndex: Parameters<
                      typeof getMaxEndFromDownstream
                  >[1];
              }
            : never;
        // task-0 → task-4 chain. task-4 locked at x=400. Compute downstream max for task-0.
        const result = getMaxEndFromDownstream(
            'task-0',
            ctx.relationshipIndex,
            ctx.getBarPosition,
            ctx.getTask,
            PPH,
        );
        expect(result).toBeLessThan(Infinity);
    });
});
