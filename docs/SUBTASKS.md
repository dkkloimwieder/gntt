# Subtasks

Subtasks allow you to break down parent tasks into smaller, manageable pieces that render inside the parent container. The Gantt chart supports three layout modes that control how subtasks are visually arranged.

## Quick Start

```javascript
const tasks = [
  // Parent task with subtaskLayout
  {
    id: 'feature-1',
    name: 'Feature Development',
    subtaskLayout: 'sequential',  // or 'parallel' or 'mixed'
    start: '2024-01-01',
    end: '2024-01-15',
    resource: 'alice',
    color: '#3b82f6',
  },
  // Subtasks reference parent via parentId
  {
    id: 'sub-1',
    name: 'Design',
    parentId: 'feature-1',
    start: '2024-01-01',
    end: '2024-01-05',
    resource: 'alice',
    color: '#93c5fd',
  },
  {
    id: 'sub-2',
    name: 'Develop',
    parentId: 'feature-1',
    start: '2024-01-06',
    end: '2024-01-12',
    resource: 'alice',
    color: '#93c5fd',
  },
];

// Expand parent tasks by default
const options = {
  expandedTasks: ['feature-1'],
};
```

## Layout Types

### Sequential

Subtasks render back-to-back in a single row. Use when tasks must be completed in order.

```
┌─────────────────────────────────────────────────┐
│ [ Design ][ Develop ][ Test ][ Deploy ]         │
└─────────────────────────────────────────────────┘
```

- **Behavior**: No time overlap between subtasks
- **Container height**: Same as regular task bar
- **Use case**: Waterfall-style task breakdown

### Parallel

All subtasks start at the same time and stack vertically. Use when tasks can be done simultaneously.

```
┌─────────────────────────────────────────────────┐
│ [ Design──────────── ]                          │
│ [ Backend Development───────── ]                │
│ [ Frontend Development──── ]                    │
│ [ Testing────── ]                               │
└─────────────────────────────────────────────────┘
```

- **Behavior**: Full time overlap, all start together
- **Container height**: Expands to fit all subtasks stacked
- **Use case**: Concurrent work streams

### Mixed

Some subtasks overlap, others don't. Rows are auto-computed based on time conflicts.

```
┌─────────────────────────────────────────────────┐
│ [ Design── ]         [ Testing──── ]            │
│ [ Development─────────────── ]                  │
└─────────────────────────────────────────────────┘
```

- **Behavior**: Partial overlap, auto-computed rows
- **Container height**: Adapts to number of computed rows
- **Use case**: Complex scheduling with some parallel work

## Task Data Structure

### Parent Task

```javascript
{
  id: string,                    // Unique identifier
  name: string,                  // Display name
  subtaskLayout: 'sequential' | 'parallel' | 'mixed',
  start: string,                 // YYYY-MM-DD
  end: string,                   // YYYY-MM-DD
  progress: number,              // 0-100
  color: string,                 // HEX color for container border
  resource: string,              // Resource/swimlane ID
}
```

### Subtask

```javascript
{
  id: string,                    // Unique identifier
  name: string,                  // Display name
  parentId: string,              // References parent task ID
  start: string,                 // YYYY-MM-DD
  end: string,                   // YYYY-MM-DD
  progress: number,              // 0-100
  color: string,                 // HEX color (typically lighter than parent)
  resource: string,              // Same resource as parent
}
```

## Configuration Options

```javascript
const options = {
  // Subtask bar height as fraction of normal bar height
  // Default: 0.5 (subtasks are 50% height)
  subtaskHeightRatio: 0.5,

  // Array of task IDs that should start expanded
  // Default: [] (all collapsed)
  expandedTasks: ['task-1', 'task-2'],
};
```

## Programmatic Expansion Control

Access expansion methods via the Gantt config store:

```javascript
// Check if task is expanded
ganttConfig.isTaskExpanded('task-1');

// Toggle expansion
ganttConfig.toggleTaskExpansion('task-1');

// Expand specific task
ganttConfig.expandTask('task-1');

// Collapse specific task
ganttConfig.collapseTask('task-1');

// Expand multiple tasks
ganttConfig.expandAllTasks(['task-1', 'task-2']);

// Collapse all tasks
ganttConfig.collapseAllTasks();
```

## Test Data Generator

For testing and demos, use the `generateSubtaskDemo()` utility:

```javascript
import { generateSubtaskDemo } from './utils/subtaskGenerator.js';

const { tasks, resources, expandedTasks } = generateSubtaskDemo({
  totalTasks: 100,
  parentTaskRatio: 1.0,
  seed: 12345,
});
```

### Generator Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `totalTasks` | 100 | Total number of tasks to generate |
| `parentTaskRatio` | 0.7 | Fraction that are parents (0.0-1.0) |
| `minSubtasks` | 2 | Minimum subtasks per parent |
| `maxSubtasks` | 4 | Maximum subtasks per parent |
| `subtaskLayouts` | `['sequential', 'parallel', 'mixed']` | Available layout types |
| `startDate` | `'2024-01-01'` | Start date for generation |
| `taskDurationDays` | `{ min: 7, max: 14 }` | Parent task duration range |
| `subtaskDurationDays` | `{ min: 2, max: 5 }` | Subtask duration range |
| `dependencyChance` | 0.3 | Probability of FS dependency (0.0-1.0) |
| `seed` | 12345 | Random seed for reproducibility |

### Generator Output

```javascript
{
  tasks: Task[],           // All tasks (parents + subtasks)
  resources: Resource[],   // 5 resources: Alice, Bob, Charlie, Diana, Eve
  expandedTasks: string[], // IDs of parent tasks (for expandedTasks option)
}
```

## Demo

Run the subtask demo:

```bash
pnpm dev
# Open http://localhost:5173/examples/subtask.html
```

## Component Architecture

### ExpandedTaskContainer

Renders the parent container with dashed border and positions subtasks inside.

- **File**: `src/components/ExpandedTaskContainer.jsx`
- **Props**: `taskId`, `taskStore`, `ganttConfig`, `rowLayout`
- **Computes**: Container height based on layout and subtask count

### SubtaskBar

Renders individual subtask bars at 50% height.

- **File**: `src/components/SubtaskBar.jsx`
- **Props**: `task`, `index`, `y`, `layout`, `config`
- **Features**: Compact labels, outline styling, progress indicator

### rowLayoutCalculator

Computes variable row heights and task positions.

- **File**: `src/utils/rowLayoutCalculator.js`
- **Key functions**:
  - `calculateRowLayouts()` - Main layout computation
  - `calculateExpandedRowHeight()` - Height for expanded task
  - `computeSubtaskRows()` - Row assignment based on time overlap

## Internal Algorithm

### Time Overlap Detection

For parallel and mixed layouts, the system detects time conflicts:

```javascript
// Two tasks overlap if NOT (one ends before other starts)
const overlaps = !(taskA.end <= taskB.start || taskA.start >= taskB.end);
```

### Row Packing Algorithm

Subtasks are assigned to rows using a first-fit packing algorithm:

1. Sort subtasks by start time
2. For each subtask, find the first row where it doesn't overlap
3. If no row fits, create a new row
4. Assign subtask to that row

This ensures minimal vertical space while preventing visual overlaps.

### Height Calculation

| Layout | Height Formula |
|--------|----------------|
| Sequential | `barHeight + padding` (same as regular task) |
| Parallel | `verticalPadding * 2 + subtaskCount * subtaskBarHeight + (subtaskCount - 1) * subtaskPadding` |
| Mixed | Same as parallel, but `subtaskCount` = computed row count |
