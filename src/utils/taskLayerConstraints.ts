/**
 * Pure helpers for TaskLayer's constraint integration.
 *
 * Each function takes everything it needs as explicit arguments — no
 * SolidJS reactivity, no hidden state. TaskLayer.tsx composes these
 * into bound handlers it passes to <Bar>/<SummaryBar>.
 */
import {
    resolveConstraints,
    collectDependentTasks,
    clampBatchDeltaX,
} from './constraintEngine';
import type { TaskStore } from '../stores/taskStore';
import type {
    Relationship,
    BarPosition,
    GanttTask,
    RelationshipIndex,
} from '../types';

interface BatchOriginal {
    originalX: number;
}

interface ConstrainedResult {
    x: number;
    y: number;
}

interface ConstraintCtx {
    taskStore: TaskStore;
    columnWidth: number;
    relationships: Relationship[];
    relationshipIndex: RelationshipIndex;
}

/** Build the context object resolveConstraints expects. */
function buildContext(ctx: ConstraintCtx) {
    return {
        getBarPosition: ctx.taskStore.getBarPosition?.bind(ctx.taskStore),
        getTask: ctx.taskStore.getTask?.bind(ctx.taskStore),
        relationships: ctx.relationships,
        relationshipIndex: ctx.relationshipIndex,
        pixelsPerHour: ctx.columnWidth, // columnWidth doubles as pixels-per-time-unit
        ganttStartDate: new Date(), // placeholder — pixel-based calcs ignore this
    };
}

/**
 * Resolve a proposed drag position against dependency constraints.
 * Returns null if the move is blocked, otherwise the constrained x/y.
 * Side effect: applies cascade updates to successors.
 */
export function constrainTaskPosition(
    taskId: string,
    newX: number,
    newY: number,
    ctx: ConstraintCtx,
): ConstrainedResult | null {
    const taskBar = ctx.taskStore.getBarPosition?.(taskId);
    const width = taskBar?.width ?? 100;

    const result = resolveConstraints(taskId, newX, width, buildContext(ctx));

    if (result.blocked) return null;

    if (result.cascadeUpdates && result.cascadeUpdates.size > 0) {
        for (const [succId, update] of result.cascadeUpdates) {
            ctx.taskStore.updateBarPosition(
                succId,
                update as Partial<BarPosition>,
            );
        }
    }

    return { x: result.constrainedX, y: newY };
}

/**
 * After a resize ends, push dependent tasks forward if needed.
 * Side effect: applies cascade updates.
 */
export function resolveResizeConstraints(
    taskId: string,
    ctx: ConstraintCtx,
): void {
    const taskBar = ctx.taskStore.getBarPosition?.(taskId);
    if (!taskBar) return;

    const result = resolveConstraints(
        taskId,
        taskBar.x,
        taskBar.width,
        buildContext(ctx),
    );

    if (result.cascadeUpdates) {
        for (const [succId, update] of result.cascadeUpdates) {
            ctx.taskStore.updateBarPosition(
                succId,
                update as Partial<BarPosition>,
            );
        }
    }
}

/** Collect dependent task IDs for a batch drag of `taskId`. */
export function collectDependents(
    taskId: string,
    relationships: Relationship[],
    taskStore: TaskStore,
): Set<string> {
    const getTask =
        taskStore.getTask?.bind(taskStore) ??
        ((_id: string): GanttTask | undefined => undefined);
    return collectDependentTasks(taskId, relationships, getTask);
}

/**
 * Clamp a proposed batch-drag delta so no task crosses its predecessor.
 */
export function clampBatchDelta(
    batchOriginals: Map<string, BatchOriginal>,
    proposedDeltaX: number,
    relationships: Relationship[],
    taskStore: TaskStore,
    columnWidth: number,
): number {
    const getTask =
        taskStore.getTask?.bind(taskStore) ??
        ((_id: string): GanttTask | undefined => undefined);
    return clampBatchDeltaX(
        batchOriginals,
        proposedDeltaX,
        relationships,
        getTask,
        {
            pixelsPerTimeUnit: columnWidth,
        },
    );
}
