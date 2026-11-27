import { afterEach, describe, expect, it } from 'vitest';
import { createSignal, createStore } from 'solid-js';
import type { GanttTask, ResourceInput } from '../src/types';
import { mountGantt, type MountedGantt } from './helpers/mountGantt';
import { settle } from './helpers/settle';

function makeTask(id: string, resource = 'R1'): GanttTask {
    return {
        id,
        name: id,
        start: '2025-01-01 08:00',
        end: '2025-01-02 16:00',
        resource,
    };
}

function rowIds(chart: MountedGantt): string[] {
    return Array.from(
        chart.container.querySelectorAll('[data-resource]'),
        (row) => row.getAttribute('data-resource')!,
    );
}

describe('Gantt reactive inputs', () => {
    let chart: MountedGantt | undefined;
    afterEach(() => {
        chart?.dispose();
        chart = undefined;
    });

    it('preserves provider resources and their order without a chart resource prop', () => {
        chart = mountGantt(
            { tasks: [makeTask('a', 'R2')] },
            { provider: true, providerResources: ['R1', 'R2'] },
        );

        expect(rowIds(chart)).toEqual(['R1', 'R2']);
        expect(chart.stores.taskStore.getTask('a')?._resourceIndex).toBe(1);
    });

    it('updates rows when the provider resource prop changes', () => {
        const [resources, setResources] = createSignal<ResourceInput[]>([
            'R1',
            'R2',
        ]);
        chart = mountGantt(
            { tasks: [makeTask('a', 'R2')] },
            {
                provider: true,
                get providerResources() {
                    return resources();
                },
            },
        );
        expect(rowIds(chart)).toEqual(['R1', 'R2']);

        setResources(['R2', 'R3']);
        settle();
        expect(rowIds(chart)).toEqual(['R2', 'R3']);
        expect(chart.stores.taskStore.getTask('a')?._resourceIndex).toBe(0);
    });

    it('reorders rows from a reactive resource list and derives rows when cleared', () => {
        const [resources, setResources] = createSignal<ResourceInput[]>([
            'R1',
            'R2',
        ]);
        chart = mountGantt({
            tasks: [makeTask('a', 'R2')],
            get resources() {
                return resources();
            },
        });
        expect(rowIds(chart)).toEqual(['R1', 'R2']);

        setResources(['R2', 'R1']);
        settle();
        expect(rowIds(chart)).toEqual(['R2', 'R1']);
        expect(chart.stores.taskStore.getTask('a')?._resourceIndex).toBe(0);

        setResources([]);
        settle();
        expect(rowIds(chart)).toEqual(['R2']);
    });

    it('handles nested edits to Solid task and resource input stores', () => {
        const [inputs, setInputs] = createStore({
            tasks: [makeTask('a')],
            resources: [
                { id: 'R1', type: 'resource' as const },
                { id: 'R2', type: 'resource' as const },
            ],
        });
        chart = mountGantt({
            get tasks() {
                return inputs.tasks;
            },
            get resources() {
                return inputs.resources;
            },
        });

        setInputs((draft) => {
            draft.tasks[0]!.resource = 'R3';
            draft.tasks[0]!.end = '2025-01-04 16:00';
            draft.resources[0]!.id = 'R3';
        });
        settle();

        const task = chart.stores.taskStore.getTask('a');
        expect(task?._end).toEqual(new Date(2025, 0, 4, 16));
        expect(task?._resourceIndex).toBe(0);
        expect(rowIds(chart)).toEqual(['R3', 'R2']);
    });

    it('uses new task bounds, view granularity and column width in one update', () => {
        const [tasks, setTasks] = createSignal([makeTask('a')]);
        const [viewMode, setViewMode] = createSignal('Day');
        const [columnWidth, setColumnWidth] = createSignal(45);
        chart = mountGantt({
            get tasks() {
                return tasks();
            },
            get options() {
                return { viewMode: viewMode(), columnWidth: columnWidth() };
            },
        });

        setTasks([
            {
                ...makeTask('b'),
                start: '2025-06-01 08:00',
                end: '2025-06-02 16:00',
            },
        ]);
        setViewMode('Week');
        setColumnWidth(75);
        settle();

        const { taskStore, dateStore, ganttConfig } = chart.stores;
        expect(dateStore.ganttStart()).toEqual(new Date(2025, 4, 1));
        expect(dateStore.step()).toBe(7);
        expect(dateStore.columnWidth()).toBe(75);
        expect(ganttConfig.columnWidth()).toBe(75);
        const task = taskStore.getTask('b');
        expect(task?._bar.x).toBe(dateStore.dateToX(task!._start));
        expect(taskStore.getTask('a')).toBeUndefined();
    });

    it('reprojects bars and grid without changing dates on a width-only update', () => {
        const [columnWidth, setColumnWidth] = createSignal<number | undefined>(
            60,
        );
        chart = mountGantt({
            tasks: [makeTask('a')],
            get options() {
                return { columnWidth: columnWidth() };
            },
        });
        const { dateStore, ganttConfig, taskStore } = chart.stores;
        const dates = dateStore.dates();
        const start = dateStore.ganttStart();
        const end = dateStore.ganttEnd();
        const initialWidth = taskStore.getBarPosition('a')!.width;

        setColumnWidth(120);
        settle();
        expect(dateStore.dates()).toBe(dates);
        expect(dateStore.ganttStart()).toBe(start);
        expect(dateStore.ganttEnd()).toBe(end);
        expect(dateStore.gridWidth()).toBe(dates.length * 120);
        expect(ganttConfig.columnWidth()).toBe(120);
        expect(taskStore.getBarPosition('a')?.width).toBe(initialWidth * 2);

        setColumnWidth(undefined);
        settle();
        expect(dateStore.columnWidth()).toBe(45);
        expect(ganttConfig.columnWidth()).toBe(45);
    });

    it('uses the new bar height when tasks and options change together', () => {
        const [tasks, setTasks] = createSignal([makeTask('a')]);
        const [barHeight, setBarHeight] = createSignal(30);
        chart = mountGantt({
            get tasks() {
                return tasks();
            },
            get options() {
                return { barHeight: barHeight() };
            },
        });

        setTasks([makeTask('b')]);
        setBarHeight(45);
        settle();
        expect(chart.stores.taskStore.getBarPosition('b')?.height).toBe(45);
    });

    it('reprojects tasks after an imperative view change and keeps the bounds', () => {
        chart = mountGantt(
            { tasks: [makeTask('a')], options: { viewMode: 'Day' } },
            { provider: true },
        );
        const { dateStore, taskStore } = chart.stores;
        const start = dateStore.ganttStart();
        const end = dateStore.ganttEnd();
        dateStore.changeViewMode('Week');
        settle();

        expect(dateStore.viewMode().name).toBe('Week');
        expect(dateStore.ganttStart()).toEqual(start);
        expect(dateStore.ganttEnd()).toEqual(end);
        const task = taskStore.getTask('a');
        expect(task?._bar.x).toBe(dateStore.dateToX(task!._start));
    });

    it('keeps edited geometry when only search changes', () => {
        const [inputs, setInputs] = createSignal({
            search: '',
            tasks: [makeTask('a')],
            resources: ['R1'],
        });
        chart = mountGantt({
            get tasks() {
                return inputs().tasks;
            },
            get resources() {
                return inputs().resources;
            },
            get options() {
                return { search: inputs().search };
            },
        });
        chart.stores.taskStore.updateBarPosition('a', { x: 123 });
        settle();

        setInputs((prev) => ({ ...prev, search: 'a' }));
        settle();
        expect(chart.stores.taskStore.getBarPosition('a')?.x).toBe(123);
    });
});
