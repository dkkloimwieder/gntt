// Characterization suite for `createTaskStore` on solid-js 1.9.12.
//
// Pins the digest chain `lib-stores-task` — specifically the two high
// hazards HAZ src/stores/taskStore.ts:108 (updateBarPosition's existence
// guard reads COMMITTED state) and HAZ src/stores/taskStore.ts:134
// (removeTask relies on `setTasks(id, undefined)` deleting the key), plus
// the two test-side hazards HAZ tests/taskStore.test.ts:98 (the gantt-6hx
// guard needs its negative half) and :322 (signal writes inside createRoot
// bodies). See docs/migration/solid2/digest-t2.md.
//
// Rule for this file: every write is followed by `settle()` BEFORE its
// result is read back — a no-op on 1.9, the real flush after E3.1 — so the
// flip is mechanical. Consecutive writes that nothing reads between them
// share one settle() (the two `updateTask` seeds in 'getAllTasks filters
// out undefined slots', the three in 'batchMovePositions: subscribers see
// each moved task update', the two `collapseTask` calls in 'expandAllTasks
// empties the collapsed set'); all three are independent keys or functional
// updaters, so they compose across a deferred batch.
//
// ONE site deliberately omits `settle()` mid-sequence: 'updateBarPosition:
// lands on a task created in the same turn'. There, "no flush between the
// two writes" IS the characterized behaviour — the E3.1 settle() sweep must
// skip it. The call site repeats this warning.
//
// Store writes may stay inside a createRoot body; signal writes may not
// (CLAUDE.md migration rule 10).
import { describe, it, expect } from 'vitest';
import { createRoot, createMemo, createEffect } from 'solid-js';
import { createTaskStore } from '../src/stores/taskStore';
import { settle } from './helpers/settle';
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
        settle();
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
        settle();
        const pos = store.getBarPosition('a');
        expect(pos).toEqual({ x: 10, y: 20, width: 30, height: 40, index: 7 });
    });

    it('getAllTasks filters out undefined slots', () => {
        const store = createTaskStore();
        store.updateTask('a', makeTask('a'));
        store.updateTask('b', makeTask('b'));
        settle();
        store.removeTask('a'); // sets to undefined
        settle();
        const all = store.getAllTasks();
        expect(all).toHaveLength(1);
        expect(all[0]?.id).toBe('b');
    });

    it('taskCount tracks live tasks across add/remove/clear', () => {
        const store = createTaskStore();
        store.updateTask('a', makeTask('a'));
        store.updateTask('b', makeTask('b'));
        settle();
        expect(store.taskCount()).toBe(2);
        store.removeTask('a');
        settle();
        expect(store.taskCount()).toBe(1);
        store.clear();
        settle();
        expect(store.taskCount()).toBe(0);
    });
});

describe('createTaskStore — () reactivity (gantt-6hx regression guard)', () => {
    it('updateBarPosition: memo subscriber re-computes when _bar.x changes', () => {
        let runs = 0;
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('t1', makeTask('t1'));
            settle();
            const x = createMemo(() => {
                runs++;
                return store.tasks['t1']?._bar?.x;
            });
            // Initial read primes the memo.
            expect(x()).toBe(0);
            expect(runs).toBe(1);
            // Mutate via produce — the path-level subscriber must invalidate.
            store.updateBarPosition('t1', { x: 999 });
            settle();
            expect(x()).toBe(999);
            expect(runs).toBe(2);
            dispose();
        });
    });

    // TODO(E2.3) (bd gantt-b4m.3): un-skip once updateBarPosition
    // leaf-mutates `_bar` instead of replacing the whole task object.
    //
    // MEASURED RED on solid-js 1.9.12: nameRuns goes 1 -> 2. taskStore.ts:114
    // assigns `state[id] = { ...task, _bar: { ...task._bar, ...position } }`
    // inside produce (the commit 6e5538c object-replacement hack for
    // gantt-6hx cause #2), so setProperty sees `state['t1'] !== value` and
    // fires the root's `t1` property node — a dependency of EVERY leaf memo
    // that read `store.tasks['t1']`, not just the ones reading `_bar`. Memos
    // are eager on 1.9, so the counter has already moved before the memo is
    // read back.
    //
    // Both halves live in this one test so E2.3 un-skips a complete
    // contract: the positive half (an `_bar.x` memo DOES re-run, also
    // asserted green in the test above) and the negative half (a sibling
    // `name` memo does NOT). E2.3's draft body — `const t = s[id]; if
    // (!t?._bar) return; t._bar[k] = v;` — turns both green.
    it('updateBarPosition leaf-mutates: sibling name memo must not re-run', () => {
        let nameRuns = 0;
        let xRuns = 0;
        const store = createTaskStore();
        store.updateTask('t1', makeTask('t1'));
        settle();

        let name!: () => string | undefined;
        let x!: () => number | undefined;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            name = createMemo(() => {
                nameRuns++;
                return store.tasks['t1']?.name;
            });
            x = createMemo(() => {
                xRuns++;
                return store.tasks['t1']?._bar?.x;
            });
        });

        // Prime both memos.
        expect(name()).toBe('task t1');
        expect(x()).toBe(0);
        expect(nameRuns).toBe(1);
        expect(xRuns).toBe(1);

        store.updateBarPosition('t1', { x: 50 });
        settle();

        // Positive half: the geometry memo sees the new value and re-ran.
        expect(x()).toBe(50);
        expect(xRuns).toBe(2);
        // Negative half: nothing else about the task changed, so the name
        // memo must still be sitting on its first computation.
        expect(name()).toBe('task t1');
        expect(nameRuns).toBe(1);

        dispose();
    });

    it('updateBarPosition: subscribers see _bar.width changes', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('t1', makeTask('t1'));
            settle();
            const w = createMemo(() => store.tasks['t1']?._bar?.width);
            expect(w()).toBe(100);
            store.updateBarPosition('t1', { width: 250 });
            settle();
            expect(w()).toBe(250);
            dispose();
        });
    });

    it('updateBarPosition: subscribers see _bar.y changes', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('t1', makeTask('t1'));
            settle();
            const y = createMemo(() => store.tasks['t1']?._bar?.y);
            expect(y()).toBe(0);
            store.updateBarPosition('t1', { y: 50 });
            settle();
            expect(y()).toBe(50);
            dispose();
        });
    });

    it('updateBarPosition: subscribers see _bar.height changes', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('t1', makeTask('t1'));
            settle();
            const h = createMemo(() => store.tasks['t1']?._bar?.height);
            expect(h()).toBe(30);
            store.updateBarPosition('t1', { height: 60 });
            settle();
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
            settle();
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
            settle();
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
        settle();
        expect(store.getTask('missing')).toBeUndefined();
        // The bail must leave no key behind. E2.3 (gantt-b4m.3) moves this
        // guard INSIDE the draft, where a careless `draft[id]` write on the
        // miss path auto-vivifies 'missing' and inflates taskCount() and
        // getAllTasks(). On 1.9 `getTask()` above happens to catch that too,
        // because assigning undefined DELETES the key; on 2.0 it does not
        // (CLAUDE.md rule 6 — assigning undefined KEEPS the key), so a slot
        // holding undefined still reads as undefined through getTask() and
        // only these two assertions see it.
        expect('missing' in store.tasks).toBe(false);
        expect(store.taskCount()).toBe(0);
    });

    // Same-turn create-then-position, the shape ShowcaseDemo.tsx:657/:807 and
    // Gantt.tsx:395 both hit. updateBarPosition's existence guard
    // (taskStore.ts:108, `if (!tasks[id]) return;`) reads the COMMITTED store,
    // which on 1.9 is the same thing as the staged store because every write
    // applies synchronously. Under 2.0's deferred writes the reconcile staged
    // by updateTasks is invisible to that guard, so it bails and the position
    // is silently dropped. E2.3 (gantt-b4m.3) moves the guard inside the
    // draft, where staged state IS visible.
    //
    // !! DO NOT INSERT settle() BETWEEN THE TWO WRITES BELOW !!
    // "Same turn" — no flush between updateTasks and updateBarPosition — is
    // this test's entire discriminating power, and this is the suite's only
    // coverage of HAZ taskStore.ts:108. A settle() inserted there lets the
    // guard see a committed 'a' on 2.0 too, so the test goes green on the
    // flipped runtime while pinning nothing. The E3.1 settle() sweep must
    // skip this site.
    it('updateBarPosition: lands on a task created in the same turn', () => {
        const store = createTaskStore();
        store.updateTasks([makeTask('a')]);
        // Mid-turn, un-flushed read of the COMMITTED store — the very read
        // the guard on the next line performs. On 1.9 the reconcile has
        // already applied, so the new task and its untouched _bar are
        // visible. Under 2.0's deferred writes this is `undefined`, the
        // guard bails, and the position is dropped. Asserting it here pins
        // the MECHANISM and not just its consequence, so the flip reports
        // WHY the position was lost rather than only that x stayed 0.
        expect(store.tasks['a']?._bar?.x).toBe(0);
        store.updateBarPosition('a', { x: 50 });
        settle();
        expect(store.tasks['a']?._bar?.x).toBe(50);
        expect(store.getBarPosition('a')?.x).toBe(50);
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
            settle();
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
            settle();

            expect([ax(), bx(), cx()]).toEqual([110, 120, 30]);
            dispose();
        });
    });

    it('batchMovePositions: skips entries whose tasks have no _bar', () => {
        const store = createTaskStore();
        const originals = new Map([['ghost', { originalX: 5 }]]);
        expect(() => store.batchMovePositions(originals, 10)).not.toThrow();
        settle();
        // Same auto-vivification tripwire as the guard test above: the skip
        // must leave the store genuinely empty, not holding a 'ghost' key.
        expect('ghost' in store.tasks).toBe(false);
        expect(store.taskCount()).toBe(0);
    });
});

describe('createTaskStore — non-produce mutations', () => {
    it('updateTask: subscriber sees new task value when whole task replaced', () => {
        createRoot((dispose) => {
            const store = createTaskStore();
            store.updateTask('a', makeTask('a', { name: 'first' }));
            settle();
            const name = createMemo(() => store.tasks['a']?.name);
            expect(name()).toBe('first');
            store.updateTask('a', makeTask('a', { name: 'second' }));
            settle();
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
            settle();
            expect(count()).toBe(3);
            // Replace with smaller set
            store.updateTasks([makeTask('a')]);
            settle();
            expect(count()).toBe(1);
            dispose();
        });
    });

    it('removeTask: removed slot becomes undefined', () => {
        const store = createTaskStore();
        store.updateTask('a', makeTask('a'));
        settle();
        expect(store.getTask('a')).toBeDefined();
        store.removeTask('a');
        settle();
        expect(store.getTask('a')).toBeUndefined();
    });

    // The assertion that distinguishes delete-the-key from
    // assign-undefined after the flip. On 1.9 `setTasks(id, undefined)`
    // (taskStore.ts:134) makes solid-js/store's setProperty `delete` the
    // key; the equivalent 2.0 draft assignment KEEPS it holding undefined,
    // so `'a' in tasks` and `Object.keys` would still report it while
    // getAllTasks (which filters undefined) would not. E2.3 (gantt-b4m.3)
    // rewrites removeTask as `delete draft[id]` to keep this green.
    it('removeTask: deletes the key outright and every counter agrees', () => {
        const store = createTaskStore();
        store.updateTasks([makeTask('a'), makeTask('b')]);
        settle();
        store.removeTask('a');
        settle();
        expect('a' in store.tasks).toBe(false);
        expect(Object.keys(store.tasks)).toEqual(['b']);
        expect(store.taskCount()).toBe(1);
        expect(store.getAllTasks()).toHaveLength(1);
        expect(store.getAllTasks()[0]?.id).toBe('b');
    });

    it('removeTask: key-list and count memos both invalidate', () => {
        const store = createTaskStore();
        store.updateTasks([makeTask('a'), makeTask('b')]);
        settle();

        let keys!: () => string[];
        let count!: () => number;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            keys = createMemo(() => Object.keys(store.tasks));
            count = createMemo(() => store.taskCount());
        });

        expect(keys()).toEqual(['a', 'b']);
        expect(count()).toBe(2);

        store.removeTask('a');
        settle();

        expect(keys()).toEqual(['b']);
        expect(count()).toBe(1);
        dispose();
    });

    it('clear: empties the store', () => {
        const store = createTaskStore();
        store.updateTasks([makeTask('a'), makeTask('b')]);
        settle();
        expect(store.getAllTasks()).toHaveLength(2);
        store.clear();
        settle();
        expect(store.getAllTasks()).toHaveLength(0);
        expect(store.taskCount()).toBe(0);
    });
});

describe('createTaskStore — collapse signals', () => {
    it('toggleTaskCollapse round-trips', () => {
        const store = createTaskStore();
        expect(store.isTaskCollapsed('a')).toBe(false);
        store.toggleTaskCollapse('a');
        settle();
        expect(store.isTaskCollapsed('a')).toBe(true);
        store.toggleTaskCollapse('a');
        settle();
        expect(store.isTaskCollapsed('a')).toBe(false);
    });

    it('expandTask is idempotent on already-expanded task', () => {
        const store = createTaskStore();
        store.expandTask('a');
        settle();
        expect(store.isTaskCollapsed('a')).toBe(false);
        store.collapseTask('a');
        settle();
        expect(store.isTaskCollapsed('a')).toBe(true);
        store.expandTask('a');
        settle();
        expect(store.isTaskCollapsed('a')).toBe(false);
    });

    it('collapseTask is idempotent on already-collapsed task', () => {
        const store = createTaskStore();
        store.collapseTask('a');
        settle();
        const setRef = store.collapsedTasks();
        store.collapseTask('a'); // no-op
        settle();
        expect(store.collapsedTasks()).toBe(setRef); // same reference
    });

    it('expandAllTasks empties the collapsed set', () => {
        const store = createTaskStore();
        store.collapseTask('a');
        store.collapseTask('b');
        settle();
        expect(store.collapsedTasks().size).toBe(2);
        store.expandAllTasks();
        settle();
        expect(store.collapsedTasks().size).toBe(0);
    });

    it('collapseAllTasks collapses every summary/parent task', () => {
        const store = createTaskStore();
        store.updateTask('p', makeTask('p', { type: 'summary' }));
        store.updateTask('q', makeTask('q', { _children: ['x'] }));
        store.updateTask('r', makeTask('r')); // leaf
        settle();
        store.collapseAllTasks();
        settle();
        expect(store.isTaskCollapsed('p')).toBe(true);
        expect(store.isTaskCollapsed('q')).toBe(true);
        expect(store.isTaskCollapsed('r')).toBe(false);
    });

    // `collapsedTasks` is a plain signal (taskStore.ts:60), and SolidJS 2.0
    // throws REACTIVE_WRITE_IN_OWNED_SCOPE for a signal write inside a
    // createRoot body — store setters are exempt there, signal setters are
    // not. So the store is built and driven from the test scope and the root
    // body holds nothing but the memo. Same shape for the two drag-state
    // tests below.
    it('collapsedTasks signal is reactive via memo subscriber', () => {
        const store = createTaskStore();
        let size!: () => number;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            size = createMemo(() => store.collapsedTasks().size);
        });
        expect(size()).toBe(0);
        store.collapseTask('a');
        settle();
        expect(size()).toBe(1);
        store.expandAllTasks();
        settle();
        expect(size()).toBe(0);
        dispose();
    });
});

describe('createTaskStore — drag state signal', () => {
    it('draggingTaskId getter/setter round-trips', () => {
        const store = createTaskStore();
        expect(store.draggingTaskId()).toBeNull();
        store.setDraggingTaskId('task-1');
        settle();
        expect(store.draggingTaskId()).toBe('task-1');
        store.setDraggingTaskId(null);
        settle();
        expect(store.draggingTaskId()).toBeNull();
    });

    it('draggingTaskId is reactive', () => {
        const store = createTaskStore();
        let id!: () => string | null;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            id = createMemo(() => store.draggingTaskId());
        });
        expect(id()).toBeNull();
        store.setDraggingTaskId('task-7');
        settle();
        expect(id()).toBe('task-7');
        dispose();
    });

    it('createEffect runs synchronously and tracks signal updates', () => {
        // Belt-and-suspenders: also verify the synchronous-tracking variant.
        // createEffect runs eagerly on every dependency change.
        // E3.1 converts this to a split createEffect; for now only the
        // setter call moves out of the root body.
        let observed: string | null = 'sentinel';
        const store = createTaskStore();
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            createEffect(
                () => store.draggingTaskId(),
                (v) => {
                    observed = v;
                },
            );
        });
        settle();
        expect(observed).toBeNull();
        store.setDraggingTaskId('task-9');
        settle();
        expect(observed).toBe('task-9');
        dispose();
    });
});
