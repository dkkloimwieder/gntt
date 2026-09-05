/**
 * Pure helpers for TaskLayer's constraint integration.
 *
 * Each function takes everything it needs as explicit arguments — no
 * SolidJS reactivity, no hidden state. TaskLayer.tsx composes these
 * into bound handlers it passes to <Bar>/<SummaryBar>.
 */
import {
    resolveConstraints,
    resolveResizeCascade,
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
 *
 * `geometry` is the rect the gesture WROTE, handed over as data. Passing it
 * is what makes the cascade real: reading the bar back here would hand the
 * engine a value the resize write has not committed yet (deferred writes),
 * and — even on a synchronous store — would compare the proposal against the
 * read it came from. The store read is kept only as the fallback for callers
 * that have no geometry to offer.
 */
export function resolveResizeConstraints(
    taskId: string,
    ctx: ConstraintCtx,
    geometry?: { x: number; width: number },
): void {
    const bar = geometry ?? ctx.taskStore.getBarPosition?.(taskId);
    if (!bar) return;

    const cascadeUpdates = resolveResizeCascade(
        taskId,
        { x: bar.x, width: bar.width },
        buildContext(ctx),
    );

    for (const [succId, update] of cascadeUpdates) {
        ctx.taskStore.updateBarPosition(succId, update as Partial<BarPosition>);
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
