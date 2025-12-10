import { For } from 'solid-js';

/**
 * ResourceColumn - Renders a sticky left column showing unique resources (swimlanes).
 * Positioned with CSS sticky to stay fixed during horizontal scroll.
 */
export function ResourceColumn(props) {
    // Get unique resources list
    const resources = () => props.resources || [];

    // Configuration from ganttConfig
    const headerHeight = () => props.ganttConfig?.headerHeight?.() ?? 75;
    const barHeight = () => props.ganttConfig?.barHeight?.() ?? 30;
    const padding = () => props.ganttConfig?.padding?.() ?? 18;
    const columnWidth = () => props.width ?? 60;

    // Calculate total height to match SVG (same formula as Gantt.jsx gridHeight)
    const totalHeight = () => {
        const count = resources().length;
        const hh = headerHeight();
        const pad = padding();
        const rowHeight = barHeight() + pad;
        return hh + pad / 2 + count * rowHeight + pad / 2;
    };

    // Styles
    const containerStyle = () => ({
        position: 'sticky',
        left: 0,
        'z-index': 9,
        width: `${columnWidth()}px`,
        'min-width': `${columnWidth()}px`,
        height: `${totalHeight()}px`,
        'background-color': 'var(--g-resource-bg, #fff)',
        'border-right': '1px solid var(--g-grid-line-color, #e0e0e0)',
        'flex-shrink': 0,
    });

    const headerStyle = () => ({
        position: 'sticky',
        top: 0,
        height: `${headerHeight()}px`,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'font-weight': 600,
        'font-size': '12px',
        'background-color': 'var(--g-header-bg-color, #fff)',
        'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
        'z-index': 11,
        color: 'var(--g-header-text-color, #333)',
    });

    const rowsContainerStyle = () => ({
        position: 'relative',
    });

    const cellStyle = (index) => {
        // Cell top must match SVG row Y: headerHeight + padding/2 + index * (barHeight + padding)
        const hh = headerHeight();
        const bh = barHeight();
        const pad = padding();
        const cellTop = hh + pad / 2 + index * (bh + pad);
        return {
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${cellTop}px`,
            height: `${bh}px`,
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'font-size': '12px',
            color: 'var(--g-text-color, #333)',
        };
    };

    return (
        <div class="resource-column" style={containerStyle()}>
            {/* Resource labels - positioned absolutely from top to match SVG coordinates */}
            <div class="resource-rows" style={rowsContainerStyle()}>
                <For each={resources()}>
                    {(resource, index) => (
                        <div
                            class="resource-cell"
                            style={cellStyle(index())}
                            data-resource={resource}
                        >
                            {resource}
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
}

export default ResourceColumn;
