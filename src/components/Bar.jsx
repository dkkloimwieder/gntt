import { createMemo, onCleanup, untrack } from 'solid-js';
import {
    computeProgressWidth,
    computeExpectedProgress,
    computeLabelPosition,
    snapToGrid,
} from '../utils/barCalculations.js';
import { useDrag, clamp } from '../hooks/useDrag.js';
import { useGanttEvents } from '../contexts/GanttEvents.jsx';

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
    // Get event handlers from context (fallback to props for backwards compatibility)
    const events = useGanttEvents();

    // Get task ID - prefer explicit taskId prop, fallback to task.id
    // taskId prop can be a value OR an accessor function (for <Index> pooling)
    const taskId = () => {
        const id = props.taskId;
        return typeof id === 'function' ? id() : id ?? props.task?.id;
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
        // Fallback to direct props
        return {
            x: props.x ?? 0,
            y: props.y ?? 0,
            width: props.width ?? 100,
            height: props.height ?? 30,
        };
    };

    // Configuration - OPTIMIZED: memoize config accessors to avoid repeated optional chaining
    const barCornerRadius = createMemo(() => props.ganttConfig?.barCornerRadius?.() ?? props.cornerRadius ?? 3);
    const readonly = createMemo(() => props.ganttConfig?.readonly?.() ?? props.readonly ?? false);
    const readonlyDates = createMemo(() => props.ganttConfig?.readonlyDates?.() ?? props.readonlyDates ?? false);
    const readonlyProgress = createMemo(() => props.ganttConfig?.readonlyProgress?.() ?? props.readonlyProgress ?? false);
    const showExpectedProgress = createMemo(() => props.ganttConfig?.showExpectedProgress?.() ?? props.showExpectedProgress ?? false);
    const columnWidth = createMemo(() => props.ganttConfig?.columnWidth?.() ?? props.columnWidth ?? 45);
    const ignoredPositions = createMemo(() => props.ganttConfig?.ignoredPositions?.() ?? props.ignoredPositions ?? []);

    // Task data - read fresh from store if available
    const task = () => {
        const id = taskId();
        if (props.taskStore && id) {
            return props.taskStore.tasks[id] ?? props.task ?? {};
        }
        return props.task ?? {};
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

    // Minimum bar width (one column)
    const minWidth = () => columnWidth();

    // OPTIMIZATION: Track if a drag occurred in non-reactive variable (avoids 60fps signal updates)
    let didDragFlag = false;

    // ═══════════════════════════════════════════════════════════════════════════
    // DRAG SETUP
    // ═══════════════════════════════════════════════════════════════════════════

    const { dragState, isDragging, startDrag } = useDrag({
        onDragStart: (data, state) => {
            // Reset drag flag at start
            didDragFlag = false;
            // Store original values
            data.originalX = x();
            data.originalY = y();
            data.originalWidth = width();
            data.originalProgress = task().progress ?? 0;

            // Signal that a drag is in progress (defers expensive recalculations)
            props.taskStore?.setDraggingTaskId?.(task().id);

            // For bar dragging: collect dependent tasks AND descendants ONCE at drag start
            // This enables batch updates during drag for better performance
            if (state === 'dragging_bar') {
                // Collect tasks that should move together
                const tasksToMove = new Set();

                // Add dependency chain (tasks that depend on this one)
                if (props.onCollectDependents) {
                    const dependentIds = props.onCollectDependents(task().id);
                    for (const id of dependentIds) {
                        tasksToMove.add(id);
                    }
                }

                // Add descendants (child tasks for summary bars)
                if (props.onCollectDescendants) {
                    const descendantIds = props.onCollectDescendants(task().id);
                    for (const id of descendantIds) {
                        tasksToMove.add(id);
                    }
                }

                // Store original positions for all tasks in the batch
                data.dependentOriginals = new Map();
                for (const id of tasksToMove) {
                    const pos = props.taskStore?.getBarPosition(id);
                    if (pos) {
                        data.dependentOriginals.set(id, { originalX: pos.x });
                    }
                }
            }
        },

        onDragMove: (move, data, state) => {
            if (!props.taskStore || !task().id) {
                return;
            }

            // Mark that a drag occurred (used to distinguish click from drag)
            didDragFlag = true;

            const colWidth = columnWidth();
            const ignored = ignoredPositions();

            if (state === 'dragging_bar') {
                // Bar movement - snap to grid
                let newX = snapToGrid(
                    data.originalX + move.deltaX,
                    colWidth,
                    ignored,
                );

                // Calculate delta from original position
                let deltaX = newX - data.originalX;

                // Use batch move if we have dependent tasks (for performance)
                if (
                    data.dependentOriginals?.size > 0 &&
                    props.taskStore.batchMovePositions
                ) {
                    // Clamp deltaX to prevent constraint violations when dragging backward
                    if (props.onClampBatchDelta && deltaX < 0) {
                        deltaX = props.onClampBatchDelta(
                            data.dependentOriginals,
                            deltaX,
                        );
                    }

                    // Batch move all dependent tasks by the same delta
                    // This is much faster than individual constraint resolution
                    props.taskStore.batchMovePositions(
                        data.dependentOriginals,
                        deltaX,
                    );
                } else {
                    // Fallback: apply constraints and update single task
                    if (props.onConstrainPosition) {
                        const constrained = props.onConstrainPosition(
                            task().id,
                            newX,
                            y(),
                        );
                        if (constrained === null) return; // Movement blocked
                        newX = constrained.x ?? newX;
                    }
                    props.taskStore.updateBarPosition(task().id, { x: newX });
                }
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

                // Apply constraints if provided - prevent moving start before predecessor's end
                if (props.onConstrainPosition) {
                    const constrained = props.onConstrainPosition(
                        task().id,
                        newX,
                        y(),
                    );
                    if (constrained === null) return; // Movement blocked
                    // If constraint moved us right, adjust width accordingly
                    if (constrained.x > newX) {
                        newWidth = newWidth - (constrained.x - newX);
                        newX = constrained.x;
                    }
                }

                props.taskStore.updateBarPosition(task().id, {
                    x: newX,
                    width: newWidth,
                });
            } else if (state === 'dragging_right') {
                // Right handle - resize from end
                const rawDelta = move.deltaX;
                const snappedDelta = Math.round(rawDelta / colWidth) * colWidth;

                let newWidth = data.originalWidth + snappedDelta;

                // Enforce minimum width
                newWidth = Math.max(minWidth(), newWidth);

                props.taskStore.updateBarPosition(task().id, {
                    width: newWidth,
                });
            } else if (state === 'dragging_progress') {
                // Progress handle - update progress percentage
                const barX = x();
                const barWidth = width();
                const ignored = ignoredPositions();
                const colWidth = columnWidth();

                // Calculate new progress X position
                let newProgressX = clamp(
                    data.startSvgX + move.deltaX,
                    barX,
                    barX + barWidth,
                );

                // Calculate progress percentage (accounting for ignored dates)
                const totalIgnoredInBar = ignored.reduce((acc, pos) => {
                    return acc + (pos >= barX && pos < barX + barWidth ? 1 : 0);
                }, 0);
                const effectiveWidth = barWidth - totalIgnoredInBar * colWidth;

                const progressOffset = newProgressX - barX;
                const ignoredInProgress = ignored.reduce((acc, pos) => {
                    return acc + (pos >= barX && pos < newProgressX ? 1 : 0);
                }, 0);
                const effectiveProgress =
                    progressOffset - ignoredInProgress * colWidth;

                const newProgress =
                    effectiveWidth > 0
                        ? clamp(
                              Math.round(
                                  (effectiveProgress / effectiveWidth) * 100,
                              ),
                              0,
                              100,
                          )
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
            // Clear drag state (allows deferred recalculations to resume)
            props.taskStore?.setDraggingTaskId?.(null);

            // Notify about changes - read directly from store to avoid reactive timing issues
            // Use props callbacks if provided, otherwise use context
            const onDateChange = props.onDateChange ?? events.onDateChange;
            const onResizeEnd = props.onResizeEnd ?? events.onResizeEnd;
            const onProgressChange = props.onProgressChange ?? events.onProgressChange;

            if (
                state === 'dragging_bar' ||
                state === 'dragging_left' ||
                state === 'dragging_right'
            ) {
                const pos = props.taskStore?.getBarPosition(task().id);
                onDateChange?.(task().id, {
                    x: pos?.x ?? x(),
                    width: pos?.width ?? width(),
                });

                // Trigger constraint resolution after resize (width changed)
                if (state === 'dragging_left' || state === 'dragging_right') {
                    onResizeEnd?.(task().id);
                }
            } else if (state === 'dragging_progress') {
                onProgressChange?.(task().id, task().progress);
            }
        },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    const handleBarMouseDown = (e) => {
        if (readonly() || readonlyDates() || isLocked()) {
            return;
        }

        // Check if clicking on a handle
        const target = e.target;
        if (target.classList && target.classList.contains('handle')) {
            return;
        }

        didDragFlag = false; // Reset drag flag on mousedown
        startDrag(e, 'dragging_bar', { taskId: task().id });
    };

    // Hover handlers for task data popup (use context with props fallback)
    const handleMouseEnter = (e) => {
        const onHover = props.onHover ?? events.onHover;
        if (onHover && !isDragging()) {
            onHover(task().id, e.clientX, e.clientY);
        }
    };

    const handleMouseLeave = () => {
        const onHoverEnd = props.onHoverEnd ?? events.onHoverEnd;
        if (onHoverEnd) {
            onHoverEnd();
        }
    };

    // Click handler for task data modal (only fires if no drag occurred)
    const handleClick = (e) => {
        const onTaskClick = props.onTaskClick ?? events.onTaskClick;
        if (!didDragFlag && onTaskClick) {
            e.stopPropagation();
            onTaskClick(task().id, e);
        }
    };

    const handleLeftHandleMouseDown = (e) => {
        if (readonly() || readonlyDates() || isLocked()) return;
        e.stopPropagation();
        startDrag(e, 'dragging_left', { taskId: task().id });
    };

    const handleRightHandleMouseDown = (e) => {
        if (readonly() || readonlyDates() || isLocked()) return;
        e.stopPropagation();
        startDrag(e, 'dragging_right', { taskId: task().id });
    };

    const handleProgressMouseDown = (e) => {
        if (readonly() || readonlyProgress() || isLocked())
            return;
        e.stopPropagation();
        startDrag(e, 'dragging_progress', { taskId: task().id });
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPUTED VALUES - OPTIMIZED: memoized to avoid recalculation on every render
    // ═══════════════════════════════════════════════════════════════════════════

    // Progress width calculation
    const progressWidth = createMemo(() => {
        const progress = task().progress ?? 0;
        return computeProgressWidth(
            x(),
            width(),
            progress,
            ignoredPositions(),
            columnWidth(),
        );
    });

    // Expected progress width (if enabled)
    const expectedProgressWidth = createMemo(() => {
        if (!showExpectedProgress()) return 0;

        const taskStart = task()._start ?? task().start;
        const taskEnd = task()._end ?? task().end;
        if (!taskStart || !taskEnd) return 0;

        const expectedPercent = computeExpectedProgress(
            taskStart,
            taskEnd,
            props.ganttConfig?.unit?.() ?? 'day',
            props.ganttConfig?.step?.() ?? 1,
        );

        return computeProgressWidth(
            x(),
            width(),
            expectedPercent,
            ignoredPositions(),
            columnWidth(),
        );
    });

    // Label positioning
    const labelInfo = createMemo(() => {
        const name = task().name ?? '';
        return computeLabelPosition(x(), width(), name);
    });

    // Colors
    const barColor = () => task().color ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = () =>
        task().color_progress ?? 'var(--g-bar-progress-color, #a3a3ff)';
    const expectedProgressColor = () =>
        'var(--g-expected-progress-color, rgba(0,0,0,0.2))';

    // Check if task has subtasks (for fill opacity)
    const hasSubtasks = () => task()._children?.length > 0;

    // Invalid state
    const isInvalid = () => task().invalid ?? false;

    // Custom class
    const customClass = () => task().custom_class ?? '';

    // Handle visibility (show when not fully readonly)
    const showHandles = () => !readonly();
    const showDateHandles = () => showHandles() && !readonlyDates();
    const showProgressHandle = () =>
        showHandles() && !readonlyProgress();

    // Locked state (from constraint system)
    const isLocked = () => task().constraints?.locked ?? false;

    // Drag state class
    const dragClass = () => (isDragging() ? `dragging ${dragState()}` : '');

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════════

    // Visibility prop for virtualization - hidden bars stay in DOM but are not painted
    const visible = () => props.visible ?? true;

    // GPU-accelerated transform for positioning
    const barTransform = () => `translate(${x()}px, ${y()}px)`;

    return (
        <div
            class={`bar-wrapper ${customClass()} ${isInvalid() ? 'invalid' : ''} ${isLocked() ? 'locked' : ''} ${dragClass()}`}
            data-id={task().id}
            onMouseDown={handleBarMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            style={{
                position: 'absolute',
                transform: barTransform(),
                width: `${width()}px`,
                height: `${height()}px`,
                cursor: isLocked()
                    ? 'not-allowed'
                    : readonly()
                      ? 'default'
                      : 'move',
                visibility: visible() ? 'visible' : 'hidden',
                'will-change': 'transform',
            }}
        >
            {/* Main bar - outline style with subtle fill */}
            <div
                class="bar"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    'border-radius': `${barCornerRadius()}px`,
                    'background-color': isLocked()
                        ? '#7f8c8d'
                        : isDragging()
                          ? '#2c3e50'
                          : barColor(),
                    opacity: isLocked() || isDragging()
                        ? 1
                        : hasSubtasks()
                          ? 0
                          : 0.1,
                    border: `${isLocked() ? '2px' : '1.5px'} solid ${isLocked() ? '#c0392b' : barColor()}`,
                    'border-style': isLocked() ? 'dashed' : 'solid',
                    'box-sizing': 'border-box',
                    transition: isDragging() ? 'none' : 'background-color 0.1s ease',
                }}
            />

            {/* Expected progress bar (behind actual progress) - use CSS display instead of Show to avoid unmount/remount */}
            <div
                class="bar-expected-progress"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${expectedProgressWidth()}px`,
                    height: '100%',
                    'border-radius': `${barCornerRadius()}px`,
                    'background-color': expectedProgressColor(),
                    display: showExpectedProgress() && expectedProgressWidth() > 0 ? 'block' : 'none',
                }}
            />

            {/* Progress bar - subtle fill */}
            <div
                class="bar-progress"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${progressWidth()}px`,
                    height: '100%',
                    'border-radius': `${barCornerRadius()}px`,
                    'background-color': progressColor(),
                    opacity: 0.3,
                }}
            />

            {/* Label */}
            <div
                class={`bar-label ${labelInfo().position}`}
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: labelInfo().position === 'inside' ? '50%' : `${width() + 5}px`,
                    transform: labelInfo().position === 'inside'
                        ? 'translate(-50%, -50%)'
                        : 'translateY(-50%)',
                    'white-space': 'nowrap',
                    'pointer-events': 'none',
                    'font-size': '12px',
                    color: labelInfo().position === 'inside' ? '#fff' : '#333',
                }}
            >
                {task().name ?? ''}
            </div>

            {/* Lock icon for locked tasks - CSS display instead of Show to avoid unmount/remount */}
            <div
                style={{
                    position: 'absolute',
                    top: '2px',
                    right: '4px',
                    'font-size': '10px',
                    'pointer-events': 'none',
                    display: isLocked() ? 'block' : 'none',
                }}
            >
                🔒
            </div>

            {/* Resize handles - CSS display instead of Show to avoid unmount/remount */}
            {/* Left resize handle */}
            <div
                class="handle handle-left"
                onMouseDown={handleLeftHandleMouseDown}
                style={{
                    position: 'absolute',
                    left: '-2px',
                    top: '25%',
                    width: '4px',
                    height: '50%',
                    'border-radius': '1px',
                    'background-color': 'var(--g-handle-color, #ddd)',
                    cursor: 'ew-resize',
                    opacity: 0,
                    display: showHandles() && !isLocked() && showDateHandles() ? 'block' : 'none',
                }}
            />

            {/* Right resize handle */}
            <div
                class="handle handle-right"
                onMouseDown={handleRightHandleMouseDown}
                style={{
                    position: 'absolute',
                    right: '-2px',
                    top: '25%',
                    width: '4px',
                    height: '50%',
                    'border-radius': '1px',
                    'background-color': 'var(--g-handle-color, #ddd)',
                    cursor: 'ew-resize',
                    opacity: 0,
                    display: showHandles() && !isLocked() && showDateHandles() ? 'block' : 'none',
                }}
            />

            {/* Progress handle (circle) */}
            <div
                class="handle handle-progress"
                onMouseDown={handleProgressMouseDown}
                style={{
                    position: 'absolute',
                    left: `${progressWidth() - 5}px`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '10px',
                    height: '10px',
                    'border-radius': '50%',
                    'background-color': 'var(--g-progress-handle-color, #fff)',
                    border: `2px solid ${progressColor()}`,
                    cursor: 'ew-resize',
                    opacity: 0,
                    'box-sizing': 'border-box',
                    display: showHandles() && !isLocked() && showProgressHandle() && progressWidth() > 0 ? 'block' : 'none',
                }}
            />
        </div>
    );
}
