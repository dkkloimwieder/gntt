// @ts-nocheck
import { createSignal } from 'solid-js';
import { Gantt } from '../components/Gantt';

/**
 * CriticalPathDemo — software-project schedule with two parallel branches
 * (Frontend vs Backend). Backend takes longer, so the critical path runs
 * Setup → Backend Design → Backend Build → Integration → Deploy. The
 * Frontend chain has 4 days of slack, so its bars stay in the theme color
 * while the critical chain renders in red.
 *
 * Toggle the highlight on/off with the button to verify the prop pipeline.
 */
export function CriticalPathDemo() {
    const [criticalPath, setCriticalPath] = createSignal(true);

    const tasks = [
        {
            id: 'setup',
            name: 'Setup',
            start: '2025-01-01',
            end: '2025-01-03',
            progress: 100,
            resource: 'Planning',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        // Frontend branch — has slack
        {
            id: 'fe-design',
            name: 'Frontend Design (slack: 4d)',
            start: '2025-01-03',
            end: '2025-01-07',
            progress: 60,
            dependencies: [{ id: 'setup' }],
            resource: 'Design',
            color: '#10b981',
            colorProgress: '#047857',
        },
        {
            id: 'fe-build',
            name: 'Frontend Build (slack: 4d)',
            start: '2025-01-07',
            end: '2025-01-10',
            progress: 30,
            dependencies: [{ id: 'fe-design' }],
            resource: 'Build',
            color: '#10b981',
            colorProgress: '#047857',
        },
        // Backend branch — critical
        {
            id: 'be-design',
            name: 'Backend Design',
            start: '2025-01-03',
            end: '2025-01-08',
            progress: 80,
            dependencies: [{ id: 'setup' }],
            resource: 'Design',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'be-build',
            name: 'Backend Build',
            start: '2025-01-08',
            end: '2025-01-14',
            progress: 40,
            dependencies: [{ id: 'be-design' }],
            resource: 'Build',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        // Both branches converge here
        {
            id: 'integration',
            name: 'Integration',
            start: '2025-01-14',
            end: '2025-01-17',
            progress: 0,
            dependencies: [{ id: 'fe-build' }, { id: 'be-build' }],
            resource: 'Integration',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'deploy',
            name: 'Deploy',
            start: '2025-01-17',
            end: '2025-01-18',
            progress: 0,
            dependencies: [{ id: 'integration' }],
            resource: 'Ops',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
    ];

    return (
        <div>
            <div
                style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '16px',
                    'margin-bottom': '12px',
                }}
            >
                <h2 style={{ margin: 0 }}>Critical Path Highlighting</h2>
                <button
                    type="button"
                    onClick={() => setCriticalPath(!criticalPath())}
                    style={{
                        padding: '6px 12px',
                        'border-radius': '4px',
                        border: '1px solid #d1d5db',
                        background: criticalPath() ? '#dc2626' : '#fff',
                        color: criticalPath() ? '#fff' : '#374151',
                        cursor: 'pointer',
                    }}
                >
                    {criticalPath()
                        ? 'Hide critical path'
                        : 'Show critical path'}
                </button>
                <p style={{ margin: 0, color: '#6b7280', 'font-size': '14px' }}>
                    Backend branch is longer → critical. Frontend has 4 days
                    slack.
                </p>
            </div>
            <Gantt
                tasks={tasks}
                options={{
                    viewMode: 'Day',
                    criticalPath: criticalPath(),
                    scrollTo: 'start',
                }}
            />
        </div>
    );
}

export default CriticalPathDemo;
