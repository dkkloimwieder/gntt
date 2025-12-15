import { For, Show, createMemo } from 'solid-js';

/**
 * ResourceColumn - Renders the resource labels for swimlane rows.
 * Supports resource groups with collapse/expand functionality.
 * Cell positions start at y=0 (or padding/2) to align with SVG content.
 * Supports row virtualization via startRow/endRow props.
 */
export function ResourceColumn(props) {
    // Get display resources from resourceStore (respects collapse state)
    const displayResources = () => props.resourceStore?.displayResources() || [];

    // Viewport row range for virtualization
    const startRow = () => props.startRow ?? 0;
    const endRow = () => props.endRow ?? displayResources().length;

    // Configuration from ganttConfig
    const barHeight = () => props.ganttConfig?.barHeight?.() ?? 30;
    const padding = () => props.ganttConfig?.padding?.() ?? 18;
    const columnWidth = () => props.width ?? 60;

    // Row height (bar + padding)
    const rowHeight = () => barHeight() + padding();

    // Calculate total height for the resource body
    const totalHeight = () => {
        const count = displayResources().length;
        const rh = rowHeight();
        return count * rh;
    };

    // Virtualized resources - only render visible rows
    const visibleResources = createMemo(() => {
        const all = displayResources();
        const start = Math.max(0, startRow());
        const end = Math.min(all.length, endRow());

        // Return array of display resources with their indices
        const visible = [];
        for (let i = start; i < end; i++) {
            visible.push(all[i]);
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
    const cellStyle = (item) => {
        const bh = barHeight();
        const pad = padding();
        const rh = bh + pad;
        const cellTop = item.displayIndex * rh + pad / 2;
        const isGroup = item.type === 'group';

        return {
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${cellTop}px`,
            height: `${bh}px`,
            display: 'flex',
            'align-items': 'center',
            'padding-left': isGroup ? '4px' : '12px',
            'font-size': isGroup ? '11px' : '12px',
            'font-weight': isGroup ? 'bold' : 'normal',
            color: isGroup
                ? 'var(--g-group-text-color, #1f2937)'
                : 'var(--g-text-color, #333)',
            'background-color': isGroup
                ? 'var(--g-group-bg-color, #e5e7eb)'
                : 'transparent',
            cursor: isGroup ? 'pointer' : 'default',
            'user-select': 'none',
            'border-radius': isGroup ? '2px' : '0',
        };
    };

    // Toggle group collapse
    const handleGroupClick = (groupId, e) => {
        e.stopPropagation();
        props.resourceStore?.toggleGroup(groupId);
    };

    // Chevron icon for groups
    const ChevronIcon = (props) => {
        const isCollapsed = () => props.collapsed;
        return (
            <span
                style={{
                    display: 'inline-block',
                    width: '12px',
                    'margin-right': '4px',
                    'font-size': '10px',
                    transition: 'transform 0.15s ease',
                    transform: isCollapsed() ? 'rotate(-90deg)' : 'rotate(0deg)',
                }}
            >
                ▼
            </span>
        );
    };

    return (
        <div class="resource-column" style={containerStyle()}>
            <For each={visibleResources()}>
                {(item) => (
                    <div
                        class={`resource-cell ${item.type === 'group' ? 'resource-group' : ''}`}
                        style={cellStyle(item)}
                        data-resource={item.id}
                        data-type={item.type}
                        onClick={
                            item.type === 'group'
                                ? (e) => handleGroupClick(item.id, e)
                                : undefined
                        }
                    >
                        <Show when={item.type === 'group'}>
                            <ChevronIcon collapsed={item.isCollapsed} />
                        </Show>
                        {item.id}
                    </div>
                )}
            </For>
        </div>
    );
}

export default ResourceColumn;
