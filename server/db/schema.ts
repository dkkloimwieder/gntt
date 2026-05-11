/**
 * Drizzle schema for the Gantt demo backend.
 *
 * Design notes:
 * - Dates are stored as ISO strings ("YYYY-MM-DD HH:MM"), matching the
 *   `GanttTask` contract on the frontend. No Date round-tripping at the
 *   API boundary.
 * - `tasks.constraints` is a JSON blob — the `TaskConstraints` shape on
 *   the frontend has many optional fields (locked, minStart, maxEnd, …);
 *   one column keeps the schema flat without forcing schema migrations
 *   when constraint fields evolve.
 * - `dependencies` is a separate table; the chart-side adapter joins
 *   them back onto each task before returning the bootstrap bundle.
 * - `blocked_time` ships as flat metadata only — the constraint engine
 *   does NOT consult it. (See bd memory: bars are absolute time;
 *   working calendars / scheduled unavailability are out of scope.)
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const resources = sqliteTable('resources', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Optional grouping for collapsible swimlanes. */
    groupName: text('group_name'),
    sortOrder: integer('sort_order').notNull().default(0),
});

export const tasks = sqliteTable(
    'tasks',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        /** ISO string. */
        start: text('start').notNull(),
        /** ISO string. */
        end: text('end').notNull(),
        progress: integer('progress').notNull().default(0),
        resourceId: text('resource_id').references(() => resources.id, {
            onDelete: 'set null',
        }),
        /** Self-FK; not enforced cyclically. Null = root. */
        parentId: text('parent_id'),
        /** 'task' | 'milestone' | 'project' | 'summary'. */
        type: text('type'),
        color: text('color'),
        colorProgress: text('color_progress'),
        baselineStart: text('baseline_start'),
        baselineEnd: text('baseline_end'),
        /** JSON blob — `TaskConstraints` on the frontend. */
        constraints: text('constraints'),
        updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
    },
    (t) => ({
        resourceIdx: index('tasks_resource_idx').on(t.resourceId),
        parentIdx: index('tasks_parent_idx').on(t.parentId),
    }),
);

export const dependencies = sqliteTable(
    'dependencies',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        fromTaskId: text('from_task_id')
            .notNull()
            .references(() => tasks.id, { onDelete: 'cascade' }),
        toTaskId: text('to_task_id')
            .notNull()
            .references(() => tasks.id, { onDelete: 'cascade' }),
        /** 'FS' | 'SS' | 'FF' | 'SF'. Default 'FS'. */
        type: text('type').notNull().default('FS'),
        /** Lag in hours. */
        lag: integer('lag').notNull().default(0),
        /** Null = elastic; 0 = fixed; N = bounded gap (hours). */
        maxGap: integer('max_gap'),
    },
    (t) => ({
        fromIdx: index('dependencies_from_idx').on(t.fromTaskId),
        toIdx: index('dependencies_to_idx').on(t.toTaskId),
    }),
);

export const blockedTime = sqliteTable(
    'blocked_time',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        resourceId: text('resource_id')
            .notNull()
            .references(() => resources.id, { onDelete: 'cascade' }),
        /** ISO string. */
        start: text('start').notNull(),
        /** ISO string. */
        end: text('end').notNull(),
        reason: text('reason'),
    },
    (t) => ({
        resourceIdx: index('blocked_time_resource_idx').on(t.resourceId),
    }),
);

export type ResourceRow = typeof resources.$inferSelect;
export type ResourceInsert = typeof resources.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;
export type DependencyRow = typeof dependencies.$inferSelect;
export type DependencyInsert = typeof dependencies.$inferInsert;
export type BlockedTimeRow = typeof blockedTime.$inferSelect;
export type BlockedTimeInsert = typeof blockedTime.$inferInsert;
