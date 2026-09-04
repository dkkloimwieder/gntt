// @ts-nocheck
import { createSignal } from 'solid-js';
import { Gantt } from '../components/Gantt';

/**
 * MultiSelectDemo — small project schedule with multi-task selection
 * and bulk drag.
 *
 * Click a bar to select it (replace selection). Ctrl/Cmd-click another
 * to add it to the selection (or toggle off). Shift-click to extend.
 * Once you have multiple selected, drag any selected bar — all selected
 * bars move together preserving their relative offsets.
 */
export function MultiSelectDemo() {
    const [selectedIds, setSelectedIds] = createSignal<string[]>([]);

    const tasks = [
        {
            id: 'plan',
            name: 'Planning',
            start: '2025-01-01',
            end: '2025-01-04',
            progress: 100,
            resource: 'Team A',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'design',
            name: 'Design',
            start: '2025-01-04',
            end: '2025-01-09',
            progress: 60,
            dependencies: [{ id: 'plan' }],
            resource: 'Team A',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'build',
            name: 'Build',
            start: '2025-01-09',
            end: '2025-01-15',
            progress: 0,
            dependencies: [{ id: 'design' }],
            resource: 'Team B',
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
            resource: 'Team A',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'docs',
            name: 'Docs',
            start: '2025-01-09',
            end: '2025-01-13',
            progress: 0,
            dependencies: [{ id: 'design' }],
            resource: 'Team C',
            color: '#a855f7',
            colorProgress: '#7e22ce',
        },
        {
            id: 'release',
            name: 'Release',
            start: '2025-01-17',
            end: '2025-01-18',
            progress: 0,
            dependencies: [{ id: 'review' }, { id: 'docs' }],
            resource: 'Team B',
            color: '#10b981',
            colorProgress: '#047857',
        },
    ];

    return (
        <div>
            <h2 style={{ margin: '0 0 12px 0' }}>Multi-Select & Bulk Drag</h2>
            <div
                style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '16px',
                    'margin-bottom': '12px',
                    'flex-wrap': 'wrap',
                }}
            >
                <p style={{ margin: 0, color: '#6b7280', 'font-size': '14px' }}>
                    <strong>Click</strong> selects one task ·{' '}
                    <strong>Ctrl/⌘-click</strong> toggles ·{' '}
                    <strong>Shift-click</strong> adds. Once multiple are
                    selected, drag any one to move them all together.
                </p>
                <div
                    style={{
                        padding: '6px 10px',
                        'border-radius': '4px',
                        'background-color': '#eef2ff',
                        color: '#4338ca',
                        'font-size': '13px',
                        'font-family': 'monospace',
                    }}
                >
                    Selected ({selectedIds().length}):{' '}
                    {selectedIds().join(', ') || '(none)'}
                </div>
            </div>
            <Gantt
                tasks={tasks}
                options={{
                    viewMode: 'Day',
                    scrollTo: 'start',
                }}
                onSelectionChange={(set) => {
                    setSelectedIds(Array.from(set).sort());
                }}
            />
        </div>
    );
}

export default MultiSelectDemo;
