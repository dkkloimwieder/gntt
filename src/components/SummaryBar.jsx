import { createMemo, untrack } from 'solid-js';
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
    // Get task ID - can be a value OR an accessor function (for <Index> pooling)
    const taskId = () => {
        const id = props.taskId;
        return typeof id === 'function' ? id() : id;
    };

    // Get position directly from taskStore - plain function for virtualized components
    const getPosition = () => {
        const id = taskId();
        if (props.taskStore && id) {
            const task = props.taskStore.tasks[id];
            if (task?.$bar) {
                return task.$bar;
            }
        }
        return { x: 0, y: 0, width: 100, height: 30 };
    };

    // Task data
    const task = () => {
        const id = taskId();
        if (props.taskStore && id) {
            return props.taskStore.tasks[id] ?? {};
        }
        return {};
    };

    // OPTIMIZATION: Single memoized position read instead of 4 separate store reads
    const position = createMemo(() => getPosition());
    const x = () => position()?.x ?? 0;
    // Use taskPosition Y if provided (for variable row heights), else fall back to $bar.y
    // taskPosition can be a value OR accessor (for <Index> pooling reactivity)
    const y = () => {
        const pos = typeof props.taskPosition === 'function' ? props.taskPosition() : props.taskPosition;
        return pos?.y ?? position()?.y ?? 0;
    };
    const width = () => position()?.width ?? 100;
    const height = () => position()?.height ?? 30;

    // Configuration - OPTIMIZED: memoize config accessors
    const columnWidth = createMemo(() => props.ganttConfig?.columnWidth?.() ?? 45);
    const readonly = createMemo(() => props.ganttConfig?.readonly?.() ?? false);
    const cornerRadius = createMemo(() => props.ganttConfig?.barCornerRadius?.() ?? 3);

    // Colors
    const barColor = () => task()?.color ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = () => task()?.color_progress ?? 'var(--g-bar-progress-color, #a3a3ff)';
    const progress = () => task()?.progress ?? 0;

    // Progress bar width
    const progressWidth = () => (width() * progress()) / 100;

    // Label position - OPTIMIZED: memoized
    const labelPos = createMemo(() => {
        const name = task()?.name ?? '';
        return computeLabelPosition(x(), width(), name, 7);
    });

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

    // GPU-accelerated transform for positioning
    const barTransform = () => `translate(${x()}px, ${y()}px)`;

    return (
        <div
            class={`summary-bar-wrapper bar-wrapper ${dragStateClass()}`}
            data-id={taskId()}
            data-type="summary"
            onMouseDown={handleBarMouseDown}
            style={{
                position: 'absolute',
                transform: barTransform(),
                width: `${width()}px`,
                height: `${height()}px`,
                cursor: readonly() ? 'default' : 'grab',
                'will-change': 'transform',
                'pointer-events': 'auto',
            }}
        >
            {/* Background bar */}
            <div
                class="bar"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    'border-radius': `${cornerRadius()}px`,
                    'background-color': isDragging() ? '#2c3e50' : barColor(),
                    'box-sizing': 'border-box',
                    transition: isDragging() ? 'none' : 'background-color 0.1s ease',
                }}
            />

            {/* Progress bar - CSS display instead of Show to avoid unmount/remount */}
            <div
                class="bar-progress"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${progressWidth()}px`,
                    height: '100%',
                    'border-radius': `${cornerRadius()}px`,
                    'background-color': progressColor(),
                    'pointer-events': 'none',
                    display: progress() > 0 ? 'block' : 'none',
                }}
            />

            {/* Label */}
            <div
                class="bar-label"
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: labelPos().position === 'inside' ? '50%' : `${width() + 8}px`,
                    transform: labelPos().position === 'inside'
                        ? 'translate(-50%, -50%)'
                        : 'translateY(-50%)',
                    'font-size': '12px',
                    'font-weight': '500',
                    color: labelPos().position === 'inside' ? '#fff' : '#333',
                    'pointer-events': 'none',
                    'user-select': 'none',
                    'white-space': 'nowrap',
                }}
            >
                {task()?.name ?? ''}
            </div>

            {/* Child count indicator (optional) - CSS display instead of Show */}
            <div
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: `${width() + 8 + (task()?.name?.length ?? 0) * 7}px`,
                    transform: 'translateY(-50%)',
                    'font-size': '10px',
                    color: '#888',
                    'pointer-events': 'none',
                    'white-space': 'nowrap',
                    display: task()?._children?.length > 0 ? 'block' : 'none',
                }}
            >
                ({task()?._children?.length ?? 0})
            </div>
        </div>
    );
}

export default SummaryBar;
