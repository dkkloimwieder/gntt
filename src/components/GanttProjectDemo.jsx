import { createSignal } from 'solid-js';
import { Gantt } from './Gantt.jsx';

/**
 * GanttProjectDemo - Demonstrates expandable subtasks within resource rows.
 *
 * Features:
 * - Resources as rows (people, teams, etc.)
 * - Tasks assigned to resources
 * - Tasks can have subtasks that expand within the resource row
 * - Three subtask layouts: sequential, parallel, mixed
 */
export function GanttProjectDemo() {
    // Resources (people/teams - appear as rows)
    const [resources] = createSignal([
        { id: 'alice', name: 'Alice', color: '#3b82f6' },
        { id: 'bob', name: 'Bob', color: '#10b981' },
        { id: 'charlie', name: 'Charlie', color: '#f59e0b' },
    ]);

    // Tasks with subtask layouts
    const [tasks] = createSignal([
        // ═══════════════════════════════════════════════════════════════════════════
        // ALICE - Sequential subtasks example
        // ═══════════════════════════════════════════════════════════════════════════

        // Task with SEQUENTIAL subtasks (stacked vertically)
        {
            id: 'auth-feature',
            name: 'User Authentication',
            resource: 'alice',
            color: '#3b82f6',
            start: '2024-01-01',
            end: '2024-01-10',
            progress: 80,
            subtaskLayout: 'sequential',
        },
        // Subtasks for User Authentication
        {
            id: 'auth-sub1',
            name: 'Design login UI',
            parentId: 'auth-feature',
            resource: 'alice',
            color: '#60a5fa',
            start: '2024-01-01',
            end: '2024-01-03',
            progress: 100,
        },
        {
            id: 'auth-sub2',
            name: 'Implement OAuth',
            parentId: 'auth-feature',
            resource: 'alice',
            color: '#60a5fa',
            start: '2024-01-04',
            end: '2024-01-07',
            progress: 100,
            dependencies: 'auth-sub1',
        },
        {
            id: 'auth-sub3',
            name: 'Security audit',
            parentId: 'auth-feature',
            resource: 'alice',
            color: '#60a5fa',
            start: '2024-01-08',
            end: '2024-01-10',
            progress: 40,
            dependencies: 'auth-sub2',
        },

        // Regular task (no subtasks)
        {
            id: 'api-task',
            name: 'API Integration',
            resource: 'alice',
            color: '#3b82f6',
            start: '2024-01-11',
            end: '2024-01-15',
            progress: 20,
            dependencies: 'auth-feature',
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // BOB - Parallel subtasks example
        // ═══════════════════════════════════════════════════════════════════════════

        // Task with PARALLEL subtasks (same row, different times)
        {
            id: 'testing-task',
            name: 'Testing Phase',
            resource: 'bob',
            color: '#10b981',
            start: '2024-01-05',
            end: '2024-01-15',
            progress: 50,
            subtaskLayout: 'parallel',
        },
        // Subtasks for Testing (run in parallel)
        {
            id: 'test-unit',
            name: 'Unit Tests',
            parentId: 'testing-task',
            resource: 'bob',
            color: '#34d399',
            start: '2024-01-05',
            end: '2024-01-10',
            progress: 80,
        },
        {
            id: 'test-integration',
            name: 'Integration',
            parentId: 'testing-task',
            resource: 'bob',
            color: '#34d399',
            start: '2024-01-06',
            end: '2024-01-12',
            progress: 60,
        },
        {
            id: 'test-e2e',
            name: 'E2E Tests',
            parentId: 'testing-task',
            resource: 'bob',
            color: '#34d399',
            start: '2024-01-08',
            end: '2024-01-15',
            progress: 20,
        },

        // Regular task
        {
            id: 'deploy-task',
            name: 'Deployment',
            resource: 'bob',
            color: '#10b981',
            start: '2024-01-16',
            end: '2024-01-20',
            progress: 0,
            dependencies: 'testing-task',
        },

        // ═══════════════════════════════════════════════════════════════════════════
        // CHARLIE - Mixed subtasks example
        // ═══════════════════════════════════════════════════════════════════════════

        // Task with MIXED subtasks (some parallel, some sequential)
        {
            id: 'sprint-task',
            name: 'Sprint 1',
            resource: 'charlie',
            color: '#f59e0b',
            start: '2024-01-08',
            end: '2024-01-18',
            progress: 40,
            subtaskLayout: 'mixed',
        },
        // Subtasks for Sprint 1 (mixed layout - rows auto-computed based on time overlap)
        {
            id: 'sprint-docs',
            name: 'Documentation',
            parentId: 'sprint-task',
            resource: 'charlie',
            color: '#fbbf24',
            start: '2024-01-08',
            end: '2024-01-11',
            progress: 100,
        },
        {
            id: 'sprint-marketing',
            name: 'Marketing prep',
            parentId: 'sprint-task',
            resource: 'charlie',
            color: '#fbbf24',
            start: '2024-01-09',
            end: '2024-01-13',
            progress: 60,
            // Overlaps with docs - will be auto-placed on different row
        },
        {
            id: 'sprint-deploy',
            name: 'Deploy to prod',
            parentId: 'sprint-task',
            resource: 'charlie',
            color: '#fbbf24',
            start: '2024-01-14',
            end: '2024-01-18',
            progress: 0,
            dependencies: 'sprint-docs',
            // No overlap with docs - will share same row
        },

        // Regular task
        {
            id: 'monitor-task',
            name: 'Monitoring',
            resource: 'charlie',
            color: '#f59e0b',
            start: '2024-01-19',
            end: '2024-01-22',
            progress: 0,
            dependencies: 'sprint-task',
        },
    ]);

    // Options - expand tasks with subtasks by default
    const [options] = createSignal({
        view_mode: 'Day',
        bar_height: 30,
        padding: 18,
        resourceColumnWidth: 150,
        subtaskHeightRatio: 0.5,
        // Expand specific tasks by default
        expandedTasks: ['auth-feature', 'testing-task', 'sprint-task'],
    });

    // Callbacks
    const handleDateChange = (taskId, newDates) => {
        console.log('Date changed:', taskId, newDates);
    };

    const handleTaskClick = (taskId, event) => {
        console.log('Task clicked:', taskId);
    };

    // Info box styles
    const infoStyle = {
        padding: '15px',
        background: '#f8fafc',
        'border-radius': '6px',
        'margin-top': '20px',
        'font-size': '14px',
        'line-height': '1.6',
    };

    return (
        <div style={{ padding: '20px', 'max-width': '1400px', margin: '0 auto' }}>
            <h1 style={{ 'margin-bottom': '10px' }}>Subtask Demo</h1>
            <p style={{ color: '#666', 'margin-bottom': '20px' }}>
                Resources with tasks that have expandable subtasks.
            </p>

            <div style={{ border: '1px solid #ddd', 'border-radius': '8px', overflow: 'hidden' }}>
                <Gantt
                    tasks={tasks()}
                    resources={resources()}
                    options={options()}
                    onDateChange={handleDateChange}
                    onTaskClick={handleTaskClick}
                />
            </div>

            <div style={infoStyle}>
                <strong>Subtask Layout Types:</strong>
                <ul style={{ margin: '10px 0 0 0', 'padding-left': '20px' }}>
                    <li><strong>Sequential</strong> (Alice - User Authentication): Subtasks stack vertically</li>
                    <li><strong>Parallel</strong> (Bob - Testing Phase): Subtasks on same row, different times</li>
                    <li><strong>Mixed</strong> (Charlie - Sprint 1): Some parallel, some sequential</li>
                </ul>
            </div>

            <div style={infoStyle}>
                <strong>Data Structure:</strong>
                <pre style={{
                    background: '#1e293b',
                    color: '#e2e8f0',
                    padding: '15px',
                    'border-radius': '4px',
                    'margin-top': '10px',
                    overflow: 'auto',
                    'font-size': '12px',
                }}>{`// Resource (row in the chart)
{
  id: 'alice',
  name: 'Alice',
  color: '#3b82f6'
}

// Task with subtasks
{
  id: 'auth-feature',
  name: 'User Authentication',
  resource: 'alice',          // Belongs to this resource
  subtaskLayout: 'sequential', // 'sequential' | 'parallel' | 'mixed'
  color: '#3b82f6'
}

// Subtask
{
  id: 'auth-sub1',
  name: 'Design login UI',
  parentId: 'auth-feature',   // Links to parent task
  resource: 'alice',
  order: 0                    // Optional: controls placement priority
}`}</pre>
            </div>
        </div>
    );
}

export default GanttProjectDemo;
