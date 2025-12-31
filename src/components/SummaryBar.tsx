import { createMemo, JSX, Accessor } from 'solid-js';
import { useDrag } from '../hooks/useDrag';
import { snapToGrid, computeLabelPosition } from '../utils/barCalculations';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { BarPosition, ProcessedTask } from '../types';

interface TaskPosition {
    y: number;
    height?: number;
}

interface BatchOriginal {
    originalX: number;
}

interface SummaryBarProps {
    taskId: string | Accessor<string>;
    taskStore?: TaskStore;
    ganttConfig?: GanttConfigStore;
    taskPosition?: TaskPosition | Accessor<TaskPosition | undefined>;
    onCollectDescendants?: (taskId: string) => Set<string>;
    onClampBatchDelta?: (batchOriginals: Map<string, BatchOriginal>, deltaX: number) => number;
    onDragEnd?: (taskId: string) => void;
}

/**
 * SummaryBar - Project-level summary bar that spans all its child tasks.
 */
export function SummaryBar(props: SummaryBarProps): JSX.Element {
    // Get task ID - can be a value OR an accessor function
    const taskId = (): string => {
        const id = props.taskId;
        return typeof id === 'function' ? id() : id;
    };

    // Get position directly from taskStore
    const getPosition = (): BarPosition => {
        const id = taskId();
        if (props.taskStore && id) {
            const task = props.taskStore.tasks[id] as ProcessedTask | undefined;
            if (task?._bar) {
                return task._bar;
            }
        }
        return { x: 0, y: 0, width: 100, height: 30 };
    };

    // Task data
    const task = (): ProcessedTask | undefined => {
        const id = taskId();
        if (props.taskStore && id) {
            return props.taskStore.tasks[id] as ProcessedTask | undefined;
        }
        return undefined;
    };

    // OPTIMIZATION: Single memoized position read
    const position = createMemo(() => getPosition());
    const x = (): number => position()?.x ?? 0;
    const y = (): number => {
        const pos = typeof props.taskPosition === 'function' ? props.taskPosition() : props.taskPosition;
        return pos?.y ?? position()?.y ?? 0;
    };
    const width = (): number => position()?.width ?? 100;
    const height = (): number => position()?.height ?? 30;

    // Configuration
    const columnWidth = createMemo(() => props.ganttConfig?.columnWidth?.() ?? 45);
    const readonly = createMemo(() => props.ganttConfig?.readonly?.() ?? false);
    const cornerRadius = createMemo(() => props.ganttConfig?.barCornerRadius?.() ?? 3);

    // Colors
    const barColor = (): string => task()?.color ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = (): string => task()?.color_progress ?? 'var(--g-bar-progress-color, #a3a3ff)';
    const progress = (): number => task()?.progress ?? 0;

    // Progress bar width
    const progressWidth = (): number => (width() * progress()) / 100;

    // Label position
    const labelPos = createMemo(() => {
        const name = task()?.name ?? '';
        return computeLabelPosition(x(), width(), name, 7);
    });

    // DRAG SETUP
    const { dragState, isDragging, startDrag } = useDrag({
        onDragStart: (data, state) => {
            data['originalX'] = x();
            data['originalY'] = y();

            if (state === 'dragging_bar' && props.onCollectDescendants) {
                const descendantIds = props.onCollectDescendants(taskId());
                descendantIds.add(taskId());

                const batchOriginals = new Map<string, BatchOriginal>();
                for (const id of descendantIds) {
                    const pos = props.taskStore?.getBarPosition(id);
                    if (pos) {
                        batchOriginals.set(id, { originalX: pos.x });
                    }
                }
                data['batchOriginals'] = batchOriginals;
            }
        },

        onDragMove: (move, data, state) => {
            if (!props.taskStore || !taskId() || state !== 'dragging_bar') {
                return;
            }

            const colWidth = columnWidth();
            const originalX = data['originalX'] as number;
            const newX = snapToGrid(originalX + move.deltaX, colWidth, []);
            let deltaX = newX - originalX;

            const batchOriginals = data['batchOriginals'] as Map<string, BatchOriginal> | undefined;
            if (batchOriginals && batchOriginals.size > 0 && props.taskStore.batchMovePositions) {
                if (props.onClampBatchDelta && deltaX < 0) {
                    deltaX = props.onClampBatchDelta(batchOriginals, deltaX);
                }
                props.taskStore.batchMovePositions(batchOriginals, deltaX);
            }
        },

        onDragEnd: (_move, _data, state) => {
            if (state === 'dragging_bar') {
                props.onDragEnd?.(taskId());
            }
        },
    });

    // Drag state class
    const dragStateClass = (): string => {
        const state = dragState();
        if (state === 'idle') return '';
        return `dragging ${state}`;
    };

    // Handle mousedown on bar for drag
    const handleBarMouseDown = (e: MouseEvent): void => {
        if (readonly()) return;
        e.preventDefault();
        e.stopPropagation();
        startDrag(e, 'dragging_bar');
    };

    // GPU-accelerated transform for positioning
    const barTransform = (): string => `translate(${x()}px, ${y()}px)`;

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
                    top: '0',
                    left: '0',
                    width: '100%',
                    height: '100%',
                    'border-radius': `${cornerRadius()}px`,
                    'background-color': isDragging() ? '#2c3e50' : barColor(),
                    'box-sizing': 'border-box',
                    transition: isDragging() ? 'none' : 'background-color 0.1s ease',
                }}
            />

            {/* Progress bar */}
            <div
                class="bar-progress"
                style={{
                    position: 'absolute',
                    top: '0',
                    left: '0',
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

            {/* Child count indicator */}
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
                    display: (task()?._children?.length ?? 0) > 0 ? 'block' : 'none',
                }}
            >
                ({task()?._children?.length ?? 0})
            </div>
        </div>
    );
}

export default SummaryBar;
