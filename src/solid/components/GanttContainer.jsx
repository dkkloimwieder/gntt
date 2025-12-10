import { createSignal, onMount, onCleanup } from 'solid-js';

/**
 * GanttContainer - Main wrapper component with scroll handling.
 * Provides the container structure and scroll management for the Gantt chart.
 */
export function GanttContainer(props) {
    let containerRef;
    let svgRef;

    const [scrollLeft, setScrollLeft] = createSignal(0);
    const [containerWidth, setContainerWidth] = createSignal(0);

    // Handle scroll events
    const handleScroll = (e) => {
        setScrollLeft(e.target.scrollLeft);
        props.onScroll?.(e.target.scrollLeft, e.target.scrollTop);
    };

    // Set initial scroll position
    const scrollTo = (x, smooth = true) => {
        if (containerRef) {
            containerRef.scrollTo({
                left: x,
                behavior: smooth ? 'smooth' : 'auto',
            });
        }
    };

    // Expose scroll methods via ref callback
    onMount(() => {
        if (containerRef) {
            setContainerWidth(containerRef.clientWidth);

            // Observe resize
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    setContainerWidth(entry.contentRect.width);
                }
            });
            resizeObserver.observe(containerRef);

            onCleanup(() => resizeObserver.disconnect());
        }

        // Expose scroll method to parent
        props.onContainerReady?.({
            scrollTo,
            getScrollLeft: () => scrollLeft(),
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
            '--gv-header-height': `${config.headerHeight?.() || 75}px`,
            '--gv-padding': `${config.padding?.() || 18}px`,
            '--gv-bar-corner-radius': `${config.barCornerRadius?.() || 3}px`,
        };
    };

    // Calculate container height
    const containerHeight = () => {
        if (props.height) return props.height;
        if (props.ganttConfig?.containerHeight) {
            const h = props.ganttConfig.containerHeight();
            if (h !== 'auto') return h;
        }
        return '100%'; // Fill parent by default
    };

    return (
        <div
            ref={containerRef}
            class="gantt-container"
            style={{
                ...cssVars(),
                height: containerHeight(),
                overflow: 'auto',
                position: 'relative',
            }}
            onScroll={handleScroll}
        >
            {/* Content wrapper with flex layout for resource column */}
            <div
                class="gantt-content"
                style={{
                    display: 'flex',
                    'min-width': 'fit-content',
                }}
            >
                {/* Resource column slot - sticky left */}
                {props.resourceColumn}

                {/* Main Gantt area */}
                <div class="gantt-main" style={{ flex: 1 }}>
                    {/* Header slot - rendered outside SVG for sticky positioning */}
                    {props.header}

                    {/* Main SVG canvas */}
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
            </div>

            {/* Overlay slot - for popups, modals, etc. */}
            {props.overlay}
        </div>
    );
}

export default GanttContainer;
