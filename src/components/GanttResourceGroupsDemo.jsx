import { createSignal } from 'solid-js';
import { Gantt } from './Gantt.jsx';

/**
 * GanttResourceGroupsDemo - Demo for resource groups with collapse/expand.
 */
export function GanttResourceGroupsDemo() {
    // Grouped resources: Engineering and Design teams
    const [resources] = createSignal([
        { id: 'Engineering', type: 'group' },
        { id: 'Alice', type: 'resource', group: 'Engineering' },
        { id: 'Bob', type: 'resource', group: 'Engineering' },
        { id: 'Charlie', type: 'resource', group: 'Engineering' },
        { id: 'Design', type: 'group' },
        { id: 'Diana', type: 'resource', group: 'Design' },
        { id: 'Eve', type: 'resource', group: 'Design' },
        { id: 'QA', type: 'group' },
        { id: 'Frank', type: 'resource', group: 'QA' },
        { id: 'Grace', type: 'resource', group: 'QA' },
    ]);

    // Tasks assigned to different resources
    const [tasks] = createSignal([
        // Engineering tasks
        {
            id: 'task-1',
            name: 'Backend API',
            start: '2024-01-01',
            end: '2024-01-08',
            progress: 100,
            color: '#3b82f6',
            resource: 'Alice',
        },
        {
            id: 'task-2',
            name: 'Database Setup',
            start: '2024-01-05',
            end: '2024-01-12',
            progress: 80,
            color: '#3b82f6',
            resource: 'Bob',
            dependencies: 'task-1',
        },
        {
            id: 'task-3',
            name: 'Auth System',
            start: '2024-01-10',
            end: '2024-01-18',
            progress: 45,
            color: '#3b82f6',
            resource: 'Charlie',
            dependencies: 'task-2',
        },
        {
            id: 'task-4',
            name: 'API Integration',
            start: '2024-01-15',
            end: '2024-01-22',
            progress: 20,
            color: '#3b82f6',
            resource: 'Alice',
            dependencies: 'task-3',
        },
        // Design tasks
        {
            id: 'task-5',
            name: 'UI Wireframes',
            start: '2024-01-01',
            end: '2024-01-06',
            progress: 100,
            color: '#8b5cf6',
            resource: 'Diana',
        },
        {
            id: 'task-6',
            name: 'Visual Design',
            start: '2024-01-07',
            end: '2024-01-15',
            progress: 60,
            color: '#8b5cf6',
            resource: 'Eve',
            dependencies: 'task-5',
        },
        {
            id: 'task-7',
            name: 'Design System',
            start: '2024-01-10',
            end: '2024-01-20',
            progress: 30,
            color: '#8b5cf6',
            resource: 'Diana',
            dependencies: 'task-5',
        },
        // QA tasks
        {
            id: 'task-8',
            name: 'Test Planning',
            start: '2024-01-08',
            end: '2024-01-12',
            progress: 100,
            color: '#10b981',
            resource: 'Frank',
        },
        {
            id: 'task-9',
            name: 'Integration Tests',
            start: '2024-01-18',
            end: '2024-01-25',
            progress: 10,
            color: '#10b981',
            resource: 'Grace',
            dependencies: 'task-3,task-8',
        },
        {
            id: 'task-10',
            name: 'UAT',
            start: '2024-01-22',
            end: '2024-01-30',
            progress: 0,
            color: '#10b981',
            resource: 'Frank',
            dependencies: 'task-9',
        },
    ]);

    // Options
    const [options] = createSignal({
        view_mode: 'Day',
        bar_height: 30,
        padding: 18,
        column_width: 45,
        upper_header_height: 45,
        lower_header_height: 30,
        lines: 'both',
        scroll_to: 'start',
    });

    // Event handlers (no-op for demo)
    const handleDateChange = () => {};
    const handleProgressChange = () => {};
    const handleTaskClick = () => {};

    // Styles
    const containerStyle = {
        'max-width': '1400px',
        margin: '0 auto',
        padding: '20px',
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    };

    const headerStyle = {
        'margin-bottom': '20px',
    };

    const ganttWrapperStyle = {
        border: '1px solid #e0e0e0',
        'border-radius': '8px',
        overflow: 'hidden',
        'background-color': '#fff',
    };

    const infoStyle = {
        'margin-top': '20px',
        padding: '15px',
        'background-color': '#f5f5f5',
        'border-radius': '8px',
        'font-size': '14px',
    };

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <h1 style={{ margin: '0 0 10px 0', color: '#333' }}>
                    Resource Groups Demo
                </h1>
                <p style={{ margin: 0, color: '#666' }}>
                    Collapsible resource groups with tasks organized by team.
                </p>
            </div>

            <div style={ganttWrapperStyle}>
                <Gantt
                    tasks={tasks()}
                    resources={resources()}
                    options={options()}
                    onDateChange={handleDateChange}
                    onProgressChange={handleProgressChange}
                    onTaskClick={handleTaskClick}
                />
            </div>

            <div style={infoStyle}>
                <strong>Resource Groups Features:</strong>
                <ul style={{ margin: '10px 0 0 0', 'padding-left': '20px' }}>
                    <li>Click on group headers (Engineering, Design, QA) to collapse/expand</li>
                    <li>Group rows have distinct styling (gray background)</li>
                    <li>Resources belong to groups via the <code>group</code> property</li>
                    <li>Tasks are assigned to resources and appear in their rows</li>
                    <li>Virtualization respects collapse state</li>
                </ul>
                <p style={{ margin: '10px 0 0 0' }}>
                    <strong>Data Structure:</strong>
                </p>
                <pre style={{
                    'background-color': '#fff',
                    padding: '10px',
                    'border-radius': '4px',
                    overflow: 'auto',
                    'font-size': '12px',
                }}>
{`// Resources with groups
[
  { id: 'Engineering', type: 'group' },
  { id: 'Alice', type: 'resource', group: 'Engineering' },
  { id: 'Bob', type: 'resource', group: 'Engineering' },
  ...
]

// Tasks assigned to resources
{ id: 'task-1', name: 'Backend API', resource: 'Alice', ... }`}
                </pre>
            </div>
        </div>
    );
}

export default GanttResourceGroupsDemo;
