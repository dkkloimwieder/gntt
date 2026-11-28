import { expect, it } from 'vitest';
import { mountGantt } from './helpers/mountGantt';
import { settle } from './helpers/settle';

it('packs expanded subtasks on the derived Unassigned row', () => {
    const chart = mountGantt({
        tasks: [
            {
                id: 'parent',
                name: 'Parent',
                start: '2025-01-01',
                end: '2025-01-07',
                subtaskLayout: 'mixed',
            },
            {
                id: 'first',
                name: 'First',
                parentId: 'parent',
                start: '2025-01-01',
                end: '2025-01-03',
            },
            {
                id: 'overlap',
                name: 'Overlap',
                parentId: 'parent',
                start: '2025-01-02',
                end: '2025-01-04',
            },
            {
                id: 'later',
                name: 'Later',
                parentId: 'parent',
                start: '2025-01-05',
                end: '2025-01-07',
            },
        ],
        options: {
            renderMode: 'detailed',
            expandedTasks: ['parent'],
        },
    });
    try {
        const parent = chart.container.querySelector(
            '.expanded-task-container[data-id="parent"]',
        );
        const layer = chart.container.querySelector('svg.expanded-layer');
        expect(layer).toBeInstanceOf(SVGSVGElement);
        expect(layer?.getAttribute('height')).toBe('100%');
        expect(parent).toBeInstanceOf(SVGElement);
        expect((parent as SVGElement).ownerSVGElement).toBe(layer);

        function y(id: string) {
            const bar = parent?.querySelector(
                `.subtask-bar[data-id="${id}"] .subtask-bar-bg`,
            );
            expect(bar).toBeInstanceOf(SVGElement);
            expect((bar as SVGElement).ownerSVGElement).toBe(layer);
            expect(Number(bar?.getAttribute('width'))).toBeGreaterThan(0);
            expect(Number(bar?.getAttribute('height'))).toBeGreaterThan(0);
            return Number(bar?.getAttribute('y'));
        }
        const first = y('first');
        expect(y('overlap')).toBeGreaterThan(first);
        expect(y('later')).toBe(first);

        chart.stores.taskStore.collapseTask('parent');
        settle();
        expect(chart.container.querySelectorAll('.subtask-bar')).toHaveLength(
            0,
        );
    } finally {
        chart.dispose();
    }
});
