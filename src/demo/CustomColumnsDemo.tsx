// @ts-nocheck
import { Gantt } from '../components/Gantt';

/**
 * CustomColumnsDemo — left panel with three configurable columns:
 * Task name, Owner (custom field on the task), and % progress with a
 * custom render function. Demonstrates the `columns` prop replacing
 * the default single resource column entirely.
 */
export function CustomColumnsDemo() {
    const tasks = [
        {
            id: 'plan',
            name: 'Planning',
            start: '2025-01-01',
            end: '2025-01-04',
            progress: 100,
            resource: 'plan',
            owner: 'Alice',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'design',
            name: 'Design',
            start: '2025-01-04',
            end: '2025-01-09',
            progress: 80,
            dependencies: [{ id: 'plan' }],
            resource: 'design',
            owner: 'Bob',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'build',
            name: 'Build',
            start: '2025-01-09',
            end: '2025-01-15',
            progress: 35,
            dependencies: [{ id: 'design' }],
            resource: 'build',
            owner: 'Charlie',
            color: '#10b981',
            colorProgress: '#047857',
        },
        {
            id: 'review',
            name: 'Review',
            start: '2025-01-15',
            end: '2025-01-17',
            progress: 0,
            dependencies: [{ id: 'build' }],
            resource: 'review',
            owner: 'Alice',
            color: '#a855f7',
            colorProgress: '#7e22ce',
        },
        {
            id: 'release',
            name: 'Release',
            start: '2025-01-17',
            end: '2025-01-18',
            progress: 0,
            dependencies: [{ id: 'review' }],
            resource: 'release',
            owner: 'Bob',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
    ];

    const columns = [
        { key: 'name', label: 'Task', width: 130 },
        { key: 'owner', label: 'Owner', width: 90 },
        {
            key: 'progress',
            label: 'Progress',
            width: 110,
            // Custom render: progress as a small bar + percent text.
            render: (task) => {
                const p = Math.max(
                    0,
                    Math.min(100, Number(task?.progress ?? 0)),
                );
                return (
                    <div
                        style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '6px',
                            width: '100%',
                        }}
                    >
                        <div
                            style={{
                                position: 'relative',
                                flex: '1',
                                height: '6px',
                                'background-color': '#e5e7eb',
                                'border-radius': '3px',
                                overflow: 'hidden',
                            }}
                        >
                            <div
                                style={{
                                    position: 'absolute',
                                    left: '0',
                                    top: '0',
                                    height: '100%',
                                    width: `${p}%`,
                                    'background-color':
                                        p === 100
                                            ? '#10b981'
                                            : p > 0
                                              ? '#3b82f6'
                                              : '#9ca3af',
                                }}
                            />
                        </div>
                        <span
                            style={{ 'font-variant-numeric': 'tabular-nums' }}
                        >
                            {p}%
                        </span>
                    </div>
                );
            },
        },
    ];

    return (
        <div>
            <h2 style={{ margin: '0 0 12px 0' }}>Custom Left-Panel Columns</h2>
            <p
                style={{
                    margin: '0 0 12px 0',
                    color: '#6b7280',
                    'font-size': '14px',
                }}
            >
                Three columns: Task (default key lookup), Owner (custom task
                field), Progress (custom render with mini-bar). The chart side
                still scrolls horizontally; the panel stays sticky-left.
            </p>
            <Gantt
                tasks={tasks}
                columns={columns}
                options={{
                    viewMode: 'Day',
                    scrollTo: 'start',
                }}
            />
        </div>
    );
}

export default CustomColumnsDemo;
