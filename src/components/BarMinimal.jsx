import { createMemo } from 'solid-js';

/**
 * BarMinimal - Mirrors indexTest.jsx V7j (TestBarMinimalCSS) exactly.
 *
 * Key characteristics:
 * - Single createMemo batching ALL task property reads
 * - NO isDragging, isLocked, hasSubtasks conditionals
 * - NO useDrag hook
 * - NO context reading
 * - FIXED opacity (0.15) - not conditional
 * - FIXED progress color - not conditional
 * - Direct inline styles
 */
export function BarMinimal(props) {
    // Exactly like V7j - handle both signal and direct value
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;

    // Single memo batching ALL reads - matches V7j pattern
    const t = createMemo(() => {
        const task = getTask();
        const progress = task?.progress ?? 0;
        const width = task?.$bar?.width ?? 100;
        return {
            color: task?.color ?? '#3b82f6',
            progress,
            name: task?.name ?? '',
            pw: (width * progress) / 100,
            id: task?.id ?? '',
            x: task?.$bar?.x ?? 0,
            y: task?.$bar?.y ?? 0,
            width,
            height: task?.$bar?.height ?? 30,
        };
    });

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${t().x}px, ${t().y}px)`,
            width: `${t().width}px`,
            height: `${t().height}px`,
        }}>
            {/* Background - FIXED opacity like V7j */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                'background-color': t().color,
                opacity: 0.15,
                'border-radius': '3px',
            }} />
            {/* Progress bar - FIXED color/opacity like V7j */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${t().pw}px`,
                'background-color': '#a3a3ff',
                opacity: 0.3,
                'border-radius': '3px',
            }} />
            {/* Task name */}
            <div style={{
                position: 'absolute',
                top: '50%',
                left: '8px',
                transform: 'translateY(-50%)',
                color: '#fff',
                'font-size': '12px',
                'white-space': 'nowrap',
            }}>{t().name}</div>
            {/* Task ID (for debugging) */}
            <div style={{
                position: 'absolute',
                bottom: '2px',
                right: '4px',
                'font-size': '9px',
                color: '#888',
            }}>{t().id}</div>
        </div>
    );
}

export default BarMinimal;
