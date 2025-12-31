import { createSignal, onMount, onCleanup, JSX, Accessor } from 'solid-js';
import type { GanttConfigStore } from '../stores/ganttConfigStore';

// Throttle interval for scroll signal updates
const SCROLL_THROTTLE_MS = 100;

/** Scroll timing debug info */
interface ScrollDebugInfo {
    domSync: number;
    signalUpdate: number;
    total: number;
    worstTotal: number;
    callCount: number;
}

// Extend Window interface for debug object
declare global {
    interface Window {
        __ganttScrollDebug: ScrollDebugInfo;
    }
}

// Global debug object for scroll timing
if (typeof window !== 'undefined') {
    window.__ganttScrollDebug = {
        domSync: 0,
        signalUpdate: 0,
        total: 0,
        worstTotal: 0,
        callCount: 0,
    };
}

interface ScrollTiming {
    domSync: number;
    signalUpdate: number;
    total: number;
    worstTotal: number;
}

interface ContainerAPI {
    scrollTo: (x: number, smooth?: boolean) => void;
    getScrollLeft: () => number;
    getScrollTop: () => number;
    getContainerWidth: () => number;
    getContainerHeight: () => number;
    getSvgElement: () => SVGSVGElement | undefined;
    scrollLeftSignal: Accessor<number>;
    scrollTopSignal: Accessor<number>;
    containerWidthSignal: Accessor<number>;
    containerHeightSignal: Accessor<number>;
    scrollTimingSignal: Accessor<ScrollTiming>;
    resetWorstTiming: () => void;
}

interface GanttContainerProps {
    ganttConfig?: GanttConfigStore;
    resourceColumnWidth?: number;
    headerHeight?: number;
    height?: string | number;
    svgWidth?: number;
    svgHeight?: number;
    resourceHeaderLabel?: string;
    header?: JSX.Element;
    resourceColumn?: JSX.Element;
    children?: JSX.Element;
    barsLayer?: JSX.Element;
    overlay?: JSX.Element;
    onScroll?: (scrollLeft: number, scrollTop: number) => void;
    onContainerReady?: (api: ContainerAPI) => void;
}

/**
 * GanttContainer - Main wrapper component with scroll handling.
 */
export function GanttContainer(props: GanttContainerProps): JSX.Element {
    let scrollAreaRef: HTMLDivElement | undefined;
    let svgRef: SVGSVGElement | undefined;
    let dateHeadersRef: HTMLDivElement | undefined;
    let resourceBodyRef: HTMLDivElement | undefined;

    const [scrollLeft, setScrollLeft] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [containerWidth, setContainerWidth] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);

    // Debug timing signals for performance monitoring
    const [scrollTiming, setScrollTiming] = createSignal<ScrollTiming>({
        domSync: 0,
        signalUpdate: 0,
        total: 0,
        worstTotal: 0,
    });

    // Resource column width
    const resourceColumnWidth = (): number => props.resourceColumnWidth || 60;

    // Header height
    const headerHeight = (): number => {
        if (props.headerHeight) return props.headerHeight;
        if (props.ganttConfig?.headerHeight) return props.ganttConfig.headerHeight();
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
            pendingUpdate = setTimeout(() => {
                pendingUpdate = null;
                lastUpdateTime = performance.now();
                setScrollLeft(latestScrollX);
                setScrollTop(latestScrollY);
            }, SCROLL_THROTTLE_MS - (now - lastUpdateTime));
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
    onMount(() => {
        if (scrollAreaRef) {
            setContainerWidth(scrollAreaRef.clientWidth);

            // Observe resize
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    setContainerWidth(entry.contentRect.width);
                    setViewportHeight(entry.contentRect.height);
                }
            });
            resizeObserver.observe(scrollAreaRef);

            onCleanup(() => resizeObserver.disconnect());
        }

        // Expose scroll API and viewport info to parent
        props.onContainerReady?.({
            scrollTo,
            getScrollLeft: () => scrollLeft(),
            getScrollTop: () => scrollTop(),
            getContainerWidth: () => containerWidth(),
            getContainerHeight: () => viewportHeight(),
            getSvgElement: () => svgRef,
            scrollLeftSignal: scrollLeft,
            scrollTopSignal: scrollTop,
            containerWidthSignal: containerWidth,
            containerHeightSignal: viewportHeight,
            scrollTimingSignal: scrollTiming,
            resetWorstTiming: () => {
                // No-op - timing tracking removed for chunk-based scrolling
            },
        });
    });

    // CSS variables from config
    const cssVars = (): Record<string, string> => {
        const config = props.ganttConfig;
        if (!config) return {};

        return {
            '--gv-column-width': `${config.columnWidth?.() || 45}px`,
            '--gv-bar-height': `${config.barHeight?.() || 30}px`,
            '--gv-header-height': `${config.headerHeight?.() || 60}px`,
            '--gv-padding': `${config.padding?.() || 18}px`,
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
            style={{
                ...cssVars(),
                display: 'grid',
                'grid-template-columns': `${resourceColumnWidth()}px 1fr`,
                'grid-template-rows': `${headerHeight()}px 1fr`,
                height: typeof containerHeight() === 'number' ? `${containerHeight()}px` : containerHeight() as string,
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
                    'border-right': '1px solid var(--g-grid-line-color, #e0e0e0)',
                    'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
                    'font-weight': '600',
                    'font-size': '12px',
                    color: 'var(--g-header-text-color, #333)',
                    'z-index': 20,
                }}
            >
                {props.resourceHeaderLabel || 'Resource'}
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
                    'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
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
                    'border-right': '1px solid var(--g-grid-line-color, #e0e0e0)',
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
                        'min-width': props.svgWidth ? `${props.svgWidth}px` : undefined,
                    }}
                >
                    {/* SVG layer */}
                    <svg
                        ref={svgRef}
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
