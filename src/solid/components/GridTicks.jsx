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
    const showVertical = () => lineMode() === 'both' || lineMode() === 'vertical';
    const showHorizontal = () => lineMode() === 'both' || lineMode() === 'horizontal';

    // Colors
    const lineColor = () => props.lineColor || 'var(--g-grid-line-color, #e0e0e0)';
    const thickLineColor = () => props.thickLineColor || 'var(--g-grid-thick-line-color, #c0c0c0)';

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

    // Generate horizontal lines (between rows)
    const horizontalLines = createMemo(() => {
        const count = taskCount();
        const hh = headerHeight();
        const rh = barHeight() + padding();
        const pad = padding();
        const width = gridWidth();

        const lines = [];

        // Line at bottom of header
        lines.push({
            y: hh,
            x1: 0,
            x2: width,
        });

        // Lines between rows
        for (let i = 0; i <= count; i++) {
            lines.push({
                y: hh + pad + i * rh,
                x1: 0,
                x2: width,
            });
        }

        return lines;
    });

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
                                style={tick.isThick ? thickLineStyle() : normalLineStyle()}
                                class={tick.isThick ? 'tick thick' : 'tick'}
                            />
                        )}
                    </For>
                </g>
            </Show>

            {/* Horizontal lines */}
            <Show when={showHorizontal()}>
                <g class="horizontal-lines">
                    <For each={horizontalLines()}>
                        {(line) => (
                            <line
                                x1={line.x1}
                                y1={line.y}
                                x2={line.x2}
                                y2={line.y}
                                style={normalLineStyle()}
                                class="row-line"
                            />
                        )}
                    </For>
                </g>
            </Show>
        </g>
    );
}

export default GridTicks;
