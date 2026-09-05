import { createSignal, onSettled, Accessor } from 'solid-js';
import type { JSX } from '@solidjs/web';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import {
    DEFAULT_COLUMN_WIDTH,
    DEFAULT_BAR_HEIGHT,
    DEFAULT_PADDING,
} from '../constants';

// Throttle interval for scroll signal updates
const SCROLL_THROTTLE_MS = 100;

interface ContainerAPI {
    scrollTo: (x: number, smooth?: boolean) => void;
    getScrollLeft: () => number;
    getScrollTop: () => number;
    getContainerWidth: () => number;
    getContainerHeight: () => number;
    /**
     * Viewport size measured at mount, as plain data. `onContainerReady`
     * runs inside this component's own mount scope, so a consumer there
     * cannot rely on reading back the signals the same scope just wrote.
     */
    containerWidth: number;
    containerHeight: number;
    scrollLeftSignal: Accessor<number>;
    scrollTopSignal: Accessor<number>;
    containerWidthSignal: Accessor<number>;
    containerHeightSignal: Accessor<number>;
}

interface GanttContainerProps {
    ganttConfig?: GanttConfigStore;
    resourceColumnWidth?: number;
    headerHeight?: number;
    height?: string | number;
    svgWidth?: number;
    svgHeight?: number;
    resourceHeaderLabel?: JSX.Element | string;
    header?: JSX.Element;
    resourceColumn?: JSX.Element;
    children?: JSX.Element;
    barsLayer?: JSX.Element;
    overlay?: JSX.Element;
    onScroll?: (scrollLeft: number, scrollTop: number) => void;
    /**
     * Fired once from `onMount` with the container's imperative API.
     *
     * MUST NOT create reactive primitives — no `createSignal`,
     * `createMemo`, `createEffect` or `onCleanup`, directly or through a
     * callee. Under SolidJS 2.0 this `onMount` becomes `onSettled`, whose
     * body is children-forbidden and throws on primitive creation.
     * Derive from the accessors on the API object from an owner that
     * outlives the callback instead — see `useGanttScroll`.
     */
    onContainerReady?: (api: ContainerAPI) => void;
}

/**
 * GanttContainer - Main wrapper component with scroll handling.
 */
export function GanttContainer(props: GanttContainerProps): JSX.Element {
    let scrollAreaRef: HTMLDivElement | undefined;
    let dateHeadersRef: HTMLDivElement | undefined;
    let resourceBodyRef: HTMLDivElement | undefined;

    const [scrollLeft, setScrollLeft] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [containerWidth, setContainerWidth] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);

    // Resource column width
    const resourceColumnWidth = (): number => props.resourceColumnWidth || 60;

    // Header height
    const headerHeight = (): number => {
        if (props.headerHeight) return props.headerHeight;
        if (props.ganttConfig?.headerHeight)
            return props.ganttConfig.headerHeight();
        return 60;
    };

    // Simple throttling for scroll signal updates
    let lastUpdateTime = 0;
    let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
    let latestScrollX = 0;
    let latestScrollY = 0;

    // Handle scroll in main scroll area - sync other panels
    const handleScroll = (e: Event): void => {
        const target = e.target as HTMLDivElement;
        const { scrollLeft: sl, scrollTop: st } = target;

        // IMPORTANT: Direct DOM sync FIRST for visual smoothness
        if (dateHeadersRef) {
            dateHeadersRef.scrollLeft = sl;
        }
        if (resourceBodyRef) {
            resourceBodyRef.scrollTop = st;
        }

        // Store latest position
        latestScrollX = sl;
        latestScrollY = st;

        // Throttle reactive updates
        const now = performance.now();
        if (now - lastUpdateTime >= SCROLL_THROTTLE_MS) {
            lastUpdateTime = now;
            setScrollLeft(sl);
            setScrollTop(st);
        } else if (!pendingUpdate) {
            pendingUpdate = setTimeout(
                () => {
                    pendingUpdate = null;
                    lastUpdateTime = performance.now();
                    setScrollLeft(latestScrollX);
                    setScrollTop(latestScrollY);
                },
                SCROLL_THROTTLE_MS - (now - lastUpdateTime),
            );
        }

        props.onScroll?.(sl, st);
    };

    // Set scroll position programmatically
    const scrollTo = (x: number, smooth = true): void => {
        if (scrollAreaRef) {
            if (smooth) {
                scrollAreaRef.scrollTo({
                    left: x,
                    behavior: 'smooth',
                });
            } else {
                scrollAreaRef.scrollLeft = x;
            }
        }
    };

    // Setup on mount
    onSettled(() => {
        // Measure once, up front. Both dimensions are seeded from the
        // measurement so the mount path does not depend on the
        // ResizeObserver having fired yet (its first callback re-sets the
        // same numbers, which the signals' default equality swallows), and
        // so the API below can carry them as plain data.
        const measuredWidth = scrollAreaRef?.clientWidth ?? 0;
        const measuredHeight = scrollAreaRef?.clientHeight ?? 0;

        let resizeObserver: ResizeObserver | undefined;
        if (scrollAreaRef) {
            setContainerWidth(measuredWidth);
            setViewportHeight(measuredHeight);

            // Observe resize
            resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    setContainerWidth(entry.contentRect.width);
                    setViewportHeight(entry.contentRect.height);
                }
            });
            resizeObserver.observe(scrollAreaRef);
        }

        // Expose scroll API and viewport info to parent. The measured
        // dimensions go across as data, not as a read-back of the signals
        // this same scope just wrote.
        props.onContainerReady?.({
            scrollTo,
            getScrollLeft: () => scrollLeft(),
            getScrollTop: () => scrollTop(),
            getContainerWidth: () => containerWidth(),
            getContainerHeight: () => viewportHeight(),
            containerWidth: measuredWidth,
            containerHeight: measuredHeight,
            scrollLeftSignal: scrollLeft,
            scrollTopSignal: scrollTop,
            containerWidthSignal: containerWidth,
            containerHeightSignal: viewportHeight,
        });

        return () => resizeObserver?.disconnect();
    });

    // CSS variables from config
    const cssVars = (): Record<string, string> => {
        const config = props.ganttConfig;
        if (!config) return {};

        return {
            '--gv-column-width': `${config.columnWidth?.() || DEFAULT_COLUMN_WIDTH}px`,
            '--gv-bar-height': `${config.barHeight?.() || DEFAULT_BAR_HEIGHT}px`,
            '--gv-header-height': `${config.headerHeight?.() || 60}px`,
            '--gv-padding': `${config.padding?.() || DEFAULT_PADDING}px`,
            '--gv-bar-corner-radius': `${config.barCornerRadius?.() || 3}px`,
        };
    };

    // Container height
    const containerHeight = (): string | number => {
        if (props.height) return props.height;
        return '100%';
    };

    return (
        <div
            class="gantt-container"
            role="region"
            aria-label="Gantt chart"
            aria-roledescription="gantt chart"
            style={{
                ...cssVars(),
                display: 'grid',
                'grid-template-columns': `${resourceColumnWidth()}px 1fr`,
                'grid-template-rows': `${headerHeight()}px 1fr`,
                height:
                    typeof containerHeight() === 'number'
                        ? `${containerHeight()}px`
                        : (containerHeight() as string),
                overflow: 'hidden',
                position: 'relative',
            }}
        >
            {/* Top-left: Resource Header (sticky corner) */}
            <div
                class="resource-header"
                style={{
                    'grid-row': '1',
                    'grid-column': '1',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    'background-color': 'var(--g-header-bg-color, #fff)',
                    'border-right':
                        '1px solid var(--g-grid-line-color, #e0e0e0)',
                    'border-bottom':
                        '1px solid var(--g-grid-line-color, #e0e0e0)',
                    'font-weight': '600',
                    'font-size': '12px',
                    color: 'var(--g-header-text-color, #333)',
                    'z-index': 20,
                }}
            >
                {props.resourceHeaderLabel ?? 'Resource'}
            </div>

            {/* Top-right: Date Headers */}
            <div
                ref={dateHeadersRef}
                class="date-headers-wrapper"
                style={{
                    'grid-row': '1',
                    'grid-column': '2',
                    overflow: 'hidden',
                    'background-color': 'var(--g-header-bg-color, #fff)',
                    'border-bottom':
                        '1px solid var(--g-grid-line-color, #e0e0e0)',
                    'z-index': 10,
                }}
            >
                {props.header}
            </div>

            {/* Bottom-left: Resource Body */}
            <div
                ref={resourceBodyRef}
                class="resource-body-wrapper"
                style={{
                    'grid-row': '2',
                    'grid-column': '1',
                    overflow: 'hidden',
                    'background-color': 'var(--g-resource-bg, #fff)',
                    'border-right':
                        '1px solid var(--g-grid-line-color, #e0e0e0)',
                    'z-index': 9,
                }}
            >
                {props.resourceColumn}
            </div>

            {/* Bottom-right: Main scroll area */}
            <div
                ref={scrollAreaRef}
                class="gantt-scroll-area"
                style={{
                    'grid-row': '2',
                    'grid-column': '2',
                    overflow: 'auto',
                }}
                onScroll={handleScroll}
            >
                {/* Content wrapper */}
                <div
                    class="gantt-content"
                    style={{
                        position: 'relative',
                        width: props.svgWidth ? `${props.svgWidth}px` : '100%',
                        height: `${props.svgHeight || 300}px`,
                        'min-width': props.svgWidth
                            ? `${props.svgWidth}px`
                            : undefined,
                    }}
                >
                    {/* SVG layer */}
                    <svg
                        class="gantt"
                        width="100%"
                        height="100%"
                        style={{
                            display: 'block',
                            position: 'absolute',
                            top: '0',
                            left: '0',
                        }}
                    >
                        {props.children}
                    </svg>

                    {/* HTML layer - Task bars */}
                    <div
                        class="gantt-bars-layer"
                        style={{
                            position: 'absolute',
                            top: '0',
                            left: '0',
                            width: '100%',
                            height: '100%',
                            'pointer-events': 'none',
                        }}
                    >
                        {props.barsLayer}
                    </div>
                </div>
            </div>

            {/* Overlay slot */}
            {props.overlay}
        </div>
    );
}

export default GanttContainer;
