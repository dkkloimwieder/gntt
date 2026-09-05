// Pins the proxy hygiene of `useGanttModals` (E2.11).
//
// Two properties that nothing else in the suite observes:
//   1. the task memos hand out a detached PLAIN copy — not the task
//      store's sub-proxy (whose identity never changes, so a memo over it
//      never invalidates) and not a `snapshot()` (untracked, so the memo
//      would compute once and go stale);
//   2. the bar-position memos carry an `equals` over the four rendered
//      geometry leaves, so a recompute driven by a leaf the popup does not
//      render (`_index`) notifies nobody.
//
// Store writes may sit in a createRoot body; the signal writes behind
// showHover/showModal may not (CLAUDE.md migration rule 2), so every
// modal-state write happens in the test body. `settle()` after each write.
import { describe, it, expect } from 'vitest';
import { createRoot, createEffect } from 'solid-js';
import { createTaskStore } from '../src/stores/taskStore';
import { useGanttModals, type GanttModals } from '../src/hooks/useGanttModals';
import { settle } from './helpers/settle';
import type {
    BarPosition,
    NormalizedConstraints,
    ProcessedTask,
} from '../src/types';

function makeTask(id: string): ProcessedTask {
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
        _bar: { x: 10, y: 20, width: 100, height: 30 },
        dependencies: [],
        constraints,
    };
}

interface Harness {
    taskStore: ReturnType<typeof createTaskStore>;
    modals: GanttModals;
    /** Every value the hovered / modal position memos pushed to a consumer. */
    hoverPos: (BarPosition | null)[];
    modalPos: (BarPosition | null)[];
}

/** One task, the hook, and a consumer subscribed to each position memo. */
function setup(): Harness {
    const taskStore = createTaskStore();
    let modals!: GanttModals;
    const hoverPos: (BarPosition | null)[] = [];
    const modalPos: (BarPosition | null)[] = [];
    createRoot(() => {
        taskStore.updateTask('t1', makeTask('t1'));
        modals = useGanttModals(taskStore, () => []);
        createEffect(
            () => modals.hoveredBarPosition(),
            (pos) => {
                hoverPos.push(pos);
            },
        );
        createEffect(
            () => modals.modalBarPosition(),
            (pos) => {
                modalPos.push(pos);
            },
        );
    });
    settle();
    return { taskStore, modals, hoverPos, modalPos };
}

describe('useGanttModals — proxy hygiene', () => {
    it('hands out a detached plain copy of the clicked task', () => {
        const { taskStore, modals } = setup();
        modals.showModal('t1');
        settle();

        const copy = modals.modalTask();
        // Compared as a boolean on purpose: handing a store proxy to
        // expect() crashes vitest's pretty-printer instead of reporting.
        expect(copy === taskStore.getTask('t1')).toBe(false);
        expect(copy?.id).toBe('t1');
        expect(copy?.name).toBe('task t1');
    });

    it('rebuilds the copy on a field change, leaving the old copy frozen', () => {
        const { taskStore, modals } = setup();
        modals.showHover('t1', 5, 6);
        settle();
        const before = modals.hoveredTask();

        taskStore.patchTask('t1', { name: 'renamed' });
        settle();

        // The copy handed out earlier is detached from the store...
        expect(before?.name).toBe('task t1');
        // ...and the memo recomputed into a fresh object (a store proxy
        // would keep its identity; a snapshot() would never recompute).
        expect(modals.hoveredTask()?.name).toBe('renamed');
        expect(modals.hoveredTask() === before).toBe(false);
    });

    it('notifies bar-position consumers only when the geometry changes', () => {
        const { taskStore, modals, hoverPos, modalPos } = setup();
        modals.showHover('t1', 5, 6);
        modals.showModal('t1');
        settle();
        expect(hoverPos[hoverPos.length - 1]).toMatchObject({ x: 10, y: 20 });
        expect(modalPos[modalPos.length - 1]).toMatchObject({ x: 10, y: 20 });
        const hoverRuns = hoverPos.length;
        const modalRuns = modalPos.length;

        // Recomputes both memos (`_index` is read by getBarPosition) without
        // moving the bar: `equals` must swallow it.
        taskStore.patchTask('t1', { _index: 7 });
        settle();
        expect(hoverPos.length).toBe(hoverRuns);
        expect(modalPos.length).toBe(modalRuns);

        taskStore.updateBarPosition('t1', { x: 42 });
        settle();
        expect(hoverPos.length).toBe(hoverRuns + 1);
        expect(modalPos.length).toBe(modalRuns + 1);
        expect(hoverPos[hoverPos.length - 1]).toMatchObject({ x: 42, y: 20 });
    });
});
