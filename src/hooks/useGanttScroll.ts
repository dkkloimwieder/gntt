/**
 * Scroll + viewport-dimension wiring for the Gantt component.
 *
 * Owns the scroll signals (X/Y, viewport W/H) and the wiring that
 * subscribes them to a ContainerAPI when one becomes available via
 * onContainerReady.
 *
 * Extracted from Gantt.tsx so the orchestrator file isn't dominated
 * by signal plumbing. Behavior unchanged: scroll signals batched in
 * a single createEffect.
 */
import { createSignal, createEffect, batch, type Accessor } from 'solid-js';

export interface ContainerAPILike {
    scrollTo: (x: number, smooth?: boolean) => void;
    getScrollLeft: () => number;
    getScrollTop: () => number;
    getContainerWidth: () => number;
    getContainerHeight: () => number;
    scrollLeftSignal?: Accessor<number>;
    scrollTopSignal?: Accessor<number>;
    containerWidthSignal?: Accessor<number>;
    containerHeightSignal?: Accessor<number>;
}

export interface GanttScroll {
    scrollLeft: Accessor<number>;
    scrollTop: Accessor<number>;
    viewportWidth: Accessor<number>;
    viewportHeight: Accessor<number>;
    /** Pass to GanttContainer's onContainerReady — wires up signals. */
    handleContainerReady: (api: ContainerAPILike) => void;
}

export function useGanttScroll(): GanttScroll {
    const [scrollLeft, setScrollLeft] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [viewportWidth, setViewportWidth] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);

    const handleContainerReady = (api: ContainerAPILike): void => {
        // Initialize viewport dimensions from the container's measured size
        setViewportWidth(api.getContainerWidth());
        setViewportHeight(api.getContainerHeight());

        // Subscribe to reactive signals from the container (batched to
        // avoid double-cascade on combined X/Y scroll).
        if (api.scrollLeftSignal && api.scrollTopSignal) {
            createEffect(() => {
                const sl = api.scrollLeftSignal!();
                const st = api.scrollTopSignal!();
                batch(() => {
                    setScrollLeft(sl);
                    setScrollTop(st);
                });
            });
        } else {
            if (api.scrollLeftSignal) {
                createEffect(() => {
                    setScrollLeft(api.scrollLeftSignal!());
                });
            }
            if (api.scrollTopSignal) {
                createEffect(() => {
                    setScrollTop(api.scrollTopSignal!());
                });
            }
        }

        if (api.containerWidthSignal) {
            createEffect(() => {
                setViewportWidth(api.containerWidthSignal!());
            });
        }
        if (api.containerHeightSignal) {
            createEffect(() => {
                setViewportHeight(api.containerHeightSignal!());
            });
        }
    };

    return {
        scrollLeft,
        scrollTop,
        viewportWidth,
        viewportHeight,
        handleContainerReady,
    };
}
