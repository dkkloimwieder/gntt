import { render } from '@solidjs/web';
import { createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { DateHeaders } from '../src/components/DateHeaders';
import type { DateInfo } from '../src/types';
import { settle } from './helpers/settle';

it('keeps overlapping headers mounted during a horizontal scroll', () => {
    const [startCol, setStartCol] = createSignal(0);
    const dates: DateInfo[] = Array.from({ length: 4 }, (_, index) => ({
        date: new Date(2025, 0, index + 1),
        x: index * 40,
        width: 40,
        lowerText: String(index + 1),
        upperText: 'January',
        isThickLine: index === 0,
    }));
    const host = document.createElement('div');
    const dispose = render(
        () => (
            <DateHeaders
                dateInfos={dates}
                startCol={startCol()}
                endCol={startCol() + 2}
                gridWidth={160}
            />
        ),
        host,
    );

    try {
        const month = host.querySelector('.upper-text');
        const day = host.querySelector('[data-date-index="1"]');
        expect(month?.textContent).toBe('January');
        expect(day?.textContent).toBe('2');

        setStartCol(1);
        settle();

        expect(host.querySelector('.upper-text')).toBe(month);
        expect(host.querySelector('[data-date-index="1"]')).toBe(day);
        expect(host.querySelector('[data-date-index="0"]')).toBeNull();
        expect(host.querySelector('[data-date-index="2"]')?.textContent).toBe(
            '3',
        );
    } finally {
        dispose();
    }
});
