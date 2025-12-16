import { Show } from 'solid-js';

/**
 * SubtaskBar - A compact bar for subtasks (50% height of normal bars).
 *
 * Minimal styling:
 * - Smaller height (50% of normal)
 * - Smaller corner radius
 * - Compact text
 * - No drag/resize handles (inherits parent behavior)
 */
export function SubtaskBar(props) {
    // Task data
    const task = () => props.task;

    // Bar geometry from task.$bar
    const bar = () => task()?.$bar || { x: 0, width: 100 };
    const x = () => bar().x;
    const width = () => bar().width;

    // Y position passed from parent container
    const y = () => props.y ?? 0;

    // Config
    const config = () => props.config || {};
    const barHeight = () => config().barHeight ?? 30;
    const subtaskHeightRatio = () => config().subtaskHeightRatio ?? 0.5;
    const cornerRadius = () => (config().cornerRadius ?? 3) * 0.7; // Smaller radius

    // Subtask bar height (50% of normal)
    const height = () => barHeight() * subtaskHeightRatio();

    // Colors - inherit from parent or use task's own color
    const barColor = () => task()?.color ?? config().parentColor ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = () => task()?.color_progress ?? barColor();

    // Progress
    const progress = () => task()?.progress ?? 0;
    const progressWidth = () => {
        const w = width();
        const p = progress();
        return Math.max(0, (w * p) / 100);
    };

    // Label positioning (centered inside bar like normal tasks)
    const labelX = () => x() + width() / 2;

    return (
        <g
            class="subtask-bar"
            data-id={task()?.id}
            data-index={props.index}
        >
            {/* Background bar - outline style with subtle fill */}
            <rect
                class="subtask-bar-bg"
                x={x()}
                y={y()}
                width={width()}
                height={height()}
                rx={cornerRadius()}
                ry={cornerRadius()}
                fill={barColor()}
                fill-opacity={0.1}
                stroke={barColor()}
                stroke-width={1.5}
            />

            {/* Progress bar */}
            <Show when={progress() > 0}>
                <rect
                    class="subtask-bar-progress"
                    x={x()}
                    y={y()}
                    width={progressWidth()}
                    height={height()}
                    rx={cornerRadius()}
                    ry={cornerRadius()}
                    fill={progressColor()}
                    fill-opacity={0.3}
                    style={{ 'pointer-events': 'none' }}
                />
            </Show>

            {/* Label (inside bar, centered) */}
            <text
                class="subtask-label"
                x={labelX()}
                y={y() + height() / 2}
                font-size="10"
                fill="#333"
                text-anchor="middle"
                dominant-baseline="middle"
                style={{ 'pointer-events': 'none', 'user-select': 'none' }}
            >
                {task()?.name ?? ''}
            </text>

            {/* Dependency arrow connector points would go here */}
        </g>
    );
}

export default SubtaskBar;
