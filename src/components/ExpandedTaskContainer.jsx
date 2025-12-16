import { createMemo, For, Show } from 'solid-js';
import { SubtaskBar } from './SubtaskBar.jsx';

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

    // Container dimensions - use task-specific Y from taskPositions (for stacking)
    const containerY = () => {
        const rowLayout = props.rowLayout;
        // Use task-specific position (handles stacking of overlapping tasks)
        const taskPos = rowLayout?.taskPositions?.get(props.taskId);
        if (taskPos?.y !== undefined) {
            return taskPos.y;
        }
        // Fallback to row Y or $bar.y
        if (rowLayout) {
            return rowLayout.y;
        }
        return parentBar().y - padding() / 2;
    };

    const containerHeight = () => {
        // Use task-specific height from taskPositions if available
        const rowLayout = props.rowLayout;
        const taskPos = rowLayout?.taskPositions?.get(props.taskId);
        if (taskPos?.height !== undefined) {
            return taskPos.height;
        }

        // Sequential: same height as a regular bar (visually identical)
        if (layout() === 'sequential') {
            return barHeight();
        }

        // Fallback calculation with consistent padding
        const subtaskBarHeight = barHeight() * subtaskHeightRatio();
        const subtaskPadding = padding() * 0.4;
        const count = subtasks().length;
        const verticalPadding = (barHeight() - subtaskBarHeight) / 2;

        // Stack with same padding as sequential
        return verticalPadding * 2 + count * subtaskBarHeight + (count - 1) * subtaskPadding;
    };

    // Content area - consistent vertical padding for all layouts
    const contentY = () => {
        // Use same centering offset for all layouts
        const subtaskH = barHeight() * subtaskHeightRatio();
        return containerY() + (barHeight() - subtaskH) / 2;
    };

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

    // Get subtask Y position from rowLayout (computed based on time overlaps)
    const getSubtaskY = (index, subtask) => {
        // Use pre-computed Y from rowLayout if available
        const rowLayout = props.rowLayout;
        const taskPos = rowLayout?.taskPositions?.get(subtask?.id);
        if (taskPos?.y !== undefined) {
            return taskPos.y;
        }

        // Fallback: compute with consistent padding
        const subtaskBarHeight = barHeight() * subtaskHeightRatio();
        const subtaskPadding = padding() * 0.4;
        const verticalPadding = (barHeight() - subtaskBarHeight) / 2;

        if (layout() === 'sequential') {
            return containerY() + verticalPadding;
        }
        // Parallel/mixed: stack by index
        return containerY() + verticalPadding + index * (subtaskBarHeight + subtaskPadding);
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
