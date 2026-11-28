import { expect, it, vi } from 'vitest';
import { mountGantt } from './helpers/mountGantt';

it('ends the expected-progress overlay at today on an uneven month timeline', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2025, 2, 1, 12));
    try {
        const chart = mountGantt(
            {
                options: {
                    viewMode: 'Month',
                    showExpectedProgress: true,
                    columnWidth: 310,
                },
                tasks: [
                    {
                        id: 'work',
                        name: 'Work',
                        start: '2025-01-16 12:00',
                        end: '2025-03-16 12:00',
                    },
                ],
            },
            { clientWidth: 1600 },
        );
        try {
            const overlay = chart.container.querySelector<HTMLElement>(
                '[data-id="work"] .bar-expected-progress',
            );
            // Half of January plus all of February. March 1 is a month tick.
            expect(overlay?.style.width).toBe('465px');
        } finally {
            chart.dispose();
        }
    } finally {
        vi.useRealTimers();
    }
});
