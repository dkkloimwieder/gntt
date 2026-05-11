import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    buildHierarchy,
    collectDescendants,
    isHiddenByCollapsedAncestor,
    getAncestors,
} from '../src/utils/hierarchyProcessor';
import {
    setDiagnosticHandler,
    type DiagnosticLevel,
} from '../src/utils/diagnostics';

interface TestTask {
    id: string;
    parentId?: string;
    type?: string;
    _children?: string[];
    _depth?: number;
}

const t = (id: string, parentId?: string, type?: string): TestTask => ({
    id,
    parentId,
    type,
});

interface DiagnosticEntry {
    level: DiagnosticLevel;
    message: string;
}
let captured: DiagnosticEntry[] = [];

beforeEach(() => {
    captured = [];
    setDiagnosticHandler((level, message) => {
        captured.push({ level, message });
    });
});

afterEach(() => {
    setDiagnosticHandler(null);
});

describe('buildHierarchy', () => {
    it('initialises _children and _depth on every task', () => {
        const tasks = [t('a'), t('b'), t('c')];
        buildHierarchy(tasks);
        for (const task of tasks) {
            expect(task._children).toEqual([]);
            expect(task._depth).toBe(0);
        }
    });

    it('returns an id → task map', () => {
        const tasks = [t('a'), t('b')];
        const map = buildHierarchy(tasks);
        expect(map.get('a')).toBe(tasks[0]);
        expect(map.get('b')).toBe(tasks[1]);
        expect(map.size).toBe(2);
    });

    it('links children to parents and computes depth', () => {
        const tasks = [
            t('root'),
            t('a', 'root'),
            t('b', 'root'),
            t('a1', 'a'),
            t('a1a', 'a1'),
        ];
        buildHierarchy(tasks);
        expect(tasks[0]?._children).toEqual(['a', 'b']);
        expect(tasks[0]?._depth).toBe(0);
        expect(tasks[1]?._depth).toBe(1); // a
        expect(tasks[3]?._depth).toBe(2); // a1
        expect(tasks[4]?._depth).toBe(3); // a1a
    });

    it('auto-detects type=summary on parents that have children', () => {
        const tasks = [t('p'), t('child', 'p')];
        buildHierarchy(tasks);
        expect(tasks[0]?.type).toBe('summary');
    });

    it('preserves explicit non-summary type on parents', () => {
        const tasks = [t('p', undefined, 'milestone'), t('c', 'p')];
        buildHierarchy(tasks);
        expect(tasks[0]?.type).toBe('milestone');
    });

    it('treats orphan tasks (parentId points to missing) as roots', () => {
        const tasks = [t('orphan', 'ghost'), t('real')];
        buildHierarchy(tasks);
        expect(tasks[0]?._depth).toBe(0);
        expect(tasks[0]?._children).toEqual([]);
        // Note: an orphan triggers the "Circular or orphaned" warn since it
        // has parentId but no depth was assigned via BFS from a real root.
        expect(captured.some((e) => /orphaned|Circular/.test(e.message))).toBe(
            true,
        );
    });

    it('handles deep nesting (>5 levels)', () => {
        const tasks = [
            t('lvl0'),
            t('lvl1', 'lvl0'),
            t('lvl2', 'lvl1'),
            t('lvl3', 'lvl2'),
            t('lvl4', 'lvl3'),
            t('lvl5', 'lvl4'),
            t('lvl6', 'lvl5'),
        ];
        buildHierarchy(tasks);
        expect(tasks[6]?._depth).toBe(6);
    });

    it('warns on circular parent references', () => {
        // cycle: a → b → a (each names the other as parentId)
        const tasks = [t('a', 'b'), t('b', 'a')];
        buildHierarchy(tasks);
        // Both rooted-via-cycle: depth stays 0, warn fires for one.
        expect(
            captured.some((e) =>
                /Circular or orphaned parent reference/.test(e.message),
            ),
        ).toBe(true);
    });

    it('handles empty input', () => {
        const map = buildHierarchy<TestTask>([]);
        expect(map.size).toBe(0);
    });
});

describe('collectDescendants', () => {
    it('returns BFS-collected descendants for the given root', () => {
        const tasks = [
            t('root'),
            t('a', 'root'),
            t('b', 'root'),
            t('a1', 'a'),
            t('a2', 'a'),
            t('b1', 'b'),
        ];
        buildHierarchy(tasks);
        // Build a Record<string, T> map (the function accepts both shapes)
        const map: Record<string, TestTask> = {};
        for (const task of tasks) map[task.id] = task;

        const desc = collectDescendants('root', map);
        expect(desc).toEqual(new Set(['a', 'b', 'a1', 'a2', 'b1']));
    });

    it('returns empty set for leaf tasks', () => {
        const tasks = [t('leaf')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        expect(collectDescendants('leaf', map).size).toBe(0);
    });

    it('returns empty set for unknown ids', () => {
        const map = new Map<string, TestTask>();
        expect(collectDescendants('missing', map).size).toBe(0);
    });

    it('accepts both Map and Record map shapes', () => {
        const tasks = [t('p'), t('c', 'p')];
        buildHierarchy(tasks);
        const asMap = new Map(tasks.map((task) => [task.id, task]));
        const asRecord: Record<string, TestTask> = {};
        for (const task of tasks) asRecord[task.id] = task;
        expect(collectDescendants('p', asMap)).toEqual(new Set(['c']));
        expect(collectDescendants('p', asRecord)).toEqual(new Set(['c']));
    });
});

describe('isHiddenByCollapsedAncestor', () => {
    it('returns false when no ancestor is collapsed', () => {
        const tasks = [t('p'), t('c', 'p')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        expect(isHiddenByCollapsedAncestor('c', map, new Set())).toBe(false);
    });

    it('returns true when direct parent is collapsed', () => {
        const tasks = [t('p'), t('c', 'p')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        expect(isHiddenByCollapsedAncestor('c', map, new Set(['p']))).toBe(
            true,
        );
    });

    it('returns true when a higher ancestor is collapsed', () => {
        const tasks = [t('a'), t('b', 'a'), t('c', 'b'), t('d', 'c')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        expect(isHiddenByCollapsedAncestor('d', map, new Set(['a']))).toBe(
            true,
        );
    });

    it('returns true when any of multiple collapsed ancestors matches', () => {
        const tasks = [t('a'), t('b', 'a'), t('c', 'b')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        expect(
            isHiddenByCollapsedAncestor('c', map, new Set(['unrelated', 'b'])),
        ).toBe(true);
    });

    it('returns false for root tasks (no parentId chain)', () => {
        const tasks = [t('root')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        expect(
            isHiddenByCollapsedAncestor('root', map, new Set(['root'])),
        ).toBe(false); // root not hidden by itself
    });
});

describe('getAncestors', () => {
    it('walks parentId chain root-out', () => {
        const tasks = [t('a'), t('b', 'a'), t('c', 'b'), t('d', 'c')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        expect(getAncestors('d', map)).toEqual(['c', 'b', 'a']);
    });

    it('returns empty array for a root task', () => {
        const tasks = [t('root')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        expect(getAncestors('root', map)).toEqual([]);
    });

    it('returns empty array for unknown id', () => {
        const map = new Map<string, TestTask>();
        expect(getAncestors('missing', map)).toEqual([]);
    });

    it('stops at the first ancestor whose parent does not exist', () => {
        const tasks = [t('a', 'ghost'), t('b', 'a')];
        buildHierarchy(tasks);
        const map = new Map(tasks.map((task) => [task.id, task]));
        // b → a → ghost (not in map, walk terminates).
        expect(getAncestors('b', map)).toEqual(['a', 'ghost']);
    });
});
