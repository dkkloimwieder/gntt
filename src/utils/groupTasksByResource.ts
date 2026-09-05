/**
 * Bucket a task map by resource id — the single grouping used by both
 * virtualization paths (`useTaskVirtualization` and `TaskLayerMinimal`).
 *
 * ## The reactive contract
 *
 * The caller owns the ONE dependency this grouping is allowed to have: it
 * computes `Object.keys(tasks)` in its own tracked scope. On a store proxy
 * that read goes through the `ownKeys` trap, which subscribes the caller to
 * the store's key-set node — a node bumped only when a key is ADDED or
 * REMOVED (`@solidjs/signals` only calls `setSignal` on it when
 * `membershipChanged`). So the grouping memo re-runs on task add/remove and
 * on a same-tick remove+add that leaves the COUNT unchanged, and stays
 * silent through the per-frame `_bar.x` writes a drag emits.
 *
 * Everything this function reads off an individual task — `_isHidden`,
 * `resource` — is a store LEAF, and every one of those reads happens inside
 * the `untrack` below. That is deliberate and load-bearing at 10K tasks: a
 * tracked leaf scan would subscribe the caller to O(N) nodes and rebuild the
 * whole grouping on every drag frame. The `untrack` lives here rather than
 * at the call sites so neither copy can forget it.
 *
 * The accepted consequence: replacing an existing task object under an
 * unchanged key (`updateTask('a', ...)` with a different `resource` or
 * `_isHidden`) does NOT regroup, because membership did not change. Callers
 * that need that must add a task or take a dependency of their own. This
 * matches the pre-2.0 behaviour and is the reason the grouping is cheap.
 */
import { untrack } from 'solid-js';
import type { ProcessedTask } from '../types';

/** Structural face of `TaskStore['tasks']` — a task map keyed by id. */
export interface TaskMapLike {
    [id: string]: ProcessedTask | undefined;
}

/**
 * @param tasks the task map (usually a store proxy)
 * @param keys  the key set the caller read in ITS tracked scope
 * @returns resource id -> visible tasks, in `keys` order; hidden and missing
 *          tasks are dropped, and a task with no `resource` lands under
 *          `'Unassigned'`
 */
export function groupTasksByResource(
    tasks: TaskMapLike,
    keys: string[],
): Map<string, ProcessedTask[]> {
    const grouped = new Map<string, ProcessedTask[]>();
    untrack(() => {
        for (const taskId of keys) {
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
