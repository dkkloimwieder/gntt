/**
 * Scroll + viewport-dimension wiring for the Gantt component.
 *
 * Pure derivation over the container API: given the accessor that holds
 * whatever `GanttContainer` handed to `onContainerReady`, the four
 * accessors below track the container's own signals and read 0 until a
 * container exists.
 *
 * The hook owns every primitive it needs. Nothing is created inside
 * `onContainerReady` — that callback fires from `GanttContainer`'s
 * `onSettled`, whose body is children-forbidden: creating an effect or a
 * memo there throws.
 */
import { createMemo, type Accessor } from 'solid-js';

export interface ContainerAPILike {
    scrollTo: (x: number, smooth?: boolean) => void;
    getScrollLeft: () => number;
    getScrollTop: () => number;
    getContainerWidth: () => number;
    getContainerHeight: () => number;
    /**
     * Viewport size measured once when the container mounted, carried as
     * plain data so a consumer running inside the container's own mount
     * scope can use it without reading a signal that scope just wrote.
     */
    containerWidth: number;
    containerHeight: number;
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
}

export function useGanttScroll(
    containerApi: Accessor<ContainerAPILike | null>,
): GanttScroll {
    const scrollLeft = createMemo(
        () => containerApi()?.scrollLeftSignal?.() ?? 0,
    );
    const scrollTop = createMemo(
        () => containerApi()?.scrollTopSignal?.() ?? 0,
    );
    const viewportWidth = createMemo(
        () =>
            containerApi()?.containerWidthSignal?.() ??
            containerApi()?.containerWidth ??
            0,
    );
    const viewportHeight = createMemo(
        () =>
            containerApi()?.containerHeightSignal?.() ??
            containerApi()?.containerHeight ??
            0,
    );

    return { scrollLeft, scrollTop, viewportWidth, viewportHeight };
}
