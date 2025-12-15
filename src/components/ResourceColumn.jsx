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

    // Row height (bar + padding) - base height for fixed mode
    const baseRowHeight = () => barHeight() + padding();

    // Row layouts for variable heights (optional)
    const rowLayouts = () => props.rowLayouts || null;

    // Calculate total height for the resource body
    // Uses variable heights if available, otherwise fixed
    const totalHeight = () => {
        const layouts = rowLayouts();
        if (layouts) {
            const total = layouts.get('__total__');
            if (total) return total.height;
        }
        const count = displayResources().length;
        return count * baseRowHeight();
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

    // Cell style - positioned to align with SVG task bars
    // Supports variable row heights when rowLayouts is provided
    const cellStyle = (item) => {
        const bh = barHeight();
        const pad = padding();
        const layouts = rowLayouts();
        const isGroup = item.type === 'group';
        const isProject = item.type === 'project';

        // Get position from layout or calculate from index
        // Use full row height/position so background spans entire row
        let cellTop, cellHeight;
        const layout = layouts?.get(item.id);
        if (layout) {
            cellTop = layout.y;
            cellHeight = layout.height;
        } else {
            const rh = bh + pad;
            cellTop = item.displayIndex * rh;
            cellHeight = rh;
        }

        return {
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${cellTop}px`,
            height: `${cellHeight}px`,
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
            'padding-left': isGroup || isProject ? '4px' : '12px',
            'font-size': isGroup || isProject ? '11px' : '12px',
            'font-weight': isGroup || isProject ? 'bold' : 'normal',
            color: isGroup || isProject
                ? 'var(--g-group-text-color, #1f2937)'
                : 'var(--g-text-color, #333)',
            'background-color': isGroup || isProject
                ? 'var(--g-group-bg-color, #e5e7eb)'
                : 'transparent',
            cursor: isGroup ? 'pointer' : 'default',
            'user-select': 'none',
            'border-radius': isGroup || isProject ? '2px' : '0',
        };
    };

    // Color swatch style for projects
    const colorSwatchStyle = (color) => ({
        width: '12px',
        height: '12px',
        'border-radius': '2px',
        'background-color': color || '#888',
        'flex-shrink': 0,
    });

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
                        class={`resource-cell ${item.type === 'group' ? 'resource-group' : ''} ${item.type === 'project' ? 'resource-project' : ''}`}
                        style={cellStyle(item)}
                        data-resource={item.id}
                        data-type={item.type}
                        onClick={
                            item.type === 'group'
                                ? (e) => handleGroupClick(item.id, e)
                                : undefined
                        }
                    >
                        {/* Chevron for collapsible groups */}
                        <Show when={item.type === 'group'}>
                            <ChevronIcon collapsed={item.isCollapsed} />
                        </Show>

                        {/* Color swatch for projects */}
                        <Show when={item.type === 'project' && item.color}>
                            <span
                                class="color-swatch"
                                style={colorSwatchStyle(item.color)}
                            />
                        </Show>

                        {/* Resource/project name */}
                        <span class="resource-name">{item.name || item.id}</span>
                    </div>
                )}
            </For>
        </div>
    );
}

export default ResourceColumn;
