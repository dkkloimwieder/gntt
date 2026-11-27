/**
 * Initialize tasks for a Gantt instance: bound timeline to task dates,
 * sync the config store, run processTasks, build the parent-child
 * hierarchy, recompute summary bounds, apply collapse visibility, then
 * commit to the task store.
 *
 * Extracted from Gantt.tsx so the orchestrator component focuses on
 * wiring stores together.
 */
import { untrack } from 'solid-js';
import { processTasks } from './taskProcessor';
import {
    computeDisplayResources,
    computeResourceIndexMap,
    extractResourcesFromTasks,
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
import type {
    GanttTask,
    ProcessedTask,
    Relationship,
    Resource,
} from '../types';

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

interface GanttSetupOptions {
    resources?: Resource[] | false;
    dateWindow?: DateWindow;
    geometry?: { barHeight: number; padding: number };
}

/**
 * Initialize tasks and compute positions. Returns the task relationships and
 * the resource names for consumers without a resource store.
 */
export function initializeTasks(
    rawTasks: GanttTask[],
    stores: GanttSetupStores,
    options: GanttSetupOptions = {},
): GanttSetupResult {
    const { taskStore, ganttConfig, dateStore, resourceStore } = stores;

    // Date window: `setupDates` stages the signal writes and RETURNS the
    // window it computed. Nothing below reads the date store back — writes
    // are deferred until the next flush, so a read-back here would still see
    // the previous window.
    const window = options.dateWindow ?? dateStore.setupDates(rawTasks);

    // Mirror the window into the config store in one write.
    ganttConfig.updateOptions({
        ganttStart: window.ganttStart,
        ganttEnd: window.ganttEnd,
        unit: window.unit,
        step: window.step,
        columnWidth: window.columnWidth,
    });

    const configured = untrack(resourceStore.configuredResources);
    const resources =
        options.resources ?? (configured.length > 0 ? configured : false);
    const rows = resources || extractResourcesFromTasks(rawTasks);
    resourceStore.setDisplayResources(rows === configured ? null : rows);

    if (!rawTasks || rawTasks.length === 0) {
        taskStore.clear();
        return { relationships: [], legacyResources: [] };
    }

    const geometry =
        options.geometry ??
        untrack(() => ({
            barHeight: ganttConfig.barHeight(),
            padding: ganttConfig.padding(),
        }));
    const config = {
        ganttStart: window.ganttStart,
        unit: window.unit,
        step: window.step,
        columnWidth: window.columnWidth,
        ...geometry,
    };

    const resourceIndexMap = computeResourceIndexMap(
        computeDisplayResources(rows, untrack(resourceStore.collapsedGroups)),
    );

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
