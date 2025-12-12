import { createMemo, For } from 'solid-js';

/**
 * Grid - Renders the SVG background and row rectangles.
 * Provides visual structure for the Gantt chart.
 * Row positions are relative to SVG content (no header offset).
 */
export function Grid(props) {
    // Grid dimensions
    const gridWidth = () => props.width || 1000;
    const gridHeight = () => props.height || 300;

    // Row configuration
    const rowHeight = () => {
        const barHeight = props.barHeight || 30;
        const padding = props.padding || 18;
        return barHeight + padding;
    };

    const taskCount = () => props.taskCount || 0;

    // Calculate rows - rows fill the full height from y=0
    // Each row has height = barHeight + padding
    // Task bars are centered within rows (at padding + index * rowHeight)
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

    return (
        <g class="grid">
            {/* Background rect */}
            <rect
                x={0}
                y={0}
                width={gridWidth()}
                height={gridHeight()}
                fill={bgColor()}
                class="grid-background"
            />

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
