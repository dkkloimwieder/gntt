import { describe, it, expect } from 'vitest';
import { initializeTasks } from '../src/utils/ganttSetup';
import { createTaskStore } from '../src/stores/taskStore';
import { createGanttConfigStore } from '../src/stores/ganttConfigStore';
import { createGanttDateStore } from '../src/stores/ganttDateStore';
import { createResourceStore } from '../src/stores/resourceStore';
import type { GanttTask } from '../src/types';

function makeStores() {
    return {
        taskStore: createTaskStore(),
        ganttConfig: createGanttConfigStore({}),
        dateStore: createGanttDateStore({}),
        resourceStore: createResourceStore([]),
    };
}

const t = (id: string, resource: string): GanttTask => ({
    id,
    name: id,
    start: '2025-01-01 08:00',
    end: '2025-01-01 16:00',
    resource,
});

describe('initializeTasks — resource extraction signal', () => {
    it('extracts resources from tasks on first run when no explicit resources', () => {
        const stores = makeStores();
        initializeTasks([t('a', 'R1'), t('b', 'R2')], stores);
        expect(stores.resourceStore.resources().map((r) => r.id)).toEqual([
            'R1',
            'R2',
        ]);
    });

    it('re-extracts resources on subsequent runs (filter use case)', () => {
        const stores = makeStores();
        // Initial set: 3 resources
        initializeTasks(
            [t('a', 'R1'), t('b', 'R2'), t('c', 'R3')],
            stores,
            true,
            false, // hasExplicitResources = false
        );
        expect(stores.resourceStore.resources().map((r) => r.id)).toEqual([
            'R1',
            'R2',
            'R3',
        ]);
        // Filter narrows the task set to just R2
        initializeTasks([t('b', 'R2')], stores, true, false);
        expect(stores.resourceStore.resources().map((r) => r.id)).toEqual([
            'R2',
        ]);
    });

    it('preserves explicit resources when hasExplicitResources=true', () => {
        const stores = makeStores();
        stores.resourceStore.updateResources([
            { id: 'R1', type: 'resource' },
            { id: 'R2', type: 'resource' },
            { id: 'R3', type: 'resource' },
        ]);
        // Pass tasks for only R1 — explicit resources stay intact.
        initializeTasks([t('a', 'R1')], stores, true, true);
        expect(stores.resourceStore.resources().map((r) => r.id)).toEqual([
            'R1',
            'R2',
            'R3',
        ]);
    });

    it('clears resources to empty on empty input when not explicit', () => {
        const stores = makeStores();
        initializeTasks([t('a', 'R1')], stores, true, false);
        expect(stores.resourceStore.resources()).toHaveLength(1);
        initializeTasks([], stores, true, false);
        expect(stores.resourceStore.resources()).toHaveLength(0);
    });

    it('keeps explicit resources untouched on empty input', () => {
        const stores = makeStores();
        stores.resourceStore.updateResources([{ id: 'R1', type: 'resource' }]);
        initializeTasks([], stores, true, true);
        expect(stores.resourceStore.resources()).toHaveLength(1);
    });
});

describe('initializeTasks — relationships and tasks', () => {
    it('returns relationships derived from dependencies', () => {
        const stores = makeStores();
        const tasks: GanttTask[] = [
            t('a', 'R1'),
            { ...t('b', 'R1'), dependencies: [{ id: 'a' }] },
        ];
        const result = initializeTasks(tasks, stores);
        expect(result.relationships).toHaveLength(1);
        expect(result.relationships[0]).toMatchObject({ from: 'a', to: 'b' });
    });

    it('clears the task store on empty input', () => {
        const stores = makeStores();
        initializeTasks([t('a', 'R1')], stores);
        expect(stores.taskStore.taskCount()).toBeGreaterThan(0);
        initializeTasks([], stores);
        expect(stores.taskStore.taskCount()).toBe(0);
    });
});
