import { For, Index, createMemo, Accessor, JSX } from 'solid-js';
import { Bar } from './Bar';
import { SummaryBar } from './SummaryBar';
import { ExpandedTaskContainer } from './ExpandedTaskContainer';
import { DEFAULT_COLUMN_WIDTH } from '../constants';
import { buildRelationshipIndex } from '../utils/constraintEngine';
import { collectDescendants } from '../utils/hierarchyProcessor';
import {
    constrainTaskPosition,
    resolveResizeConstraints,
    collectDependents,
    clampBatchDelta,
} from '../utils/taskLayerConstraints';
import { useTaskVirtualization } from '../hooks/useTaskVirtualization';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { ResourceStore } from '../stores/resourceStore';
import type { ProcessedTask, Relationship } from '../types';
import type { RowLayout } from '../utils/rowLayoutCalculator';

interface BatchOriginal {
    originalX: number;
}

interface ConstrainedResult {
    x: number;
    y: number;
}

interface TaskLayerProps {
    taskStore?: TaskStore;
    ganttConfig?: GanttConfigStore;
    resourceStore?: ResourceStore;
    tasks?: ProcessedTask[];
    relationships?: Relationship[];
    rowLayouts?: Map<string, RowLayout>;
    startRow?: number;
    endRow?: number;
    startX?: number;
    endX?: number;
    onDateChange?: (
        taskId: string,
        position: { x: number; width: number },
    ) => void;
    onProgressChange?: (taskId: string, progress: number) => void;
    onResizeEnd?: (taskId: string) => void;
    onHover?: (taskId: string, clientX: number, clientY: number) => void;
    onHoverEnd?: () => void;
    onTaskClick?: (taskId: string, event: MouseEvent) => void;
}

/**
 * TaskLayer - Container for all task bars.
 * Maps tasks to Bar components and handles constraint resolution.
 */
export function TaskLayer(props: TaskLayerProps): JSX.Element {
    // Relationships for constraint resolution
    const relationships = (): Relationship[] => props.relationships || [];

    // Pre-build relationship index for O(1) lookups (rebuilds when relationships change)
    const relationshipIndex = createMemo(() =>
        buildRelationshipIndex(relationships()),
    );

    // Build the constraint context once per call. Cheap; values are accessors.
    const buildCtx = (taskId: string) => {
        const store = props.taskStore;
        if (!store) return null;
        return {
            taskStore: store,
            columnWidth:
                props.ganttConfig?.columnWidth?.() ?? DEFAULT_COLUMN_WIDTH,
            relationships: relationships(),
            relationshipIndex: relationshipIndex(),
            taskId,
        };
    };

    const handleConstrainPosition = (
        taskId: string,
        newX: number,
        newY: number,
    ): ConstrainedResult | null => {
        const ctx = buildCtx(taskId);
        if (!ctx) return { x: newX, y: newY };
        return constrainTaskPosition(taskId, newX, newY, ctx);
    };

    const handleResizeEnd = (taskId: string): void => {
        const ctx = buildCtx(taskId);
        if (ctx) resolveResizeConstraints(taskId, ctx);
        props.onResizeEnd?.(taskId);
    };

    const handleCollectDependents = (taskId: string): Set<string> => {
        if (!props.taskStore) return new Set();
        return collectDependents(taskId, relationships(), props.taskStore);
    };

    const handleClampBatchDelta = (
        batchOriginals: Map<string, BatchOriginal>,
        proposedDeltaX: number,
    ): number => {
        if (!props.taskStore) return proposedDeltaX;
        const columnWidth =
            props.ganttConfig?.columnWidth?.() ?? DEFAULT_COLUMN_WIDTH;
        return clampBatchDelta(
            batchOriginals,
            proposedDeltaX,
            relationships(),
            props.taskStore,
            columnWidth,
        );
    };

    // Pure callback-bridges to props
    const handleDateChange = (
        taskId: string,
        position: { x: number; width: number },
    ): void => props.onDateChange?.(taskId, position);
    const handleProgressChange = (taskId: string, progress: number): void =>
        props.onProgressChange?.(taskId, progress);
    const handleHover = (
        taskId: string,
        clientX: number,
        clientY: number,
    ): void => props.onHover?.(taskId, clientX, clientY);
    const handleHoverEnd = (): void => props.onHoverEnd?.();
    const handleTaskClick = (taskId: string, event: MouseEvent): void =>
        props.onTaskClick?.(taskId, event);

    const handleCollectDescendants = (taskId: string): Set<string> => {
        if (!props.taskStore) return new Set();
        return collectDescendants(taskId, props.taskStore.tasks);
    };

    // Virtualization: tasks-by-resource grouping, viewport filtering,
    // pooled <Index> arrays, per-task position lookup.
    const {
        splitTaskIds,
        pooledRegularTasks,
        pooledSummaryIds,
        getTaskPosition,
    } = useTaskVirtualization(props);

    return (
        <div
            class="task-layer"
            style={{
                contain: 'layout style',
                position: 'relative',
                width: '100%',
                height: '100%',
            }}
        >
            {/* Summary bars render BEHIND everything */}
            <div class="summary-layer" style={{ contain: 'layout style' }}>
                <Index each={pooledSummaryIds()}>
                    {(taskId: Accessor<string | undefined>) => (
                        <div style={{ display: taskId() ? 'block' : 'none' }}>
                            <SummaryBar
                                taskId={taskId as Accessor<string>}
                                taskStore={props.taskStore}
                                ganttConfig={props.ganttConfig}
                                onCollectDescendants={handleCollectDescendants}
                                onClampBatchDelta={handleClampBatchDelta}
                                onDragEnd={handleResizeEnd}
                            />
                        </div>
                    )}
                </Index>
            </div>

            {/* Expanded task containers (parent + subtasks) */}
            <div class="expanded-layer" style={{ contain: 'layout style' }}>
                <For each={splitTaskIds().expandedIds}>
                    {(taskId) => (
                        <ExpandedTaskContainer
                            taskId={taskId}
                            taskStore={props.taskStore}
                            ganttConfig={props.ganttConfig}
                            rowLayout={getTaskPosition(taskId) ?? undefined}
                        />
                    )}
                </For>
            </div>

            {/* Regular task bars render ON TOP */}
            <div class="task-bars-layer" style={{ contain: 'layout style' }}>
                <Index each={pooledRegularTasks()}>
                    {(task: Accessor<ProcessedTask | undefined>) => (
                        <div
                            style={{
                                display: task() ? 'block' : 'none',
                                'pointer-events': 'auto',
                            }}
                        >
                            <Bar
                                task={task as Accessor<ProcessedTask>}
                                taskStore={props.taskStore}
                                ganttConfig={props.ganttConfig}
                                onConstrainPosition={handleConstrainPosition}
                                onCollectDependents={handleCollectDependents}
                                onCollectDescendants={handleCollectDescendants}
                                onClampBatchDelta={handleClampBatchDelta}
                                onDateChange={handleDateChange}
                                onProgressChange={handleProgressChange}
                                onResizeEnd={handleResizeEnd}
                                onHover={handleHover}
                                onHoverEnd={handleHoverEnd}
                                onTaskClick={handleTaskClick}
                            />
                        </div>
                    )}
                </Index>
            </div>
        </div>
    );
}

export default TaskLayer;
