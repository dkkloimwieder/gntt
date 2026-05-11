/**
 * Seed the on-disk DB from the existing fixture at
 * `src/data/generated/calendar.json`.
 *
 * - Wipes the tables first so re-running gives a clean snapshot.
 * - Inserts inside a single transaction (~200 tasks → milliseconds).
 * - Resources are extracted from `task.resource` strings and seeded as
 *   one row per unique value (matching the chart's auto-extraction).
 * - Adds two illustrative blocked_time rows so the table isn't empty.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    blockedTime as blockedTable,
    dependencies as depsTable,
    resources as resourcesTable,
    tasks as tasksTable,
    type DependencyInsert,
    type ResourceInsert,
    type TaskInsert,
} from './schema';
import { openDb, closeDb } from './client';

interface FixtureTask {
    id: string;
    name: string;
    start: string;
    end: string;
    progress: number;
    color?: string;
    colorProgress?: string;
    color_bg?: string;
    color_fill?: string;
    resource?: string;
    dependencies?: Array<{ id: string; type?: string; lag?: number }>;
}

interface Fixture {
    tasks: FixtureTask[];
}

const dbPath = process.env.GANTT_DB_PATH ?? './data/gantt.db';
const fixturePath = resolve('./src/data/generated/calendar.json');

const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const db = openDb(dbPath);

// Pull the underlying better-sqlite3 connection out of the Drizzle
// wrapper so we can wrap inserts in a single transaction (~10x faster).
// Drizzle's own .transaction is async and overkill for this script.
const raw = (
    db as unknown as {
        $client: { transaction: (fn: () => void) => () => void };
    }
).$client;

raw.transaction(() => {
    db.delete(depsTable).run();
    db.delete(blockedTable).run();
    db.delete(tasksTable).run();
    db.delete(resourcesTable).run();

    // Resources: one row per unique `task.resource` (chart-side default).
    const seenResources = new Set<string>();
    let order = 0;
    const resourceRows: ResourceInsert[] = [];
    for (const t of fixture.tasks) {
        const r = t.resource;
        if (r && !seenResources.has(r)) {
            seenResources.add(r);
            resourceRows.push({
                id: r,
                name: r,
                sortOrder: order++,
            });
        }
    }
    if (resourceRows.length > 0) {
        db.insert(resourcesTable).values(resourceRows).run();
    }

    // Tasks (without dependencies — the dependency table is FK'd to
    // tasks(id) so we must populate tasks first).
    const taskRows: TaskInsert[] = fixture.tasks.map((t) => ({
        id: t.id,
        name: t.name,
        start: t.start,
        end: t.end,
        progress: t.progress ?? 0,
        resourceId: t.resource ?? null,
        color: t.color ?? null,
        colorProgress: t.colorProgress ?? null,
        updatedAt: new Date().toISOString(),
    }));
    db.insert(tasksTable).values(taskRows).run();

    // Dependencies — chart shape `{id: predecessor, type, lag}` → DB
    // shape `{from_task_id, to_task_id, type, lag}`. The fixture's
    // `task.dependencies` lists predecessors, so `from_task_id = dep.id`
    // and `to_task_id = task.id`.
    const depRows: DependencyInsert[] = [];
    const taskIds = new Set(fixture.tasks.map((t) => t.id));
    for (const t of fixture.tasks) {
        if (!t.dependencies) continue;
        for (const d of t.dependencies) {
            if (!taskIds.has(d.id)) continue; // skip dangling refs
            depRows.push({
                fromTaskId: d.id,
                toTaskId: t.id,
                type: d.type ?? 'FS',
                lag: d.lag ?? 0,
            });
        }
    }
    if (depRows.length > 0) {
        // Bulk insert the dependencies in chunks of 500 to dodge
        // SQLite's 999-parameter limit (each row binds 5+ params).
        const CHUNK = 500;
        for (let i = 0; i < depRows.length; i += CHUNK) {
            db.insert(depsTable)
                .values(depRows.slice(i, i + CHUNK))
                .run();
        }
    }

    // Two illustrative blocked-time rows on whichever resources exist.
    const firstTwo = Array.from(seenResources).slice(0, 2);
    if (firstTwo.length > 0) {
        db.insert(blockedTable)
            .values(
                firstTwo.map((rid, i) => ({
                    resourceId: rid,
                    start: i === 0 ? '2025-01-15 08:00' : '2025-01-22 08:00',
                    end: i === 0 ? '2025-01-15 17:00' : '2025-01-23 17:00',
                    reason: i === 0 ? 'Personal day' : 'Team offsite',
                })),
            )
            .run();
    }

    console.log(
        `✓ seeded ${taskRows.length} tasks, ${resourceRows.length} resources, ${depRows.length} dependencies, ${firstTwo.length} blocked slots`,
    );
})();

closeDb();
