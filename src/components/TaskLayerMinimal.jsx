import { createMemo, Index, untrack } from 'solid-js';
import { BarMinimal } from './BarMinimal.jsx';

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
export function TaskLayerMinimal(props) {
    // Get display resources from resourceStore (respects collapse state)
    const displayResources = () => props.resourceStore?.displayResources() || [];

    // Viewport range for row virtualization
    const startRow = () => props.startRow ?? 0;
    const endRow = () => props.endRow ?? 50;

    // X range for horizontal filtering
    const startX = () => props.startX ?? 0;
    const endX = () => props.endX ?? Infinity;

    // Group tasks by resource - simple cached version
    let cachedGrouping = null;
    let cachedTaskCount = -1;

    const tasksByResource = () => {
        const tasksObj = props.taskStore?.tasks;
        if (!tasksObj) return new Map();

        const taskKeys = untrack(() => Object.keys(tasksObj));
        if (taskKeys.length === cachedTaskCount && cachedGrouping) {
            return cachedGrouping;
        }

        cachedTaskCount = taskKeys.length;
        const grouped = new Map();
        untrack(() => {
            for (const taskId of taskKeys) {
                const task = tasksObj[taskId];
                if (!task || task._isHidden) continue;

                const resource = task.resource || 'Unassigned';
                if (!grouped.has(resource)) {
                    grouped.set(resource, []);
                }
                grouped.get(resource).push(task);
            }
        });
        cachedGrouping = grouped;
        return grouped;
    };

    // EXACTLY like indexTest visibleTasks() pattern:
    // Simple memo that returns task OBJECTS (not IDs)
    const visibleTasks = createMemo(() => {
        const result = [];
        const resList = displayResources();
        const grouped = tasksByResource();
        const startIdx = startRow();
        const endIdx = endRow();
        const sx = startX();
        const ex = endX();

        // Filter by row range
        for (let i = startIdx; i < endIdx && i < resList.length; i++) {
            const item = resList[i];
            if (item.type === 'group') continue;

            const resourceTaskList = grouped.get(item.id);
            if (!resourceTaskList) continue;

            // Filter by X range - untrack to prevent O(n) subscriptions
            untrack(() => {
                if (ex === Infinity) {
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        result.push(resourceTaskList[j]);
                    }
                } else {
                    for (let j = 0; j < resourceTaskList.length; j++) {
                        const task = resourceTaskList[j];
                        const bar = task.$bar;
                        if (!bar || (bar.x + bar.width >= sx - 200 && bar.x <= ex + 200)) {
                            result.push(task);
                        }
                    }
                }
            });
        }
        return result;
    });

    // Simple count for debugging
    const taskCount = () => visibleTasks().length;

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
            <Index each={visibleTasks()}>
                {(task) => <BarMinimal task={task} />}
            </Index>
        </div>
    );
}

export default TaskLayerMinimal;
