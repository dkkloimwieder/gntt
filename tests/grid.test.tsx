import { render } from '@solidjs/web';
import { expect, it } from 'vitest';
import { Grid } from '../src/components/Grid';

it('gives each chart its own pattern for vertical grid lines', () => {
    const host = document.createElement('div');
    const dispose = render(
        () => (
            <>
                <svg>
                    <Grid columnWidth={45} />
                </svg>
                <svg>
                    <Grid columnWidth={55} />
                </svg>
            </>
        ),
        host,
    );
    try {
        const [first, second] = [...host.querySelectorAll('pattern')];
        expect(first?.id).toBeTruthy();
        expect(second?.id).toBeTruthy();
        expect(first?.id).not.toBe(second?.id);
        expect(first?.getAttribute('width')).toBe('45');
        expect(second?.getAttribute('width')).toBe('55');
        for (const pattern of [first, second]) {
            const lines = pattern
                ?.closest('svg')
                ?.querySelector('.grid-vertical-lines');
            expect(lines?.getAttribute('fill')).toBe(`url(#${pattern?.id})`);
        }
    } finally {
        dispose();
    }
});
