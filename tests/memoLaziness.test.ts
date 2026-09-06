/**
 * Characterization test for the rc.6 recompute semantics that decision D7
 * (the E4.5 lazy-memo policy) rests on.
 *
 * Nothing here tests the Gantt library. Every assertion pins an observed
 * behaviour of `@solidjs/signals` 2.0.0-rc.6 so that a runtime bump which
 * changes when a memo body runs fails HERE, loudly, instead of silently
 * invalidating a `{ lazy: true }` decision made in `src/`.
 *
 * Counting method: each memo body increments a plain `let` counter. Counters
 * are read from the test body only (never from inside a reactive scope), and
 * every write is followed by `settle()` per CLAUDE.md rule 10.
 *
 * The three mechanisms these numbers come from, in the rc.6 dev build
 * (`node_modules/.pnpm/@solidjs+signals@2.0.0-rc.6/.../dist/dev.js`):
 *
 *   1. Eager creation — `setupComputedNode` (dev.js:4442-4477) does the
 *      first run at dev.js:4469, `!options?.lazy && recompute(self, true)`.
 *      An eager memo therefore has one body run before anything reads it; a
 *      lazy one has zero.
 *   2. AUTO_DISPOSE — `computed()` sets `CONFIG_AUTO_DISPOSE` when
 *      `!context || options?.lazy` (dev.js:4291). `{ lazy: true }` is
 *      therefore not only "defer the first run": it opts the node into the
 *      *observation* lifecycle, where losing the last subscriber tears the
 *      node down (`unobserved`, dev.js:2920) and the next read revives it via
 *      `prepareComputed` (dev.js:4587-4600).
 *   3. Deferred dormancy — a top-level untracked read of a subscriber-less
 *      AUTO_DISPOSE node does not tear it down inline; it queues the node in
 *      `dormantNodes` and arms a flush (dev.js:4866-4881: the guard opens at
 *      4866, `dormantNodes.add(el)` at 4880, `schedule()` at 4881), and
 *      `sweepDormant` (dev.js:2946) reclaims it at the top of the next flush.
 *      So untracked reads are idempotent *within a tick* and pay-per-read
 *      *across* ticks. This is the #3078 fix — the package ships no changelog;
 *      the shipped source names it at dev.js:2926 and dev.js:4874. It is the
 *      single most surprising number below.
 *
 *   "Ownerless" below means a read whose reactive context resolves to no
 *   computed (dev.js:4677-4678): a test body, an event handler, a timer, a
 *   promise continuation, and — case 11 — an effect's apply phase.
 *
 * All three mechanisms ship in the prod build unchanged
 * (dist/prod/core/core.js: the `!t?.lazy && recompute(e, true)` first run and
 * the `!context || options.lazy` AUTO_DISPOSE assignment; the dormancy sweep in
 * dist/prod/core/graph.js + scheduler.js), so these numbers characterise the
 * shipped runtime, not a dev artefact. Every case creates its memos under a
 * `createRoot` owner except case 10, which pins the no-owner lifecycle.
 *
 * Client project only: the server vitest project resolves solid-js to the
 * server build, whose createEffect is a stub, and every case here would pass
 * vacuously there.
 */
import { describe, it, expect } from 'vitest';
import {
    createRoot,
    createSignal,
    createMemo,
    createEffect,
    createStore,
    untrack,
} from 'solid-js';
import { settle } from './helpers/settle';

/**
 * The only difference between the two variants under test. Passing the option
 * object vs. `undefined` is exactly the mutation each case is proofed against:
 * flipping a case's `lazy` argument changes at least one asserted number.
 */
const memoOptions = (lazy: boolean) => (lazy ? { lazy: true } : undefined);

describe('rc.6 memo recompute semantics (E4.5 / D7)', () => {
    it('case 1: eager memo with a tracked reader runs once at creation, then once per write', () => {
        const [n, setN] = createSignal(0);
        let bodyRuns = 0;
        let atCreation = -1;
        let dispose!: () => void;

        createRoot((d) => {
            dispose = d;
            const doubled = createMemo(() => {
                bodyRuns++;
                return n() * 2;
            }, memoOptions(false));
            // Sampled before any reader exists: an eager memo has already run.
            atCreation = bodyRuns;
            createEffect(
                () => doubled(),
                () => {},
            );
        });

        // dev.js:4469 — the eager path recomputes inside createMemo itself.
        expect(atCreation).toBe(1);

        settle();
        // The effect's *compute* already pulled the memo when createEffect ran
        // (its apply is what waits for the flush), and the memo was clean, so
        // the first flush adds no body run.
        expect(bodyRuns).toBe(1);

        for (let i = 1; i <= 5; i++) {
            setN(i);
            settle();
        }

        // 1 (creation) + 5 (one per settled write).
        expect(bodyRuns).toBe(6);
        dispose();
    });

    it('case 2: lazy memo defers creation but reaches eager parity once a tracked reader exists', () => {
        const [n, setN] = createSignal(0);
        let bodyRuns = 0;
        let atCreation = -1;
        let afterReaderCreated = -1;
        let dispose!: () => void;

        createRoot((d) => {
            dispose = d;
            const doubled = createMemo(() => {
                bodyRuns++;
                return n() * 2;
            }, memoOptions(true));
            atCreation = bodyRuns;
            createEffect(
                () => doubled(),
                () => {},
            );
            // Sampled immediately after createEffect returns, still inside the
            // root and before any flush.
            afterReaderCreated = bodyRuns;
        });

        // The whole of laziness at creation time: zero body runs, vs. case 1's 1.
        expect(atCreation).toBe(0);

        // OBSERVED, and worth stating because it is not the obvious answer: the
        // first body run happens when `createEffect` is CONSTRUCTED, not at the
        // first flush. An effect's compute runs synchronously at creation to
        // link its dependencies; reading the lazy memo there hits
        // prepareComputed (dev.js:4588), which clears REACTIVE_LAZY and
        // recomputes on the spot. Only the effect's *apply* waits for settle().
        expect(afterReaderCreated).toBe(1);

        settle();
        expect(bodyRuns).toBe(1);

        for (let i = 1; i <= 5; i++) {
            setN(i);
            settle();
        }

        // Parity with case 1 from the first read onward: a lazy memo with a
        // live tracked subscriber costs exactly what an eager one costs. Lazy
        // buys nothing here — that is the D7 point.
        expect(bodyRuns).toBe(6);
        dispose();
    });

    it('case 3: with NO reader, an eager memo recomputes on every write and a lazy memo never does', () => {
        // --- eager ---
        {
            const [n, setN] = createSignal(0);
            let bodyRuns = 0;
            let dispose!: () => void;
            let read!: () => number;

            createRoot((d) => {
                dispose = d;
                read = createMemo(() => {
                    bodyRuns++;
                    return n() * 2;
                }, memoOptions(false));
            });

            expect(bodyRuns).toBe(1);
            settle();
            expect(bodyRuns).toBe(1);

            for (let i = 1; i <= 5; i++) {
                setN(i);
                settle();
            }

            // Rule 7 in CLAUDE.md, measured: eager memos recompute unread. This
            // is the wasted work a lazy memo is meant to remove.
            expect(bodyRuns).toBe(6);
            expect(untrack(() => read())).toBe(10);
            expect(bodyRuns).toBe(6);
            dispose();
        }

        // --- lazy ---
        {
            const [n, setN] = createSignal(0);
            let bodyRuns = 0;
            let dispose!: () => void;
            let read!: () => number;

            createRoot((d) => {
                dispose = d;
                read = createMemo(() => {
                    bodyRuns++;
                    return n() * 2;
                }, memoOptions(true));
            });

            expect(bodyRuns).toBe(0);
            settle();
            expect(bodyRuns).toBe(0);

            for (let i = 1; i <= 5; i++) {
                setN(i);
                settle();
            }

            // Zero, not one: an unread lazy memo is pure savings across writes.
            expect(bodyRuns).toBe(0);

            // First read pays for the whole batch at once, and pays once.
            expect(untrack(() => read())).toBe(10);
            expect(bodyRuns).toBe(1);
            dispose();
        }
    });

    it('case 4: untracked-only reads are idempotent within a tick but pay again after every flush', () => {
        // --- lazy, five reads with NO flush in between ---
        {
            const [n] = createSignal(3);
            let bodyRuns = 0;
            let dispose!: () => void;
            let read!: () => number;

            createRoot((d) => {
                dispose = d;
                read = createMemo(() => {
                    bodyRuns++;
                    return n() * 2;
                }, memoOptions(true));
            });

            // Zero before the first read: the one number an eager flip of this
            // site cannot produce.
            expect(bodyRuns).toBe(0);

            const values: number[] = [];
            for (let i = 0; i < 5; i++) values.push(untrack(() => read()));

            expect(values).toEqual([6, 6, 6, 6, 6]);
            // ONE, not five. The #3078 fix: read() queues the subscriber-less
            // AUTO_DISPOSE node into `dormantNodes` and arms schedule()
            // (dev.js:4868-4882) instead of calling unobserved() inline, so the
            // node stays alive and serves its cache for the rest of the tick.
            expect(bodyRuns).toBe(1);
            dispose();
        }

        // --- lazy, five reads each followed by a flush ---
        {
            const [n] = createSignal(3);
            let bodyRuns = 0;
            let dispose!: () => void;
            let read!: () => number;

            createRoot((d) => {
                dispose = d;
                read = createMemo(() => {
                    bodyRuns++;
                    return n() * 2;
                }, memoOptions(true));
            });

            for (let i = 0; i < 5; i++) {
                expect(untrack(() => read())).toBe(6);
                settle();
            }

            // FIVE. Each settle() runs sweepDormant (dev.js:2946), which finds
            // the node still subscriber-less and calls unobserved() on it; the
            // next read revives it through prepareComputed's REACTIVE_DISPOSED
            // + CONFIG_AUTO_DISPOSE branch (dev.js:4598) with a full recompute.
            // A lazy memo read only from event handlers therefore recomputes
            // once per handler, with no memoization across ticks at all.
            expect(bodyRuns).toBe(5);
            dispose();
        }

        // --- eager, same two read patterns: one body run, ever ---
        {
            const [n] = createSignal(3);
            let bodyRuns = 0;
            let dispose!: () => void;
            let read!: () => number;

            createRoot((d) => {
                dispose = d;
                read = createMemo(() => {
                    bodyRuns++;
                    return n() * 2;
                }, memoOptions(false));
            });

            // Five reads with no flush in between: one run, same as lazy.
            for (let i = 0; i < 5; i++) expect(untrack(() => read())).toBe(6);
            expect(bodyRuns).toBe(1);

            // Five reads each followed by a flush: STILL one run — this is the
            // half that discriminates from the lazy block above.
            for (let i = 0; i < 5; i++) {
                expect(untrack(() => read())).toBe(6);
                settle();
            }

            // An eager memo created under an owner gets no CONFIG_AUTO_DISPOSE
            // (dev.js:4291), and a non-AUTO_DISPOSE node is never swept, so the
            // creation run is the only run: with no writes, reads are free
            // under either read pattern. (An eager memo created with NO owner
            // does get the bit — case 10.)
            expect(bodyRuns).toBe(1);
            dispose();
        }
    });

    it('case 5: after its owner is disposed, a memo serves its last value without recomputing', () => {
        for (const lazy of [false, true]) {
            const [n] = createSignal(1);
            let bodyRuns = 0;
            let atCreation = -1;
            let dispose!: () => void;
            let read!: () => number;

            createRoot((d) => {
                dispose = d;
                read = createMemo(() => {
                    bodyRuns++;
                    return n() * 2;
                }, memoOptions(lazy));
                atCreation = bodyRuns;
                createEffect(
                    () => read(),
                    () => {},
                );
            });

            expect(atCreation).toBe(lazy ? 0 : 1);

            settle();
            expect(bodyRuns).toBe(1);

            dispose();
            settle();
            expect(bodyRuns).toBe(1);

            const values: number[] = [];
            for (let i = 0; i < 3; i++) {
                values.push(untrack(() => read()));
                settle();
            }

            // Still 1, for lazy as well as eager. Owner teardown strips
            // CONFIG_AUTO_DISPOSE (dev.js:2581 in dispose(), 2610 in disposeChildren()), which is exactly what
            // separates death from dormancy: prepareComputed's revival branch
            // is gated on that bit (dev.js:4598), so a dead node falls through
            // and returns its last committed value forever.
            expect(values).toEqual([2, 2, 2]);
            expect(bodyRuns).toBe(1);
        }
    });

    it('case 6: store leaf reads recompute per settled draft write, lazy or eager', () => {
        for (const lazy of [false, true]) {
            const [state, setState] = createStore({ t: { _bar: { x: 0 } } });
            let bodyRuns = 0;
            let atCreation = -1;
            let dispose!: () => void;

            createRoot((d) => {
                dispose = d;
                const x = createMemo(() => {
                    bodyRuns++;
                    return state.t._bar.x;
                }, memoOptions(lazy));
                atCreation = bodyRuns;
                createEffect(
                    () => x(),
                    () => {},
                );
            });

            // The one place the two variants differ in this case.
            expect(atCreation).toBe(lazy ? 0 : 1);

            settle();
            expect(bodyRuns).toBe(1);

            for (let i = 0; i < 5; i++) {
                setState((draft) => {
                    draft.t._bar.x += 1;
                });
                settle();
            }

            // 1 + 5. Leaf mutation of `_bar.x` invalidates the memo exactly
            // once per settled write (CLAUDE.md rule 6), and lazy does not
            // change that once a tracked reader is attached — the drag path's
            // per-frame cost is identical either way.
            expect(state.t._bar.x).toBe(5);
            expect(bodyRuns).toBe(6);
            dispose();
        }
    });

    it('case 7: equals returning true stops the reader but not the memo body', () => {
        for (const lazy of [false, true]) {
            const [n, setN] = createSignal(0);
            let bodyRuns = 0;
            let applyRuns = 0;
            let atCreation = -1;
            let dispose!: () => void;

            createRoot((d) => {
                dispose = d;
                const m = createMemo(
                    () => {
                        bodyRuns++;
                        return n();
                    },
                    { equals: () => true, ...memoOptions(lazy) },
                );
                atCreation = bodyRuns;
                createEffect(
                    () => m(),
                    () => {
                        applyRuns++;
                    },
                );
            });

            expect(atCreation).toBe(lazy ? 0 : 1);

            settle();
            expect(bodyRuns).toBe(1);
            expect(applyRuns).toBe(1);

            for (let i = 1; i <= 5; i++) {
                setN(i);
                settle();
            }

            // `equals` is a COMMIT filter, not an INVALIDATION filter: the body
            // still runs on every settled write (6 = 1 + 5) because the runtime
            // has to produce a candidate value before it can compare. Only the
            // downstream propagation is suppressed, so the effect's apply is
            // still at its single first-flush run.
            expect(bodyRuns).toBe(6);
            expect(applyRuns).toBe(1);
            dispose();
        }
    });

    it('case 8: a subscriber that comes and goes — the one shape lazy is for', () => {
        for (const lazy of [false, true]) {
            const [n, setN] = createSignal(1);
            const [shown, setShown] = createSignal(true);
            let bodyRuns = 0;
            let dispose!: () => void;

            createRoot((d) => {
                dispose = d;
                const m = createMemo(() => {
                    bodyRuns++;
                    return n() * 2;
                }, memoOptions(lazy));
                // The memo has a tracked subscriber only while `shown`.
                createEffect(
                    () => (shown() ? m() : null),
                    () => {},
                );
            });
            settle();
            expect(bodyRuns).toBe(1);

            // Last subscriber leaves, then the source changes twice.
            setShown(false);
            settle();
            setN(2);
            settle();
            setN(3);
            settle();
            // Eager keeps recomputing for nobody; lazy was torn down by
            // unlinkSubs (dev.js:2888-2892) and ignores both writes.
            expect(bodyRuns).toBe(lazy ? 1 : 3);

            // Subscriber returns: lazy pays exactly one revival recompute.
            setShown(true);
            settle();
            expect(bodyRuns).toBe(lazy ? 2 : 3);
            dispose();
        }
    });

    it('case 9: an eager memo reading a lazy memo pulls it in its own creation tick', () => {
        const [n, setN] = createSignal(1);
        let childRuns = 0;
        let dispose!: () => void;
        let parent!: () => number;

        let atCreation = -1;
        let afterParent = -1;
        createRoot((d) => {
            dispose = d;
            const child = createMemo(() => {
                childRuns++;
                return n() * 2;
            }, memoOptions(true));
            atCreation = childRuns;
            // Eager wrapper: its creation-time compute reads (and subscribes
            // to) the lazy child before any effect or JSX exists — the
            // getAllDateInfos / dateInfos shape in src/.
            parent = createMemo(() => child() + 1);
            afterParent = childRuns;
        });
        expect(atCreation).toBe(0);
        expect(afterParent).toBe(1);

        // Nothing reads the parent. It is eager and owned, so it recomputes
        // per write regardless, and the child — subscribed by it — follows:
        // full parity with an eager child.
        for (let i = 2; i <= 6; i++) {
            setN(i);
            settle();
        }
        expect(childRuns).toBe(6);
        expect(untrack(() => parent())).toBe(13);
        dispose();
    });

    it('case 10: a memo created with no owner is auto-dispose whether or not it is lazy', () => {
        const [n] = createSignal(3);
        let bodyRuns = 0;
        // Eager, but NO owner: dev.js:4291 sets CONFIG_AUTO_DISPOSE for
        // `!context` exactly as it does for `options.lazy`.
        const read = createMemo(() => {
            bodyRuns++;
            return n() * 2;
        });
        expect(bodyRuns).toBe(1);

        for (let i = 0; i < 3; i++) {
            expect(untrack(() => read())).toBe(6);
            settle();
        }
        // First read hits the creation value; each settle() sweeps the
        // subscriber-less node; each later read recomputes — the lazy
        // treadmill of case 4, without anyone having asked for lazy.
        expect(bodyRuns).toBe(3);
    });

    it('case 11: an effect apply is an ownerless scope — a lazy memo read only there recomputes every apply', () => {
        for (const lazy of [false, true]) {
            const [tick, setTick] = createSignal(0);
            const [n] = createSignal(3); // never changes
            let bodyRuns = 0;
            let applies = 0;
            let dispose!: () => void;

            createRoot((d) => {
                dispose = d;
                const m = createMemo(() => {
                    bodyRuns++;
                    return n() * 2;
                }, memoOptions(lazy));
                createEffect(
                    () => tick(),
                    () => {
                        applies++;
                        // runEffect (dev.js:6236) installs no context, so this
                        // read is ownerless even though the effect is owned.
                        untrack(() => m());
                    },
                );
            });
            settle();
            for (let i = 1; i <= 4; i++) {
                setTick(i);
                settle();
            }
            expect(applies).toBe(5);
            // Source never changed. Eager: cached once. Lazy: swept after
            // every apply's read, recomputed by the next — five for five.
            expect(bodyRuns).toBe(lazy ? 5 : 1);
            dispose();
        }
    });
});
