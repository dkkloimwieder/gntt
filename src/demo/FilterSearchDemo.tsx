// @ts-nocheck
import { createSignal } from 'solid-js';
import { Gantt } from '../components/Gantt';

/**
 * FilterSearchDemo — small project schedule with two interactive props:
 *
 * - Search: highlights matching tasks by name; dims the rest (no layout
 *   change). Live as you type.
 * - Filter: a few preset predicates (only Backend, only In-Progress) that
 *   compress rows when active.
 *
 * Combine the two: filter to Backend, then search "build" to spotlight
 * Backend Build inside the smaller filtered set.
 */
export function FilterSearchDemo() {
    const [search, setSearch] = createSignal('');
    const [filterPreset, setFilterPreset] = createSignal('all');

    const tasks = [
        {
            id: 'fe-design',
            name: 'Frontend Design',
            start: '2025-01-01',
            end: '2025-01-04',
            progress: 100,
            resource: 'Frontend',
            color: '#10b981',
            colorProgress: '#047857',
            tag: 'frontend',
        },
        {
            id: 'fe-build',
            name: 'Frontend Build',
            start: '2025-01-04',
            end: '2025-01-09',
            progress: 60,
            dependencies: [{ id: 'fe-design' }],
            resource: 'Frontend',
            color: '#10b981',
            colorProgress: '#047857',
            tag: 'frontend',
        },
        {
            id: 'fe-polish',
            name: 'Frontend Polish',
            start: '2025-01-09',
            end: '2025-01-11',
            progress: 0,
            dependencies: [{ id: 'fe-build' }],
            resource: 'Frontend',
            color: '#10b981',
            colorProgress: '#047857',
            tag: 'frontend',
        },
        {
            id: 'be-design',
            name: 'Backend Design',
            start: '2025-01-01',
            end: '2025-01-05',
            progress: 100,
            resource: 'Backend',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
            tag: 'backend',
        },
        {
            id: 'be-build',
            name: 'Backend Build',
            start: '2025-01-05',
            end: '2025-01-12',
            progress: 40,
            dependencies: [{ id: 'be-design' }],
            resource: 'Backend',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
            tag: 'backend',
        },
        {
            id: 'be-deploy',
            name: 'Backend Deploy',
            start: '2025-01-12',
            end: '2025-01-13',
            progress: 0,
            dependencies: [{ id: 'be-build' }],
            resource: 'Backend',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
            tag: 'backend',
        },
        {
            id: 'qa-test',
            name: 'QA Test',
            start: '2025-01-09',
            end: '2025-01-13',
            progress: 0,
            dependencies: [{ id: 'fe-polish' }, { id: 'be-build' }],
            resource: 'QA',
            color: '#a855f7',
            colorProgress: '#7e22ce',
            tag: 'qa',
        },
    ];

    const filterFn = () => {
        const p = filterPreset();
        if (p === 'all') return undefined;
        if (p === 'backend') return (t) => t.tag === 'backend';
        if (p === 'in-progress')
            return (t) => t.progress > 0 && t.progress < 100;
        if (p === 'incomplete') return (t) => (t.progress ?? 0) < 100;
        return undefined;
    };

    return (
        <div>
            <h2 style={{ margin: '0 0 12px 0' }}>Filter & Search</h2>
            <div
                style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '16px',
                    'margin-bottom': '12px',
                    'flex-wrap': 'wrap',
                }}
            >
                <label
                    style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '8px',
                    }}
                >
                    Search:
                    <input
                        type="text"
                        value={search()}
                        onInput={(e) => setSearch(e.currentTarget.value)}
                        placeholder="e.g. build, deploy, QA"
                        style={{
                            padding: '6px 10px',
                            'border-radius': '4px',
                            border: '1px solid #d1d5db',
                            width: '220px',
                        }}
                    />
                </label>
                <label
                    style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '8px',
                    }}
                >
                    Filter:
                    <select
                        value={filterPreset()}
                        onChange={(e) => setFilterPreset(e.currentTarget.value)}
                        style={{
                            padding: '6px 10px',
                            'border-radius': '4px',
                            border: '1px solid #d1d5db',
                        }}
                    >
                        <option value="all">All tasks</option>
                        <option value="backend">Backend only</option>
                        <option value="in-progress">In progress</option>
                        <option value="incomplete">Incomplete</option>
                    </select>
                </label>
                <p
                    style={{
                        margin: 0,
                        color: '#6b7280',
                        'font-size': '14px',
                    }}
                >
                    Search dims non-matches. Filter removes rows entirely.
                </p>
            </div>
            <Gantt
                tasks={tasks}
                options={{
                    viewMode: 'Day',
                    scrollTo: 'start',
                    // Signal accessors wrap to getters automatically; a
                    // function-call result (filterFn()) does not, so write
                    // an explicit getter to keep filter reactive.
                    get search() {
                        return search();
                    },
                    get filter() {
                        return filterFn();
                    },
                }}
            />
        </div>
    );
}

export default FilterSearchDemo;
