import { createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import type { GanttTask, Resource } from '../src/types';
import { formatDiagnostics, startDiagnostics } from './helpers/diagnostics';
import { mountGantt } from './helpers/mountGantt';
import { settle } from './helpers/settle';

const tasks: GanttTask[] = [
    {
        id: 'task-a',
        name: 'Planning',
        start: '2025-01-01',
        end: '2025-01-03',
        progress: 25,
        resource: 'a',
    },
    {
        id: 'task-b',
        name: 'Design',
        start: '2025-01-03',
        end: '2025-01-05',
        resource: 'b',
    },
    {
        id: 'task-c',
        name: 'Delivery',
        start: '2025-01-06',
        end: '2025-01-08',
        resource: 'c',
    },
];

it('retains resource cells across refreshes, name changes, and group collapse', () => {
    const initialResources: Resource[] = [
        { id: 'team', name: 'Team', type: 'group' },
        { id: 'a', name: 'Alice', type: 'resource', group: 'team' },
        { id: 'b', name: 'Bob', type: 'resource', group: 'team' },
        { id: 'c', name: 'Casey', type: 'resource' },
    ];
    const [resources, setResources] = createSignal(initialResources);
    const mounted = mountGantt({
        tasks,
        get resources() {
            return resources();
        },
    });
    const diagnostics = startDiagnostics();

    try {
        const group = mounted.container.querySelector<HTMLElement>(
            '.resource-cell[data-resource="team"]',
        );
        const member = mounted.container.querySelector(
            '.resource-cell[data-resource="a"]',
        );
        expect(group?.textContent).toContain('Team');
        expect(member?.textContent).toBe('Alice');

        setResources(initialResources.map((resource) => ({ ...resource })));
        settle();

        expect(formatDiagnostics(diagnostics.take())).toEqual([]);
        expect(
            mounted.container.querySelector(
                '.resource-cell[data-resource="a"]',
            ),
        ).toBe(member);

        setResources((previous) =>
            previous.map((resource) =>
                resource.id === 'a' ? { ...resource, name: 'Ada' } : resource,
            ),
        );
        settle();

        expect(
            mounted.container.querySelector(
                '.resource-cell[data-resource="a"]',
            ),
        ).toBe(member);
        expect(member?.textContent).toBe('Ada');

        group!.click();
        settle();

        expect(
            mounted.container.querySelector(
                '.resource-cell[data-resource="team"]',
            ),
        ).toBe(group);
        expect(
            mounted.container.querySelector(
                '.resource-cell[data-resource="a"]',
            ),
        ).toBeNull();
        expect(formatDiagnostics(diagnostics.take())).toEqual([]);
    } finally {
        diagnostics.stop();
        mounted.dispose();
    }
});

it('keeps a custom column row and updates its task progress after reload', () => {
    const [currentTasks, setCurrentTasks] = createSignal(tasks);
    const mounted = mountGantt({
        get tasks() {
            return currentTasks();
        },
        columns: [{ key: 'progress', label: 'Progress' }],
    });
    const diagnostics = startDiagnostics();

    try {
        const row = mounted.container.querySelector(
            '.column-panel-row[data-resource="a"]',
        );
        expect(row?.textContent).toBe('25');

        setCurrentTasks((previous) => previous.slice());
        settle();

        expect(formatDiagnostics(diagnostics.take())).toEqual([]);
        expect(
            mounted.container.querySelector(
                '.column-panel-row[data-resource="a"]',
            ),
        ).toBe(row);

        mounted.stores.taskStore.setTaskProgress('task-a', 70);
        settle();

        expect(row?.textContent).toBe('70');
        expect(formatDiagnostics(diagnostics.take())).toEqual([]);
    } finally {
        diagnostics.stop();
        mounted.dispose();
    }
});
