import { createMemo, For, untrack } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { BarMinimal } from './BarMinimal';
import type { ResourceStore } from '../stores/resourceStore';
import type { TaskStore } from '../stores/taskStore';
import type { ProcessedTask } from '../types';
import { groupTasksByResource } from '../utils/groupTasksByResource';

interface DisplayResource {
    id: string;
    type: 'resource' | 'group';
}

interface TaskLayerMinimalProps {
    resourceStore?: ResourceStore;
    taskStore?: TaskStore;
    startRow?: number;
    endRow?: number;
    startX?: number;
    endX?: number;
}

/**
 * TaskLayerMinimal - Mirrors indexTest.jsx pattern exactly.
 *
 * Key characteristics matching indexTest:
 * - Simple visibleTasks() memo that returns task OBJECTS
 * - NO pooling (no undefined slots)
 * - NO wrapper div with display: none
 * - Direct <Index> → BarMinimal
 * - NO extra handlers passed to Bar
 */
export function TaskLayerMinimal(props: TaskLayerMinimalProps): JSX.Element {
    // Get display resources from resourceStore (respects collapse state)
    const displayResources = (): DisplayResource[] =>
        (props.resourceStore?.displayResources() as DisplayResource[]) || [];

    // Viewport range for row virtualization
    const startRow = (): number => props.startRow ?? 0;
    const endRow = (): number => props.endRow ?? 50;

    // X range for horizontal filtering
    const startX = (): number => props.startX ?? 0;
    const endX = (): number => props.endX ?? Infinity;

    // Group tasks by resource. Shares `groupTasksByResource` with
    // `useTaskVirtualization` — this file used to carry a byte-for-byte copy
    // of it, cached on the task COUNT, which went permanently stale on a
    // same-tick remove+add. `Object.keys` is TRACKED (the store's `ownKeys`
    // trap), so the memo re-runs on any key add/remove; the per-task leaf
    // reads stay untracked inside the helper, so a drag's `_bar.x` writes
    // never rebuild the grouping.
    const tasksByResource = createMemo((): Map<string, ProcessedTask[]> => {
        const tasksObj = props.taskStore?.tasks;
        if (!tasksObj) return new Map();
        return groupTasksByResource(tasksObj, Object.keys(tasksObj));
    });

    // EXACTLY like indexTest visibleTasks() pattern:
    // Simple memo that returns task OBJECTS (not IDs)
    const visibleTasks = createMemo<ProcessedTask[]>(() => {
        const result: ProcessedTask[] = [];
        const resList = displayResources();
        const grouped = tasksByResource();
        const startIdx = startRow();
        const endIdx = endRow();
        const sx = startX();
        const ex = endX();

        // Filter by row range
        for (let i = startIdx; i < endIdx && i < resList.length; i++) {
            const item = resList[i];
            if (!item || item.type === 'group') continue;

            const resourceTaskList = grouped.get(item.id);
            if (!resourceTaskList) continue;

            // Filter by X range - untrack to prevent O(n) subscriptions
            untrack(() => {
                if (ex === Infinity) {
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        const task = resourceTaskList[j];
                        if (task) result.push(task);
                    }
                } else {
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        const task = resourceTaskList[j];
                        if (!task) continue;
                        const bar = task._bar;
                        if (
                            !bar ||
                            (bar.x + bar.width >= sx - 200 && bar.x <= ex + 200)
                        ) {
                            result.push(task);
                        }
                    }
                }
            });
        }
        return result;
    });

    return (
        <div
            class="task-layer-minimal"
            style={{
                contain: 'layout style',
                position: 'relative',
                width: '100%',
                height: '100%',
            }}
        >
            {/* Direct Index → BarMinimal (NO wrapper div, NO display:none) */}
            <For keyed={false} each={visibleTasks()}>
                {(task) => <BarMinimal task={task} />}
            </For>
        </div>
    );
}

export default TaskLayerMinimal;
