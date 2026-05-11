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
    type DependencyInsert,
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

// ──────────────────────────────────────────────────────────────────────
// Create / delete + dependency replacement
// ──────────────────────────────────────────────────────────────────────

/** Shape accepted by `createTask`. */
export interface CreateTaskInput {
    id: string;
    name: string;
    start: string;
    end: string;
    progress?: number;
    resource?: string | null;
    color?: string | null;
    colorProgress?: string | null;
    type?: string | null;
    constraints?: Record<string, unknown> | null;
    /** Optional inline deps; equivalent to calling replaceDependencies after create. */
    dependencies?: Array<{
        id: string; // predecessor
        type?: string;
        lag?: number;
        max?: number | null;
    }>;
}

export class DuplicateTaskError extends Error {
    readonly status = 409;
}

/** Insert a new task, optionally with inline dependencies. Returns the chart-shape row. */
export function createTask(db: DB, input: CreateTaskInput): GanttTaskApi {
    if (!input.id || !input.name || !input.start || !input.end) {
        throw new PatchValidationError(
            'id, name, start, end are required to create a task',
        );
    }
    const existing = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, input.id))
        .all();
    if (existing.length > 0) {
        throw new DuplicateTaskError(`task '${input.id}' already exists`);
    }

    const row: TaskInsert = {
        id: input.id,
        name: input.name,
        start: input.start,
        end: input.end,
        progress: Math.max(
            0,
            Math.min(100, Math.round(Number(input.progress ?? 0))),
        ),
        resourceId: input.resource ?? null,
        color: input.color ?? null,
        colorProgress: input.colorProgress ?? null,
        type: input.type ?? null,
        constraints: input.constraints
            ? JSON.stringify(input.constraints)
            : null,
        updatedAt: new Date().toISOString(),
    };
    db.insert(tasksTable).values(row).run();

    if (input.dependencies && input.dependencies.length > 0) {
        replaceDependencies(db, input.id, input.dependencies);
    }

    const reread = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, input.id))
        .all()[0];
    if (!reread) throw new TaskNotFoundError(input.id);
    const deps = db
        .select()
        .from(depsTable)
        .where(eq(depsTable.toTaskId, input.id))
        .all();
    return rowToTask(reread, deps);
}

/** Delete a task. FK cascade removes any dependencies it participates in. */
export function deleteTask(db: DB, id: string): void {
    const result = db.delete(tasksTable).where(eq(tasksTable.id, id)).run();
    if (result.changes === 0) {
        throw new TaskNotFoundError(`No task with id '${id}'`);
    }
}

/**
 * Replace ALL incoming dependencies for a task. Cleanest form-based UX:
 * the form sends the full list and the server reconciles.
 *
 * Validates that each predecessor id refers to an existing task and that
 * the predecessor is not the same task (no self-deps). Silently ignores
 * duplicate (predecessor, type) pairs.
 */
export function replaceDependencies(
    db: DB,
    taskId: string,
    deps: Array<{
        id: string;
        type?: string;
        lag?: number;
        max?: number | null;
    }>,
): GanttTaskApi {
    const successor = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .all()[0];
    if (!successor) throw new TaskNotFoundError(`No task with id '${taskId}'`);

    // Validate predecessors all exist and aren't self.
    const seen = new Set<string>();
    const sanitized: DependencyInsert[] = [];
    for (const d of deps) {
        if (!d.id) {
            throw new PatchValidationError('dependency missing predecessor id');
        }
        if (d.id === taskId) {
            throw new PatchValidationError(
                `task '${taskId}' cannot depend on itself`,
            );
        }
        const key = `${d.id}::${d.type ?? 'FS'}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const predExists =
            db
                .select({ id: tasksTable.id })
                .from(tasksTable)
                .where(eq(tasksTable.id, d.id))
                .all().length > 0;
        if (!predExists) {
            throw new PatchValidationError(
                `predecessor '${d.id}' does not exist`,
            );
        }

        sanitized.push({
            fromTaskId: d.id,
            toTaskId: taskId,
            type: d.type ?? 'FS',
            lag: d.lag ?? 0,
            maxGap: d.max ?? null,
        });
    }

    db.delete(depsTable).where(eq(depsTable.toTaskId, taskId)).run();
    if (sanitized.length > 0) {
        db.insert(depsTable).values(sanitized).run();
    }

    const reread = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .all()[0]!;
    const reloaded = db
        .select()
        .from(depsTable)
        .where(eq(depsTable.toTaskId, taskId))
        .all();
    return rowToTask(reread, reloaded);
}

// ──────────────────────────────────────────────────────────────────────
// Resources CRUD
// ──────────────────────────────────────────────────────────────────────

export interface CreateResourceInput {
    id: string;
    name: string;
    group?: string | null;
    order?: number;
}

export class DuplicateResourceError extends Error {
    readonly status = 409;
}

export class ResourceNotFoundError extends Error {
    readonly status = 404;
}

export function createResource(
    db: DB,
    input: CreateResourceInput,
): ResourceApi {
    if (!input.id || !input.name) {
        throw new PatchValidationError('id and name are required');
    }
    const existing = db
        .select()
        .from(resourcesTable)
        .where(eq(resourcesTable.id, input.id))
        .all();
    if (existing.length > 0) {
        throw new DuplicateResourceError(
            `resource '${input.id}' already exists`,
        );
    }
    db.insert(resourcesTable)
        .values({
            id: input.id,
            name: input.name,
            groupName: input.group ?? null,
            sortOrder: input.order ?? 0,
        })
        .run();
    const row = db
        .select()
        .from(resourcesTable)
        .where(eq(resourcesTable.id, input.id))
        .all()[0]!;
    return rowToResource(row);
}

export function deleteResource(db: DB, id: string): void {
    const result = db
        .delete(resourcesTable)
        .where(eq(resourcesTable.id, id))
        .run();
    if (result.changes === 0) {
        throw new ResourceNotFoundError(`No resource with id '${id}'`);
    }
}

// ──────────────────────────────────────────────────────────────────────
// Blocked-time CRUD
// ──────────────────────────────────────────────────────────────────────

export interface CreateBlockedInput {
    resource: string;
    start: string;
    end: string;
    reason?: string | null;
}

export class BlockedNotFoundError extends Error {
    readonly status = 404;
}

export function createBlocked(
    db: DB,
    input: CreateBlockedInput,
): BlockedSlotApi {
    if (!input.resource || !input.start || !input.end) {
        throw new PatchValidationError('resource, start, end are required');
    }
    const result = db
        .insert(blockedTime)
        .values({
            resourceId: input.resource,
            start: input.start,
            end: input.end,
            reason: input.reason ?? null,
        })
        .returning()
        .all();
    return rowToBlocked(result[0]!);
}

export function deleteBlocked(db: DB, id: number): void {
    const result = db.delete(blockedTime).where(eq(blockedTime.id, id)).run();
    if (result.changes === 0) {
        throw new BlockedNotFoundError(`No blocked-time with id '${id}'`);
    }
}
