/**
 * Bar drag/resize/progress interaction logic.
 *
 * Encapsulates the four drag states (`dragging_bar`, `dragging_left`,
 * `dragging_right`, `dragging_progress`) and the per-state move handlers
 * that live on top of useDrag. Extracted from Bar.tsx so the component
 * file can stay focused on rendering + thin event-handler bridges.
 *
 * The hook receives the reactive accessors it needs (no Solid signal
 * creation here), reads them inside the drag callbacks, and returns the
 * useDrag bag plus a didDrag tracker for distinguishing click-vs-drag.
 */
import { useDrag, clamp } from './useDrag';
import { snapToGrid } from '../utils/barCalculations';
import type { TaskStore } from '../stores/taskStore';

interface BatchOriginal {
    originalX: number;
}

interface ConstrainedResult {
    x?: number;
}

export interface BarDragHandlers {
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
}

export interface UseBarDragDeps {
    taskStore?: TaskStore;
    handlers: BarDragHandlers;
    /** Identifying info + current progress for the bar. */
    taskInfo: () => { id: string; progress: number };
    /** Current bar geometry. */
    x: () => number;
    y: () => number;
    width: () => number;
    columnWidth: () => number;
    ignoredPositions: () => number[];
    minWidth: () => number;
}

export function useBarDrag(deps: UseBarDragDeps) {
    // Track whether a drag occurred during this gesture — used to
    // distinguish a click from a drag-then-release in handleClick.
    // Kept as a non-reactive var to avoid 60fps signal updates.
    let didDragFlag = false;

    const drag = useDrag({
        onDragStart: (data, state) => {
            didDragFlag = false;

            const t = deps.taskInfo();
            data['originalX'] = deps.x();
            data['originalY'] = deps.y();
            data['originalWidth'] = deps.width();
            data['originalProgress'] = t.progress;

            // Defer expensive recalculations while a drag is in progress
            deps.taskStore?.setDraggingTaskId?.(t.id);

            if (state === 'dragging_bar') {
                // Pre-collect dependents + descendants so we can batch their
                // moves on every drag tick instead of resolving constraints
                // per task each frame.
                const tasksToMove = new Set<string>();

                if (deps.handlers.onCollectDependents) {
                    for (const id of deps.handlers.onCollectDependents(t.id)) {
                        tasksToMove.add(id);
                    }
                }
                if (deps.handlers.onCollectDescendants) {
                    for (const id of deps.handlers.onCollectDescendants(t.id)) {
                        tasksToMove.add(id);
                    }
                }

                const dependentOriginals = new Map<string, BatchOriginal>();
                for (const id of tasksToMove) {
                    const pos = deps.taskStore?.getBarPosition(id);
                    if (pos) {
                        dependentOriginals.set(id, { originalX: pos.x });
                    }
                }
                data['dependentOriginals'] = dependentOriginals;
            }
        },

        onDragMove: (move, data, state) => {
            const t = deps.taskInfo();
            if (!deps.taskStore || !t.id) return;

            // Only count this as a drag (suppressing the subsequent click)
            // if the pointer moved past a small threshold. Without this,
            // playwright's force-click + any sub-pixel jitter trips the
            // drag flag and modifier clicks (shift/ctrl) lose their click
            // event.
            if (Math.abs(move.deltaX) > 3 || Math.abs(move.deltaY) > 3) {
                didDragFlag = true;
            } else {
                return;
            }

            const colWidth = deps.columnWidth();
            const ignored = deps.ignoredPositions();

            if (state === 'dragging_bar') {
                const originalX = data['originalX'] as number;
                let newX = snapToGrid(
                    originalX + move.deltaX,
                    colWidth,
                    ignored,
                );
                let deltaX = newX - originalX;

                const dependentOriginals = data['dependentOriginals'] as
                    | Map<string, BatchOriginal>
                    | undefined;

                if (
                    dependentOriginals &&
                    dependentOriginals.size > 0 &&
                    deps.taskStore.batchMovePositions
                ) {
                    // Clamp backward moves to prevent constraint violations
                    if (deps.handlers.onClampBatchDelta && deltaX < 0) {
                        deltaX = deps.handlers.onClampBatchDelta(
                            dependentOriginals,
                            deltaX,
                        );
                    }
                    deps.taskStore.batchMovePositions(
                        dependentOriginals,
                        deltaX,
                    );
                } else {
                    // Fallback: per-task constraint resolution
                    if (deps.handlers.onConstrainPosition) {
                        const constrained = deps.handlers.onConstrainPosition(
                            t.id,
                            newX,
                            deps.y(),
                        );
                        if (constrained === null) return;
                        newX = constrained.x ?? newX;
                    }
                    deps.taskStore.updateBarPosition(t.id, { x: newX });
                }
            } else if (state === 'dragging_left') {
                const originalX = data['originalX'] as number;
                const originalWidth = data['originalWidth'] as number;
                const snappedDelta =
                    Math.round(move.deltaX / colWidth) * colWidth;

                let newX = originalX + snappedDelta;
                let newWidth = originalWidth - snappedDelta;

                if (newWidth < deps.minWidth()) {
                    newWidth = deps.minWidth();
                    newX = originalX + originalWidth - deps.minWidth();
                }

                newX = snapToGrid(newX, colWidth, ignored);

                // Constraints: prevent moving start before predecessor's end
                if (deps.handlers.onConstrainPosition) {
                    const constrained = deps.handlers.onConstrainPosition(
                        t.id,
                        newX,
                        deps.y(),
                    );
                    if (constrained === null) return;
                    if (constrained.x !== undefined && constrained.x > newX) {
                        newWidth = newWidth - (constrained.x - newX);
                        newX = constrained.x;
                    }
                }

                deps.taskStore.updateBarPosition(t.id, {
                    x: newX,
                    width: newWidth,
                });
            } else if (state === 'dragging_right') {
                const originalWidth = data['originalWidth'] as number;
                const snappedDelta =
                    Math.round(move.deltaX / colWidth) * colWidth;
                const newWidth = Math.max(
                    deps.minWidth(),
                    originalWidth + snappedDelta,
                );
                deps.taskStore.updateBarPosition(t.id, { width: newWidth });
            } else if (state === 'dragging_progress') {
                const barX = deps.x();
                const barWidth = deps.width();
                const ignoredPos = deps.ignoredPositions();
                const colW = deps.columnWidth();
                const startSvgX = data['startSvgX'] as number;

                const newProgressX = clamp(
                    startSvgX + move.deltaX,
                    barX,
                    barX + barWidth,
                );

                // Account for ignored dates in progress %
                const totalIgnoredInBar = ignoredPos.reduce(
                    (acc, pos) =>
                        acc + (pos >= barX && pos < barX + barWidth ? 1 : 0),
                    0,
                );
                const effectiveWidth = barWidth - totalIgnoredInBar * colW;

                const progressOffset = newProgressX - barX;
                const ignoredInProgress = ignoredPos.reduce(
                    (acc, pos) =>
                        acc + (pos >= barX && pos < newProgressX ? 1 : 0),
                    0,
                );
                const effectiveProgress =
                    progressOffset - ignoredInProgress * colW;

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

                deps.taskStore.setTaskProgress(t.id, newProgress);
            }
        },

        onDragEnd: (_move, _data, state) => {
            const t = deps.taskInfo();
            // Allow deferred recalculations to resume
            deps.taskStore?.setDraggingTaskId?.(null);

            if (
                state === 'dragging_bar' ||
                state === 'dragging_left' ||
                state === 'dragging_right'
            ) {
                // Read directly from store to avoid reactive timing issues
                const pos = deps.taskStore?.getBarPosition(t.id);
                deps.handlers.onDateChange?.(t.id, {
                    x: pos?.x ?? deps.x(),
                    width: pos?.width ?? deps.width(),
                });

                if (state === 'dragging_left' || state === 'dragging_right') {
                    deps.handlers.onResizeEnd?.(t.id);
                }
            } else if (state === 'dragging_progress') {
                deps.handlers.onProgressChange?.(t.id, t.progress);
            }
        },
    });

    return {
        dragState: drag.dragState,
        isDragging: drag.isDragging,
        startDrag: drag.startDrag,
        /** True if a drag (vs a stationary click) occurred during the latest gesture. */
        didDrag: () => didDragFlag,
        /** Reset the didDrag flag — called from mousedown to start a fresh gesture. */
        resetDidDrag: () => {
            didDragFlag = false;
        },
    };
}
