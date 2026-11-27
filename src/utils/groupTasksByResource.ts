/**
 * Bucket a task map by resource id — the single grouping used by both
 * virtualization paths (`useTaskVirtualization` and `TaskLayerMinimal`).
 *
 * The caller tracks the task store's content revision. Keep the store reads
 * untracked here so live geometry edits do not rebuild the grouping.
 */
import { untrack } from 'solid-js';
import type { ProcessedTask } from '../types';

/** Structural face of `TaskStore['tasks']` — a task map keyed by id. */
export interface TaskMapLike {
    [id: string]: ProcessedTask | undefined;
}

/**
 * @param tasks the task map (usually a store proxy)
 * @returns resource id -> visible tasks, in task key order; hidden and missing
 *          tasks are dropped, and a task with no `resource` lands under
 *          `'Unassigned'`
 */
export function groupTasksByResource(
    tasks: TaskMapLike,
): Map<string, ProcessedTask[]> {
    const grouped = new Map<string, ProcessedTask[]>();
    untrack(() => {
        for (const taskId of Object.keys(tasks)) {
            const task = tasks[taskId];
            if (!task || task._isHidden) continue;

            const resource = task.resource || 'Unassigned';
            let bucket = grouped.get(resource);
            if (bucket === undefined) {
                bucket = [];
                grouped.set(resource, bucket);
            }
            bucket.push(task);
        }
    });
    return grouped;
}
