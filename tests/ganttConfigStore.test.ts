import { describe, it, expect } from 'vitest';
import { createRoot, createMemo } from 'solid-js';
import { createGanttConfigStore } from '../src/stores/ganttConfigStore';
import { settle } from './helpers/settle';

// Characterization tests for `createGanttConfigStore` on solid-js 1.9.12.
//
// These pin what the store does TODAY so the flip to SolidJS 2.0 (E3) turns
// into a named regression list instead of a mystery. They asserted current
// behaviour even where that behaviour was a defect: the two expansion cases
// that landed here as `it.skip` were the defect, named rather than "fixed",
// and E2.4 (bd gantt-b4m.4) is what un-skipped them.
//
// Digest chain pinned: `lib-stores-config-date` STRUCT sites in
// docs/migration/solid2/digest-t2.md — ganttConfigStore.ts:146
// (store-builtin-collection: `expandedTasks: new Set(...)` inside the store),
// :151 (custom-setter-shim: `makeSetter` reads committed `state[key]` as
// `prev` and returns the post-write value), :173/:175/:189/:199
// (store-path-setter / store-produce / store-delete on the Set) — plus
// CHAIN J2 in digest-t1.md:540 ("makeSetter prev/return + getConfig
// snapshot"). E2.4 rewrote every one of those sites; the assertions are
// unchanged, which is the point — the observable contract survived.
//
// Test posture (CLAUDE.md migration rule 10): `settle()` after every write,
// before reading back — a no-op on 1.9, `flush` after E3.1. `createRoot`
// bodies create primitives only; every write happens outside them.

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('createGanttConfigStore — construction', () => {
    it('uses `??` for the pixel fields, so an explicit 0 survives', () => {
        const cfg = createGanttConfigStore({
            columnWidth: 0,
            barHeight: 0,
            headerHeight: 0,
            padding: 0,
            barCornerRadius: 0,
        });
        expect(cfg.columnWidth()).toBe(0);
        expect(cfg.barHeight()).toBe(0);
        expect(cfg.headerHeight()).toBe(0);
        expect(cfg.padding()).toBe(0);
        expect(cfg.barCornerRadius()).toBe(0);
    });

    it('uses `||` for unit/step/subtaskHeightRatio, so a falsy option is replaced by the default', () => {
        // The asymmetry with the `??` fields above is deliberate current
        // behaviour, not an accident of this test: ganttConfigStore.ts seeds
        // unit/step/subtaskHeightRatio with `||` and the pixel fields with
        // `??`. E2.4 rewrites this constructor, so pin both halves.
        const cfg = createGanttConfigStore({
            unit: '',
            step: 0,
            subtaskHeightRatio: 0,
        });
        expect(cfg.unit()).toBe('day');
        expect(cfg.step()).toBe(1);
        expect(cfg.subtaskHeightRatio()).toBe(0.5);
    });

    it('drops options.ignoredPositions — the field is always seeded empty', () => {
        const cfg = createGanttConfigStore({ ignoredPositions: [1, 2, 3] });
        expect(cfg.ignoredPositions()).toEqual([]);
        expect(cfg.getConfig().ignoredPositions).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// expandedTasks — the E2.4 defect and the half of the API that works around it
// ---------------------------------------------------------------------------

describe('createGanttConfigStore — expandedTasks', () => {
    // WAS RED before E2.4, and this is the defect it named: `has()` stayed
    // false and the memo never re-ran. The mechanism was worse than "the Set is
    // mutated in place" — on 1.9 the Set was never written AT ALL. The old
    // `toggleTaskExpansion` called `setState('expandedTasks', (fn))`;
    // store `produce` only invokes `fn` when `isWrappable(state)` is true, and
    // `isWrappable` rejects a Set (its prototype is Set.prototype, neither a
    // plain object nor an array), so `produce` returned the identical Set and
    // `updatePath` short-circuited on `value === prev`. Nothing was written and
    // nothing was notified; `expandTask`/`collapseTask` had the same body and
    // the same outcome. E2.4 moved `expandedTasks` out of the store into a
    // signal over an immutable Set, so each mutator now replaces the Set.
    it('toggleTaskExpansion notifies a memo over expandedTasks()', () => {
        const cfg = createGanttConfigStore({});
        let runs = 0;
        let has!: () => boolean;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            has = createMemo(() => {
                runs++;
                return cfg.expandedTasks().has('t1');
            });
        });
        expect(has()).toBe(false);
        expect(runs).toBe(1);

        cfg.toggleTaskExpansion('t1');
        settle();
        expect(has()).toBe(true);
        expect(runs).toBe(2);

        cfg.collapseTask('t1');
        settle();
        expect(has()).toBe(false);
        expect(runs).toBe(3);

        dispose();
    });

    // Same root cause as above, stated without any reactivity in play: before
    // E2.4 this was not a missing notification, the committed state itself was
    // untouched.
    it('toggleTaskExpansion/expandTask/collapseTask write committed state', () => {
        const cfg = createGanttConfigStore({});

        cfg.toggleTaskExpansion('t1');
        settle();
        expect(cfg.isTaskExpanded('t1')).toBe(true);
        expect(cfg.expandedTasks().size).toBe(1);

        cfg.expandTask('t2');
        settle();
        expect(cfg.isTaskExpanded('t2')).toBe(true);

        // Drive `collapseTask` PAST the committed-state guard it used to carry
        // (`if (!state.expandedTasks.has(taskId)) return;`) by seeding the Set
        // through `expandAllTasks`, the one path that wrote even then. The
        // guard therefore was not what swallowed the call — `produce` was.
        // E2.4 deleted the guard outright: replacing the Set is idempotent, so
        // the guard bought nothing and would have read committed state.
        cfg.expandAllTasks(['t3']);
        settle();
        expect(cfg.isTaskExpanded('t3')).toBe(true); // green even today

        cfg.collapseTask('t3');
        settle();
        expect(cfg.isTaskExpanded('t3')).toBe(false);
    });

    it('toggleTaskExpansion flips the same id back off', () => {
        // The two cases above drive toggle ON and then take the id back off
        // with `collapseTask`, so neither of them exercises toggle's OFF
        // branch: a `toggleTaskExpansion` that only ever ADDS passes both.
        // Toggling one id twice is what pins the branch.
        const cfg = createGanttConfigStore({});

        cfg.toggleTaskExpansion('t1');
        settle();
        expect(cfg.isTaskExpanded('t1')).toBe(true);

        cfg.toggleTaskExpansion('t1');
        settle();
        expect(cfg.isTaskExpanded('t1')).toBe(false);
        expect(cfg.expandedTasks().size).toBe(0);

        // And a toggle of a DIFFERENT id leaves the first one alone — the
        // mutator replaces the Set, so a bug that dropped `prev` on the floor
        // (`new Set([taskId])`) would still pass the round trip above.
        cfg.toggleTaskExpansion('t1');
        cfg.toggleTaskExpansion('t2');
        settle();
        expect(Array.from(cfg.expandedTasks())).toEqual(['t1', 't2']);
    });

    it('expandTask stays content-idempotent but replaces the Set every time', () => {
        // E2.4 deleted the `if (state.expandedTasks.has(taskId)) return;`
        // guard the old `expandTask`/`collapseTask` carried: a guard that reads
        // COMMITTED state is exactly the shape deferred writes break (it would
        // read the pre-write value and swallow a legitimate call). Replacing
        // the Set is idempotent in CONTENT, but it is still a write, so a
        // redundant expand does re-notify. That is the deliberate trade, pinned
        // here rather than left to be rediscovered — and it costs nothing
        // today: nothing in src/ calls these mutators, only `isTaskExpanded`
        // and `expandedTasks()`.
        const cfg = createGanttConfigStore({});
        let runs = 0;
        let ids!: () => string[];
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            ids = createMemo(() => {
                runs++;
                return Array.from(cfg.expandedTasks());
            });
        });
        expect(runs).toBe(1);

        cfg.expandTask('t1');
        settle();
        expect(ids()).toEqual(['t1']);
        expect(runs).toBe(2);

        cfg.expandTask('t1');
        settle();
        expect(ids()).toEqual(['t1']);
        expect(runs).toBe(3);

        // Symmetrically on the collapse side: deleting an id that is not in
        // the Set still replaces it, so the contents hold and the memo re-runs.
        cfg.collapseTask('absent');
        settle();
        expect(ids()).toEqual(['t1']);
        expect(runs).toBe(4);

        dispose();
    });

    it('seeds the Set from options.expandedTasks', () => {
        const cfg = createGanttConfigStore({ expandedTasks: ['a', 'b'] });
        // Contents and insertion order, not `.size`: a constructor that seeded
        // the right NUMBER of wrong ids would pass a size check.
        expect(Array.from(cfg.expandedTasks())).toEqual(['a', 'b']);
        expect(cfg.isTaskExpanded('a')).toBe(true);
        expect(cfg.isTaskExpanded('b')).toBe(true);
        expect(cfg.isTaskExpanded('c')).toBe(false);
    });

    // The four tests below are the working half of the same API and the reason
    // this file is not one skip plus three unrelated tests: they all assign a
    // FRESH Set through `setState`, which is a plain property write, so they
    // both land and notify on 1.9. E2.4 rewrites every one of these code paths,
    // so they hold the working half in place while the broken half is fixed.

    it('expandAllTasks replaces the Set and notifies', () => {
        const cfg = createGanttConfigStore({});
        let runs = 0;
        let ids!: () => string[];
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            ids = createMemo(() => {
                runs++;
                return Array.from(cfg.expandedTasks());
            });
        });
        expect(ids()).toEqual([]);
        expect(runs).toBe(1);

        cfg.expandAllTasks(['t3', 't4']);
        settle();
        expect(runs).toBe(2);
        expect(ids()).toEqual(['t3', 't4']);
        expect(cfg.isTaskExpanded('t3')).toBe(true);
        expect(cfg.isTaskExpanded('t4')).toBe(true);

        dispose();
    });

    it('collapseAllTasks empties the Set and notifies', () => {
        const cfg = createGanttConfigStore({ expandedTasks: ['a', 'b'] });
        let runs = 0;
        let ids!: () => string[];
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            ids = createMemo(() => {
                runs++;
                return Array.from(cfg.expandedTasks());
            });
        });
        expect(ids()).toEqual(['a', 'b']);
        expect(runs).toBe(1);

        cfg.collapseAllTasks();
        settle();
        expect(runs).toBe(2);
        expect(ids()).toEqual([]);
        expect(cfg.isTaskExpanded('a')).toBe(false);

        dispose();
    });

    it('setExpandedTasks replaces the Set, notifies, and hands the same instance back', () => {
        const cfg = createGanttConfigStore({ expandedTasks: ['a'] });
        let runs = 0;
        let ids!: () => string[];
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            // Contents, not `.size`: the store starts at one id and is
            // replaced by another one-id Set, so a size memo reads 1 both
            // before and after and cannot tell "replaced" from "unchanged".
            ids = createMemo(() => {
                runs++;
                return Array.from(cfg.expandedTasks());
            });
        });
        expect(ids()).toEqual(['a']);
        expect(runs).toBe(1);

        const replacement = new Set(['zz']);
        cfg.setExpandedTasks(replacement);
        settle();
        expect(runs).toBe(2);
        expect(ids()).toEqual(['zz']);
        expect(cfg.isTaskExpanded('zz')).toBe(true);
        expect(cfg.isTaskExpanded('a')).toBe(false);
        // Nothing copies the Set on write — the signal keeps the caller's own
        // instance, exactly as the store did (a Set is not wrappable, so there
        // was never a proxy either) — measured through its consequence first,
        // because that is what a consumer can observe: mutating the Set the
        // caller still holds edits committed state behind the store's back and
        // notifies nobody, so the memo goes on serving a stale projection.
        // (This is a SEPARATE fact from why the two skips above are red —
        // those never reach a mutation at all, because `produce` declines to
        // invoke its callback on an unwrappable value.) A store that
        // defensively copied on write would fail here, at the first line, not
        // at the identity check.
        replacement.add('yy');
        settle();
        expect(cfg.isTaskExpanded('yy')).toBe(true);
        expect(runs).toBe(2);
        expect(ids()).toEqual(['zz']);
        // E2.4 moved this behind a signal over an immutable Set. "Immutable" is
        // a rule the STORE keeps (every mutator replaces the Set); it is not
        // enforced against the caller, and `setExpandedTasks` does not copy —
        // so the identity below still holds, and so does the aliasing above.
        expect(cfg.expandedTasks()).toBe(replacement);

        dispose();
    });

    it('updateOptions({ expandedTasks }) replaces the Set and notifies', () => {
        const cfg = createGanttConfigStore({ expandedTasks: ['a'] });
        let runs = 0;
        let ids!: () => string[];
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            ids = createMemo(() => {
                runs++;
                return Array.from(cfg.expandedTasks());
            });
        });
        expect(ids()).toEqual(['a']);
        expect(runs).toBe(1);

        cfg.updateOptions({ expandedTasks: ['x'] });
        settle();
        expect(runs).toBe(2);
        expect(ids()).toEqual(['x']);
        expect(cfg.isTaskExpanded('x')).toBe(true);
        expect(cfg.isTaskExpanded('a')).toBe(false);

        dispose();
    });
});

// ---------------------------------------------------------------------------
// makeSetter — the 20 public setters
// ---------------------------------------------------------------------------

describe('createGanttConfigStore — makeSetter', () => {
    it('composes two updater-form calls in one turn: 30 + 10 + 10 === 50', () => {
        // CHAIN J2. `makeSetter` used to compute `prev` by reading the
        // committed store proxy `state[key]` and only then write. On 1.9 writes
        // commit synchronously, so the second call read 40 and the pair
        // composed to +20. Under rc.6's deferred writes that same code yields
        // +10, because both calls read the same committed 30; E2.4 moved the
        // `prev` read inside the draft, which keeps +20 on both runtimes. This
        // assertion is the one that would name a slide back to +10.
        const cfg = createGanttConfigStore({ columnWidth: 30 });
        cfg.setColumnWidth((w) => w + 10);
        cfg.setColumnWidth((w) => w + 10);
        settle();
        expect(cfg.columnWidth()).toBe(50);
    });

    // NB: deliberately no assertion on any setter's RETURN value. `makeSetter`
    // used to return `state[key]` after the write to satisfy `Setter<T>`, and
    // on 1.9 that was the new value — but D13 made all 20 setters
    // void-returning `ConfigSetter<T>` in E2.4, so such an assertion would have
    // had to be deleted rather than adjusted. No in-repo caller reads a
    // setter's return value.

    it('value form assigns and notifies only that path', () => {
        const cfg = createGanttConfigStore({ columnWidth: 30, barHeight: 30 });
        let widthRuns = 0;
        let heightRuns = 0;
        let width!: () => number;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            width = createMemo(() => {
                widthRuns++;
                return cfg.columnWidth();
            });
            createMemo(() => {
                heightRuns++;
                return cfg.barHeight();
            });
        });
        expect(width()).toBe(30);
        expect(widthRuns).toBe(1);
        expect(heightRuns).toBe(1);

        cfg.setColumnWidth(99);
        settle();
        expect(width()).toBe(99);
        expect(widthRuns).toBe(2);
        // Path-level tracking: an unrelated field's reader does not re-run.
        expect(heightRuns).toBe(1);

        // Re-writing the identical value is a no-op — the store short-circuits
        // on reference equality before notifying.
        cfg.setColumnWidth(99);
        settle();
        expect(widthRuns).toBe(2);

        dispose();
    });
});

// ---------------------------------------------------------------------------
// updateOptions — one draft write over the whole state
// ---------------------------------------------------------------------------

describe('createGanttConfigStore — updateOptions', () => {
    it('applies barHeight and padding atomically: one run for a memo reading both', () => {
        const cfg = createGanttConfigStore({
            columnWidth: 30,
            barHeight: 30,
            padding: 18,
        });
        let barRuns = 0;
        let pairRuns = 0;
        let columnRuns = 0;
        let bar!: () => number;
        let pair!: () => string;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            bar = createMemo(() => {
                barRuns++;
                return cfg.barHeight();
            });
            pair = createMemo(() => {
                pairRuns++;
                return `${cfg.barHeight()}/${cfg.padding()}`;
            });
            createMemo(() => {
                columnRuns++;
                return cfg.columnWidth();
            });
        });
        expect(bar()).toBe(30);
        expect(pair()).toBe('30/18');
        expect(barRuns).toBe(1);
        expect(pairRuns).toBe(1);
        expect(columnRuns).toBe(1);

        cfg.updateOptions({ barHeight: 40, padding: 20 });
        settle();

        expect(cfg.barHeight()).toBe(40);
        expect(cfg.padding()).toBe(20);
        expect(bar()).toBe(40);
        expect(pair()).toBe('40/20');
        // Atomicity: the memo that reads BOTH changed fields runs exactly once
        // for the pair, not once per field.
        expect(pairRuns).toBe(2);
        expect(barRuns).toBe(2);
        // And a memo over a field `updateOptions` did not name never runs again.
        expect(columnRuns).toBe(1);

        dispose();
    });

    it('applies a store field and expandedTasks in ONE flush', () => {
        // E2.4 split `expandedTasks` out of the store, so `updateOptions` now
        // writes two reactive cells instead of one. A memo that reads both —
        // Gantt.tsx's `rowLayouts` is exactly that (barHeight + padding +
        // subtaskHeightRatio + expandedTasks) — must still see a single
        // update, not one per cell. On 1.9 the `batch()` wrapper is what buys
        // that; under 2.0's default microtask batching it comes for free, so
        // this assertion holds across the flip and is what would catch the
        // wrapper being dropped too early.
        const cfg = createGanttConfigStore({
            barHeight: 30,
            expandedTasks: ['a'],
        });
        let runs = 0;
        let view!: () => string;
        let dispose!: () => void;
        createRoot((d) => {
            dispose = d;
            view = createMemo(() => {
                runs++;
                return `${cfg.barHeight()}:${Array.from(cfg.expandedTasks()).join(',')}`;
            });
        });
        expect(view()).toBe('30:a');
        expect(runs).toBe(1);

        cfg.updateOptions({ barHeight: 40, expandedTasks: ['x', 'y'] });
        settle();
        expect(view()).toBe('40:x,y');
        expect(runs).toBe(2);

        dispose();
    });

    it('leaves unnamed fields untouched', () => {
        const cfg = createGanttConfigStore({
            columnWidth: 30,
            unit: 'week',
            step: 2,
            renderMode: 'detailed',
        });
        cfg.updateOptions({ columnWidth: 60 });
        settle();
        expect(cfg.columnWidth()).toBe(60);
        expect(cfg.unit()).toBe('week');
        expect(cfg.step()).toBe(2);
        expect(cfg.renderMode()).toBe('detailed');
    });
});

// ---------------------------------------------------------------------------
// getConfig — the committed snapshot
// ---------------------------------------------------------------------------

describe('createGanttConfigStore — getConfig', () => {
    it('projects committed state field by field', () => {
        const ganttStart = new Date('2025-01-01T00:00:00Z');
        const ganttEnd = new Date('2025-03-01T00:00:00Z');
        const ignoredDates = [new Date('2025-02-01T00:00:00Z')];
        const ignoredFunction = (d: Date): boolean => d.getDay() === 0;
        const cfg = createGanttConfigStore({
            ganttStart,
            ganttEnd,
            unit: 'week',
            step: 2,
            columnWidth: 30,
            barHeight: 22,
            headerHeight: 44,
            padding: 12,
            barCornerRadius: 5,
            readonly: true,
            readonlyDates: true,
            readonlyProgress: true,
            showExpectedProgress: true,
            autoMoveLabel: true,
            ignoredDates,
            ignoredFunction,
            subtaskHeightRatio: 0.25,
            renderMode: 'detailed',
            expandedTasks: ['a', 'b'],
        });
        const snapshot = cfg.getConfig();

        // Scalars: identical to their accessors.
        expect(snapshot.unit).toBe('week');
        expect(snapshot.step).toBe(2);
        expect(snapshot.columnWidth).toBe(30);
        expect(snapshot.barHeight).toBe(22);
        expect(snapshot.headerHeight).toBe(44);
        expect(snapshot.padding).toBe(12);
        expect(snapshot.barCornerRadius).toBe(5);
        expect(snapshot.subtaskHeightRatio).toBe(0.25);
        expect(snapshot.renderMode).toBe('detailed');
        expect(snapshot.readonly).toBe(true);
        expect(snapshot.readonlyDates).toBe(true);
        expect(snapshot.readonlyProgress).toBe(true);
        expect(snapshot.showExpectedProgress).toBe(true);
        expect(snapshot.autoMoveLabel).toBe(true);
        // NB: no `snapshot.columnWidth === cfg.columnWidth()` style mirror for
        // the scalars. Both sides read the same `state[key]` off the same
        // proxy, so such a line restates `getConfig`'s own expression and
        // cannot fail while the literal assertions above hold. The identity
        // mirrors that DO follow are a different matter: each of them can fail
        // on its own, because the accessor and the projection could disagree
        // about handing back the raw instance versus a copy.

        // Dates are not wrappable, so the store hands back the very instance
        // that was passed in — mutating one would mutate the store's copy
        // silently. E2.4 documents this in types.ts rather than changing it.
        expect(snapshot.ganttStart).toBe(ganttStart);
        expect(snapshot.ganttEnd).toBe(ganttEnd);
        expect(snapshot.ganttStart).toBe(cfg.ganttStart());
        expect(snapshot.ganttEnd).toBe(cfg.ganttEnd());

        // Arrays ARE wrappable, so the store serves a stable proxy: identical
        // to the accessor's value, but NOT the caller's original array.
        expect(Array.isArray(snapshot.ignoredDates)).toBe(true);
        expect(snapshot.ignoredDates).toBe(cfg.ignoredDates());
        expect(snapshot.ignoredDates).not.toBe(ignoredDates);
        expect(snapshot.ignoredDates?.length).toBe(1);
        // The element itself is the caller's Date, served raw THROUGH the
        // array proxy: a projection that copied or re-wrapped the entries
        // would keep the length and the proxy identity above and still be
        // wrong here.
        expect(snapshot.ignoredDates?.[0]).toBe(ignoredDates[0]);

        // Functions pass straight through.
        expect(snapshot.ignoredFunction).toBe(ignoredFunction);
        expect(snapshot.ignoredFunction).toBe(cfg.ignoredFunction());

        // expandedTasks is the one field whose SHAPE differs from its
        // accessor: `string[]` out of getConfig, `Set<string>` off the store.
        // The literal below carries that on its own — a mirror against
        // `Array.from(cfg.expandedTasks())` would just re-run getConfig's own
        // projection expression and could not fail while this line passes.
        expect(snapshot.expandedTasks).toEqual(['a', 'b']);
    });

    it('reflects a preceding write once it has settled', () => {
        // CHAIN J2: getConfig() reads COMMITTED state. On 1.9 the write above
        // commits synchronously; after the flip only the settle() in between
        // makes this hold. A caller that mutates and snapshots in the same turn
        // WITHOUT settling sees pre-mutation values — E2.4 documents that
        // rather than changing it, which is why there is no assertion here for
        // the un-settled case.
        const cfg = createGanttConfigStore({ columnWidth: 30, barHeight: 22 });
        expect(cfg.getConfig().columnWidth).toBe(30);

        cfg.setColumnWidth(77);
        settle();
        expect(cfg.getConfig().columnWidth).toBe(77);

        cfg.updateOptions({ barHeight: 64 });
        settle();
        expect(cfg.getConfig().barHeight).toBe(64);

        // getConfig re-projects the Set on every call — it does not close over
        // a construction-time copy. The `expandedTasks` projection is the only
        // field getConfig computes rather than passes through, so it is the
        // one that could silently freeze.
        expect(cfg.getConfig().expandedTasks).toEqual([]);
        cfg.expandAllTasks(['q']);
        settle();
        expect(cfg.getConfig().expandedTasks).toEqual(['q']);
    });
});
