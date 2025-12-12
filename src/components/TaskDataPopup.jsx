import { Show, createMemo } from 'solid-js';
import { formatTaskCompact } from '../utils/jsonFormatter.js';

/**
 * Lightweight popup for displaying task data on hover
 *
 * @param {Object} props
 * @param {() => boolean} props.visible - Reactive visibility signal
 * @param {() => {x: number, y: number}} props.position - Reactive position signal (client coordinates)
 * @param {() => Object|null} props.task - Reactive task object
 * @param {() => Object|null} props.barPosition - Reactive bar position {x, y, width, height}
 */
export function TaskDataPopup(props) {
    const formattedData = createMemo(() => {
        const task = props.task?.();
        const barPos = props.barPosition?.();
        if (!task) return '';
        return formatTaskCompact(task, barPos);
    });

    const popupStyle = createMemo(() => {
        const pos = props.position?.() || { x: 0, y: 0 };
        return {
            position: 'fixed',
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
            'pointer-events': 'none',
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
