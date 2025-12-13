import { createMemo, For, Show } from 'solid-js';

/**
 * Grid - Renders the SVG background, row rectangles, and vertical grid lines.
 * Uses SVG patterns for vertical lines (single element vs thousands of <line> elements).
 * Row positions are relative to SVG content (no header offset).
 */
export function Grid(props) {
    // Grid dimensions
    const gridWidth = () => props.width || 1000;
    const gridHeight = () => props.height || 300;

    // Column configuration (for vertical lines)
    const columnWidth = () => props.columnWidth || 45;
    const dateInfos = () => props.dateInfos || [];

    // Line display mode: 'both', 'vertical', 'horizontal', 'none'
    const lineMode = () => props.lines || 'both';
    const showVertical = () =>
        lineMode() === 'both' || lineMode() === 'vertical';

    // Colors
    const lineColor = () =>
        props.lineColor || 'var(--g-grid-line-color, #e0e0e0)';
    const thickLineColor = () =>
        props.thickLineColor || 'var(--g-grid-thick-line-color, #c0c0c0)';

    // Row configuration
    const rowHeight = () => {
        const barHeight = props.barHeight || 30;
        const padding = props.padding || 18;
        return barHeight + padding;
    };

    const taskCount = () => props.taskCount || 0;

    // Calculate rows - rows fill the full height from y=0
    const rows = createMemo(() => {
        const count = taskCount();
        const rh = rowHeight();

        const result = [];
        for (let i = 0; i < count; i++) {
            result.push({
                index: i,
                y: i * rh,
                height: rh,
            });
        }
        return result;
    });

    // Background color
    const bgColor = () =>
        props.backgroundColor || 'var(--g-grid-bg-color, #fff)';

    // Row colors (alternating or single)
    const rowColor = (index) => {
        if (props.alternateRows) {
            return index % 2 === 0
                ? 'var(--g-grid-row-even, #fff)'
                : 'var(--g-grid-row-odd, #f5f5f5)';
        }
        return 'var(--g-grid-row-color, #fff)';
    };

    // Generate unique pattern ID for this grid instance
    const patternId = () => `grid-pattern-${props.id || 'default'}`;

    // Build single path for thick lines only (month/week boundaries)
    // Much more efficient than individual <line> elements
    const thickLinesPath = createMemo(() => {
        const infos = dateInfos();
        const colWidth = columnWidth();
        const height = gridHeight();

        const commands = [];
        for (let i = 0; i < infos.length; i++) {
            if (infos[i].isThickLine) {
                const x = (i + 1) * colWidth - 0.5;
                commands.push(`M${x},0 V${height}`);
            }
        }
        return commands.join(' ');
    });

    return (
        <g class="grid">
            {/* SVG Pattern definition for vertical grid lines */}
            <defs>
                <pattern
                    id={patternId()}
                    width={columnWidth()}
                    height={10}
                    patternUnits="userSpaceOnUse"
                >
                    {/* Single vertical line at right edge of pattern cell */}
                    <line
                        x1={columnWidth() - 0.5}
                        y1={0}
                        x2={columnWidth() - 0.5}
                        y2={10}
                        stroke={lineColor()}
                        stroke-width="0.5"
                    />
                </pattern>
            </defs>

            {/* Background rect */}
            <rect
                x={0}
                y={0}
                width={gridWidth()}
                height={gridHeight()}
                fill={bgColor()}
                class="grid-background"
            />

            {/* Vertical grid lines via pattern (1 element instead of thousands) */}
            <Show when={showVertical()}>
                <rect
                    x={0}
                    y={0}
                    width={gridWidth()}
                    height={gridHeight()}
                    fill={`url(#${patternId()})`}
                    class="grid-vertical-lines"
                />
            </Show>

            {/* Thick lines for month/week boundaries (single path) */}
            <Show when={showVertical() && thickLinesPath()}>
                <path
                    d={thickLinesPath()}
                    stroke={thickLineColor()}
                    stroke-width="1"
                    fill="none"
                    class="grid-thick-lines"
                />
            </Show>

            {/* Row rects */}
            <For each={rows()}>
                {(row) => (
                    <rect
                        x={0}
                        y={row.y}
                        width={gridWidth()}
                        height={row.height}
                        fill={rowColor(row.index)}
                        stroke="var(--g-grid-line-color, #e0e0e0)"
                        stroke-width="0.5"
                        class="grid-row"
                        data-row-index={row.index}
                    />
                )}
            </For>
        </g>
    );
}

export default Grid;
