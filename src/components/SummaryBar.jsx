import { Show } from 'solid-js';
import { useDrag } from '../hooks/useDrag.js';
import { snapToGrid, computeLabelPosition } from '../utils/barCalculations.js';

/**
 * SummaryBar - Project-level summary bar that spans all its child tasks.
 *
 * Visual appearance: Same as regular Bar but without resize handles.
 * This is used for project rows that show a summary bar spanning all tasks.
 *
 * Note: Chevron toggle has been removed. Projects are always expanded.
 * Expand/collapse for regular tasks with subtasks will be via context menu.
 */
export function SummaryBar(props) {
    // Get task ID
    const taskId = () => props.taskId;

    // Get position directly from taskStore - plain function for virtualized components
    // Avoids memo subscription churn during scroll (similar to Arrow.jsx approach)
    const getPosition = () => {
        if (props.taskStore && taskId()) {
            const task = props.taskStore.tasks[taskId()];
            if (task?.$bar) {
                return task.$bar;
            }
        }
        return { x: 0, y: 0, width: 100, height: 30 };
    };

    // Task data
    const task = () => {
        if (props.taskStore && taskId()) {
            return props.taskStore.tasks[taskId()] ?? {};
        }
        return {};
    };

    // Position values - call getPosition() for fine-grained store tracking
    const x = () => getPosition()?.x ?? 0;
    // Use taskPosition Y if provided (for variable row heights), else fall back to $bar.y
    const y = () => props.taskPosition?.y ?? getPosition()?.y ?? 0;
    const width = () => getPosition()?.width ?? 100;
    const height = () => getPosition()?.height ?? 30;

    // Configuration
    const columnWidth = () => props.ganttConfig?.columnWidth?.() ?? 45;
    const readonly = () => props.ganttConfig?.readonly?.() ?? false;
    const cornerRadius = () => props.ganttConfig?.barCornerRadius?.() ?? 3;

    // Colors
    const barColor = () => task()?.color ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = () => task()?.color_progress ?? 'var(--g-bar-progress-color, #a3a3ff)';
    const progress = () => task()?.progress ?? 0;

    // Progress bar width
    const progressWidth = () => (width() * progress()) / 100;

    // Label position
    const labelPos = () => {
        const name = task()?.name ?? '';
        return computeLabelPosition(x(), width(), name, 7);
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
    const dragStateClass = () => {
        const state = dragState();
        if (state === 'idle') return '';
        return `dragging ${state}`;
    };

    // Handle mousedown on bar for drag
    const handleBarMouseDown = (e) => {
        if (readonly()) return;
        e.preventDefault();
        e.stopPropagation();
        startDrag(e, 'dragging_bar');
    };

    return (
        <g
            class={`summary-bar-wrapper bar-wrapper ${dragStateClass()}`}
            data-id={taskId()}
            data-type="summary"
        >
            {/* Main bar */}
            <g
                class="bar-group"
                onMouseDown={handleBarMouseDown}
                style={{ cursor: readonly() ? 'default' : 'grab' }}
            >
                {/* Background bar */}
                <rect
                    class="bar"
                    x={x()}
                    y={y()}
                    width={width()}
                    height={height()}
                    rx={cornerRadius()}
                    ry={cornerRadius()}
                    fill={isDragging() ? '#2c3e50' : barColor()}
                    stroke="var(--g-bar-stroke, #8a8aff)"
                    stroke-width="0"
                    style={{ transition: isDragging() ? 'none' : 'fill 0.1s ease' }}
                />

                {/* Progress bar */}
                <Show when={progress() > 0}>
                    <rect
                        class="bar-progress"
                        x={x()}
                        y={y()}
                        width={progressWidth()}
                        height={height()}
                        rx={cornerRadius()}
                        ry={cornerRadius()}
                        fill={progressColor()}
                        style={{ 'pointer-events': 'none' }}
                    />
                </Show>

                {/* Label inside bar */}
                <text
                    x={labelPos().position === 'inside' ? labelPos().x : labelPos().x}
                    y={y() + height() / 2 + 4}
                    text-anchor={labelPos().position === 'inside' ? 'middle' : 'start'}
                    font-size="12"
                    font-weight="500"
                    fill={labelPos().position === 'inside' ? '#fff' : '#333'}
                    style={{ 'pointer-events': 'none', 'user-select': 'none' }}
                >
                    {task()?.name ?? ''}
                </text>

                {/* Child count indicator (optional) */}
                <Show when={task()?._children?.length > 0}>
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
        </g>
    );
}

export default SummaryBar;
