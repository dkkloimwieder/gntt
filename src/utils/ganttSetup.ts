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
import { processTasks } from './taskProcessor';
import { extractResourcesFromTasks } from './resourceProcessor';
import {
    buildHierarchy,
    isHiddenByCollapsedAncestor,
} from './hierarchyProcessor';
import { recomputeAllSummaryBounds } from './barCalculations';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { GanttDateStore } from '../stores/ganttDateStore';
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
 */
export function initializeTasks(
    rawTasks: GanttTask[],
    stores: GanttSetupStores,
    useResourceStore = true,
    hasExplicitResources?: boolean,
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

    // Setup date store with task bounds
    dateStore.setupDates(rawTasks);

    // Sync config store with date store values
    ganttConfig.setGanttStart(dateStore.ganttStart());
    ganttConfig.setGanttEnd(dateStore.ganttEnd());
    ganttConfig.setUnit(dateStore.unit());
    ganttConfig.setStep(dateStore.step());
    ganttConfig.setColumnWidth(dateStore.columnWidth());

    const config = {
        ganttStart: dateStore.ganttStart(),
        ganttEnd: dateStore.ganttEnd(),
        unit: dateStore.unit(),
        step: dateStore.step(),
        columnWidth: dateStore.columnWidth(),
        headerHeight: ganttConfig.headerHeight(),
        barHeight: ganttConfig.barHeight(),
        padding: ganttConfig.padding(),
    };

    // Resource index map: prefer the resourceStore (respects collapse
    // state) when explicit resources were passed; otherwise re-extract
    // from the current task list. The flag must come from the caller —
    // checking `resourceStore.resources().length > 0` is unreliable
    // because we ourselves populate it during the first run.
    let resourceIndexMap: Map<string, number> | null = null;
    // Backward-compat fallback: if caller didn't pass the flag, infer
    // from current store state (matches pre-flag behavior).
    const explicit =
        hasExplicitResources ?? resourceStore.resources().length > 0;

    if (explicit && useResourceStore) {
        resourceIndexMap = resourceStore.resourceIndexMap();
    } else if (!explicit) {
        const extracted = extractResourcesFromTasks(rawTasks);
        resourceStore.updateResources(extracted);
        resourceIndexMap = resourceStore.resourceIndexMap();
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
    const collapsedTaskSet = taskStore.collapsedTasks();
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
