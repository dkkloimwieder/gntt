import { For } from 'solid-js';

/**
 * ResourceColumn - Renders the resource labels for swimlane rows.
 * No longer includes header - that's now handled by GanttContainer.
 * Cell positions start at y=0 (or padding/2) to align with SVG content.
 */
export function ResourceColumn(props) {
    // Get unique resources list
    const resources = () => props.resources || [];

    // Configuration from ganttConfig
    const barHeight = () => props.ganttConfig?.barHeight?.() ?? 30;
    const padding = () => props.ganttConfig?.padding?.() ?? 18;
    const columnWidth = () => props.width ?? 60;

    // Row height (bar + padding)
    const rowHeight = () => barHeight() + padding();

    // Calculate total height for the resource body
    // Rows start at y=0, so total height = count * rowHeight
    const totalHeight = () => {
        const count = resources().length;
        const rh = rowHeight();
        return count * rh;
    };

    // Container style
    const containerStyle = () => ({
        position: 'relative',
        width: `${columnWidth()}px`,
        height: `${totalHeight()}px`,
    });

    // Cell style - positioned to align with SVG task bars (centered in row)
    // Formula matches computeY: index * rowHeight + padding/2
    const cellStyle = (index) => {
        const bh = barHeight();
        const pad = padding();
        const rowHeight = bh + pad;
        const cellTop = index * rowHeight + pad / 2;
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
    );
}

export default ResourceColumn;
