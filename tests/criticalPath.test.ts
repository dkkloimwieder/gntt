import { describe, it, expect } from 'vitest';
import { computeCriticalPath } from '../src/utils/criticalPath';
import type { Relationship } from '../src/types';

const PPH = 10;

interface T {
    id: string;
    _bar: { x: number; y: number; width: number; height: number };
}
const t = (id: string, x: number, width: number): T => ({
    id,
    _bar: { x, y: 0, width, height: 30 },
});

const fs = (from: string, to: string, lag = 0): Relationship => ({
    from,
    to,
    type: 'FS',
    lag,
});

describe('computeCriticalPath — single chain', () => {
    it('marks every task in a linear FS chain as critical', () => {
        const tasks = new Map([
            ['a', t('a', 0, 50)],
            ['b', t('b', 50, 50)],
            ['c', t('c', 100, 50)],
        ]);
        const rels = [fs('a', 'b'), fs('b', 'c')];
        const r = computeCriticalPath(tasks, rels, PPH);
        expect(r.critical).toEqual(new Set(['a', 'b', 'c']));
        expect(r.projectFinish).toBe(150);
        expect(r.slack.get('a')).toBeCloseTo(0);
        expect(r.slack.get('b')).toBeCloseTo(0);
        expect(r.slack.get('c')).toBeCloseTo(0);
    });

    it('correctly computes ES/EF/LS/LF for a 3-chain', () => {
        const tasks = new Map([
            ['a', t('a', 0, 50)],
            ['b', t('b', 50, 30)],
            ['c', t('c', 80, 70)],
        ]);
        const rels = [fs('a', 'b'), fs('b', 'c')];
        const r = computeCriticalPath(tasks, rels, PPH);
        expect(r.es.get('a')).toBe(0);
        expect(r.ef.get('a')).toBe(50);
        expect(r.es.get('b')).toBe(50);
        expect(r.ef.get('b')).toBe(80);
        expect(r.es.get('c')).toBe(80);
        expect(r.ef.get('c')).toBe(150);
        expect(r.projectFinish).toBe(150);
    });
});

describe('computeCriticalPath — branching', () => {
    it('selects the longer of two parallel branches', () => {
        // a → short(b, w=30) → d
        // a → long(c, w=100) → d
        // critical path is a → c → d
        const tasks = new Map([
            ['a', t('a', 0, 50)],
            ['b', t('b', 50, 30)],
            ['c', t('c', 50, 100)],
            ['d', t('d', 150, 40)],
        ]);
        const rels = [fs('a', 'b'), fs('a', 'c'), fs('b', 'd'), fs('c', 'd')];
        const r = computeCriticalPath(tasks, rels, PPH);
        expect(r.critical.has('a')).toBe(true);
        expect(r.critical.has('c')).toBe(true);
        expect(r.critical.has('d')).toBe(true);
        expect(r.critical.has('b')).toBe(false); // shorter branch has slack
        expect(r.slack.get('b')).toBeCloseTo(70); // 100 - 30
    });

    it('marks both branches critical when they have equal duration', () => {
        const tasks = new Map([
            ['a', t('a', 0, 50)],
            ['b', t('b', 50, 50)],
            ['c', t('c', 50, 50)],
            ['d', t('d', 100, 30)],
        ]);
        const rels = [fs('a', 'b'), fs('a', 'c'), fs('b', 'd'), fs('c', 'd')];
        const r = computeCriticalPath(tasks, rels, PPH);
        expect(r.critical).toEqual(new Set(['a', 'b', 'c', 'd']));
    });
});

describe('computeCriticalPath — dependency types', () => {
    it('SS dependency: pred and succ start together; both critical when chain end is reached via succ', () => {
        // a (w=50) SS→ b (w=80, starts with a) → end. Project finish = b.end = 80.
        const tasks = new Map([
            ['a', t('a', 0, 50)],
            ['b', t('b', 0, 80)],
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'SS', lag: 0 },
        ];
        const r = computeCriticalPath(tasks, rels, PPH);
        // b's EF=80 > a's EF=50; b is sink → critical.
        expect(r.critical.has('b')).toBe(true);
        // a is critical iff its slack=0; LS_a is determined by SS edge → LS_b - 0 = 0
        // LS_a=0, ES_a=0 → slack=0 → critical
        expect(r.slack.get('a')).toBeCloseTo(0);
        expect(r.critical.has('a')).toBe(true);
    });

    it('FF dependency: pred end ≤ succ end + lag, both align at finish', () => {
        const tasks = new Map([
            ['a', t('a', 0, 50)], // ends at 50
            ['b', t('b', 0, 50)], // ends at 50; FF makes them align
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FF', lag: 0 },
        ];
        const r = computeCriticalPath(tasks, rels, PPH);
        // Both end at 50; b is sink with no further successors → critical.
        // a's LF = b's LF (FF lag 0) = 50 → LS=0; a's ES=0 → slack=0 → critical.
        expect(r.critical.has('a')).toBe(true);
        expect(r.critical.has('b')).toBe(true);
    });

    it('lag adds to the constraint distance', () => {
        // a (w=50) →lag=2h(20px)→ b (w=30). b can't start before a.end + 20.
        const tasks = new Map([
            ['a', t('a', 0, 50)],
            ['b', t('b', 70, 30)], // 50 + 20 lag
        ]);
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 2 },
        ];
        const r = computeCriticalPath(tasks, rels, PPH);
        expect(r.es.get('b')).toBe(70);
        expect(r.projectFinish).toBe(100);
        expect(r.critical.has('a')).toBe(true);
        expect(r.critical.has('b')).toBe(true);
    });
});

describe('computeCriticalPath — disconnected and edge cases', () => {
    it('disconnected tasks each form their own root+sink', () => {
        const tasks = new Map([
            ['a', t('a', 0, 100)],
            ['b', t('b', 0, 50)],
        ]);
        const r = computeCriticalPath(tasks, [], PPH);
        // projectFinish = max(100, 50) = 100
        expect(r.projectFinish).toBe(100);
        // a is critical (its EF == projectFinish); b has slack
        expect(r.critical.has('a')).toBe(true);
        expect(r.critical.has('b')).toBe(false);
        expect(r.slack.get('b')).toBeCloseTo(50);
    });

    it('empty input → empty result', () => {
        const r = computeCriticalPath(new Map(), [], PPH);
        expect(r.critical.size).toBe(0);
        expect(r.projectFinish).toBe(0);
    });

    it('single task → critical (its own critical path)', () => {
        const tasks = new Map([['a', t('a', 100, 50)]]);
        const r = computeCriticalPath(tasks, [], PPH);
        expect(r.critical).toEqual(new Set(['a']));
        expect(r.projectFinish).toBe(150);
    });

    it('relationships with unknown endpoints are ignored', () => {
        const tasks = new Map([['a', t('a', 0, 50)]]);
        const rels = [fs('a', 'ghost'), fs('ghost', 'a')];
        const r = computeCriticalPath(tasks, rels, PPH);
        expect(r.critical).toEqual(new Set(['a']));
    });

    it('cycle members are excluded; non-cycle members still computed', () => {
        // a → b → c → b (cycle); d standalone
        const tasks = new Map([
            ['a', t('a', 0, 50)],
            ['b', t('b', 50, 50)],
            ['c', t('c', 100, 50)],
            ['d', t('d', 0, 30)],
        ]);
        const rels = [fs('a', 'b'), fs('b', 'c'), fs('c', 'b')];
        const r = computeCriticalPath(tasks, rels, PPH);
        // a has in-degree 0; processed.
        expect(r.es.get('a')).toBe(0);
        // d has no relationships; processed.
        expect(r.es.get('d')).toBe(0);
        // b and c are in the cycle and never reach in-degree 0 → not in result.
        expect(r.es.has('b')).toBe(false);
        expect(r.es.has('c')).toBe(false);
    });

    it('Record map shape works the same as Map', () => {
        const tasks: Record<string, T> = {
            a: t('a', 0, 50),
            b: t('b', 50, 50),
        };
        const r = computeCriticalPath(tasks, [fs('a', 'b')], PPH);
        expect(r.critical).toEqual(new Set(['a', 'b']));
    });
});

describe('computeCriticalPath — critical edges', () => {
    it('marks the edges along the critical path', () => {
        const tasks = new Map([
            ['a', t('a', 0, 50)],
            ['b', t('b', 50, 30)],
            ['c', t('c', 50, 100)],
            ['d', t('d', 150, 40)],
        ]);
        const rels = [fs('a', 'b'), fs('a', 'c'), fs('b', 'd'), fs('c', 'd')];
        const r = computeCriticalPath(tasks, rels, PPH);
        // critical path is a → c → d
        // edge indices: 0=a→b, 1=a→c, 2=b→d, 3=c→d
        expect(r.criticalEdges.has(1)).toBe(true);
        expect(r.criticalEdges.has(3)).toBe(true);
        // a→b ends at non-critical b → not critical
        expect(r.criticalEdges.has(0)).toBe(false);
        // b→d originates from non-critical b → not critical
        expect(r.criticalEdges.has(2)).toBe(false);
    });
});
