import { describe, it, expect } from 'vitest';
import { createRoot, createMemo, createComputed } from 'solid-js';
import { createTaskStore } from '../src/stores/taskStore';
import type { ProcessedTask, NormalizedConstraints } from '../src/types';

// Build a minimal valid ProcessedTask. Most fields are required by the type
// but the store treats the task as an opaque payload, so plain defaults work.
function makeTask(
    id: string,
    overrides: Partial<ProcessedTask> = {},
): ProcessedTask {
    const constraints: NormalizedConstraints = { locked: false };
    return {
        id,
        name: `task ${id}`,
        start: '2025-01-01 08:00',
        end: '2025-01-01 16:00',
        _start: new Date('2025-01-01T08:00:00'),
        _end: new Date('2025-01-01T16:00:00'),
        _index: 0,
        _resourceIndex: 0,
        _isHidden: false,
        _children: [],
        _depth: 0,
        _bar: { x: 0, y: 0, width: 100, height: 30 },
        dependencies: [],
        constraints,
        ...overrides,
    };
}

describe('createTaskStore — pure accessors', () => {
    it('getTask returns the stored task', () => {
        const store = createTaskStore();
        store.updateTask('a', makeTask('a'));
        expect(store.getTask('a')?.id).toBe('a');
    });

    it('getTask returns undefined for missing id', () => {
        const store = createTaskStore();
        expect(store.getTask('missing')).toBeUndefined();
    });

    it('getBarPosition returns null for missing task', () => {
        const store = createTaskStore();
        expect(store.getBarPosition('missing')).toBeNull();
    });

    it('getBarPosition returns position fields plus _index', () => {
        const store = createTaskStore();
        store.updateTask(
            'a',
            makeTask('a', {
                _index: 7,
                _bar: { x: 10, y: 20, width: 30, height: 40 },
            }),
        );
        const pos = store.getBarPosition('a');
        expect(pos).toEqual({ x: 10, y: 20, width: 30, height: 40, index: 7 });
    });

    it('getAllTasks filters out undefined slots', () => {
        const store = createTaskStore();
        store.updateTask('a', makeTask('a'));
        store.updateTask('b', makeTask('b'));
        store.removeTask('a'); // sets to undefined
        const all = store.getAllTasks();
        expect(all).toHaveLength(1);
        expect(all[0]?.id).toBe('b');
    });

    it('taskCount tracks live tasks across add/remove/clear', () => {
        const store = createTaskStore();
        store.updateTask('a', makeTask('a'));
        store.updateTask('b', makeTask('b'));
        expect(store.taskCount()).toBe(2);
        store.removeTask('a');
        expect(store.taskCount()).toBe(1);
        store.clear();
        expect(store.taskCount()).toBe(0);
    });
});

describe('createTaskStore — produce() reactivity (gantt-6hx regression guard)', () => {
    it('updateBarPosition: memo subscriber re-computes when _bar.x changes', () => {
        let runs = 0;
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('t1', makeTask('t1'));
            const x = createMemo(() => {
                runs++;
                return store.tasks['t1']?._bar?.x;
            });
            // Initial read primes the memo.
            expect(x()).toBe(0);
            expect(runs).toBe(1);
            // Mutate via produce — the path-level subscriber must invalidate.
            store.updateBarPosition('t1', { x: 999 });
            expect(x()).toBe(999);
            expect(runs).toBe(2);
            dispose();
        });
    });

    it('updateBarPosition: subscribers see _bar.width changes', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('t1', makeTask('t1'));
            const w = createMemo(() => store.tasks['t1']?._bar?.width);
            expect(w()).toBe(100);
            store.updateBarPosition('t1', { width: 250 });
            expect(w()).toBe(250);
            dispose();
        });
    });

    it('updateBarPosition: subscribers see _bar.y changes', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('t1', makeTask('t1'));
            const y = createMemo(() => store.tasks['t1']?._bar?.y);
            expect(y()).toBe(0);
            store.updateBarPosition('t1', { y: 50 });
            expect(y()).toBe(50);
            dispose();
        });
    });

    it('updateBarPosition: subscribers see _bar.height changes', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('t1', makeTask('t1'));
            const h = createMemo(() => store.tasks['t1']?._bar?.height);
            expect(h()).toBe(30);
            store.updateBarPosition('t1', { height: 60 });
            expect(h()).toBe(60);
            dispose();
        });
    });

    it('updateBarPosition: only the touched task re-runs its memo', () => {
        let aRuns = 0;
        let bRuns = 0;
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('a', makeTask('a'));
            store.updateTask('b', makeTask('b'));
            const ax = createMemo(() => {
                aRuns++;
                return store.tasks['a']?._bar?.x;
            });
            const bx = createMemo(() => {
                bRuns++;
                return store.tasks['b']?._bar?.x;
            });
            ax();
            bx();
            expect(aRuns).toBe(1);
            expect(bRuns).toBe(1);
            store.updateBarPosition('a', { x: 100 });
            // Pull both — only a's memo should re-compute.
            expect(ax()).toBe(100);
            expect(bx()).toBe(0);
            expect(aRuns).toBe(2);
            expect(bRuns).toBe(1);
            dispose();
        });
    });

    it('updateBarPosition: no-op when task does not exist', () => {
        const store = createTaskStore();
        expect(() =>
            store.updateBarPosition('missing', { x: 50 }),
        ).not.toThrow();
        expect(store.getTask('missing')).toBeUndefined();
    });

    it('batchMovePositions: subscribers see each moved task update', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask(
                'a',
                makeTask('a', {
                    _bar: { x: 10, y: 0, width: 100, height: 30 },
                }),
            );
            store.updateTask(
                'b',
                makeTask('b', {
                    _bar: { x: 20, y: 0, width: 100, height: 30 },
                }),
            );
            store.updateTask(
                'c',
                makeTask('c', {
                    _bar: { x: 30, y: 0, width: 100, height: 30 },
                }),
            );
            const ax = createMemo(() => store.tasks['a']?._bar?.x);
            const bx = createMemo(() => store.tasks['b']?._bar?.x);
            const cx = createMemo(() => store.tasks['c']?._bar?.x);

            expect([ax(), bx(), cx()]).toEqual([10, 20, 30]);

            const originals = new Map([
                ['a', { originalX: 10 }],
                ['b', { originalX: 20 }],
                // c intentionally omitted from batch
            ]);
            store.batchMovePositions(originals, 100);

            expect([ax(), bx(), cx()]).toEqual([110, 120, 30]);
            dispose();
        });
    });

    it('batchMovePositions: skips entries whose tasks have no _bar', () => {
        const store = createTaskStore();
        const originals = new Map([['ghost', { originalX: 5 }]]);
        expect(() => store.batchMovePositions(originals, 10)).not.toThrow();
    });
});

describe('createTaskStore — non-produce mutations', () => {
    it('updateTask: subscriber sees new task value when whole task replaced', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('a', makeTask('a', { name: 'first' }));
            const name = createMemo(() => store.tasks['a']?.name);
            expect(name()).toBe('first');
            store.updateTask('a', makeTask('a', { name: 'second' }));
            expect(name()).toBe('second');
            dispose();
        });
    });

    it('updateTasks: reconcile populates and replaces', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            const count = createMemo(() => Object.keys(store.tasks).length);
            expect(count()).toBe(0);
            store.updateTasks([makeTask('a'), makeTask('b'), makeTask('c')]);
            expect(count()).toBe(3);
            // Replace with smaller set
            store.updateTasks([makeTask('a')]);
            expect(count()).toBe(1);
            dispose();
        });
    });

    it('removeTask: removed slot becomes undefined', () => {
        const store = createTaskStore();
        store.updateTask('a', makeTask('a'));
        expect(store.getTask('a')).toBeDefined();
        store.removeTask('a');
        expect(store.getTask('a')).toBeUndefined();
    });

    it('clear: empties the store', () => {
        const store = createTaskStore();
        store.updateTasks([makeTask('a'), makeTask('b')]);
        expect(store.getAllTasks()).toHaveLength(2);
        store.clear();
        expect(store.getAllTasks()).toHaveLength(0);
        expect(store.taskCount()).toBe(0);
    });
});

describe('createTaskStore — collapse signals', () => {
    it('toggleTaskCollapse round-trips', () => {
        const store = createTaskStore();
        expect(store.isTaskCollapsed('a')).toBe(false);
        store.toggleTaskCollapse('a');
        expect(store.isTaskCollapsed('a')).toBe(true);
        store.toggleTaskCollapse('a');
        expect(store.isTaskCollapsed('a')).toBe(false);
    });

    it('expandTask is idempotent on already-expanded task', () => {
        const store = createTaskStore();
        store.expandTask('a');
        expect(store.isTaskCollapsed('a')).toBe(false);
        store.collapseTask('a');
        expect(store.isTaskCollapsed('a')).toBe(true);
        store.expandTask('a');
        expect(store.isTaskCollapsed('a')).toBe(false);
    });

    it('collapseTask is idempotent on already-collapsed task', () => {
        const store = createTaskStore();
        store.collapseTask('a');
        const setRef = store.collapsedTasks();
        store.collapseTask('a'); // no-op
        expect(store.collapsedTasks()).toBe(setRef); // same reference
    });

    it('expandAllTasks empties the collapsed set', () => {
        const store = createTaskStore();
        store.collapseTask('a');
        store.collapseTask('b');
        expect(store.collapsedTasks().size).toBe(2);
        store.expandAllTasks();
        expect(store.collapsedTasks().size).toBe(0);
    });

    it('collapseAllTasks collapses every summary/parent task', () => {
        const store = createTaskStore();
        store.updateTask('p', makeTask('p', { type: 'summary' }));
        store.updateTask('q', makeTask('q', { _children: ['x'] }));
        store.updateTask('r', makeTask('r')); // leaf
        store.collapseAllTasks();
        expect(store.isTaskCollapsed('p')).toBe(true);
        expect(store.isTaskCollapsed('q')).toBe(true);
        expect(store.isTaskCollapsed('r')).toBe(false);
    });

    it('collapsedTasks signal is reactive via memo subscriber', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            const size = createMemo(() => store.collapsedTasks().size);
            expect(size()).toBe(0);
            store.collapseTask('a');
            expect(size()).toBe(1);
            store.expandAllTasks();
            expect(size()).toBe(0);
            dispose();
        });
    });
});

describe('createTaskStore — drag state signal', () => {
    it('draggingTaskId getter/setter round-trips', () => {
        const store = createTaskStore();
        expect(store.draggingTaskId()).toBeNull();
        store.setDraggingTaskId('task-1');
        expect(store.draggingTaskId()).toBe('task-1');
        store.setDraggingTaskId(null);
        expect(store.draggingTaskId()).toBeNull();
    });

    it('draggingTaskId is reactive', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            const id = createMemo(() => store.draggingTaskId());
            expect(id()).toBeNull();
            store.setDraggingTaskId('task-7');
            expect(id()).toBe('task-7');
            dispose();
        });
    });

    it('createComputed runs synchronously and tracks signal updates', () => {
        // Belt-and-suspenders: also verify the synchronous-tracking variant.
        // createComputed runs eagerly on every dependency change.
        let observed: string | null = 'sentinel';
        createRoot((dispose) => {
            const store = createTaskStore();
            createComputed(() => {
                observed = store.draggingTaskId();
            });
            expect(observed).toBeNull();
            store.setDraggingTaskId('task-9');
            expect(observed).toBe('task-9');
            dispose();
        });
    });
});
