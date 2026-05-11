/**
 * Translate DB rows ↔ chart-side `GanttTask` shape, and back.
 *
 * The chart's contract embeds dependencies inline on each task; the DB
 * stores them in a separate table. The bootstrap path SELECTs everything
 * once and joins in memory (cheap — even at 10k tasks the bootstrap is
 * one-time per page load).
 *
 * The adapter is the only file in the server tree that knows about the
 * chart's `GanttTask` field names. Routes call into it; the demo only
 * sees its return shape.
 */
import { eq } from 'drizzle-orm';
import type { DB } from './client';
import {
    blockedTime,
    dependencies as depsTable,
    resources as resourcesTable,
    tasks as tasksTable,
    type BlockedTimeRow,
    type DependencyRow,
    type ResourceRow,
    type TaskInsert,
    type TaskRow,
} from './schema';

/** API shape: a task row joined with its incoming dependency edges. */
export interface GanttTaskApi {
    id: string;
    name: string;
    start: string;
    end: string;
    progress: number;
    resource?: string;
    parentId?: string;
    type?: string;
    color?: string;
    colorProgress?: string;
    baselineStart?: string;
    baselineEnd?: string;
    constraints?: Record<string, unknown>;
    /** [{id: predecessorId, type, lag, max?}] — chart's expected shape. */
    dependencies?: Array<{
        id: string;
        type: string;
        lag: number;
        max?: number;
    }>;
}

export interface ResourceApi {
    id: string;
    name: string;
    group?: string;
    order?: number;
}

export interface BlockedSlotApi {
    id: number;
    resource: string;
    start: string;
    end: string;
    reason?: string;
}

export interface BootstrapBundle {
    tasks: GanttTaskApi[];
    resources: ResourceApi[];
    blockedTime: BlockedSlotApi[];
}

function rowToTask(
    row: TaskRow,
    deps: DependencyRow[] | undefined,
): GanttTaskApi {
    const out: GanttTaskApi = {
        id: row.id,
        name: row.name,
        start: row.start,
        end: row.end,
        progress: row.progress,
    };
    if (row.resourceId) out.resource = row.resourceId;
    if (row.parentId) out.parentId = row.parentId;
    if (row.type) out.type = row.type;
    if (row.color) out.color = row.color;
    if (row.colorProgress) out.colorProgress = row.colorProgress;
    if (row.baselineStart) out.baselineStart = row.baselineStart;
    if (row.baselineEnd) out.baselineEnd = row.baselineEnd;
    if (row.constraints) {
        try {
            out.constraints = JSON.parse(row.constraints);
        } catch {
            // Bad JSON in storage → drop the field rather than crash the
            // whole bootstrap. Worth surfacing in logs in a real app.
        }
    }
    if (deps && deps.length > 0) {
        out.dependencies = deps.map((d) => ({
            id: d.fromTaskId,
            type: d.type,
            lag: d.lag,
            ...(d.maxGap !== null ? { max: d.maxGap } : {}),
        }));
    }
    return out;
}

function rowToResource(row: ResourceRow): ResourceApi {
    const out: ResourceApi = { id: row.id, name: row.name };
    if (row.groupName) out.group = row.groupName;
    out.order = row.sortOrder;
    return out;
}

function rowToBlocked(row: BlockedTimeRow): BlockedSlotApi {
    const out: BlockedSlotApi = {
        id: row.id,
        resource: row.resourceId,
        start: row.start,
        end: row.end,
    };
    if (row.reason) out.reason = row.reason;
    return out;
}

/**
 * Fetch every entity needed to render the chart in one shot. Used by
 * `GET /api/bootstrap`.
 */
export function loadBootstrap(db: DB): BootstrapBundle {
    const taskRows = db.select().from(tasksTable).all();
    const resourceRows = db.select().from(resourcesTable).all();
    const depRows = db.select().from(depsTable).all();
    const blockedRows = db.select().from(blockedTime).all();

    // Group dependencies by their successor (to_task_id) so we can attach
    // each task's incoming edges as the chart expects.
    const depsBySuccessor = new Map<string, DependencyRow[]>();
    for (const d of depRows) {
        const arr = depsBySuccessor.get(d.toTaskId);
        if (arr) arr.push(d);
        else depsBySuccessor.set(d.toTaskId, [d]);
    }

    return {
        tasks: taskRows.map((r) => rowToTask(r, depsBySuccessor.get(r.id))),
        resources: resourceRows.map(rowToResource),
        blockedTime: blockedRows.map(rowToBlocked),
    };
}

/** Allowlist of fields a PATCH /api/tasks/:id can touch. */
const PATCHABLE_KEYS = new Set([
    'name',
    'start',
    'end',
    'progress',
    'color',
    'colorProgress',
    'resource',
    'baselineStart',
    'baselineEnd',
    'constraints',
]);

export class PatchValidationError extends Error {
    readonly status = 400;
}

export class TaskNotFoundError extends Error {
    readonly status = 404;
}

/**
 * Apply a partial update to a task and return the new chart-shape row.
 * Throws PatchValidationError on disallowed keys, TaskNotFoundError if
 * no row matches.
 */
export function patchTask(
    db: DB,
    id: string,
    patch: Record<string, unknown>,
): GanttTaskApi {
    const update: Partial<TaskInsert> = {};
    for (const [key, value] of Object.entries(patch)) {
        if (!PATCHABLE_KEYS.has(key)) {
            throw new PatchValidationError(`Field '${key}' is not patchable`);
        }
        if (key === 'resource') {
            update.resourceId = value === null ? null : String(value);
        } else if (key === 'colorProgress') {
            update.colorProgress = value === null ? null : String(value);
        } else if (key === 'baselineStart') {
            update.baselineStart = value === null ? null : String(value);
        } else if (key === 'baselineEnd') {
            update.baselineEnd = value === null ? null : String(value);
        } else if (key === 'constraints') {
            update.constraints = value === null ? null : JSON.stringify(value);
        } else if (key === 'progress') {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0 || n > 100) {
                throw new PatchValidationError(
                    `progress must be a number 0..100 (got ${value})`,
                );
            }
            update.progress = Math.round(n);
        } else {
            (update as Record<string, unknown>)[key] = value;
        }
    }
    update.updatedAt = new Date().toISOString();

    const result = db
        .update(tasksTable)
        .set(update)
        .where(eq(tasksTable.id, id))
        .run();
    if (result.changes === 0) {
        throw new TaskNotFoundError(`No task with id '${id}'`);
    }

    const row = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id))
        .all()[0];
    if (!row) {
        // Should be unreachable — we just confirmed changes>0 above —
        // but make TS happy and fail loudly if something goes sideways.
        throw new TaskNotFoundError(`Task '${id}' vanished after update`);
    }
    const deps = db
        .select()
        .from(depsTable)
        .where(eq(depsTable.toTaskId, id))
        .all();
    return rowToTask(row, deps);
}
