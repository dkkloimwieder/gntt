import { createMemo, Accessor, JSX } from 'solid-js';
import {
    computeProgressWidth,
    computeExpectedProgress,
    computeLabelPosition,
} from '../utils/barCalculations';
import { useBarDrag } from '../hooks/useBarDrag';
import { useBarConfig } from '../hooks/useBarConfig';
import { useGanttEvents } from '../contexts/GanttEvents';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { ProcessedTask, BarPosition, LockState } from '../types';
import { DEFAULT_BAR_HEIGHT } from '../constants';

// Bar-local layout constants (px)
const LABEL_OUTSIDE_GAP = 5; // gap between bar's right edge and outside-positioned label
const PROGRESS_HANDLE_SIZE = 10; // diameter of the circular progress handle
const PROGRESS_HANDLE_HALF = PROGRESS_HANDLE_SIZE / 2;

interface TaskPosition {
    y: number;
    height?: number;
}

interface BatchOriginal {
    originalX: number;
}

interface ConstrainedResult {
    x?: number;
}

interface BarProps {
    task: ProcessedTask | Accessor<ProcessedTask>;
    taskStore?: TaskStore;
    ganttConfig?: GanttConfigStore;
    taskPosition?: TaskPosition | Accessor<TaskPosition | undefined>;
    visible?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    cornerRadius?: number;
    readonly?: boolean;
    readonlyDates?: boolean;
    readonlyProgress?: boolean;
    showExpectedProgress?: boolean;
    columnWidth?: number;
    ignoredPositions?: number[];
    onCollectDependents?: (taskId: string) => Set<string>;
    onCollectDescendants?: (taskId: string) => Set<string>;
    onClampBatchDelta?: (
        batchOriginals: Map<string, BatchOriginal>,
        deltaX: number,
    ) => number;
    onConstrainPosition?: (
        taskId: string,
        x: number,
        y: number,
    ) => ConstrainedResult | null;
    onDateChange?: (
        taskId: string,
        position: { x: number; width: number },
    ) => void;
    onResizeEnd?: (taskId: string) => void;
    onProgressChange?: (taskId: string, progress: number) => void;
    onHover?: (taskId: string, clientX: number, clientY: number) => void;
    onHoverEnd?: () => void;
    onTaskClick?: (taskId: string, e: MouseEvent) => void;
}

interface TaskData {
    id: string;
    name: string;
    color: string;
    colorProgress: string;
    progress: number;
    locked: LockState;
    invalid: boolean;
    customClass: string;
    hasChildren: boolean;
    start: Date | string | null;
    end: Date | string | null;
}

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
export function Bar(props: BarProps): JSX.Element {
    // Get event handlers from context (fallback to props for backwards compatibility)
    const events = useGanttEvents();

    // Get task - props.task can be a value OR an accessor function (for <Index> pooling)
    // Returns the store proxy for reactive position updates during drag
    const getTask = (): ProcessedTask | undefined => {
        const t = props.task;
        return typeof t === 'function' ? t() : t;
    };

    // Get position directly from task's _bar - keeps reactivity for drag updates
    const getPosition = (): BarPosition => {
        const task = getTask();
        return (
            task?._bar ?? {
                x: props.x ?? 0,
                y: props.y ?? 0,
                width: props.width ?? 100,
                height: props.height ?? DEFAULT_BAR_HEIGHT,
            }
        );
    };

    // Memoized config accessors — store value → prop fallback → default.
    const {
        barCornerRadius,
        readonly,
        readonlyDates,
        readonlyProgress,
        showExpectedProgress,
        columnWidth,
        ignoredPositions,
    } = useBarConfig(props);

    // OPTIMIZATION: Single memo batching all task property reads
    // This reduces reactive overhead from 34 separate task() accesses to 1 memo evaluation
    // Position (_bar) is NOT included here - it's read directly in getPosition() for drag reactivity
    const t = createMemo((): TaskData => {
        const task = getTask();
        if (!task)
            return {
                id: '',
                name: '',
                color: '#b8c2cc',
                colorProgress: '#a3a3ff',
                progress: 0,
                locked: false,
                invalid: false,
                customClass: '',
                hasChildren: false,
                start: null,
                end: null,
            };
        return {
            id: task.id ?? '',
            name: task.name ?? '',
            color: task.color ?? '#b8c2cc',
            colorProgress: task.color_progress ?? '#a3a3ff',
            progress: task.progress ?? 0,
            locked: task.constraints?.locked ?? false,
            invalid:
                (task as ProcessedTask & { invalid?: boolean }).invalid ??
                false,
            customClass:
                (task as ProcessedTask & { custom_class?: string })
                    .custom_class ?? '',
            hasChildren: (task._children?.length ?? 0) > 0,
            start: task._start ?? null,
            end: task._end ?? null,
        };
    });

    // OPTIMIZATION: Single memoized position read instead of 4 separate store reads
    const position = createMemo(() => getPosition());
    const x = (): number => position()?.x ?? 0;
    // Use taskPosition Y if provided (for variable row heights), else fall back to _bar.y
    // taskPosition can be a value OR accessor (for <Index> pooling reactivity)
    const y = (): number => {
        const pos =
            typeof props.taskPosition === 'function'
                ? props.taskPosition()
                : props.taskPosition;
        return pos?.y ?? position()?.y ?? 0;
    };
    const width = (): number => position()?.width ?? 100;
    const height = (): number => position()?.height ?? DEFAULT_BAR_HEIGHT;

    // Minimum bar width (one column)
    const minWidth = (): number => columnWidth();

    // Drag/resize/progress interaction state — see hooks/useBarDrag.
    const { dragState, isDragging, startDrag, didDrag, resetDidDrag } =
        useBarDrag({
            taskStore: props.taskStore,
            handlers: {
                onCollectDependents: props.onCollectDependents,
                onCollectDescendants: props.onCollectDescendants,
                onClampBatchDelta: props.onClampBatchDelta,
                onConstrainPosition: props.onConstrainPosition,
                // Props callbacks take precedence; context provides fallback.
                onDateChange: props.onDateChange ?? events.onDateChange,
                onResizeEnd: props.onResizeEnd ?? events.onResizeEnd,
                onProgressChange:
                    props.onProgressChange ?? events.onProgressChange,
            },
            taskInfo: () => ({ id: t().id, progress: t().progress }),
            x,
            y,
            width,
            columnWidth,
            ignoredPositions,
            minWidth,
        });

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    const handleBarMouseDown = (e: MouseEvent): void => {
        if (readonly() || readonlyDates() || isLocked()) return;

        // Skip if clicking on a handle (its own onMouseDown handles drag)
        const target = e.target as HTMLElement;
        if (target.classList && target.classList.contains('handle')) return;

        resetDidDrag();
        startDrag(e, 'dragging_bar', { taskId: t().id });
    };

    // Hover handlers for task data popup (use context with props fallback)
    const handleMouseEnter = (e: MouseEvent): void => {
        const onHover = props.onHover ?? events.onHover;
        if (onHover && !isDragging()) {
            onHover(t().id, e.clientX, e.clientY);
        }
    };

    const handleMouseLeave = (): void => {
        const onHoverEnd = props.onHoverEnd ?? events.onHoverEnd;
        if (onHoverEnd) {
            onHoverEnd();
        }
    };

    // Click handler for task data modal (only fires if no drag occurred)
    const handleClick = (e: MouseEvent): void => {
        const onTaskClick = props.onTaskClick ?? events.onTaskClick;
        if (!didDrag() && onTaskClick) {
            e.stopPropagation();
            onTaskClick(t().id, e);
        }
    };

    const handleLeftHandleMouseDown = (e: MouseEvent): void => {
        if (readonly() || readonlyDates() || isLocked()) return;
        e.stopPropagation();
        startDrag(e, 'dragging_left', { taskId: t().id });
    };

    const handleRightHandleMouseDown = (e: MouseEvent): void => {
        if (readonly() || readonlyDates() || isLocked()) return;
        e.stopPropagation();
        startDrag(e, 'dragging_right', { taskId: t().id });
    };

    const handleProgressMouseDown = (e: MouseEvent): void => {
        if (readonly() || readonlyProgress() || isLocked()) return;
        e.stopPropagation();
        startDrag(e, 'dragging_progress', { taskId: t().id });
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // COMPUTED VALUES - OPTIMIZED: memoized to avoid recalculation on every render
    // ═══════════════════════════════════════════════════════════════════════════

    // Progress width calculation
    const progressWidth = createMemo(() => {
        return computeProgressWidth(
            x(),
            width(),
            t().progress,
            ignoredPositions(),
            columnWidth(),
        );
    });

    // Expected progress width (if enabled)
    const expectedProgressWidth = createMemo(() => {
        if (!showExpectedProgress()) return 0;

        const taskStart = t().start;
        const taskEnd = t().end;
        if (!taskStart || !taskEnd) return 0;

        const expectedPercent = computeExpectedProgress(
            taskStart instanceof Date ? taskStart : new Date(taskStart),
            taskEnd instanceof Date ? taskEnd : new Date(taskEnd),
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
        return computeLabelPosition(x(), width(), t().name);
    });

    // Colors - use t() memo values
    const barColor = (): string => t().color;
    const progressColor = (): string => t().colorProgress;
    const expectedProgressColor = (): string =>
        'var(--g-expected-progress-color, rgba(0,0,0,0.2))';

    // Check if task has subtasks (for fill opacity)
    const hasSubtasks = (): boolean => t().hasChildren;

    // Invalid state
    const isInvalid = (): boolean => t().invalid;

    // Custom class
    const customClass = (): string => t().customClass;

    // Handle visibility (show when not fully readonly)
    const showHandles = (): boolean => !readonly();
    const showDateHandles = (): boolean => showHandles() && !readonlyDates();
    const showProgressHandle = (): boolean =>
        showHandles() && !readonlyProgress();

    // Locked state (from constraint system)
    const isLocked = (): boolean => !!t().locked;

    // Drag state class
    const dragClass = (): string =>
        isDragging() ? `dragging ${dragState()}` : '';

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════════

    // Visibility prop for virtualization - hidden bars stay in DOM but are not painted
    const visible = (): boolean => props.visible ?? true;

    // GPU-accelerated transform for positioning
    const barTransform = (): string => `translate(${x()}px, ${y()}px)`;

    return (
        <div
            class={`bar-wrapper ${customClass()} ${isInvalid() ? 'invalid' : ''} ${isLocked() ? 'locked' : ''} ${dragClass()}`}
            data-id={t().id}
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
            }}
        >
            {/* Main bar - outline style with subtle fill */}
            <div
                class="bar"
                style={{
                    position: 'absolute',
                    top: '0',
                    left: '0',
                    width: '100%',
                    height: '100%',
                    'border-radius': `${barCornerRadius()}px`,
                    'background-color': isLocked()
                        ? '#7f8c8d'
                        : isDragging()
                          ? '#2c3e50'
                          : barColor(),
                    opacity:
                        isLocked() || isDragging()
                            ? 1
                            : hasSubtasks()
                              ? 0
                              : 0.1,
                    border: `${isLocked() ? '2px' : '1.5px'} solid ${isLocked() ? '#c0392b' : barColor()}`,
                    'border-style': isLocked() ? 'dashed' : 'solid',
                    'box-sizing': 'border-box',
                    transition: isDragging()
                        ? 'none'
                        : 'background-color 0.1s ease',
                }}
            />

            {/* Expected progress bar (behind actual progress) - use CSS display instead of Show to avoid unmount/remount */}
            <div
                class="bar-expected-progress"
                style={{
                    position: 'absolute',
                    top: '0',
                    left: '0',
                    width: `${expectedProgressWidth()}px`,
                    height: '100%',
                    'border-radius': `${barCornerRadius()}px`,
                    'background-color': expectedProgressColor(),
                    display:
                        showExpectedProgress() && expectedProgressWidth() > 0
                            ? 'block'
                            : 'none',
                }}
            />

            {/* Progress bar - subtle fill */}
            <div
                class="bar-progress"
                style={{
                    position: 'absolute',
                    top: '0',
                    left: '0',
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
                    left:
                        labelInfo().position === 'inside'
                            ? '50%'
                            : `${width() + LABEL_OUTSIDE_GAP}px`,
                    transform:
                        labelInfo().position === 'inside'
                            ? 'translate(-50%, -50%)'
                            : 'translateY(-50%)',
                    'white-space': 'nowrap',
                    'pointer-events': 'none',
                    'font-size': '12px',
                    color: labelInfo().position === 'inside' ? '#fff' : '#333',
                }}
            >
                {t().name}
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
                    display:
                        showHandles() && !isLocked() && showDateHandles()
                            ? 'block'
                            : 'none',
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
                    display:
                        showHandles() && !isLocked() && showDateHandles()
                            ? 'block'
                            : 'none',
                }}
            />

            {/* Progress handle (circle) */}
            <div
                class="handle handle-progress"
                onMouseDown={handleProgressMouseDown}
                style={{
                    position: 'absolute',
                    left: `${progressWidth() - PROGRESS_HANDLE_HALF}px`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: `${PROGRESS_HANDLE_SIZE}px`,
                    height: `${PROGRESS_HANDLE_SIZE}px`,
                    'border-radius': '50%',
                    'background-color': 'var(--g-progress-handle-color, #fff)',
                    border: `2px solid ${progressColor()}`,
                    cursor: 'ew-resize',
                    opacity: 0,
                    'box-sizing': 'border-box',
                    display:
                        showHandles() &&
                        !isLocked() &&
                        showProgressHandle() &&
                        progressWidth() > 0
                            ? 'block'
                            : 'none',
                }}
            />
        </div>
    );
}

export default Bar;
