import { createSignal } from 'solid-js';
import { Gantt } from '../components/Gantt.jsx';
import { generateSubtaskDemo } from '../utils/subtaskGenerator.js';

/**
 * GanttProjectDemo - Demonstrates expandable subtasks with generated data.
 *
 * Features:
 * - 100 tasks across 5 resources (Alice, Bob, Charlie, Diana, Eve)
 * - Random mix of parent tasks with subtasks and standalone tasks
 * - Three subtask layouts: sequential, parallel, mixed
 * - Dependencies between parent/standalone tasks
 */
export function GanttProjectDemo() {
    // Generate tasks with seeded random (reproducible)
    const { tasks: generatedTasks, resources: generatedResources, expandedTasks } =
        generateSubtaskDemo({
            totalTasks: 100,
            parentTaskRatio: 1.0,  // 100% parents with subtasks
            seed: 12345,
        });

    const [resources] = createSignal(generatedResources);
    const [tasks] = createSignal(generatedTasks);

    // Options - all parent tasks expanded by default
    const [options] = createSignal({
        view_mode: 'Day',
        bar_height: 30,
        padding: 18,
        resourceColumnWidth: 150,
        subtaskHeightRatio: 0.5,
        expandedTasks,
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

    // Stats for display
    const parentCount = generatedTasks.filter(t => t.subtaskLayout).length;
    const subtaskCount = generatedTasks.filter(t => t.parentId).length;
    const standaloneCount = generatedTasks.filter(t => !t.subtaskLayout && !t.parentId).length;

    return (
        <div style={{ padding: '20px', 'max-width': '1400px', margin: '0 auto' }}>
            <h1 style={{ 'margin-bottom': '10px' }}>Subtask Demo</h1>
            <p style={{ color: '#666', 'margin-bottom': '20px' }}>
                {generatedTasks.length} tasks across {generatedResources.length} resources
                ({parentCount} parents, {subtaskCount} subtasks, {standaloneCount} standalone)
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
                    <li><strong>Sequential</strong>: Subtasks in a single row, back-to-back</li>
                    <li><strong>Parallel</strong>: Subtasks stacked vertically (overlap in time)</li>
                    <li><strong>Mixed</strong>: Auto-computed rows based on time overlap</li>
                </ul>
            </div>

            <div style={infoStyle}>
                <strong>Generation Config:</strong>
                <pre style={{
                    background: '#1e293b',
                    color: '#e2e8f0',
                    padding: '15px',
                    'border-radius': '4px',
                    'margin-top': '10px',
                    overflow: 'auto',
                    'font-size': '12px',
                }}>{`import { generateSubtaskDemo } from '../utils/subtaskGenerator.js';

const { tasks, resources, expandedTasks } = generateSubtaskDemo({
    totalTasks: 100,          // Target number of tasks
    parentTaskRatio: 0.3,     // 30% are parents with subtasks
    minSubtasks: 2,           // Min subtasks per parent
    maxSubtasks: 5,           // Max subtasks per parent
    seed: 12345,              // For reproducibility
});`}</pre>
            </div>
        </div>
    );
}

export default GanttProjectDemo;
