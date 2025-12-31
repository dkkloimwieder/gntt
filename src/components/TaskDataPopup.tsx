import { Show, createMemo, JSX, Accessor } from 'solid-js';
import { formatTaskCompact } from '../utils/jsonFormatter';
import type { GanttTask, BarPosition } from '../types';

interface TaskDataPopupProps {
    visible?: Accessor<boolean>;
    position?: Accessor<{ x: number; y: number }>;
    task?: Accessor<GanttTask | null>;
    barPosition?: Accessor<BarPosition | null>;
}

/**
 * Lightweight popup for displaying task data on hover
 */
export function TaskDataPopup(props: TaskDataPopupProps): JSX.Element {
    const formattedData = createMemo(() => {
        const task = props.task?.();
        const barPos = props.barPosition?.();
        if (!task) return '';
        return formatTaskCompact(task, barPos ?? undefined);
    });

    const popupStyle = createMemo(() => {
        const pos = props.position?.() || { x: 0, y: 0 };
        return {
            position: 'fixed' as const,
            left: `${pos.x + 15}px`,
            top: `${pos.y - 10}px`,
            background: '#fff',
            'box-shadow': '0 4px 12px rgba(0,0,0,0.15)',
            'border-radius': '6px',
            padding: '12px',
            'min-width': '180px',
            'max-width': '280px',
            'z-index': 1100,
            'font-size': '12px',
            'border-left': '3px solid #3498db',
            'pointer-events': 'none' as const,
        };
    });

    return (
        <Show when={props.visible?.()}>
            <div style={popupStyle()}>
                <div style={{
                    'font-family': 'monospace',
                    'white-space': 'pre-line',
                    'line-height': '1.5',
                }}>
                    {formattedData()}
                </div>
                <div style={{
                    'margin-top': '10px',
                    'padding-top': '8px',
                    'border-top': '1px solid #eee',
                    'font-size': '10px',
                    color: '#999',
                    'text-align': 'center',
                    'font-family': 'sans-serif',
                }}>
                    Click for full data
                </div>
            </div>
        </Show>
    );
}
