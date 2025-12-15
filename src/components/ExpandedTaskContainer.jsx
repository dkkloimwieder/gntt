import { createMemo, For, Show } from 'solid-js';
import { SubtaskBar } from './SubtaskBar.jsx';
import { computeSubtaskY } from '../utils/rowLayoutCalculator.js';

/**
 * ExpandedTaskContainer - Renders a parent task with subtasks inside.
 *
 * When a task is expanded:
 * - Parent bar becomes a border container (low opacity fill ~0.05)
 * - Subtasks render inside at 50% height
 * - Supports sequential, parallel, and mixed layouts
 */
export function ExpandedTaskContainer(props) {
    // Get task from store
    const task = () => {
        const taskMap = props.taskStore?.tasks();
        return taskMap?.get(props.taskId);
    };

    // Get subtasks
    const subtasks = createMemo(() => {
        const t = task();
        if (!t?._children?.length) return [];

        const taskMap = props.taskStore?.tasks();
        if (!taskMap) return [];

        return t._children
            .map((childId) => taskMap.get(childId))
            .filter((child) => child != null);
    });

    // Layout mode
    const layout = () => task()?.subtaskLayout || 'sequential';

    // Config from ganttConfig
    const barHeight = () => props.ganttConfig?.barHeight?.() ?? 30;
    const padding = () => props.ganttConfig?.padding?.() ?? 18;
    const subtaskHeightRatio = () => props.ganttConfig?.subtaskHeightRatio?.() ?? 0.5;
    const cornerRadius = () => props.ganttConfig?.barCornerRadius?.() ?? 3;

    // Parent bar geometry (from $bar)
    const parentBar = () => task()?.$bar || { x: 0, y: 0, width: 100, height: 30 };

    // Container dimensions (full row height when expanded)
    const containerY = () => {
        // Use row layout Y if available, otherwise fall back to $bar.y
        const rowLayout = props.rowLayout;
        if (rowLayout) {
            return rowLayout.y;
        }
        return parentBar().y - padding() / 2;
    };

    const containerHeight = () => {
        const rowLayout = props.rowLayout;
        if (rowLayout) {
            return rowLayout.height;
        }
        // Calculate based on subtask count
        const subtaskBarHeight = barHeight() * subtaskHeightRatio();
        const subtaskPadding = padding() * 0.4;
        const subtaskRowHeight = subtaskBarHeight + subtaskPadding;
        const count = subtasks().length;

        if (layout() === 'parallel') {
            return padding() + subtaskBarHeight + padding();
        }
        return padding() + count * subtaskRowHeight + padding() / 2;
    };

    // Content area (inside padding)
    const contentY = () => containerY() + padding() / 2;

    // Colors
    const parentColor = () => task()?.color ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = () => task()?.color_progress ?? parentColor();

    // Subtask config for SubtaskBar
    const subtaskConfig = createMemo(() => ({
        barHeight: barHeight(),
        padding: padding(),
        subtaskHeightRatio: subtaskHeightRatio(),
        cornerRadius: cornerRadius(),
        parentColor: parentColor(),
    }));

    // Calculate subtask Y position
    const getSubtaskY = (index, subtask) => {
        const row = subtask?.row ?? index;
        return computeSubtaskY(
            index,
            contentY(),
            layout(),
            {
                barHeight: barHeight(),
                padding: padding(),
                subtaskHeightRatio: subtaskHeightRatio(),
            },
            row
        );
    };

    return (
        <g
            class="expanded-task-container"
            data-id={props.taskId}
            data-layout={layout()}
        >
            {/* Parent task container border - thicker, more visible */}
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

            {/* Subtasks are the main visual elements */}
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
