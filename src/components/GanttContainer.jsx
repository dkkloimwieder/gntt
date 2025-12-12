import { createSignal, onMount, onCleanup } from 'solid-js';

/**
 * GanttContainer - Main wrapper component with scroll handling.
 * Uses CSS Grid for proper 4-quadrant layout:
 * - Top-left: Resource header (sticky corner)
 * - Top-right: Date headers (sticky top, scrolls horizontally with content)
 * - Bottom-left: Resource body (sticky left, scrolls vertically with content)
 * - Bottom-right: SVG content (scrolls both ways)
 */
export function GanttContainer(props) {
    let scrollAreaRef;
    let svgRef;
    let dateHeadersRef;
    let resourceBodyRef;

    const [scrollLeft, setScrollLeft] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [containerWidth, setContainerWidth] = createSignal(0);

    // Resource column width
    const resourceColumnWidth = () => props.resourceColumnWidth || 60;

    // Header height
    const headerHeight = () => {
        if (props.headerHeight) return props.headerHeight;
        if (props.ganttConfig?.headerHeight) return props.ganttConfig.headerHeight();
        return 60;
    };

    // Handle scroll in main scroll area - sync other panels
    const handleScroll = (e) => {
        const { scrollLeft: sl, scrollTop: st } = e.target;
        setScrollLeft(sl);
        setScrollTop(st);

        // Sync date headers horizontal scroll
        if (dateHeadersRef) {
            dateHeadersRef.scrollLeft = sl;
        }

        // Sync resource body vertical scroll
        if (resourceBodyRef) {
            resourceBodyRef.scrollTop = st;
        }

        props.onScroll?.(sl, st);
    };

    // Set scroll position programmatically
    const scrollTo = (x, smooth = true) => {
        if (scrollAreaRef) {
            scrollAreaRef.scrollTo({
                left: x,
                behavior: smooth ? 'smooth' : 'auto',
            });
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
                }
            });
            resizeObserver.observe(scrollAreaRef);

            onCleanup(() => resizeObserver.disconnect());
        }

        // Expose scroll API to parent
        props.onContainerReady?.({
            scrollTo,
            getScrollLeft: () => scrollLeft(),
            getScrollTop: () => scrollTop(),
            getContainerWidth: () => containerWidth(),
            getSvgElement: () => svgRef,
        });
    });

    // CSS variables from config
    const cssVars = () => {
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
    const containerHeight = () => {
        if (props.height) return props.height;
        if (props.ganttConfig?.containerHeight) {
            const h = props.ganttConfig.containerHeight();
            if (h !== 'auto') return h;
        }
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
                height: containerHeight(),
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

            {/* Top-right: Date Headers (scrolls horizontally with content) */}
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

            {/* Bottom-left: Resource Body (scrolls vertically with content) */}
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

            {/* Bottom-right: Main SVG scroll area */}
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
                <svg
                    ref={svgRef}
                    class="gantt"
                    width={props.svgWidth || '100%'}
                    height={props.svgHeight || 300}
                    style={{
                        display: 'block',
                        'min-width': props.svgWidth
                            ? `${props.svgWidth}px`
                            : undefined,
                    }}
                >
                    {props.children}
                </svg>
            </div>

            {/* Overlay slot - for popups, modals, etc. */}
            {props.overlay}
        </div>
    );
}

export default GanttContainer;
