import { createMemo, For } from 'solid-js';

/**
 * Grid - Renders the SVG background and row rectangles.
 * Provides visual structure for the Gantt chart.
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

    const headerHeight = () => props.headerHeight || 75;
    const taskCount = () => props.taskCount || 0;

    // Calculate rows
    const rows = createMemo(() => {
        const count = taskCount();
        const rh = rowHeight();
        const hh = headerHeight();
        const pad = props.padding || 18;

        const result = [];
        for (let i = 0; i < count; i++) {
            result.push({
                index: i,
                y: hh + pad + i * rh,
                height: rh,
            });
        }
        return result;
    });

    // Background color
    const bgColor = () => props.backgroundColor || 'var(--g-grid-bg-color, #fff)';

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
                        class="grid-row"
                        data-row-index={row.index}
                    />
                )}
            </For>
        </g>
    );
}

export default Grid;
