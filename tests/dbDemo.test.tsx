import { render } from '@solidjs/web';
import { expect, it, vi } from 'vitest';
import { DbDemo } from '../src/demo/DbDemo';
import type { BootstrapBundle } from '../src/demo/db/types';
import { settle } from './helpers/settle';

it('persists a fractional-day resize and its cascade through the demo API', async () => {
    const fixture: BootstrapBundle = {
        tasks: [
            {
                id: 'first',
                name: 'First',
                start: '2025-02-01 10:17',
                end: '2025-02-02 01:23',
                progress: 0,
                resource: 'team',
            },
            {
                id: 'second',
                name: 'Second',
                start: '2025-02-02 01:23',
                end: '2025-02-03 03:47',
                progress: 0,
                resource: 'team',
                dependencies: [{ id: 'first', type: 'FS' }],
            },
        ],
        resources: [{ id: 'team', name: 'Team' }],
        blockedTime: [],
    };

    const patches = new Map<string, { start: string; end: string }>();
    const fetchMock = vi.fn(async (path: string, options?: RequestInit) => {
        if (path === '/api/bootstrap') return Response.json(fixture);
        if (options?.method !== 'PATCH' || typeof options.body !== 'string') {
            throw new Error(`Unexpected request ${path}`);
        }

        const id = path.slice('/api/tasks/'.length);
        const dates = JSON.parse(options.body);
        patches.set(id, dates);
        return Response.json({
            ...fixture.tasks.find((task) => task.id === id),
            ...dates,
        });
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );

    const container = document.createElement('div');
    document.body.append(container);
    let dispose: (() => void) | undefined;
    try {
        dispose = render(() => <DbDemo />, container);
        const first = await vi.waitFor(() => {
            const bar = container.querySelector(
                '.bar-wrapper[data-id="first"]',
            );
            expect(bar).not.toBeNull();
            return bar!;
        });
        first.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowRight',
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        settle();

        // A one-column Day resize keeps the original start. The finish
        // and both successor dates move by one day, keeping exact minutes.
        await vi.waitFor(() => {
            expect(container.textContent).toContain('Saved dates for first');
        });
        expect(patches).toEqual(
            new Map([
                [
                    'first',
                    { start: '2025-02-01 10:17', end: '2025-02-03 01:23' },
                ],
                [
                    'second',
                    { start: '2025-02-03 01:23', end: '2025-02-04 03:47' },
                ],
            ]),
        );
        expect(
            fetchMock.mock.calls.filter(([path]) => path === '/api/bootstrap'),
        ).toHaveLength(1);
        expect(
            fetchMock.mock.calls.filter(
                ([, options]) => options?.method === 'PATCH',
            ),
        ).toHaveLength(2);
    } finally {
        dispose?.();
        container.remove();
        vi.unstubAllGlobals();
    }
});
