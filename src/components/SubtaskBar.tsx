import { Show, JSX } from 'solid-js';
import type { ProcessedTask, BarPosition } from '../types';

interface SubtaskConfig {
    barHeight?: number;
    padding?: number;
    subtaskHeightRatio?: number;
    cornerRadius?: number;
    parentColor?: string;
}

interface SubtaskBarProps {
    task: ProcessedTask;
    index: number;
    y?: number;
    layout?: 'sequential' | 'parallel' | 'mixed';
    config?: SubtaskConfig;
    ganttConfig?: unknown;
}

/**
 * SubtaskBar - A compact bar for subtasks (50% height of normal bars).
 */
export function SubtaskBar(props: SubtaskBarProps): JSX.Element {
    // Task data
    const task = (): ProcessedTask => props.task;

    // Bar geometry from task._bar
    const bar = (): BarPosition => task()?._bar || { x: 0, y: 0, width: 100, height: 30 };
    const x = (): number => bar().x;
    const width = (): number => bar().width;

    // Y position passed from parent container
    const y = (): number => props.y ?? 0;

    // Config
    const config = (): SubtaskConfig => props.config || {};
    const barHeight = (): number => config().barHeight ?? 30;
    const subtaskHeightRatio = (): number => config().subtaskHeightRatio ?? 0.5;
    const cornerRadius = (): number => (config().cornerRadius ?? 3) * 0.7; // Smaller radius

    // Subtask bar height (50% of normal)
    const height = (): number => barHeight() * subtaskHeightRatio();

    // Colors - inherit from parent or use task's own color
    const barColor = (): string => (task()?.color as string) ?? config().parentColor ?? 'var(--g-bar-color, #b8c2cc)';
    const progressColor = (): string => (task()?.color_progress as string) ?? barColor();

    // Progress
    const progress = (): number => task()?.progress ?? 0;
    const progressWidth = (): number => {
        const w = width();
        const p = progress();
        return Math.max(0, (w * p) / 100);
    };

    // Label positioning (centered inside bar like normal tasks)
    const labelX = (): number => x() + width() / 2;

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
        </g>
    );
}

export default SubtaskBar;
