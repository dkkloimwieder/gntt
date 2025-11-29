import { createSignal, createMemo, Show, onCleanup } from 'solid-js';
import { computeProgressWidth, computeExpectedProgress, computeLabelPosition, snapToGrid } from '../utils/barCalculations.js';
import { useDrag, clamp } from '../hooks/useDrag.js';

/**
 * SolidJS Bar Component
 *
 * Renders a task bar with:
 * - Main bar rectangle
 * - Progress bar
 * - Expected progress bar (optional)
 * - Label
 * - Resize handles (when not readonly)
 * - Drag interactions (bar move, resize, progress)
 *
 * Integrates with taskStore for reactive position updates.
 */
export function Bar(props) {
    // Get position from taskStore reactively
    const position = createMemo(() => {
        if (props.taskStore && props.task?.id) {
            return props.taskStore.getBarPosition(props.task.id);
        }
        // Fallback to direct props
        return {
            x: props.x ?? 0,
            y: props.y ?? 0,
            width: props.width ?? 100,
            height: props.height ?? 30,
        };
    });

    // Configuration from ganttConfig or direct props
    const config = createMemo(() => ({
        barCornerRadius: props.ganttConfig?.barCornerRadius?.() ?? props.cornerRadius ?? 3,
        readonly: props.ganttConfig?.readonly?.() ?? props.readonly ?? false,
        readonlyDates: props.ganttConfig?.readonlyDates?.() ?? props.readonlyDates ?? false,
        readonlyProgress: props.ganttConfig?.readonlyProgress?.() ?? props.readonlyProgress ?? false,
        showExpectedProgress: props.ganttConfig?.showExpectedProgress?.() ?? props.showExpectedProgress ?? false,
        columnWidth: props.ganttConfig?.columnWidth?.() ?? props.columnWidth ?? 45,
        ignoredPositions: props.ganttConfig?.ignoredPositions?.() ?? props.ignoredPositions ?? [],
    }));

    // Task data
    const task = createMemo(() => props.task ?? {});

    // Derived values
    const x = () => position()?.x ?? 0;
    const y = () => position()?.y ?? 0;
    const width = () => position()?.width ?? 100;
    const height = () => position()?.height ?? 30;

    // Minimum bar width (one column)
    const minWidth = () => config().columnWidth;

    // ═══════════════════════════════════════════════════════════════════════════
    // DRAG SETUP
    // ═══════════════════════════════════════════════════════════════════════════

    const { dragState, isDragging, startDrag } = useDrag({
        onDragStart: (data, state) => {
            // Store original values
            data.originalX = x();
            data.originalY = y();
            data.originalWidth = width();
            data.originalProgress = task().progress ?? 0;
        },

        onDragMove: (move, data, state) => {
            if (!props.taskStore || !task().id) return;

            const colWidth = config().columnWidth;
            const ignored = config().ignoredPositions;

            if (state === 'dragging_bar') {
                // Bar movement - snap to grid
                let newX = snapToGrid(data.originalX + move.deltaX, colWidth, ignored);

                // Apply constraints if provided
                if (props.onConstrainPosition) {
                    const constrained = props.onConstrainPosition(task().id, newX, y());
                    if (constrained === null) return; // Movement blocked
                    newX = constrained.x ?? newX;
                }

                props.taskStore.updateBarPosition(task().id, { x: newX });

            } else if (state === 'dragging_left') {
                // Left handle - resize from start
                const rawDelta = move.deltaX;
                const snappedDelta = Math.round(rawDelta / colWidth) * colWidth;

                let newX = data.originalX + snappedDelta;
                let newWidth = data.originalWidth - snappedDelta;

                // Enforce minimum width
                if (newWidth < minWidth()) {
                    newWidth = minWidth();
                    newX = data.originalX + data.originalWidth - minWidth();
                }

                // Skip ignored positions
                newX = snapToGrid(newX, colWidth, ignored);

                props.taskStore.updateBarPosition(task().id, { x: newX, width: newWidth });

            } else if (state === 'dragging_right') {
                // Right handle - resize from end
                const rawDelta = move.deltaX;
                const snappedDelta = Math.round(rawDelta / colWidth) * colWidth;

                let newWidth = data.originalWidth + snappedDelta;

                // Enforce minimum width
                newWidth = Math.max(minWidth(), newWidth);

                props.taskStore.updateBarPosition(task().id, { width: newWidth });

            } else if (state === 'dragging_progress') {
                // Progress handle - update progress percentage
                const barX = x();
                const barWidth = width();
                const ignored = config().ignoredPositions;
                const colWidth = config().columnWidth;

                // Calculate new progress X position
                let newProgressX = clamp(
                    data.startSvgX + move.deltaX,
                    barX,
                    barX + barWidth
                );

                // Calculate progress percentage (accounting for ignored dates)
                const totalIgnoredInBar = ignored.reduce((acc, pos) => {
                    return acc + (pos >= barX && pos < barX + barWidth ? 1 : 0);
                }, 0);
                const effectiveWidth = barWidth - (totalIgnoredInBar * colWidth);

                const progressOffset = newProgressX - barX;
                const ignoredInProgress = ignored.reduce((acc, pos) => {
                    return acc + (pos >= barX && pos < newProgressX ? 1 : 0);
                }, 0);
                const effectiveProgress = progressOffset - (ignoredInProgress * colWidth);

                const newProgress = effectiveWidth > 0
                    ? clamp(Math.round((effectiveProgress / effectiveWidth) * 100), 0, 100)
                    : 0;

                // Update task progress
                if (props.taskStore) {
                    const currentTask = props.taskStore.getTask(task().id);
                    if (currentTask) {
                        props.taskStore.updateTask(task().id, {
                            ...currentTask,
                            progress: newProgress,
                        });
                    }
                }
            }
        },

        onDragEnd: (move, data, state) => {
            // Notify about changes - read directly from store to avoid reactive timing issues
            if (state === 'dragging_bar' || state === 'dragging_left' || state === 'dragging_right') {
                const pos = props.taskStore?.getBarPosition(task().id);
                props.onDateChange?.(task().id, {
                    x: pos?.x ?? x(),
                    width: pos?.width ?? width(),
                });
            } else if (state === 'dragging_progress') {
                props.onProgressChange?.(task().id, task().progress);
            }
        },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    const handleBarMouseDown = (e) => {
        if (config().readonly || config().readonlyDates || isLocked()) return;

        // Check if clicking on a handle
        const target = e.target;
        if (target.classList.contains('handle')) return;

        startDrag(e, 'dragging_bar', { taskId: task().id });
    };

    const handleLeftHandleMouseDown = (e) => {
        if (config().readonly || config().readonlyDates || isLocked()) return;
        e.stopPropagation();
        startDrag(e, 'dragging_left', { taskId: task().id });
    };

    const handleRightHandleMouseDown = (e) => {
        if (config().readonly || config().readonlyDates || isLocked()) return;
        e.stopPropagation();
        startDrag(e, 'dragging_right', { taskId: task().id });
    };

    const handleProgressMouseDown = (e) => {
        if (config().readonly || config().readonlyProgress || isLocked()) return;
        e.stopPropagation();
        startDrag(e, 'dragging_progress', { taskId: task().id });
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPUTED VALUES
    // ═══════════════════════════════════════════════════════════════════════════

    // Progress width calculation
    const progressWidth = createMemo(() => {
        const progress = task().progress ?? 0;
        return computeProgressWidth(
            x(),
            width(),
            progress,
            config().ignoredPositions,
            config().columnWidth
        );
    });

    // Expected progress width (if enabled)
    const expectedProgressWidth = createMemo(() => {
        if (!config().showExpectedProgress) return 0;

        const taskStart = task()._start ?? task().start;
        const taskEnd = task()._end ?? task().end;
        if (!taskStart || !taskEnd) return 0;

        const expectedPercent = computeExpectedProgress(
            taskStart,
            taskEnd,
            props.ganttConfig?.unit?.() ?? 'day',
            props.ganttConfig?.step?.() ?? 1
        );

        return computeProgressWidth(
            x(),
            width(),
            expectedPercent,
            config().ignoredPositions,
            config().columnWidth
        );
    });

    // Label positioning
    const labelInfo = createMemo(() => {
        const name = task().name ?? '';
        return computeLabelPosition(x(), width(), name);
    });

    // Colors
    const barColor = () => task().color ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = () => task().color_progress ?? 'var(--g-bar-progress-color, #a3a3ff)';
    const expectedProgressColor = () => 'var(--g-expected-progress-color, rgba(0,0,0,0.2))';

    // Invalid state
    const isInvalid = () => task().invalid ?? false;

    // Custom class
    const customClass = () => task().custom_class ?? '';

    // Handle visibility (show when not fully readonly)
    const showHandles = () => !config().readonly;
    const showDateHandles = () => showHandles() && !config().readonlyDates;
    const showProgressHandle = () => showHandles() && !config().readonlyProgress;

    // Locked state (from constraint system)
    const isLocked = () => task().constraints?.locked ?? false;

    // Drag state class
    const dragClass = () => isDragging() ? `dragging ${dragState()}` : '';

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════════

    return (
        <g
            class={`bar-wrapper ${customClass()} ${isInvalid() ? 'invalid' : ''} ${isLocked() ? 'locked' : ''} ${dragClass()}`}
            data-id={task().id}
            onMouseDown={handleBarMouseDown}
            style={{ cursor: isLocked() ? 'not-allowed' : (config().readonly ? 'default' : 'move') }}
        >
            {/* Main bar group */}
            <g class="bar-group">
                {/* Main bar rectangle */}
                <rect
                    x={x()}
                    y={y()}
                    width={width()}
                    height={height()}
                    rx={config().barCornerRadius}
                    ry={config().barCornerRadius}
                    class="bar"
                    style={{
                        fill: isLocked() ? '#7f8c8d' : (isDragging() ? '#2c3e50' : barColor()),
                        stroke: isLocked() ? '#c0392b' : 'var(--g-bar-stroke, #8a8aff)',
                        'stroke-width': isLocked() ? '2' : '0',
                        'stroke-dasharray': isLocked() ? '4,4' : 'none',
                        transition: isDragging() ? 'none' : 'fill 0.1s ease',
                    }}
                />

                {/* Expected progress bar (behind actual progress) */}
                <Show when={config().showExpectedProgress && expectedProgressWidth() > 0}>
                    <rect
                        x={x()}
                        y={y()}
                        width={expectedProgressWidth()}
                        height={height()}
                        rx={config().barCornerRadius}
                        ry={config().barCornerRadius}
                        class="bar-expected-progress"
                        style={{ fill: expectedProgressColor() }}
                    />
                </Show>

                {/* Progress bar */}
                <rect
                    x={x()}
                    y={y()}
                    width={progressWidth()}
                    height={height()}
                    rx={config().barCornerRadius}
                    ry={config().barCornerRadius}
                    class="bar-progress"
                    style={{ fill: progressColor() }}
                />

                {/* Label */}
                <text
                    x={labelInfo().x}
                    y={y() + height() / 2}
                    class={`bar-label ${labelInfo().position}`}
                    dominant-baseline="middle"
                    text-anchor={labelInfo().position === 'inside' ? 'middle' : 'start'}
                    style={{ 'pointer-events': 'none' }}
                >
                    {task().name ?? ''}
                </text>

                {/* Lock icon for locked tasks */}
                <Show when={isLocked()}>
                    <text
                        x={x() + width() - 12}
                        y={y() + 12}
                        font-size="10"
                        style={{ 'pointer-events': 'none' }}
                    >
                        🔒
                    </text>
                </Show>
            </g>

            {/* Resize handles group */}
            <Show when={showHandles() && !isLocked()}>
                <g class="handle-group">
                    {/* Left resize handle */}
                    <Show when={showDateHandles()}>
                        <rect
                            x={x() - 2}
                            y={y() + height() / 4}
                            width={4}
                            height={height() / 2}
                            rx={1}
                            class="handle handle-left"
                            onMouseDown={handleLeftHandleMouseDown}
                            style={{
                                fill: 'var(--g-handle-color, #ddd)',
                                cursor: 'ew-resize',
                                opacity: 0,
                            }}
                        />
                    </Show>

                    {/* Right resize handle */}
                    <Show when={showDateHandles()}>
                        <rect
                            x={x() + width() - 2}
                            y={y() + height() / 4}
                            width={4}
                            height={height() / 2}
                            rx={1}
                            class="handle handle-right"
                            onMouseDown={handleRightHandleMouseDown}
                            style={{
                                fill: 'var(--g-handle-color, #ddd)',
                                cursor: 'ew-resize',
                                opacity: 0,
                            }}
                        />
                    </Show>

                    {/* Progress handle (circle) */}
                    <Show when={showProgressHandle() && progressWidth() > 0}>
                        <circle
                            cx={x() + progressWidth()}
                            cy={y() + height() / 2}
                            r={5}
                            class="handle handle-progress"
                            onMouseDown={handleProgressMouseDown}
                            style={{
                                fill: 'var(--g-progress-handle-color, #fff)',
                                stroke: progressColor(),
                                'stroke-width': 2,
                                cursor: 'ew-resize',
                                opacity: 0,
                            }}
                        />
                    </Show>
                </g>
            </Show>
        </g>
    );
}
