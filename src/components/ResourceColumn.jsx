import { For, createMemo } from 'solid-js';

/**
 * ResourceColumn - Renders the resource labels for swimlane rows.
 * No longer includes header - that's now handled by GanttContainer.
 * Cell positions start at y=0 (or padding/2) to align with SVG content.
 * Supports row virtualization via startRow/endRow props.
 */
export function ResourceColumn(props) {
    // Get unique resources list
    const resources = () => props.resources || [];

    // Viewport row range for virtualization
    const startRow = () => props.startRow ?? 0;
    const endRow = () => props.endRow ?? resources().length;

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

    // Virtualized resources - only render visible rows
    const visibleResources = createMemo(() => {
        const all = resources();
        const start = Math.max(0, startRow());
        const end = Math.min(all.length, endRow());

        // Return array of { resource, originalIndex } to preserve positioning
        const visible = [];
        for (let i = start; i < end; i++) {
            visible.push({ resource: all[i], index: i });
        }
        return visible;
    });

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
            <For each={visibleResources()}>
                {(item) => (
                    <div
                        class="resource-cell"
                        style={cellStyle(item.index)}
                        data-resource={item.resource}
                    >
                        {item.resource}
                    </div>
                )}
            </For>
        </div>
    );
}

export default ResourceColumn;
