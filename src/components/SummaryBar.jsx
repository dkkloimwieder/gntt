import { createMemo, Show } from 'solid-js';
import { useDrag } from '../hooks/useDrag.js';
import { snapToGrid } from '../utils/barCalculations.js';

/**
 * SummaryBar - Parent task bar with bracket/chevron styling.
 *
 * Visual appearance:
 *   [==============================]
 *   (bracket ends, thin bar connecting them)
 *
 * Features:
 * - Distinct bracket end caps
 * - Collapse chevron (click to toggle subtask visibility)
 * - Drag support (moves all descendant tasks together)
 * - Spans from earliest child start to latest child end
 */
export function SummaryBar(props) {
    // Get task ID
    const taskId = () => props.taskId;

    // Get position from taskStore
    const getPosition = () => {
        if (props.taskStore && taskId()) {
            const tasksMap = props.taskStore.tasks();
            const task = tasksMap.get(taskId());
            if (task?.$bar) {
                return task.$bar;
            }
        }
        return { x: 0, y: 0, width: 100, height: 30 };
    };

    // Task data
    const task = () => {
        if (props.taskStore && taskId()) {
            const tasksMap = props.taskStore.tasks();
            return tasksMap.get(taskId()) ?? {};
        }
        return {};
    };

    // Position values
    const x = () => getPosition()?.x ?? 0;
    const y = () => getPosition()?.y ?? 0;
    const width = () => getPosition()?.width ?? 100;
    const height = () => getPosition()?.height ?? 30;

    // Configuration
    const columnWidth = () => props.ganttConfig?.columnWidth?.() ?? 45;
    const readonly = () => props.ganttConfig?.readonly?.() ?? false;

    // Collapse state
    const isCollapsed = () => props.taskStore?.isTaskCollapsed(taskId()) ?? false;

    // Visual dimensions
    const barHeight = () => height() * 0.4; // Thinner than regular bars
    const barY = () => y() + (height() - barHeight()) / 2;
    const bracketHeight = () => height() * 0.6;
    const bracketWidth = () => 8;

    // Colors
    const barColor = () => task()?.color ?? '#2c3e50';
    const hoverColor = () => '#34495e';

    // Chevron icon dimensions
    const chevronX = () => x() - 18;
    const chevronY = () => y() + height() / 2;

    // Click handler for collapse toggle
    const handleChevronClick = (e) => {
        e.stopPropagation();
        props.taskStore?.toggleTaskCollapse(taskId());
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // DRAG SETUP (moves all descendants)
    // ═══════════════════════════════════════════════════════════════════════════

    const { dragState, isDragging, startDrag } = useDrag({
        onDragStart: (data, state) => {
            data.originalX = x();
            data.originalY = y();

            // Collect all descendants for batch drag
            if (state === 'dragging_bar' && props.onCollectDescendants) {
                const descendantIds = props.onCollectDescendants(taskId());
                // Include self in batch
                descendantIds.add(taskId());

                data.batchOriginals = new Map();
                for (const id of descendantIds) {
                    const pos = props.taskStore?.getBarPosition(id);
                    if (pos) {
                        data.batchOriginals.set(id, { originalX: pos.x });
                    }
                }
            }
        },

        onDragMove: (move, data, state) => {
            if (!props.taskStore || !taskId() || state !== 'dragging_bar') {
                return;
            }

            const colWidth = columnWidth();
            let newX = snapToGrid(data.originalX + move.deltaX, colWidth, []);
            let deltaX = newX - data.originalX;

            // Batch move all descendants
            if (data.batchOriginals?.size > 0 && props.taskStore.batchMovePositions) {
                // Clamp delta if provided
                if (props.onClampBatchDelta && deltaX < 0) {
                    deltaX = props.onClampBatchDelta(data.batchOriginals, deltaX);
                }
                props.taskStore.batchMovePositions(data.batchOriginals, deltaX);
            }
        },

        onDragEnd: (data, state) => {
            if (state === 'dragging_bar') {
                props.onDragEnd?.(taskId());
            }
        },
    });

    // Drag state class
    const dragStateClass = createMemo(() => {
        const state = dragState();
        if (state === 'idle') return '';
        return `dragging ${state}`;
    });

    // Handle mousedown on bar for drag
    const handleBarMouseDown = (e) => {
        if (readonly()) return;
        e.preventDefault();
        e.stopPropagation();
        startDrag(e, 'dragging_bar');
    };

    // Chevron path based on collapse state
    const chevronPath = createMemo(() => {
        const cx = chevronX();
        const cy = chevronY();
        if (isCollapsed()) {
            // Right-pointing chevron (collapsed)
            return `M ${cx - 3} ${cy - 5} L ${cx + 3} ${cy} L ${cx - 3} ${cy + 5}`;
        } else {
            // Down-pointing chevron (expanded)
            return `M ${cx - 5} ${cy - 3} L ${cx} ${cy + 3} L ${cx + 5} ${cy - 3}`;
        }
    });

    // Label position (below the bar for summary tasks)
    const labelX = () => x() + width() / 2;
    const labelY = () => y() + height() - 2;

    return (
        <g
            class={`summary-bar-wrapper ${dragStateClass()} ${isCollapsed() ? 'collapsed' : 'expanded'}`}
            data-id={taskId()}
            data-type="summary"
        >
            {/* Collapse chevron (clickable) */}
            <g
                class="collapse-toggle"
                onClick={handleChevronClick}
                style={{ cursor: 'pointer' }}
            >
                {/* Hit area for chevron */}
                <rect
                    x={chevronX() - 8}
                    y={chevronY() - 8}
                    width={16}
                    height={16}
                    fill="transparent"
                />
                {/* Chevron icon */}
                <path
                    d={chevronPath()}
                    fill="none"
                    stroke="#666"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    style={{
                        transition: 'transform 0.15s ease',
                    }}
                />
            </g>

            {/* Draggable bar area */}
            <g
                class="summary-bar-draggable"
                onMouseDown={handleBarMouseDown}
                style={{ cursor: readonly() ? 'default' : 'grab' }}
            >
                {/* Left bracket */}
                <path
                    d={`M ${x()} ${barY() + bracketHeight()}
                        L ${x()} ${barY()}
                        L ${x() + bracketWidth()} ${barY()}`}
                    fill="none"
                    stroke={isDragging() ? hoverColor() : barColor()}
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />

                {/* Main bar line (connecting the brackets) */}
                <rect
                    x={x() + bracketWidth()}
                    y={barY() + barHeight() / 2 - 2}
                    width={Math.max(0, width() - bracketWidth() * 2)}
                    height={4}
                    fill={isDragging() ? hoverColor() : barColor()}
                    rx="2"
                />

                {/* Right bracket */}
                <path
                    d={`M ${x() + width() - bracketWidth()} ${barY()}
                        L ${x() + width()} ${barY()}
                        L ${x() + width()} ${barY() + bracketHeight()}`}
                    fill="none"
                    stroke={isDragging() ? hoverColor() : barColor()}
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />

                {/* Progress indicator (if applicable) */}
                <Show when={task()?.progress > 0}>
                    <rect
                        x={x() + bracketWidth()}
                        y={barY() + barHeight() / 2 - 1}
                        width={Math.max(0, (width() - bracketWidth() * 2) * (task()?.progress ?? 0) / 100)}
                        height={2}
                        fill={task()?.color_progress ?? '#a3a3ff'}
                        rx="1"
                    />
                </Show>

                {/* Invisible hit area for easier dragging */}
                <rect
                    x={x()}
                    y={y()}
                    width={width()}
                    height={height()}
                    fill="transparent"
                />
            </g>

            {/* Label (task name) */}
            <text
                x={labelX()}
                y={labelY()}
                text-anchor="middle"
                font-size="11"
                font-weight="600"
                fill="#333"
                style={{ 'pointer-events': 'none', 'user-select': 'none' }}
            >
                {task()?.name ?? ''}
            </text>

            {/* Children count indicator when collapsed */}
            <Show when={isCollapsed() && task()?._children?.length > 0}>
                <text
                    x={x() + width() + 8}
                    y={y() + height() / 2 + 4}
                    font-size="10"
                    fill="#888"
                    style={{ 'pointer-events': 'none' }}
                >
                    ({task()._children.length})
                </text>
            </Show>
        </g>
    );
}

export default SummaryBar;
