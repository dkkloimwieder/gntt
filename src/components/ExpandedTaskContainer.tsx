import { For, JSX } from 'solid-js';
import { SubtaskBar } from './SubtaskBar';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { ProcessedTask } from '../types';
import type { RowLayout } from '../utils/rowLayoutCalculator';

interface ExpandedTaskContainerProps {
    taskId: string;
    taskStore?: TaskStore;
    ganttConfig?: GanttConfigStore;
    rowLayout?: RowLayout;
}

interface SubtaskConfig {
    barHeight: number;
    padding: number;
    subtaskHeightRatio: number;
    cornerRadius: number;
    parentColor: string;
}

/**
 * ExpandedTaskContainer - Renders a parent task with subtasks inside.
 */
export function ExpandedTaskContainer(props: ExpandedTaskContainerProps): JSX.Element {
    // Get task from store
    const task = (): ProcessedTask | undefined => {
        return props.taskStore?.tasks[props.taskId] as ProcessedTask | undefined;
    };

    // Get subtasks
    const subtasks = (): ProcessedTask[] => {
        const t = task();
        if (!t?._children?.length) return [];

        const tasksObj = props.taskStore?.tasks;
        if (!tasksObj) return [];

        return t._children
            .map((childId) => tasksObj[childId] as ProcessedTask | undefined)
            .filter((child): child is ProcessedTask => child != null);
    };

    // Layout mode
    const layout = (): 'sequential' | 'parallel' | 'mixed' =>
        (task()?.subtaskLayout as 'sequential' | 'parallel' | 'mixed') || 'sequential';

    // Config from ganttConfig
    const barHeight = (): number => props.ganttConfig?.barHeight?.() ?? 30;
    const padding = (): number => props.ganttConfig?.padding?.() ?? 18;
    const subtaskHeightRatio = (): number => props.ganttConfig?.subtaskHeightRatio?.() ?? 0.5;
    const cornerRadius = (): number => props.ganttConfig?.barCornerRadius?.() ?? 3;

    // Parent bar geometry (from _bar)
    const parentBar = () => task()?._bar || { x: 0, y: 0, width: 100, height: 30 };

    // Container dimensions
    const containerY = (): number => {
        const rowLayout = props.rowLayout;
        const taskPos = rowLayout?.taskPositions?.get(props.taskId);
        if (taskPos?.y !== undefined) {
            return taskPos.y;
        }
        if (rowLayout) {
            return rowLayout.y;
        }
        return parentBar().y - padding() / 2;
    };

    const containerHeight = (): number => {
        const rowLayout = props.rowLayout;
        const taskPos = rowLayout?.taskPositions?.get(props.taskId);
        if (taskPos?.height !== undefined) {
            return taskPos.height;
        }

        if (layout() === 'sequential') {
            return barHeight();
        }

        const subtaskBarHeight = barHeight() * subtaskHeightRatio();
        const subtaskPadding = padding() * 0.4;
        const count = subtasks().length;
        const verticalPadding = (barHeight() - subtaskBarHeight) / 2;

        return verticalPadding * 2 + count * subtaskBarHeight + (count - 1) * subtaskPadding;
    };

    // Colors
    const parentColor = (): string => (task()?.color as string) ?? 'var(--g-bar-color, #b8c2cc)';

    // Subtask config for SubtaskBar
    const subtaskConfig = (): SubtaskConfig => ({
        barHeight: barHeight(),
        padding: padding(),
        subtaskHeightRatio: subtaskHeightRatio(),
        cornerRadius: cornerRadius(),
        parentColor: parentColor(),
    });

    // Get subtask Y position from rowLayout
    const getSubtaskY = (index: number, subtask: ProcessedTask): number => {
        const rowLayout = props.rowLayout;
        const taskPos = rowLayout?.taskPositions?.get(subtask?.id);
        if (taskPos?.y !== undefined) {
            return taskPos.y;
        }

        const subtaskBarHeight = barHeight() * subtaskHeightRatio();
        const subtaskPadding = padding() * 0.4;
        const verticalPadding = (barHeight() - subtaskBarHeight) / 2;

        if (layout() === 'sequential') {
            return containerY() + verticalPadding;
        }
        return containerY() + verticalPadding + index * (subtaskBarHeight + subtaskPadding);
    };

    return (
        <g
            class="expanded-task-container"
            data-id={props.taskId}
            data-layout={layout()}
        >
            {/* Parent task container border */}
            <rect
                class="parent-container"
                x={parentBar().x}
                y={containerY()}
                width={parentBar().width}
                height={containerHeight()}
                fill="none"
                stroke={parentColor()}
                stroke-width={2}
                stroke-opacity={0.6}
                stroke-dasharray="6,3"
                rx={cornerRadius()}
                ry={cornerRadius()}
            />

            {/* Subtasks */}
            <g class="subtasks">
                <For each={subtasks()}>
                    {(subtask, index) => (
                        <SubtaskBar
                            task={subtask}
                            index={index()}
                            y={getSubtaskY(index(), subtask)}
                            layout={layout()}
                            config={subtaskConfig()}
                            ganttConfig={props.ganttConfig}
                        />
                    )}
                </For>
            </g>
        </g>
    );
}

export default ExpandedTaskContainer;
