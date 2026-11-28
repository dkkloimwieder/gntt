import { render } from '@solidjs/web';
import { createMemo, createSignal, For, Repeat } from 'solid-js';
import { expect, it } from 'vitest';
import { settle } from './helpers/settle';

interface Item {
    id: string;
}

interface Counts {
    mounts: number;
    reads: number;
}

function Slot(props: { read: () => Item | undefined; counts: Counts }) {
    const counts = props.counts;
    counts.mounts++;
    const label = createMemo(() => {
        counts.reads++;
        return props.read()?.id ?? '';
    });
    return <span>{label()}</span>;
}

it('reuses sparse slot nodes and compares item reads with Repeat', () => {
    const first = { id: 'a' };
    const second = { id: 'b' };
    const third = { id: 'c' };
    const initial: (Item | undefined)[] = new Array(4);
    initial[0] = first;
    initial[2] = second;
    const [pool, setPool] = createSignal(initial);
    const forCounts = { mounts: 0, reads: 0 };
    const repeatCounts = { mounts: 0, reads: 0 };
    const host = document.createElement('div');
    const dispose = render(
        () => (
            <>
                <div class="for">
                    <For keyed={false} each={pool()}>
                        {(item) => <Slot read={item} counts={forCounts} />}
                    </For>
                </div>
                <div class="repeat">
                    <Repeat count={pool().length}>
                        {(index) => (
                            <Slot
                                read={() => pool()[index]}
                                counts={repeatCounts}
                            />
                        )}
                    </Repeat>
                </div>
            </>
        ),
        host,
    );
    const slots = (kind: string) => [...host.querySelectorAll(`.${kind} span`)];
    const labels = (nodes: Element[]) => nodes.map((node) => node.textContent);
    try {
        const beforeFor = slots('for');
        const beforeRepeat = slots('repeat');
        expect(labels(beforeFor)).toEqual(['a', '', 'b', '']);
        expect(labels(beforeRepeat)).toEqual(labels(beforeFor));
        expect(forCounts).toEqual({ mounts: 4, reads: 4 });
        expect(repeatCounts).toEqual(forCounts);

        const refreshed: (Item | undefined)[] = new Array(4);
        refreshed[0] = first;
        refreshed[1] = third;
        refreshed[3] = second;
        setPool(refreshed);
        settle();

        const afterFor = slots('for');
        const afterRepeat = slots('repeat');
        expect(labels(afterFor)).toEqual(['a', 'c', '', 'b']);
        expect(labels(afterRepeat)).toEqual(labels(afterFor));
        for (let i = 0; i < afterFor.length; i++) {
            expect(afterFor[i]).toBe(beforeFor[i]);
            expect(afterRepeat[i]).toBe(beforeRepeat[i]);
        }

        expect(forCounts).toEqual({ mounts: 4, reads: 7 });
        expect(repeatCounts).toEqual({ mounts: 4, reads: 8 });
    } finally {
        dispose();
    }
});
