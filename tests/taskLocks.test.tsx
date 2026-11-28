import { afterEach, expect, it, vi } from 'vitest';
import { resolveConstraints, type ConstraintContext } from '../src';
import type { GanttTask, LockState } from '../src/types';
import { mountGantt, type MountedGantt } from './helpers/mountGantt';
import { settle } from './helpers/settle';

let mounted: MountedGantt | undefined;
afterEach(() => {
    mounted?.dispose();
    mounted = undefined;
});

const task: GanttTask = {
    id: 'task',
    name: 'Locked task',
    resource: 'A',
    start: '2025-01-08 06:00',
    end: '2025-01-13 12:00',
    progress: 25,
};

function bar(id = 'task'): HTMLElement {
    const node = mounted!.container.querySelector<HTMLElement>(
        `.bar-wrapper[data-id="${id}"]`,
    );
    expect(node).not.toBeNull();
    return node!;
}

function position(id = 'task') {
    const rect = mounted!.stores.taskStore.getBarPosition(id);
    expect(rect).not.toBeNull();
    return rect!;
}

function drag(target: Element, x: number, delta: number): void {
    const mouse = (type: string, clientX: number) =>
        new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY: 18,
        });
    target.dispatchEvent(mouse('mousedown', x));
    document.dispatchEvent(mouse('mousemove', x + delta));
    document.dispatchEvent(mouse('mouseup', x + delta));
    settle();
}

function key(target: Element, name: string, shiftKey = false): void {
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: name,
            shiftKey,
            bubbles: true,
            cancelable: true,
        }),
    );
    settle();
}

function handle(side: 'left' | 'right' | 'progress'): HTMLElement {
    return bar().querySelector<HTMLElement>(`.handle-${side}`)!;
}

it.each([
    { locked: 'start', moves: false, left: false, right: true, progress: true },
    { locked: 'end', moves: false, left: true, right: false, progress: true },
    {
        locked: 'duration',
        moves: true,
        left: false,
        right: false,
        progress: true,
    },
    { locked: true, moves: false, left: false, right: false, progress: false },
] as const)(
    'applies the $locked lock to controls and pointer edits',
    ({ locked, moves, left, right, progress }) => {
        const onDateChange = vi.fn();
        const onProgressChange = vi.fn();
        mounted = mountGantt({
            tasks: [{ ...task, constraints: { locked } }],
            onDateChange,
            onProgressChange,
        });
        const column = mounted.stores.dateStore.columnWidth();
        const wrapper = bar();
        expect(wrapper.getAttribute('aria-disabled')).toBe(
            String(locked === true),
        );
        expect(wrapper.getAttribute('aria-label')).toContain(
            locked === true ? ', locked' : `${locked} locked`,
        );
        expect(handle('left').style.display !== 'none').toBe(left);
        expect(handle('right').style.display !== 'none').toBe(right);
        expect(handle('progress').style.display !== 'none').toBe(progress);

        const original = position();
        drag(wrapper, original.x + 10, column);
        const afterMove = position();
        if (moves) expect(afterMove.x).toBeGreaterThan(original.x);
        else expect(afterMove).toEqual(original);
        expect(afterMove.width).toBeCloseTo(original.width);

        drag(handle('left'), afterMove.x, column);
        const afterLeft = position();
        if (left) {
            expect(afterLeft.x).toBeGreaterThan(afterMove.x);
            expect(afterLeft.x + afterLeft.width).toBeCloseTo(
                afterMove.x + afterMove.width,
            );
        } else expect(afterLeft).toEqual(afterMove);

        drag(handle('right'), afterLeft.x + afterLeft.width, column);
        const afterRight = position();
        if (right) {
            expect(afterRight.x).toBe(afterLeft.x);
            expect(afterRight.width).toBeGreaterThan(afterLeft.width);
        } else expect(afterRight).toEqual(afterLeft);
        expect(onDateChange).toHaveBeenCalledTimes(
            Number(moves) + Number(left) + Number(right),
        );

        drag(
            handle('progress'),
            afterRight.x + afterRight.width * 0.25,
            afterRight.width * 0.5,
        );
        expect(onProgressChange).toHaveBeenCalledTimes(Number(progress));
        expect(mounted.stores.taskStore.getTask('task')?.progress).toBe(
            progress ? 75 : 25,
        );
    },
);

it.each(['start', 'end', 'duration', true] as const)(
    'honors the %s lock through keyboard edits',
    (locked) => {
        const onDateChange = vi.fn();
        mounted = mountGantt({
            tasks: [{ ...task, constraints: { locked } }],
            onDateChange,
        });
        const original = position();
        key(bar(), 'ArrowRight');
        const moved = position();
        if (locked === 'duration') {
            expect(moved.x).toBeGreaterThan(original.x);
            expect(moved.width).toBeCloseTo(original.width);
        } else expect(moved).toEqual(original);

        key(bar(), 'ArrowRight', true);
        const resized = position();
        if (locked === 'start') {
            expect(resized.x).toBe(original.x);
            expect(resized.width).toBeGreaterThan(original.width);
        } else if (locked === 'end') {
            expect(resized.x).toBeGreaterThan(original.x);
            expect(resized.x + resized.width).toBeCloseTo(
                original.x + original.width,
            );
        } else expect(resized).toEqual(moved);
        expect(onDateChange).toHaveBeenCalledTimes(locked === true ? 0 : 1);
    },
);

it.each(['start', 'end', true] as const)(
    'keeps a %s summary stationary',
    (locked) => {
        const onResizeEnd = vi.fn();
        mounted = mountGantt({
            tasks: [{ ...task, type: 'summary', constraints: { locked } }],
            onResizeEnd,
        });
        const original = position();
        expect(bar().getAttribute('aria-disabled')).toBe('true');
        drag(bar(), original.x + 10, mounted.stores.dateStore.columnWidth());
        expect(position()).toEqual(original);
        expect(onResizeEnd).not.toHaveBeenCalled();
    },
);

it('keeps a locked descendant stationary in a summary drag', () => {
    const child = (id: string, locked: LockState): GanttTask => ({
        ...task,
        id,
        parentId: 'task',
        constraints: { locked },
    });
    mounted = mountGantt({
        tasks: [
            { ...task, type: 'summary' },
            child('fixed', 'start'),
            child('movable', 'duration'),
        ],
    });
    const original = position();
    const fixed = position('fixed');
    const movable = position('movable');
    drag(bar(), original.x + 10, mounted.stores.dateStore.columnWidth());
    expect(position('fixed')).toEqual(fixed);
    expect(position('movable').x).toBeGreaterThan(movable.x);
});

it('preserves elapsed duration in a monthly drag for both the task and its dependent', () => {
    const onDateChange = vi.fn();
    mounted = mountGantt({
        tasks: [
            {
                ...task,
                start: '2025-01-01',
                end: '2025-02-01',
                constraints: { locked: 'duration' },
            },
            {
                ...task,
                id: 'dependent',
                start: '2025-02-01',
                end: '2025-03-01',
                constraints: { locked: 'duration' },
                dependencies: [{ id: 'task', type: 'FS' }],
            },
        ],
        options: { viewMode: 'Month' },
        onDateChange,
    });
    const { dateStore } = mounted.stores;
    const elapsed = ({ x, width }: { x: number; width: number }) =>
        dateStore.xToDate(x + width).getTime() - dateStore.xToDate(x).getTime();
    const original = position();
    const dependent = position('dependent');
    const DAY = 24 * 60 * 60 * 1000;
    expect(elapsed(original)).toBe(31 * DAY);
    expect(elapsed(dependent)).toBe(28 * DAY);

    drag(bar(), original.x + 10, dateStore.columnWidth());

    expect(position().x).toBeGreaterThan(original.x);
    expect(position().width).not.toBeCloseTo(original.width);
    expect(elapsed(position())).toBe(31 * DAY);
    expect(position('dependent').x).toBeGreaterThan(dependent.x);
    expect(position('dependent').x).toBeGreaterThanOrEqual(
        position().x + position().width,
    );
    expect(position('dependent').width).not.toBeCloseTo(dependent.width);
    expect(elapsed(position('dependent'))).toBe(28 * DAY);
    expect(onDateChange).toHaveBeenCalledTimes(1);
    const [, range] = onDateChange.mock.calls[0]!;
    expect(range.end.getTime() - range.start.getTime()).toBe(31 * DAY);
});

it.each(['keyboard', 'pointer'] as const)(
    'preserves duration and maxEnd in a bounded %s move across months',
    (gesture) => {
        const onDateChange = vi.fn();
        mounted = mountGantt({
            tasks: [
                {
                    ...task,
                    start: '2025-02-01',
                    end: '2025-03-01',
                    constraints: { locked: 'duration', maxEnd: '2025-03-20' },
                },
            ],
            options: { viewMode: 'Month' },
            onDateChange,
        });
        const original = position();
        if (gesture === 'keyboard') key(bar(), 'ArrowRight');
        else
            drag(
                bar(),
                original.x + 10,
                mounted.stores.dateStore.columnWidth(),
            );
        expect(position().x).toBeGreaterThan(original.x);
        expect(onDateChange).toHaveBeenCalledExactlyOnceWith(
            'task',
            {
                start: new Date(
                    new Date(2025, 2, 20).getTime() - 28 * 24 * 60 * 60 * 1000,
                ),
                end: new Date(2025, 2, 20),
            },
            expect.any(Object),
        );
    },
);

it('places a duration-locked FF successor at the exact Month cascade boundary', () => {
    mounted = mountGantt({
        tasks: [
            { ...task, start: '2025-01-01', end: '2025-02-01' },
            {
                ...task,
                id: 'dependent',
                start: '2025-01-01',
                end: '2025-02-01',
                constraints: { locked: 'duration' },
                dependencies: [{ id: 'task', type: 'FF' }],
            },
        ],
        options: { viewMode: 'Month' },
    });

    key(bar(), 'ArrowRight', true);

    const { dateStore } = mounted.stores;
    const predecessor = position();
    const successor = position('dependent');
    expect(dateStore.xToDate(predecessor.x + predecessor.width)).toEqual(
        new Date(2025, 2, 1),
    );
    expect(dateStore.xToDate(successor.x + successor.width)).toEqual(
        new Date(2025, 2, 1),
    );
    expect(dateStore.xToDate(successor.x)).toEqual(new Date(2025, 0, 29));
});

it('returns the reprojected width at the final constrained start', () => {
    mounted = mountGantt({
        tasks: [
            {
                ...task,
                start: '2025-02-01',
                end: '2025-03-01',
                constraints: { locked: 'duration', maxEnd: '2025-03-20' },
            },
        ],
        options: { viewMode: 'Month' },
    });
    const { dateStore, taskStore } = mounted.stores;
    const { xToDate, dateToX } = dateStore;
    const duration = 28 * 24 * 60 * 60 * 1000;
    const context: ConstraintContext = {
        getBarPosition: (id) => taskStore.getBarPosition(id) ?? undefined,
        getTask: taskStore.getTask,
        relationships: [],
        pixelsPerHour: dateStore.pixelsPerHour(),
        ganttStartDate: dateStore.ganttStart(),
        dateToX,
        projectMoveWidth: (_id, _original, x) =>
            dateToX(new Date(xToDate(x).getTime() + duration)) - x,
        projectMoveStart: (_id, _original, end) =>
            dateToX(new Date(xToDate(end).getTime() - duration)),
    };
    const proposedX = dateToX(new Date(2025, 2, 1));
    const proposedWidth =
        dateToX(new Date(new Date(2025, 2, 1).getTime() + duration)) -
        proposedX;
    const result = resolveConstraints(
        'task',
        proposedX,
        proposedWidth,
        context,
    );
    expect(result.blocked).toBe(false);
    expect(result.constrainedWidth).not.toBeCloseTo(proposedWidth);
    expect(xToDate(result.constrainedX + result.constrainedWidth)).toEqual(
        new Date(2025, 2, 20),
    );
    expect(xToDate(result.constrainedX)).toEqual(
        new Date(new Date(2025, 2, 20).getTime() - duration),
    );
});
