import { createMemo, For, Show } from 'solid-js';

/**
 * GridTicks - Renders vertical and horizontal grid lines.
 * Provides visual column/row separation.
 */
export function GridTicks(props) {
    // Configuration
    const gridWidth = () => props.width || 1000;
    const gridHeight = () => props.height || 300;
    const headerHeight = () => props.headerHeight || 75;
    const columnWidth = () => props.columnWidth || 45;
    const taskCount = () => props.taskCount || 0;
    const barHeight = () => props.barHeight || 30;
    const padding = () => props.padding || 18;

    // Line display mode: 'both', 'vertical', 'horizontal', 'none'
    const lineMode = () => props.lines || 'both';
    const showVertical = () =>
        lineMode() === 'both' || lineMode() === 'vertical';
    const showHorizontal = () =>
        lineMode() === 'both' || lineMode() === 'horizontal';

    // Colors
    const lineColor = () =>
        props.lineColor || 'var(--g-grid-line-color, #e0e0e0)';
    const thickLineColor = () =>
        props.thickLineColor || 'var(--g-grid-thick-line-color, #c0c0c0)';

    // Date infos for determining thick lines
    const dateInfos = () => props.dateInfos || [];

    // Generate vertical ticks
    const verticalTicks = createMemo(() => {
        const infos = dateInfos();
        const colWidth = columnWidth();
        const height = gridHeight();

        return infos.map((info, index) => ({
            x: index * colWidth,
            y1: 0,
            y2: height,
            isThick: info.isThickLine,
        }));
    });

    // Horizontal lines removed - rows in Grid.jsx now have stroke borders

    // Line styles
    const normalLineStyle = () => ({
        stroke: lineColor(),
        'stroke-width': 0.5,
    });

    const thickLineStyle = () => ({
        stroke: thickLineColor(),
        'stroke-width': 1,
    });

    return (
        <g class="grid-ticks">
            {/* Vertical ticks */}
            <Show when={showVertical()}>
                <g class="vertical-ticks">
                    <For each={verticalTicks()}>
                        {(tick) => (
                            <line
                                x1={tick.x}
                                y1={tick.y1}
                                x2={tick.x}
                                y2={tick.y2}
                                style={
                                    tick.isThick
                                        ? thickLineStyle()
                                        : normalLineStyle()
                                }
                                class={tick.isThick ? 'tick thick' : 'tick'}
                            />
                        )}
                    </For>
                </g>
            </Show>
        </g>
    );
}

export default GridTicks;
