/**
 * Initialize tasks for a Gantt instance: bound timeline to task dates,
 * sync the config store, run processTasks, build the parent-child
 * hierarchy, recompute summary bounds, apply collapse visibility, then
 * commit to the task store.
 *
 * Extracted from Gantt.tsx so the orchestrator component focuses on
 * wiring stores together — the setup pipeline is a pure function of
 * the rawTasks + stores.
 */
import { untrack } from 'solid-js';
import { processTasks } from './taskProcessor';
import {
    computeDisplayResources,
    computeResourceIndexMap,
    extractResourcesFromTasks,
    normalizeResources,
} from './resourceProcessor';
import {
    buildHierarchy,
    isHiddenByCollapsedAncestor,
} from './hierarchyProcessor';
import { recomputeAllSummaryBounds } from './barCalculations';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { DateWindow, GanttDateStore } from '../stores/ganttDateStore';
import type { ResourceStore } from '../stores/resourceStore';
import type { GanttTask, ProcessedTask, Relationship } from '../types';

export interface GanttSetupStores {
    taskStore: TaskStore;
    ganttConfig: GanttConfigStore;
    dateStore: GanttDateStore;
    resourceStore: ResourceStore;
}

export interface GanttSetupResult {
    relationships: Relationship[];
    legacyResources: string[];
}

/**
 * Initialize tasks and compute positions. Returns the task relationships
 * and any extracted resource names (for backward-compat consumers that
 * pre-date the resourceStore).
 *
 * Empty input clears the stores; non-empty input runs the full pipeline.
 *
 * @param hasExplicitResources - true when the parent passed an explicit
 *   `resources` prop (so we leave the resource store alone). When false,
 *   resources are re-extracted from `rawTasks` on every call so filter/
 *   add/remove changes the resource set (and the row layout) accordingly.
 * @param dateWindow - a window the CALLER already computed (a view-mode
 *   change gets one back from `changeViewMode`). Supplying it skips the
 *   `setupDates` call: re-running it would recompute the same bounds from
 *   the same tasks and re-stage the same writes, and — since writes are
 *   deferred — would do so against a date store that has not yet committed
 *   the caller's mode change.
 */
export function initializeTasks(
    rawTasks: GanttTask[],
    stores: GanttSetupStores,
    useResourceStore = true,
    hasExplicitResources?: boolean,
    dateWindow?: DateWindow,
): GanttSetupResult {
    const { taskStore, ganttConfig, dateStore, resourceStore } = stores;

    if (!rawTasks || rawTasks.length === 0) {
        taskStore.clear();
        dateStore.setupDates([]);
        if (!hasExplicitResources) {
            resourceStore.updateResources([]);
        }
        return { relationships: [], legacyResources: [] };
    }

    // Date window: `setupDates` stages the signal writes and RETURNS the
    // window it computed. Nothing below reads the date store back — writes
    // are deferred until the next flush, so a read-back here would still see
    // the previous window.
    const window = dateWindow ?? dateStore.setupDates(rawTasks);

    // Mirror the window into the config store in one write.
    ganttConfig.updateOptions({
        ganttStart: window.ganttStart,
        ganttEnd: window.ganttEnd,
        unit: window.unit,
        step: window.step,
        columnWidth: window.columnWidth,
    });

    // Not written in this turn, so the committed values are the right ones.
    // This runs from an effect's apply, where a bare reactive read is flagged
    // as a strict-read mistake; `untrack` states that these are one-shot.
    const config = untrack(() => ({
        ganttStart: window.ganttStart,
        ganttEnd: window.ganttEnd,
        unit: window.unit,
        step: window.step,
        columnWidth: window.columnWidth,
        headerHeight: ganttConfig.headerHeight(),
        barHeight: ganttConfig.barHeight(),
        padding: ganttConfig.padding(),
    }));

    // Resource index map: when explicit resources were passed the store was
    // populated by the caller in an earlier turn, so its memo is current and
    // respects collapse state. Otherwise the resources are re-extracted from
    // the task list here, in which case the map is built from the SAME local
    // list that is published to the store — never read back from the memo
    // this turn just staged. The flag must come from the caller: checking
    // `resourceStore.resources().length > 0` is unreliable because we
    // ourselves populate it during the first run.
    let resourceIndexMap: Map<string, number> | null = null;
    // Backward-compat fallback: if caller didn't pass the flag, infer
    // from current store state (matches pre-flag behavior).
    const explicit =
        hasExplicitResources ??
        untrack(() => resourceStore.resources().length > 0);

    if (explicit && useResourceStore) {
        resourceIndexMap = untrack(() => resourceStore.resourceIndexMap());
    } else if (!explicit) {
        const extracted = extractResourcesFromTasks(rawTasks);
        resourceStore.updateResources(extracted);
        resourceIndexMap = computeResourceIndexMap(
            computeDisplayResources(
                normalizeResources(extracted),
                untrack(() => resourceStore.collapsedGroups()),
            ),
        );
    }

    const {
        tasks: processedTasks,
        relationships,
        resources: legacyResources,
    } = processTasks(rawTasks, config, resourceIndexMap);

    // Hierarchy + summary bounds
    const taskMap = buildHierarchy(processedTasks);
    recomputeAllSummaryBounds(taskMap);

    // Apply subtask-collapse visibility (in addition to resource group collapse)
    const collapsedTaskSet = untrack(() => taskStore.collapsedTasks());
    for (const task of taskMap.values()) {
        const processedTask = task as ProcessedTask;
        if (
            isHiddenByCollapsedAncestor(
                processedTask.id,
                taskMap as Map<string, ProcessedTask>,
                collapsedTaskSet,
            )
        ) {
            processedTask._isHidden = true;
        }
    }

    taskStore.updateTasks(Array.from(taskMap.values()));

    return { relationships, legacyResources };
}
