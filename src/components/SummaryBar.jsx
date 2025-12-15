import { createMemo, Show } from 'solid-js';
import { useDrag } from '../hooks/useDrag.js';
import { snapToGrid, computeLabelPosition } from '../utils/barCalculations.js';

/**
 * SummaryBar - Parent task bar that looks like a regular task but with collapse toggle.
 *
 * Visual appearance: Same as regular Bar but with chevron indicator
 * Features:
 * - Collapse chevron on the bar (click to toggle subtask visibility)
 * - Drag support (moves all descendant tasks together)
 * - Progress bar display
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
    const cornerRadius = () => props.ganttConfig?.barCornerRadius?.() ?? 3;

    // Collapse state
    const isCollapsed = () => props.taskStore?.isTaskCollapsed(taskId()) ?? false;

    // Check if summary has children on the same resource (single-resource subtasks)
    // When expanded with same-resource children, we hide the bar to avoid overlap
    const hasSameResourceChildren = createMemo(() => {
        const t = task();
        if (!t?._children?.length) return false;
        const myResource = t.resource;
        const taskMap = props.taskStore?.tasks();
        if (!taskMap) return false;

        for (const childId of t._children) {
            const child = taskMap.get(childId);
            if (child?.resource === myResource) return true;
        }
        return false;
    });

    // Should we hide the bar? (expanded + same-resource children)
    const shouldHideBar = () => !isCollapsed() && hasSameResourceChildren();

    // Colors
    const barColor = () => task()?.color ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = () => task()?.color_progress ?? 'var(--g-bar-progress-color, #a3a3ff)';
    const progress = () => task()?.progress ?? 0;

    // Progress bar width
    const progressWidth = () => (width() * progress()) / 100;

    // Chevron position (inside the bar on the left)
    const chevronX = () => x() + 12;
    const chevronY = () => y() + height() / 2;

    // Label position
    const labelPos = createMemo(() => {
        const name = task()?.name ?? '';
        // Offset label to account for chevron
        return computeLabelPosition(x() + 20, width() - 20, name, 7);
    });

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
            return `M ${cx - 3} ${cy - 4} L ${cx + 3} ${cy} L ${cx - 3} ${cy + 4}`;
        } else {
            // Down-pointing chevron (expanded)
            return `M ${cx - 4} ${cy - 3} L ${cx} ${cy + 3} L ${cx + 4} ${cy - 3}`;
        }
    });

    // For single-resource expanded summaries, show a small collapse toggle only
    // For cross-resource or collapsed, show the full bar
    return (
        <g
            class={`summary-bar-wrapper bar-wrapper ${dragStateClass()} ${isCollapsed() ? 'collapsed' : 'expanded'}`}
            data-id={taskId()}
            data-type="summary"
        >
            <Show when={!shouldHideBar()}>
                {/* Main bar - same as regular Bar */}
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

                    {/* Collapse chevron (clickable area) */}
                    <g
                        class="collapse-toggle"
                        onClick={handleChevronClick}
                        style={{ cursor: 'pointer' }}
                    >
                        {/* Hit area */}
                        <rect
                            x={x() + 2}
                            y={y() + 2}
                            width={20}
                            height={height() - 4}
                            fill="transparent"
                        />
                        {/* Chevron icon */}
                        <path
                            d={chevronPath()}
                            fill="none"
                            stroke="rgba(255,255,255,0.9)"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </g>

                    {/* Label inside bar */}
                    <text
                        x={labelPos().position === 'inside' ? labelPos().x + 10 : labelPos().x}
                        y={y() + height() / 2 + 4}
                        text-anchor={labelPos().position === 'inside' ? 'middle' : 'start'}
                        font-size="12"
                        font-weight="500"
                        fill={labelPos().position === 'inside' ? '#fff' : '#333'}
                        style={{ 'pointer-events': 'none', 'user-select': 'none' }}
                    >
                        {task()?.name ?? ''}
                    </text>

                    {/* Children count when collapsed */}
                    <Show when={isCollapsed() && task()?._children?.length > 0}>
                        <text
                            x={x() + width() + 8}
                            y={y() + height() / 2 + 4}
                            font-size="11"
                            fill="#666"
                            style={{ 'pointer-events': 'none' }}
                        >
                            +{task()._children.length}
                        </text>
                    </Show>
                </g>
            </Show>

            {/* For single-resource expanded: show small collapse indicator at start of row */}
            <Show when={shouldHideBar()}>
                <g
                    class="collapse-toggle-inline"
                    onClick={handleChevronClick}
                    style={{ cursor: 'pointer' }}
                >
                    {/* Small indicator before the first child */}
                    <rect
                        x={x() - 20}
                        y={y() + 4}
                        width={16}
                        height={height() - 8}
                        rx={3}
                        fill={barColor()}
                        opacity={0.8}
                    />
                    <path
                        d={`M ${x() - 15} ${y() + height() / 2 - 3} L ${x() - 12} ${y() + height() / 2 + 2} L ${x() - 9} ${y() + height() / 2 - 3}`}
                        fill="none"
                        stroke="#fff"
                        stroke-width="1.5"
                        stroke-linecap="round"
                    />
                </g>
            </Show>
        </g>
    );
}

export default SummaryBar;
