# SolidJS Architecture Documentation

**Last Updated**: December 29, 2025 (Constraint engine rewrite - iterative relaxation algorithm for correct cascade resolution)

This document describes the SolidJS Gantt chart implementation.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Directory Structure](#directory-structure)
3. [Core Components](#core-components)
4. [Stores](#stores)
5. [Utility Functions](#utility-functions)
6. [Hooks](#hooks)
7. [Demo Pages](#demo-pages)
8. [Configuration Options](#configuration-options)
9. [Key Features](#key-features)
10. [Development Workflow](#development-workflow)

---

## Project Overview

The SolidJS implementation lives in `src/` and provides reactive, fine-grained updates for Gantt chart components.

### Component Status

| Component | Status | Location |
|-----------|--------|----------|
| Arrow | Complete | `src/components/Arrow.jsx` |
| Bar | Complete | `src/components/Bar.jsx` |
| Popup | Complete | `src/components/TaskDataPopup.jsx` |
| Modal | Complete | `src/components/TaskDataModal.jsx` |
| Task Store | Complete | `src/stores/taskStore.js` |
| Config Store | Complete | `src/stores/ganttConfigStore.js` |
| Date Store | Complete | `src/stores/ganttDateStore.js` |
| Resource Store | Complete | `src/stores/resourceStore.js` |
| Constraint System | Complete | `src/utils/constraintEngine.js` |
| Main Gantt Orchestrator | Complete | `src/components/Gantt.jsx` |
| Grid & Headers | Complete | `src/components/Grid.jsx`, `DateHeaders.jsx` |
| Resource Column | Complete | `src/components/ResourceColumn.jsx` |
| Task Layer | Complete | `src/components/TaskLayer.jsx` |
| Arrow Layer | Complete | `src/components/ArrowLayer.jsx` |
| ExpandedTaskContainer | Complete | `src/components/ExpandedTaskContainer.jsx` |
| SubtaskBar | Complete | `src/components/SubtaskBar.jsx` |

> **See also**: [SUBTASKS.md](./SUBTASKS.md) for comprehensive subtask documentation.

---

## Public API (`src/index.js`)

The library exports the following from `src/index.js`:

### Main Component
- `Gantt` - Main Gantt chart component

### Store Factories
- `createTaskStore()` - Creates reactive task state management
- `createGanttConfigStore(config)` - Creates configuration store
- `createGanttDateStore()` - Creates date/timeline calculation store
- `createResourceStore()` - Creates resource group store

### Context API
- `GanttEventsProvider` - Wraps Gantt to provide event handlers via context
- `useGanttEvents()` - Hook to access event handlers (`onDateChange`, `onProgressChange`, `onTaskClick`, etc.)

### Constraint Functions
- `resolveMovement(taskId, deltaX, taskStore, options)` - Resolve drag movement with dependency constraints
- `detectCycles(taskId, taskStore)` - Check for circular dependencies

### Hierarchy Functions
- `buildHierarchy(tasks)` - Build parent-child task tree from flat array
- `collectDescendants(taskId, taskStore)` - Get all descendant task IDs

### Generator Functions
- `generateSubtaskDemo(config)` - Generate test data with parent/child tasks

### Date Utilities (re-exported from `date_utils.js`)
- `parse(date)` - Parse date string to Date object
- `format(date, formatString)` - Format Date to string
- `diff(date1, date2, scale)` - Calculate difference between dates
- `add(date, qty, scale)` - Add time to date
- `start_of(date, scale)` - Get start of time period
- `parse_duration(duration)` - Parse duration string (e.g., "2d", "4h")

---

## Directory Structure

```
src/
├── components/
│   ├── Arrow.jsx           # Dependency arrow rendering
│   ├── ArrowLayer.jsx      # Container for all arrows
│   ├── Bar.jsx             # Task bar with drag/resize/progress
│   ├── DateHeaders.jsx     # Month/day headers
│   ├── Gantt.jsx           # Main orchestrator component
│   ├── GanttContainer.jsx  # Scroll container with sticky headers
│   ├── GanttDemo.jsx       # Full Gantt demo page
│   ├── GanttPerfDemo.jsx   # Performance testing demo
│   ├── GanttResourceGroupsDemo.jsx  # Resource groups demo
│   ├── Grid.jsx            # Background grid with rows and ticks
│   ├── Arrow.jsx           # Single dependency arrow
│   ├── ArrowLayerBatched.jsx # Batched arrow rendering
│   ├── SummaryBar.jsx      # Parent/summary task bars
│   ├── ResourceColumn.jsx  # Sticky left column (swimlanes)
│   ├── ShowcaseDemo.jsx    # Interactive props showcase
│   ├── TaskDataModal.jsx   # Debug/detail modal on click
│   ├── TaskDataPopup.jsx   # Hover tooltip popup
│   ├── TaskLayer.jsx       # Container for all bars
│   ├── ExpandedTaskContainer.jsx  # Expanded parent with subtasks
│   └── SubtaskBar.jsx      # Individual subtask bars (50% height)
├── stores/
│   ├── taskStore.js        # Reactive task state management
│   ├── ganttConfigStore.js # Configuration state management
│   ├── ganttDateStore.js   # Date/timeline calculations
│   └── resourceStore.js    # Resource groups and collapse state
├── utils/
│   ├── barCalculations.js  # Pure functions for bar geometry
│   ├── constraintEngine.js # Unified constraint resolution (iterative relaxation)
│   ├── absoluteConstraints.js # Lock type helpers, absolute time constraints
│   ├── createVirtualViewport.js # Simple 2D viewport virtualization
│   ├── resourceProcessor.js # Resource normalization and group display
│   ├── taskProcessor.js    # Task parsing and position computation
│   ├── taskGenerator.js    # Test data generation
│   ├── subtaskGenerator.js # Subtask demo data generation
│   └── rowLayoutCalculator.js # Variable row heights for subtasks
├── hooks/
│   └── useDrag.js          # RAF-based drag state machine
├── entries/                # Vite entry points for demos
│   ├── gantt.jsx
│   ├── resource-groups.jsx
│   ├── perf.jsx
│   ├── subtask.jsx         # Subtask demo (100 tasks with subtasks)
│   ├── arrow.jsx
│   ├── bar.jsx
│   ├── constraint.jsx
│   └── showcase.jsx
├── scripts/
│   └── generateCalendar.js # CLI for generating test data
├── data/
│   └── calendar.json       # Generated test data
└── styles/
    └── *.css               # Stylesheets
```

---

## Core Components

### Arrow Component (`Arrow.jsx`)

**Purpose**: Renders SVG path arrows between task bars to visualize dependencies.

**Key Features**:
- Auto-selects anchor points (top/bottom/right) based on task positions
- Smart exit point calculation (default 90% along bar for vertical offsets)
- Orthogonal routing with configurable curve radius
- Supports multiple arrow head shapes (chevron, triangle, none)
- Reactive path updates when task positions change

**Props**:
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `from` | `{x, y, width, height}` | - | Direct predecessor position |
| `to` | `{x, y, width, height}` | - | Direct successor position |
| `taskStore` | `TaskStore` | - | Store for reactive position lookup |
| `fromId` | `string` | - | Task ID for predecessor lookup |
| `toId` | `string` | - | Task ID for successor lookup |
| `startAnchor` | `'auto'\|'top'\|'bottom'\|'left'\|'right'` | `'auto'` | Where arrow exits predecessor |
| `endAnchor` | `'auto'\|'left'\|'top'\|'right'` | `'auto'` | Where arrow enters successor |
| `dependencyType` | `'FS'\|'SS'\|'FF'\|'SF'` | `'FS'` | Dependency type (affects anchor selection and exit point) |
| `startOffset` | `number` | Smart calc | 0-1 position along anchor edge |
| `routing` | `'orthogonal'\|'straight'` | `'orthogonal'` | Path routing style |
| `curveRadius` | `number` | `5` | Radius for rounded corners |
| `stroke` | `string` | `'#666'` | Arrow color |
| `strokeWidth` | `number` | `1.4` | Line thickness |
| `headSize` | `number` | `5` | Arrow head size |
| `headShape` | `'chevron'\|'triangle'\|'diamond'\|'circle'\|'none'` | `'chevron'` | Arrow head style |
| `headFill` | `boolean` | `false` | Fill arrow head (not chevron) |
| `strokeOpacity` | `number` | `1` | Line opacity (0-1) |
| `strokeDasharray` | `string` | `''` | Dash pattern (e.g., '8,4') |

**Path Calculation Logic** (`Arrow.jsx:calculateSmartOffset`):

Exit point positioning depends on dependency type:
- **FS/FF**: Exit near the END (right) of predecessor → offset 0.9
- **SS/SF**: Exit near the START (left) of predecessor → offset 0.1

```javascript
function calculateSmartOffset(from, to, anchor, curveRadius, dependencyType = 'FS') {
    if (anchor === 'right') return 0.5;  // Center of right edge
    if (anchor === 'left') return 0.5;   // Center of left edge

    if (anchor === 'top' || anchor === 'bottom') {
        // SS/SF: Exit near the START (left) of predecessor
        if (dependencyType === 'SS' || dependencyType === 'SF') {
            return 0.1;  // Exit near left edge
        }
        // FS/FF: Exit near the END (right) of predecessor
        const defaultOffset = 0.9;
        const maxExitX = to.x - curveRadius;
        const maxOffset = (maxExitX - from.x) / from.width;
        return Math.max(0.1, Math.min(defaultOffset, maxOffset));
    }
    return 0.5;
}
```

---

### ResourceColumn Component (`ResourceColumn.jsx`)

**Purpose**: Renders a sticky left column showing unique resource labels for swimlane layout.

**Key Features**:
- CSS sticky positioning (stays fixed during horizontal scroll)
- Resource cells positioned to match SVG grid rows exactly
- Supports alphabetic labels (A-Z, AA, AB, etc.)

**Props**:
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `resources` | `string[]` | `[]` | Array of unique resource names |
| `ganttConfig` | `GanttConfigStore` | - | Config store for headerHeight, barHeight, padding |
| `width` | `number` | `60` | Column width in pixels |
| `headerLabel` | `string` | `'Resource'` | Header text (currently not rendered) |

**Cell Positioning Formula**:
```javascript
// Must match SVG row positioning in Grid.jsx and barCalculations.computeY
cellTop = headerHeight + padding/2 + index * (barHeight + padding)
```

**Swimlane Layout**:
- Each unique resource gets one row
- Multiple tasks with same resource appear on same row
- Tasks are positioned by resource index, not task index
- Cross-resource dependencies create diagonal arrows between swimlanes

---

### Bar Component (`Bar.jsx`)

**Purpose**: Renders interactive task bars with drag, resize, and progress editing.

**Key Features**:
- Reactive position from taskStore
- Grid snapping during drag (respects `columnWidth`)
- Left/right resize handles
- Progress handle (circular drag target)
- Expected progress visualization (based on dates vs today)
- Locked task styling (gray + dashed border + lock icon)
- Constraint integration via `onConstrainPosition` callback

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `task` | `Task` | Task data object |
| `taskStore` | `TaskStore` | Store for position management |
| `ganttConfig` | `GanttConfigStore` | Configuration signals |
| `onConstrainPosition` | `(id, x, y) => {x, y} \| null` | Constraint callback |
| `onDateChange` | `(id, {x, width}) => void` | Date change callback |
| `onProgressChange` | `(id, progress) => void` | Progress change callback |

**Task Object Shape**:
```javascript
{
    id: 'task-1',
    name: 'Task Name',
    progress: 50,           // 0-100
    _start: Date,           // For expected progress
    _end: Date,             // For expected progress
    color: '#3498db',       // Bar background
    color_progress: '#2980b9', // Progress bar color
    _index: 0,              // Row position
    dependencies: [         // Parsed dependency array
        { id: 'task-0', type: 'FS', lag: 0 }
    ],
    constraints: {
        locked: false       // Prevents movement
    },
    $bar: {                 // Position data
        x: 100,
        y: 60,
        width: 135,
        height: 30
    }
}
```

**Dependency Input Formats** (parsed by `taskProcessor.parseDependencies`):
```javascript
// String format (simple FS, no lag)
dependencies: 'task-1'
dependencies: 'task-1, task-2'  // Comma-separated

// Object format (with type and lag)
dependencies: { id: 'task-1', type: 'SS', lag: 2 }

// Array format (mixed)
dependencies: [
    'task-1',                              // FS, lag: 0
    { id: 'task-2', type: 'SS', lag: 3 }   // SS, lag: 3 days
]
```

**Dependency Types**:
| Type | Name | Description |
|------|------|-------------|
| `FS` | Finish-to-Start | Successor starts after predecessor ENDS (default) |
| `SS` | Start-to-Start | Successor starts after predecessor STARTS + lag |
| `FF` | Finish-to-Finish | Successor finishes after predecessor finishes |
| `SF` | Start-to-Finish | Successor finishes after predecessor starts |

**Drag States** (`Bar.jsx:60-174`):
- `idle` - No drag in progress
- `dragging_bar` - Moving entire bar horizontally
- `dragging_left` - Resizing from left edge
- `dragging_right` - Resizing from right edge
- `dragging_progress` - Adjusting progress percentage

---

### TaskDataPopup Component (`TaskDataPopup.jsx`)

**Purpose**: Displays task detail tooltips on hover.

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `visible` | `() => boolean` | Visibility signal |
| `position` | `() => {x, y}` | Position signal (client coordinates) |
| `task` | `() => Object` | Task data object |
| `barPosition` | `() => {x, y, width, height}` | Bar position data |

---

## Stores

### Task Store (`taskStore.js`)

**Purpose**: Reactive state management for task data and positions.

**API**:
```javascript
const taskStore = createTaskStore();

// Get task by ID
const task = taskStore.getTask('task-1');

// Get bar position (reactive)
const pos = taskStore.getBarPosition('task-1');
// Returns: { x, y, width, height, index }

// Update single task
taskStore.updateTask('task-1', taskData);

// Update bar position only
taskStore.updateBarPosition('task-1', { x: 100 });

// Batch update all tasks
taskStore.updateTasks(tasksArray);

// Remove task
taskStore.removeTask('task-1');

// Clear all
taskStore.clear();
```

**Internal Structure**:
Uses `createStore({})` for fine-grained reactivity. Each task includes `$bar` property with position data.

**Fine-Grained Reactivity** (December 2025):
The store uses SolidJS `createStore` instead of `createSignal(Map)` to enable path-level dependency tracking:
```javascript
// Reading tasks[taskId].$bar.x only subscribes to that specific path
// NOT the entire tasks object - critical for drag performance
const x = () => props.taskStore.tasks[taskId()]?.$bar?.x ?? 0;
```

This allows dragging a single task to update only:
- The dragged Bar component
- Arrows connected to that task

Without affecting the other 400+ tasks in the chart.

---

### Gantt Config Store (`ganttConfigStore.js`)

**Purpose**: Reactive configuration for layout and features.

**Signals**:
| Signal | Type | Default | Description |
|--------|------|---------|-------------|
| `ganttStart` | `Date` | `new Date()` | Chart start date |
| `ganttEnd` | `Date` | `new Date()` | Chart end date |
| `unit` | `string` | `'day'` | Time unit (hour/day/week/month/year) |
| `step` | `number` | `1` | Units per column |
| `columnWidth` | `number` | `45` | Pixels per column |
| `barHeight` | `number` | `30` | Bar height in pixels |
| `headerHeight` | `number` | `75` | Header area height |
| `padding` | `number` | `18` | Vertical spacing between bars |
| `barCornerRadius` | `number` | `3` | Bar corner radius |
| `readonly` | `boolean` | `false` | Disable all interactions |
| `readonlyDates` | `boolean` | `false` | Disable date changes |
| `readonlyProgress` | `boolean` | `false` | Disable progress changes |
| `showExpectedProgress` | `boolean` | `false` | Show expected progress bar |
| `autoMoveLabel` | `boolean` | `false` | Auto-reposition labels |
| `ignoredDates` | `Date[]` | `[]` | Dates to skip |
| `ignoredFunction` | `Function` | `null` | Custom date filter |
| `ignoredPositions` | `number[]` | `[]` | Pixel X positions to skip |

**API**:
```javascript
const config = createGanttConfigStore({ columnWidth: 45 });

// Access signals
config.columnWidth();  // 45
config.setColumnWidth(50);

// Batch update
config.updateOptions({ barHeight: 40, padding: 20 });

// Snapshot
const snapshot = config.getConfig();
```

---

### Resource Store (`resourceStore.js`)

**Purpose**: Reactive state management for resource groups with collapse/expand functionality.

**API**:
```javascript
const resourceStore = createResourceStore(initialResources);

// Get all resources (normalized)
resourceStore.resources();

// Get visible resources (respects collapse state)
resourceStore.displayResources();
// Returns: [{ id, type, group, displayIndex, isCollapsed? }, ...]

// Get resource index map for task positioning
resourceStore.resourceIndexMap();
// Returns: Map<resourceId, displayIndex>

// Get display count (visible rows)
resourceStore.displayCount();

// Toggle group collapse state
resourceStore.toggleGroup('Engineering');

// Expand/collapse specific group
resourceStore.expandGroup('Engineering');
resourceStore.collapseGroup('Engineering');

// Update resources
resourceStore.updateResources(newResources);
```

**Resource Data Structure**:
```javascript
// Input format - groups and resources as flat array
const resources = [
    { id: 'Engineering', type: 'group' },
    { id: 'Alice', type: 'resource', group: 'Engineering' },
    { id: 'Bob', type: 'resource', group: 'Engineering' },
    { id: 'Design', type: 'group' },
    { id: 'Carol', type: 'resource', group: 'Design' },
];

// Backward compatible - simple string array auto-converts
const resources = ['Alice', 'Bob', 'Carol'];
// Converts to: [{ id: 'Alice', type: 'resource' }, ...]
```

**Integration with Gantt**:
```jsx
<Gantt
    tasks={tasks}
    resources={resources}  // Optional - extracted from tasks if not provided
    options={{ resource_column_width: 120 }}
/>
```

---

## Utility Functions

### Bar Calculations (`barCalculations.js`)

Pure functions for computing bar geometry.

| Function | Description |
|----------|-------------|
| `computeX(taskStart, ganttStart, unit, step, columnWidth)` | Calculate X position from date |
| `computeY(taskIndex, headerHeight, barHeight, padding)` | Calculate Y position from row |
| `computeWidth(taskStart, taskEnd, unit, step, columnWidth)` | Calculate width from duration |
| `computeProgressWidth(barX, barWidth, progress, ignoredPositions, columnWidth)` | Progress bar width (handles ignored dates) |
| `computeExpectedProgress(taskStart, taskEnd, unit, step)` | Expected progress % based on today |
| `computeLabelPosition(barX, barWidth, labelText, charWidth)` | Label position (inside/outside) |
| `snapToGrid(x, columnWidth, ignoredPositions)` | Snap to nearest valid column |
| `isIgnoredPosition(x, ignoredPositions, columnWidth)` | Check if position is ignored |
| `calculateDistance(predBar, succBar)` | Edge-to-edge distance between bars |

---

### Viewport Virtualization (`createVirtualViewport.js`)

Simple 2D viewport virtualization following the solid-primitives/virtual pattern.

**Pattern**: `offset / itemSize → visible range`

**API**:
```javascript
import { createVirtualViewport } from '../utils/createVirtualViewport.js';

const viewport = createVirtualViewport({
    scrollX: scrollLeft,           // Horizontal scroll position signal
    scrollY: scrollTop,            // Vertical scroll position signal
    viewportWidth,                 // Viewport width signal
    viewportHeight,                // Viewport height signal
    columnWidth: () => 45,         // Column width accessor
    rowHeight: () => 28,           // Row height accessor
    totalRows: () => 100,          // Total row count accessor
    overscanCols: 5,               // Extra columns to render
    overscanRows: 5,               // Extra rows to render
    overscanX: 600,                // Extra pixels for X range
});

// Returns reactive ranges:
viewport.colRange()   // { start: 0, end: 64 } - for DateHeaders
viewport.rowRange()   // { start: 0, end: 30 } - for Grid, TaskLayer, ArrowLayer
viewport.xRange()     // { start: 0, end: 1800 } - for TaskLayer, ArrowLayer X filtering
```

**Usage**:
- Single viewport calculation shared by ALL components in Gantt.jsx
- No throttling, no hysteresis - pure reactive updates
- Components filter their own content based on viewport ranges

---

### Constraint Engine (`constraintEngine.js`)

Unified constraint resolution engine with iterative relaxation algorithm for cascade updates.

**Key Innovation**: Uses **iterative relaxation** instead of BFS for cascade updates. This guarantees correct constraint resolution when tasks have multiple predecessors from different paths in the dependency graph.

**Relationship Object Shape**:
```javascript
{
    from: 'task-1',      // Predecessor task ID
    to: 'task-2',        // Successor task ID
    type: 'SS',          // FS, SS, FF, SF (default: FS)
    lag: 3,              // Base offset in hours
    min: 0,              // Minimum additional offset (default: 0)
    max: undefined,      // undefined = elastic, 0 = fixed, N = bounded
}
```

**Dependency Types**:
| Type | Name | Rule |
|------|------|------|
| `FS` | Finish-to-Start | `successor.start >= predecessor.end + lag` |
| `SS` | Start-to-Start | `successor.start >= predecessor.start + lag` |
| `FF` | Finish-to-Finish | `successor.end >= predecessor.end + lag` |
| `SF` | Start-to-Finish | `successor.end >= predecessor.start + lag` |

**Gap Behavior** (min/max model):
| min | max | Behavior | Push? | Pull? |
|-----|-----|----------|-------|-------|
| 0 | undefined | **Elastic** - gap can grow indefinitely | Yes | No |
| 0 | 0 | **Fixed** - gap must be exactly `lag` | Yes | Yes |
| 0 | N | **Bounded** - gap can grow up to N hours | Yes | Yes (if gap > N) |

**Task Constraints**:
| Property | Type | Description |
|----------|------|-------------|
| `locked` | `boolean \| string` | `true`, `"start"`, `"end"`, `"duration"` |
| `minStart` | `string` | Earliest start datetime |
| `maxStart` | `string` | Latest start datetime |
| `maxEnd` | `string` | Deadline (latest end datetime) |

**API**:
```javascript
import { resolveConstraints, calculateCascadeUpdates } from './constraintEngine.js';

const context = {
    getBarPosition: (id) => ({ x, y, width, height }),
    getTask: (id) => task,
    relationships: [...],
    relationshipIndex: { byPredecessor: Map, bySuccessor: Map },
    pixelsPerHour: number,
    ganttStartDate: Date,
};

// Main entry point - resolve all constraints with single call
const result = resolveConstraints(taskId, proposedX, proposedWidth, context);
// Returns: {
//   constrainedX: number,       // Final X after constraints
//   constrainedWidth: number,   // Final width
//   blocked: boolean,           // True if move is blocked
//   blockReason: string|null,   // 'locked' or 'conflicting_constraints'
//   cascadeUpdates: Map,        // taskId → { x } for affected successors
// }

// Calculate cascade updates separately (used internally)
const updates = calculateCascadeUpdates(taskId, newX, context);
// Returns: Map<taskId, { x: number }>
```

**Iterative Relaxation Algorithm**:

The `calculateCascadeUpdates` function uses iterative relaxation instead of BFS:

```
Step 1: Find ALL reachable successors (single BFS traversal)
        - Build set of all downstream tasks from dragged task

Step 2: Iterative relaxation until convergence
        WHILE changes occur AND iterations < MAX_CASCADE_ITERATIONS:
            FOR each reachable successor:
                - Get current position (with any pending update)
                - Calculate minX from ALL predecessors (using updates map)
                - If minX > current position: record update, mark changed
```

**Why Iterative Relaxation?**

BFS fails for multi-path convergence:
```
    A ──→ B ──→ D
          ↓
    A ──→ C ──→ D
```
When dragging A, BFS visits D when only B is updated. D gets positioned based on B, then C updates, but D is already "processed". Result: D violates C's constraint → overlap.

Iterative relaxation re-evaluates each task against ALL predecessors on every iteration, guaranteeing convergence to a correct solution for DAGs.

**Complexity**: O(iterations × reachable × avg_predecessors), typically 2-3 iterations

**Constraint Application Order**:
1. **Lock check** → Block if `locked: true`
2. **Absolute constraints** → minStart, maxStart, maxEnd
3. **Predecessor constraints** → minX from dependencies
4. **Downstream constraints** → maxX from locked successors
5. **Position clamping** → Final constrained position
6. **Cascade updates** → Push/pull affected successors via iterative relaxation

---

### Date Utilities (`date_utils.js`)

Date manipulation functions.

| Function | Description |
|----------|-------------|
| `parse(date)` | Parse string to Date |
| `format(date, format, lang)` | Format Date to string |
| `diff(date_a, date_b, scale)` | Difference in units |
| `add(date, qty, scale)` | Add time to date |
| `start_of(date, scale)` | Start of period |
| `today()` | Today at midnight |
| `now()` | Current datetime |
| `clone(date)` | Clone Date object |
| `get_days_in_month(date)` | Days in month |
| `convert_scales(period, to_scale)` | Convert duration units |

---

## Hooks

### useDrag (`useDrag.js`)

**Purpose**: RAF-based drag state machine for 60fps performance.

**Features**:
- Request Animation Frame loop for smooth updates
- Batches move updates to prevent jank
- Automatic cleanup on unmount
- SVG coordinate conversion

**API**:
```javascript
const { dragState, isDragging, startDrag, createDragHandler, toSvgCoords } = useDrag({
    onDragStart: (data, state) => { ... },
    onDragMove: (move, data, state) => { ... },
    onDragEnd: (move, data, state) => { ... },
    getSvgPoint: (clientX, clientY) => { x, y }  // Optional
});

// Start drag from mousedown
startDrag(mouseEvent, 'dragging_bar', { taskId: 'task-1' });

// Create reusable handler
const handleLeftResize = createDragHandler('dragging_left', { taskId });
```

**Move Object Shape**:
```javascript
{
    clientX: number,    // Client coordinates
    clientY: number,
    svgX: number,       // SVG coordinates
    svgY: number,
    deltaX: number,     // Offset from start
    deltaY: number,
    shiftKey: boolean,  // Modifier keys
    ctrlKey: boolean,
    altKey: boolean
}
```

---

## Demo Pages

### GanttDemo (`/examples/gantt.html`) - **Primary Demo**

Full-featured Gantt chart demonstration with real task data.

**Features Demonstrated**:
- Complete Gantt chart with grid, headers, tasks, and arrows
- 6 sample tasks with dependencies (FS - Finish-to-Start)
- Draggable task bars with grid snapping
- Resizable bars (drag left/right edges)
- Progress bar adjustment
- Dependency constraint enforcement (successors pushed when predecessor moves)
- Hover popup with task details
- Click modal with debug/raw task info
- Horizontal scrolling

**Sample Tasks**:
| Task | Dependencies | Description |
|------|--------------|-------------|
| Project Planning | - | Initial planning phase |
| Design Phase | task-1 | UI/UX design work |
| Development | task-2 | Main coding phase |
| Testing | task-3 | QA and testing |
| Documentation | task-2 | User docs (parallel with dev) |
| Deployment | task-4, task-5 | Final deployment |

**Run**: `pnpm dev` → http://localhost:5173/examples/gantt.html

---

### ShowcaseDemo (`/examples/showcase.html`)

Interactive props showcase for all task and connector configuration options.

**Features**:
- 8 presets (Default, Colorful, Minimal, Constrained, Locked, Fixed Offset, Start-to-Start, Finish-to-Finish)
- Full task configuration (name, color, progress, cornerRadius, locked, invalid)
- Full connector configuration (anchoring, routing, line style, arrow head)
- Dependency type controls (FS, SS, FF, SF)
- Constraint controls (lag, elastic vs fixed)
- Global settings (readonly modes, grid snap)
- 4 linked tasks demonstrating constraint chains

**Run**: `pnpm dev` → http://localhost:5173/examples/showcase.html

---

### GanttResourceGroupsDemo (`/examples/resource-groups.html`) - **Resource Groups**

Demonstrates collapsible resource groups for organizing tasks by team.

**Features Demonstrated**:
- Three resource groups (Engineering, Design, QA)
- Resources assigned to groups via `group` property
- Click group headers to collapse/expand
- Chevron icon indicates collapse state (▼ expanded, ► collapsed)
- Group rows have distinct gray background
- Tasks assigned to individual resources within groups
- Arrows hidden when connected to collapsed groups

**Run**: `pnpm dev` → http://localhost:5173/examples/resource-groups.html

---

### GanttPerfDemo (`/examples/perf.html`) - **Performance Testing**

Performance testing demo with pre-generated calendar data and stress tests.

**Features**:
- Loads pre-generated calendar data from `src/data/calendar.json`
- FPS counter and frame timing metrics
- Horizontal scroll stress test (H-Scroll button)
- Vertical scroll stress test (V-Scroll button)
- View mode selector (Hour/Day/Week/Month)

**Metrics Displayed**:
| Metric | Description |
|--------|-------------|
| Tasks | Number of task bars currently in DOM |
| Arrows | Number of dependency arrows currently in DOM |
| Render | Initial render time (ms) |
| FPS | Current frames per second |
| Worst | Worst frame time in last 60 frames |
| Avg | Average frame time in last 60 frames |
| Scroll/s | Scroll events per second (during stress test) |

**To generate test data**:
```bash
pnpm run generate:calendar              # Generate 200 tasks (default)
node src/scripts/generateCalendar.js --tasks=500  # Custom count
node src/scripts/generateCalendar.js --tasks=10000 --resources=100 --dense  # Stress test
```

**Dense Mode** (December 2025):
The `--dense` flag generates tightly packed tasks for stress testing:
- Back-to-back tasks on each resource (no gaps)
- All resources start at the same time (maximum viewport density)
- ~30% cross-row dependencies (arrows spanning multiple rows)
- Short durations (1-5 hours) for more tasks in viewport

**Run**: `pnpm dev` → http://localhost:5173/examples/perf.html

---

### Component Demos

Individual component demos for isolated testing:

- `/examples/bar.html` - Bar component isolation testing
- `/examples/arrow.html` - Arrow component isolation testing
- `/examples/constraint.html` - Constraint system scenarios

---

## Configuration Options

### resource_column_width (Default: 120)

Width of the sticky left resource column in pixels.

Example: `resource_column_width: 150` → wider column for longer names

---

### columnWidth (Default: 45)

Controls the granularity of task positioning:
- Determines grid cell width in pixels
- Minimum bar width (1 column)
- Time-to-pixel conversion factor

Example: `columnWidth: 45` → each day occupies 45 pixels

### showExpectedProgress (Default: false)

When enabled, shows a semi-transparent bar indicating where progress should be based on:
- Task start date (`_start`)
- Task end date (`_end`)
- Today's date

Visual: Dark overlay behind actual progress bar

### ignoredPositions

Array of pixel X positions that represent non-working days (weekends, holidays).

Effects:
- Progress calculations skip these positions
- Grid snapping jumps over them
- Bar movement cannot land on them

---

## Key Features

### Constraint System Architecture

**Separation of Concerns**:
- **Arrows**: Pure visual rendering (decorative only)
- **Relationships**: Dependency constraints with min/max offsets (FS, SS, FF, SF)
- **Tasks**: Lock state + absolute time constraints (minStart, maxStart, maxEnd)

**Resolution Flow**:
```
User drags task
    ↓
Bar.onConstrainPosition called
    ↓
resolveConstraints() applies:
    1. Lock check → Block if locked: true
    2. Absolute constraints → minStart, maxStart, maxEnd bounds
    3. Predecessor constraints → minX from incoming dependencies
    4. Downstream check → maxX if would push locked task
    5. Cascade calculation → iterative relaxation for successors
    ↓
Return { constrainedX, cascadeUpdates }
    ↓
taskStore.updateBarPosition() for dragged task
    ↓
Apply cascadeUpdates to all affected successors
    ↓
Arrow paths recalculate (reactive via SolidJS)
```

**Cascade Update Algorithm**:
```
1. Find all reachable successors (BFS from dragged task)
2. Iterative relaxation:
   WHILE changed AND iterations < 100:
     FOR each successor:
       minX = max(constraint from each predecessor)
       IF minX > current position:
         Record update, mark changed
3. Return Map<taskId, { x }>
```

This iterative approach guarantees correct resolution for DAGs with multi-path convergence, where a task has multiple predecessors from different dependency chains.

---

### Expected Progress Calculation

**Formula** (`barCalculations.js:141-149`):
```javascript
function computeExpectedProgress(taskStart, taskEnd, unit, step) {
    const today = date_utils.today();
    const totalDuration = date_utils.diff(taskEnd, taskStart, 'hour') / step;
    const elapsed = date_utils.diff(today, taskStart, 'hour') / step;

    const progress = Math.min(elapsed, totalDuration);
    return totalDuration > 0 ? (progress * 100) / totalDuration : 0;
}
```

**Visual Interpretation**:
- Expected > Actual: Task is behind schedule (red indicator)
- Expected < Actual: Task is ahead of schedule (green indicator)
- Expected = Actual: On track

---

### Arrow Smart Anchoring

**Start Anchor Selection** (`Arrow.jsx:autoSelectStartAnchor`):

```
For SS/SF dependencies (start-based):
    If same row → Exit from LEFT edge
    Else → Exit from TOP/BOTTOM

For FS/FF dependencies (finish-based):
    If same row → Exit from RIGHT edge
    Else → Exit from TOP/BOTTOM
```

**End Anchor Selection** (`Arrow.jsx:autoSelectEndAnchor`):

Entry point is determined by what the dependency constrains:

```
For -Start dependencies (FS, SS):
    → Always enter from LEFT (the start of the task)

For -Finish dependencies (FF, SF):
    If same row:
        → Enter from RIGHT
    Else:
        → Enter from TOP (cleaner routing for stacked tasks)
```

**Start Offset Calculation** (along TOP/BOTTOM edges):
- **SS/SF**: Exit at 10% (near LEFT/start of predecessor)
- **FS/FF**: Exit at 90% (near RIGHT/end of predecessor)
- Clamped to ensure exit point is left of target's left edge
- Leaves room for curve radius

This creates a visual distinction:
- SS arrows originate from the START of the predecessor bar
- FS arrows originate from the END of the predecessor bar

---

## Development Workflow

### Running Demos

```bash
# Install dependencies
pnpm i

# Start SolidJS development server
pnpm dev

# Open demos:
# http://localhost:5173/examples/           - Demo hub (index)
# http://localhost:5173/examples/gantt.html - Main Gantt demo
# http://localhost:5173/examples/resource-groups.html - Resource groups
# http://localhost:5173/examples/perf.html  - Performance test
# http://localhost:5173/examples/arrow.html - Arrow component
# http://localhost:5173/examples/bar.html   - Bar component
# http://localhost:5173/examples/constraint.html - Constraint demo
# http://localhost:5173/examples/showcase.html - Props showcase
```

### Build

```bash
# Production build
pnpm build

# Development build (watch mode)
pnpm build-dev
```

### Code Quality

```bash
pnpm lint        # Lint JavaScript
pnpm prettier    # Format code
```

---

## Migration Notes

### What's Complete

1. **Core Components**: Bar, Arrow, TaskDataPopup, TaskDataModal fully functional
2. **Main Gantt Orchestrator**: Grid, headers, scroll handling, task/arrow layers
3. **State Management**: Task store, config store, date store, resource store operational
4. **Interactions**: Drag, resize, progress editing all working
5. **Constraints**: Full dependency constraint system (FS, SS, FF, SF types)
6. **Reactivity**: Fine-grained updates via SolidJS signals and stores
7. **Resource Groups**: Collapsible groups with collapse/expand, arrow hiding
8. **Demos**: Full Gantt demo, resource groups demo, and interactive showcase

### What's Pending

1. **Public API Wrapper**: Compatibility layer for imperative API (`new Gantt()`)
2. **Infinite Padding**: Timeline extension on scroll edges
3. **View Mode Switching**: Hour/Day/Week/Month/Year support (currently Day only)
4. **Grid line fix**: Missing horizontal line between row A and B (first row top border issue)

### Performance Optimizations Implemented

See `PERFORMANCE.md` for detailed documentation.

| Optimization | Impact |
|--------------|--------|
| scrollTo fix (direct scrollLeft) | 5,000ms → 2,100ms (58% faster) |
| SVG pattern for grid lines | 2,100ms → 1,800ms (14% faster) |
| Intl.DateTimeFormat caching | 1,800ms → 1,138ms (37% faster) |
| DateHeaders column virtualization | 1,138ms → 568ms (50% faster) |
| Row-level task grouping | Foundation for row virtualization |
| Arrow row virtualization | Filters by visible row range |
| **Unified viewport virtualization** | **10K tasks: ~30ms re-render** |
| **Item-keyed rendering with `<For>`** | **Smooth scroll, no visual artifacts** |
| **createStore for task data** | **60 FPS drag with 10K tasks** |

**Total improvement**: 99.5% for 10K tasks (5,519ms → ~30ms re-render)

#### Drag Performance Fix (December 2025)

**Problem**: Dragging tasks dropped to ~10 FPS with 400+ tasks due to reactive cascade.

**Root Cause**:
```
User drags task → updateBarPosition() → setTasks(new Map())
    → tasks() signal fires → ALL 400+ Bars re-evaluate → ALL arrows re-evaluate
```

**Solution**: Convert `taskStore` from `createSignal(Map)` to `createStore({})`:

| Before | After |
|--------|-------|
| `createSignal(new Map())` | `createStore({})` |
| Reading `tasks()` subscribes to ALL tasks | Reading `tasks[id].$bar.x` subscribes to ONE path |
| 400+ Bar re-evaluations per frame | 1 Bar re-evaluation per frame |
| ~10 FPS during drag | 60 FPS during drag |

**Files Modified**:
- `src/stores/taskStore.js` - Store conversion, path-based updates
- `src/components/Bar.jsx` - Direct store path access, removed 3 unnecessary memos
- `src/components/Arrow.jsx` - Direct store path access
- `src/components/TaskLayer.jsx` - Store object iteration (kept 3 essential memos)
- `src/components/ArrowLayer.jsx` - Store object iteration
- `src/components/SummaryBar.jsx` - Removed 2 unnecessary memos
- `src/components/ExpandedTaskContainer.jsx` - Removed 2 unnecessary memos
- `src/components/SubtaskBar.jsx` - Removed 1 unnecessary memo

**Memo Strategy**:
- **Remove**: Memos for simple calculations in render paths (causes reactive subscriptions)
- **Keep**: Memos for expensive O(n) filtering operations (TaskLayer's `tasksByResource`, `visibleTaskIds`, `splitTaskIds`)

**Virtualization Architecture**:
```
src/utils/createVirtualViewport.js
└── Single utility providing:
    ├── colRange()  → DateHeaders (which columns to render)
    ├── rowRange()  → Grid, TaskLayer, ArrowLayer (which rows)
    └── xRange()    → TaskLayer, ArrowLayer (X pixel filtering)

Gantt.jsx
└── viewport = createVirtualViewport({...})
    └── Shared by ALL components (single calculation)

TaskLayer.jsx / ArrowLayer.jsx
└── <For each={visibleItems()}> - Keyed by item identity
    └── New items get new components, removed items are destroyed
```

**Key Pattern**: solid-primitives/virtual approach
- `offset / itemSize → visible range` for viewport calculation
- `<For>` for item-keyed rendering (components tied to item identity, not array index)

With 10K tasks: 10,000 bars → ~11 rendered, 9,179 arrows → ~11 rendered

### Known Limitations

- No SSR support (SVG rendering is client-side only)
- No TypeScript (JavaScript only)
- Test coverage pending
- View mode is fixed to Day view

---

## File Quick Reference

| Need to... | Look in... |
|------------|------------|
| Modify arrow appearance | `Arrow.jsx` DEFAULTS object |
| Change anchor logic | `Arrow.jsx` autoSelectStartAnchor, autoSelectEndAnchor |
| Add bar interaction | `Bar.jsx` useDrag callbacks |
| Change grid snapping | `barCalculations.js` snapToGrid |
| Modify constraint rules | `constraintEngine.js` resolveConstraints, calculateCascadeUpdates |
| Add new config option | `ganttConfigStore.js` |
| Change date calculations | `ganttDateStore.js` |
| Modify task processing | `taskProcessor.js` processTasks |
| Add/modify resource groups | `resourceStore.js`, `resourceProcessor.js` |
| Update Gantt demo tasks | `GanttDemo.jsx` tasks signal |
| Update showcase presets | `ShowcaseDemo.jsx` PRESETS object |
| Modify grid rendering | `Grid.jsx` |
| Change header rendering | `DateHeaders.jsx` |
