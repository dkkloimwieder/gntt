# Subtasks

Subtasks are tasks that name another task as their parent. Use the full
task layer with `options.renderMode: 'detailed'` to draw children within
an expanded parent. The chart uses the full task layer by default.

## Set up a parent and its children

```tsx
import { Gantt } from 'ganttss';

const tasks = [
    {
        id: 'feature',
        name: 'Feature',
        start: '2025-01-01',
        end: '2025-01-08',
        resource: 'alice',
        subtaskLayout: 'mixed' as const,
    },
    {
        id: 'design',
        name: 'Design',
        parentId: 'feature',
        start: '2025-01-01',
        end: '2025-01-05',
        resource: 'alice',
    },
    {
        id: 'build',
        name: 'Build',
        parentId: 'feature',
        start: '2025-01-03',
        end: '2025-01-08',
        resource: 'alice',
    },
];

<Gantt
    tasks={tasks}
    options={{
        renderMode: 'detailed',
        expandedTasks: ['feature'],
        subtaskHeightRatio: 0.5,
    }}
/>;
```

Give each task a unique ID. Set a child's `parentId` to the parent's ID.
Put a parent and its children on the same resource row. If the tasks have
no resource and the chart derives its rows from tasks, it uses the
`Unassigned` row.

If you supply a `resources` list, use each resource's ID in the tasks.
Keep the entries in display order. A group uses `type: 'group'`.
Give its member resources a `group` field with that group ID. Collapsing
the group hides those resource rows and their tasks.

The chart detects summary parents when their `type` is missing. A summary
bar spans its children. The chart warns and removes a link when the
parent is missing or the link would keep a parent cycle. The task and its
descendants stay in the chart.

## Choose a layout

| `subtaskLayout`        | Row placement                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `sequential` (default) | All children share one row. Use nonoverlapping dates for this layout.                       |
| `parallel`             | Each child uses a separate row.                                                             |
| `mixed`                | Children share the first row where their dates fit. Overlapping children use separate rows. |

The layout changes how the chart draws the children. It leaves the
specified dates in place. In a mixed layout, a child can share a row with
another child that ends at its start.

`subtaskHeightRatio` sets the height of a subtask bar as a fraction of
`barHeight`. It defaults to `0.5`. A sequential parent uses the normal
bar height. Parallel and mixed parents grow to fit their subtask rows.

## Expand containers and hide branches

`options.expandedTasks` lists the parents to draw as expanded containers.
For programmatic control, read `ganttConfig` through `useGanttStores()`
inside a `GanttProvider`. Call `expandTask(id)`, `collapseTask(id)`,
`toggleTaskExpansion(id)`, `expandAllTasks(ids)`, or `collapseAllTasks()`.
Use `isTaskExpanded(id)` to read the committed expansion state.

The task store has a separate collapse state for ancestor visibility.
`taskStore.collapseTask(id)` hides the task's descendants.
`taskStore.expandTask(id)` restores visibility if no other ancestor is
collapsed. These actions do not change the parent container configuration.
Solid commits store writes after the current synchronous code finishes.

## Test Data Generator

For testing and demos, import `generateSubtaskDemo()` from `ganttss`.

```javascript
import { generateSubtaskDemo } from 'ganttss';

const { tasks, resources, expandedTasks } = generateSubtaskDemo({
    totalTasks: 100,
    parentTaskRatio: 1.0,
    seed: 12345,
});
```

### Generator Configuration

| Option                | Default                               | Description                                               |
| --------------------- | ------------------------------------- | --------------------------------------------------------- |
| `totalTasks`          | 100                                   | Target number of tasks                                    |
| `parentTaskRatio`     | 0.7                                   | Target fraction of tasks in parent-child groups (0.0–1.0) |
| `minSubtasks`         | 2                                     | Minimum subtasks per parent                               |
| `maxSubtasks`         | 4                                     | Maximum subtasks per parent                               |
| `subtaskLayouts`      | `['sequential', 'parallel', 'mixed']` | Available layout types                                    |
| `startDate`           | `'2024-01-01'`                        | Start date for generation                                 |
| `taskDurationDays`    | `{ min: 7, max: 14 }`                 | Parent task duration range                                |
| `subtaskDurationDays` | `{ min: 2, max: 5 }`                  | Subtask duration range                                    |
| `dependencyChance`    | 0.3                                   | Probability of FS dependency (0.0-1.0)                    |
| `seed`                | 12345                                 | Random seed for reproducibility                           |

### Generator Output

```javascript
{
  tasks: GeneratedSubtaskTask[],           // All tasks (parents + subtasks)
  resources: ResourceDef[],   // 5 resources: Alice, Bob, Charlie, Diana, Eve
  expandedTasks: string[], // IDs of parent tasks (for expandedTasks option)
}
```

## Demo

Run the subtask demo:

```bash
pnpm dev
# Open http://localhost:5173/examples/subtask.html
```

## Implementation

[buildHierarchy](../src/utils/hierarchyProcessor.ts) links tasks and
assigns their depth. [The row layout calculator](../src/utils/rowLayoutCalculator.ts)
assigns vertical positions. [ExpandedTaskContainer](../src/components/ExpandedTaskContainer.tsx)
uses those positions to draw child bars with [SubtaskBar](../src/components/SubtaskBar.tsx).
