import { For, createMemo, Accessor } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { Bar } from './Bar';
import { SummaryBar } from './SummaryBar';
import { ExpandedTaskContainer } from './ExpandedTaskContainer';
import { DEFAULT_COLUMN_WIDTH } from '../constants';
import { buildRelationshipIndex } from '../utils/constraintEngine';
import { collectDescendants } from '../utils/hierarchyProcessor';
import {
    constrainTaskPosition,
    resolveResizeConstraints,
    collectDependents,
    clampBatchDelta,
} from '../utils/taskLayerConstraints';
import { useTaskVirtualization } from '../hooks/useTaskVirtualization';
import { useBoxSelect } from '../hooks/useBoxSelect';
import type { DragGeometry } from '../hooks/useBarDrag';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { ResourceStore } from '../stores/resourceStore';
import type { SelectionStore } from '../stores/selectionStore';
import type { ProcessedTask, Relationship } from '../types';
import type { RowLayout } from '../utils/rowLayoutCalculator';

interface BatchOriginal {
    originalX: number;
}

interface ConstrainedResult {
    x: number;
    y: number;
}

interface TaskLayerProps {
    taskStore?: TaskStore;
    ganttConfig?: GanttConfigStore;
    resourceStore?: ResourceStore;
    selectionStore?: SelectionStore;
    tasks?: ProcessedTask[];
    relationships?: Relationship[];
    rowLayouts?: Map<string, RowLayout>;
    /** Task IDs on the critical path (renders bars with a critical class). */
    criticalSet?: Set<string>;
    /** Whether a search query is currently applied. */
    searchActive?: boolean;
    /** Task IDs that match the active search query. Bars NOT in this set get dimmed. */
    searchMatches?: Set<string>;
    startRow?: number;
    endRow?: number;
    startX?: number;
    endX?: number;
    onDateChange?: (
        taskId: string,
        position: { x: number; width: number },
    ) => void;
    onProgressChange?: (taskId: string, progress: number) => void;
    /**
     * `geometry` is the rect the gesture wrote, forwarded as data so a
     * consumer never has to read a still-staged store write back.
     */
    onResizeEnd?: (taskId: string, geometry?: DragGeometry) => void;
    onHover?: (taskId: string, clientX: number, clientY: number) => void;
    onHoverEnd?: () => void;
    /**
     * Fired on a bar click, after the click's selection intent has been
     * applied.
     *
     * `selection` is the selection this click PRODUCED, computed locally and
     * handed over rather than read back out of the store — a consumer that
     * called `selectionStore.selectedIds()` from here would observe the
     * PRE-click selection once writes are deferred (digest chain E). It is
     * `undefined` only when no `selectionStore` is wired, in which case the
     * click changed no selection at all.
     */
    onTaskClick?: (
        taskId: string,
        event: MouseEvent,
        selection?: ReadonlySet<string>,
    ) => void;
}

/**
 * TaskLayer - Container for all task bars.
 * Maps tasks to Bar components and handles constraint resolution.
 */
export function TaskLayer(props: TaskLayerProps): JSX.Element {
    // Relationships for constraint resolution
    const relationships = (): Relationship[] => props.relationships || [];

    // Pre-build relationship index for O(1) lookups (rebuilds when relationships change)
    const relationshipIndex = createMemo(() =>
        buildRelationshipIndex(relationships()),
    );

    // Build the constraint context once per call. Cheap; values are accessors.
    const buildCtx = (taskId: string) => {
        const store = props.taskStore;
        if (!store) return null;
        return {
            taskStore: store,
            columnWidth:
                props.ganttConfig?.columnWidth?.() ?? DEFAULT_COLUMN_WIDTH,
            relationships: relationships(),
            relationshipIndex: relationshipIndex(),
            taskId,
        };
    };

    const handleConstrainPosition = (
        taskId: string,
        newX: number,
        newY: number,
    ): ConstrainedResult | null => {
        const ctx = buildCtx(taskId);
        if (!ctx) return { x: newX, y: newY };
        return constrainTaskPosition(taskId, newX, newY, ctx);
    };

    const handleResizeEnd = (taskId: string, geometry?: DragGeometry): void => {
        const ctx = buildCtx(taskId);
        if (ctx) resolveResizeConstraints(taskId, ctx, geometry);
        props.onResizeEnd?.(taskId, geometry);
    };

    /**
     * Summary bars report a MOVE through the same consumer callback, but
     * must not go through `resolveResizeConstraints`. They did call it
     * before, and it was dead: the proposal came from the same store read
     * the engine compared it against, so the cascade was always empty. Now
     * that the geometry arrives as data that early-out is gone, and routing
     * summaries through it would newly push their successors — a behaviour
     * change this refactor has no business making.
     */
    const handleSummaryDragEnd = (
        taskId: string,
        geometry?: DragGeometry,
    ): void => {
        props.onResizeEnd?.(taskId, geometry);
    };

    const handleCollectDependents = (taskId: string): Set<string> => {
        if (!props.taskStore) return new Set();
        const sel = props.selectionStore;
        // Multi-select: when the dragged task is part of the selection,
        // include every selected task's transitive dependents so the
        // batch drag preserves relative offsets across the whole set.
        if (sel && sel.isSelected(taskId) && sel.selectionCount() > 1) {
            const union = new Set<string>();
            for (const id of sel.selectedIds()) {
                for (const depId of collectDependents(
                    id,
                    relationships(),
                    props.taskStore,
                )) {
                    union.add(depId);
                }
            }
            return union;
        }
        return collectDependents(taskId, relationships(), props.taskStore);
    };

    // Click intent: shift extends the selection, ctrl/meta toggles, plain
    // click replaces it with just this task. Bar passes the raw event so
    // we can read modifiers without re-binding handlers.
    //
    // Each branch derives the RESULTING selection as a local Set from the
    // selection read once up front, applies exactly the one store mutator it
    // always applied, and reports that local to the consumer. The store keeps
    // its functional updaters (verified safe — they compose against staged
    // state), and nothing here reads the selection back after writing it, so
    // the consumer contract survives deferred writes unchanged.
    const handleTaskClickWithSelection = (
        taskId: string,
        event: MouseEvent,
    ): void => {
        const sel = props.selectionStore;
        let resulting: Set<string> | undefined;
        if (sel) {
            const current = sel.selectedIds();
            if (event.shiftKey) {
                resulting = new Set(current);
                resulting.add(taskId);
                sel.add(taskId);
            } else if (event.ctrlKey || event.metaKey) {
                resulting = new Set(current);
                if (resulting.has(taskId)) {
                    resulting.delete(taskId);
                } else {
                    resulting.add(taskId);
                }
                sel.toggle(taskId);
            } else {
                resulting = new Set([taskId]);
                sel.replace([taskId]);
            }
        }
        props.onTaskClick?.(taskId, event, resulting);
    };

    const handleClampBatchDelta = (
        batchOriginals: Map<string, BatchOriginal>,
        proposedDeltaX: number,
    ): number => {
        if (!props.taskStore) return proposedDeltaX;
        const columnWidth =
            props.ganttConfig?.columnWidth?.() ?? DEFAULT_COLUMN_WIDTH;
        return clampBatchDelta(
            batchOriginals,
            proposedDeltaX,
            relationships(),
            props.taskStore,
            columnWidth,
        );
    };

    // Pure callback-bridges to props. Block bodies on purpose: these cross
    // the component boundary into consumer code, and a callback that leaks
    // a return value is rejected wherever the caller validates cleanups.
    const handleDateChange = (
        taskId: string,
        position: { x: number; width: number },
    ): void => {
        props.onDateChange?.(taskId, position);
    };
    const handleProgressChange = (taskId: string, progress: number): void => {
        props.onProgressChange?.(taskId, progress);
    };
    const handleHover = (
        taskId: string,
        clientX: number,
        clientY: number,
    ): void => {
        props.onHover?.(taskId, clientX, clientY);
    };
    const handleHoverEnd = (): void => {
        props.onHoverEnd?.();
    };
    const handleTaskClick = (taskId: string, event: MouseEvent): void => {
        handleTaskClickWithSelection(taskId, event);
    };

    const handleCollectDescendants = (taskId: string): Set<string> => {
        if (!props.taskStore) return new Set();
        return collectDescendants(taskId, props.taskStore.tasks);
    };

    // Virtualization: tasks-by-resource grouping, viewport filtering,
    // pooled <Index> arrays, per-task position lookup.
    const {
        splitTaskIds,
        pooledRegularTasks,
        pooledSummaryIds,
        getTaskPosition,
    } = useTaskVirtualization(props);

    // Box-select: pointer-down on empty grid space draws a translucent
    // rect; on release, intersected bars become the selection (replace,
    // or extend when shift/ctrl held).
    let layerRef: HTMLDivElement | undefined;
    const boxSelect = useBoxSelect({
        taskStore: props.taskStore,
        selectionStore: props.selectionStore,
        getLayerEl: () => layerRef,
    });

    return (
        <div
            ref={layerRef}
            class="task-layer"
            onMouseDown={boxSelect.handleMouseDown}
            style={{
                contain: 'layout style',
                position: 'relative',
                width: '100%',
                height: '100%',
                'pointer-events': 'auto',
            }}
        >
            {/* Summary bars render BEHIND everything */}
            <div class="summary-layer" style={{ contain: 'layout style' }}>
                <For keyed={false} each={pooledSummaryIds()}>
                    {(taskId: Accessor<string | undefined>) => (
                        <div style={{ display: taskId() ? 'block' : 'none' }}>
                            <SummaryBar
                                taskId={taskId as Accessor<string>}
                                taskStore={props.taskStore}
                                ganttConfig={props.ganttConfig}
                                onCollectDescendants={handleCollectDescendants}
                                onClampBatchDelta={handleClampBatchDelta}
                                onDragEnd={handleSummaryDragEnd}
                            />
                        </div>
                    )}
                </For>
            </div>

            {/* Expanded task containers (parent + subtasks) */}
            <div class="expanded-layer" style={{ contain: 'layout style' }}>
                <For each={splitTaskIds().expandedIds}>
                    {(taskId) => (
                        <ExpandedTaskContainer
                            taskId={taskId}
                            taskStore={props.taskStore}
                            ganttConfig={props.ganttConfig}
                            rowLayout={getTaskPosition(taskId) ?? undefined}
                        />
                    )}
                </For>
            </div>

            {/* Regular task bars render ON TOP */}
            <div class="task-bars-layer" style={{ contain: 'layout style' }}>
                <For keyed={false} each={pooledRegularTasks()}>
                    {(task: Accessor<ProcessedTask | undefined>) => (
                        <div
                            style={{
                                display: task() ? 'block' : 'none',
                                'pointer-events': 'auto',
                            }}
                        >
                            <Bar
                                task={task as Accessor<ProcessedTask>}
                                taskStore={props.taskStore}
                                ganttConfig={props.ganttConfig}
                                isCritical={
                                    !!task() &&
                                    !!props.criticalSet?.has(task()!.id)
                                }
                                isDimmed={
                                    !!props.searchActive &&
                                    !!task() &&
                                    !props.searchMatches?.has(task()!.id)
                                }
                                isSelected={
                                    !!task() &&
                                    !!props.selectionStore?.isSelected(
                                        task()!.id,
                                    )
                                }
                                onConstrainPosition={handleConstrainPosition}
                                onCollectDependents={handleCollectDependents}
                                onCollectDescendants={handleCollectDescendants}
                                onClampBatchDelta={handleClampBatchDelta}
                                onDateChange={handleDateChange}
                                onProgressChange={handleProgressChange}
                                onResizeEnd={handleResizeEnd}
                                onHover={handleHover}
                                onHoverEnd={handleHoverEnd}
                                onTaskClick={handleTaskClick}
                            />
                        </div>
                    )}
                </For>
            </div>

            {/* Box-select overlay (only rendered while dragging the box) */}
            {boxSelect.overlay().visible && (
                <div
                    class="box-select-overlay"
                    style={{
                        position: 'absolute',
                        left: `${boxSelect.overlay().x}px`,
                        top: `${boxSelect.overlay().y}px`,
                        width: `${boxSelect.overlay().width}px`,
                        height: `${boxSelect.overlay().height}px`,
                        'background-color':
                            'var(--g-selection-fill, rgba(99, 102, 241, 0.12))',
                        border: '1px solid var(--g-selection-color, #6366f1)',
                        'pointer-events': 'none',
                        'z-index': 10,
                    }}
                />
            )}
        </div>
    );
}

export default TaskLayer;
