# SolidJS Architecture Documentation

**Last Updated**: SolidJS 2.0 migration — public API delta (E4.8) and the deferred-write reactivity contract.

This document describes the SolidJS Gantt chart implementation.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Public API](#public-api-srcindexts)
3. [Reactivity contract (SolidJS 2.0)](#reactivity-contract-solidjs-20)
4. [Directory Structure](#directory-structure)
5. [Core Components](#core-components)
6. [Stores](#stores)
7. [Utility Functions](#utility-functions)
8. [Hooks](#hooks)
9. [Demo Pages](#demo-pages)
10. [Configuration Options](#configuration-options)
11. [Key Features](#key-features)
12. [Development Workflow](#development-workflow)

---

## Project Overview

The SolidJS implementation lives in `src/` and provides reactive, fine-grained updates for Gantt chart components.

### Component Status

| Component | Status | Location |
|-----------|--------|----------|
| Arrow | Complete | `src/components/Arrow.tsx` |
| Bar | Complete | `src/components/Bar.tsx` |
| Popup | Complete | `src/components/TaskDataPopup.tsx` |
| Modal | Complete | `src/components/TaskDataModal.tsx` |
| Task Store | Complete | `src/stores/taskStore.ts` |
| Config Store | Complete | `src/stores/ganttConfigStore.ts` |
| Date Store | Complete | `src/stores/ganttDateStore.ts` |
| Resource Store | Complete | `src/stores/resourceStore.ts` |
| Constraint System | Complete | `src/utils/constraintEngine.ts` |
| Main Gantt Orchestrator | Complete | `src/components/Gantt.tsx` |
| Grid & Headers | Complete | `src/components/Grid.tsx`, `DateHeaders.tsx` |
| Resource Column | Complete | `src/components/ResourceColumn.tsx` |
| Task Layer | Complete | `src/components/TaskLayer.tsx` |
| Arrow Layer | Complete | `src/components/ArrowLayerBatched.tsx` |
| ExpandedTaskContainer | Complete | `src/components/ExpandedTaskContainer.tsx` |
| SubtaskBar | Complete | `src/components/SubtaskBar.tsx` |

> **See also**: [SUBTASKS.md](./SUBTASKS.md) for comprehensive subtask documentation.

---

## Public API (`src/index.ts`)

`src/index.ts` is the whole published surface — nothing else in `src/` is
reachable by a consumer. Peer runtimes: `solid-js` and `@solidjs/web` at
`2.0.0-rc.6`, both left external in the bundle and compiled with
`jsxImportSource: '@solidjs/web'`. Packaging is ESM-only.

### Main Component
- `Gantt` - Main Gantt chart component

### Store Factories
- `createTaskStore(): TaskStore` - reactive task state (no arguments)
- `createGanttConfigStore(options?: GanttConfigOptions): GanttConfigStore`
- `createGanttDateStore(options?: GanttDateStoreOptions): GanttDateStore`
- `createResourceStore(resources?: ResourceInput[]): ResourceStore`

Their interface types (`TaskStore`, `GanttConfigStore`, `GanttDateStore`,
`ResourceStore`) are exported alongside them. `createSelectionStore` is
**internal**: `<Gantt>` creates the selection store itself and it is neither
exported nor carried on the stores context.

### Context API
- `GanttEventsProvider` / `useGanttEvents()` - event handlers by context.
  `useGanttEvents()` **always** returns a full `GanttEventHandlers` set;
  outside a provider the handlers are no-ops, so a consumer may call any of
  them unconditionally.
- `GanttProvider` / `useGanttStores()` - the four stores by context, typed
  `GanttStores` = `{ taskStore, ganttConfig, dateStore, resourceStore }`.
  `useGanttStores()` returns `GanttStores | undefined` — `undefined`, never
  `null`, outside a provider, so `useGanttStores() ?? ownStores` is the
  intended shape. Solid 2.0 makes a default-less context throw in
  `useContext`, so `GanttStoresContext` carries an explicit `null` default
  and the hook maps it back to `undefined`.

### Constraint Functions
- `resolveConstraints(taskId, proposedX, proposedWidth, context): ResolveResult`
  - resolve a proposed drag/resize against FS/SS/FF/SF dependencies
- `calculateCascadeUpdates(taskId, newX, context): Map<string, { x: number }>`
  - propagate a move downstream

### Hierarchy Functions
- `buildHierarchy<T>(tasks: T[]): Map<string, T>` - parent/child tree from a flat array
- `collectDescendants<T>(taskId, tasksObj): Set<string>` - all descendant ids

### Generator Functions
- `generateSubtaskDemo(config?): SubtaskDemoResult` - test data with parent/child tasks

### Diagnostics
- `setDiagnosticHandler(handler | null)` plus the `DiagnosticHandler` and
  `DiagnosticLevel` types - route the library's data-validation warnings
  (silence them in tests, forward them to an error tracker). This is the
  library's own channel and is unrelated to the SolidJS 2.0 dev-build
  diagnostics.

### Date Utilities (re-exported from `dateUtils.ts`)
- `parse(date)` - Parse date string to Date object
- `format(date, formatString)` - Format Date to string
- `diff(date1, date2, scale)` - Calculate difference between dates
- `add(date, qty, scale)` - Add time to date
- `start_of(date, scale)` - Get start of time period
- `parse_duration(duration)` - Parse duration string (e.g., "2d", "4h")

camelCase aliases are exported for the snake_case names: `parseDuration`,
`toString`, `startOf`, `getDateValues`, `convertScales`, `getDaysInMonth`,
`getDaysInYear`.

### Types
`DependencyType`, `Dependency`, `NormalizedDependency`, `TaskConstraints`,
`NormalizedConstraints`, `LockState`, `GanttTask`, `ProcessedTask`,
`BarPosition`, `Relationship`, `ConstraintResult`, `ConstraintContext`.

---

## Reactivity contract (SolidJS 2.0)

Solid 2.0 **defers writes**: a setter stages its value, and reads return the
previously committed one until the microtask flush (or an explicit
`flush()`). Three parts of the public API are shaped by that.

### Config setters are void updaters

```ts
export type ConfigSetter<T> = (
    value: Exclude<T, Function> | ((prev: T) => T),
) => void;
```

All twenty `set*` fields on `GanttConfigStore` have this type. It mirrors
Solid's own `Setter<T>` — including the `Exclude<Function>` guard, which is
what makes a function argument unambiguously an updater rather than a value
— but it returns `void`, because under deferred writes there is no
post-write value left to hand back. Internally each setter writes through a
draft and reads `prev` off that draft, so two updater calls in one turn
compose:

```ts
config.setColumnWidth((w) => w * 2); // composes against the staged value
config.setColumnWidth(90); // returns undefined — nothing to read
```

`ConfigSetter<T>` is exported from `src/stores/ganttConfigStore.ts`.

### Readers answer about committed state

`taskStore.getTask`, `getBarPosition`, `getAllTasks`, `taskCount`,
`isTaskCollapsed`; `resourceStore.isGroupCollapsed`;
`ganttConfigStore.getConfig()`; and — internally — `selectionStore.isSelected`
and `selectionCount` all read committed state. Inside JSX, a memo,
or an effect's compute they subscribe and track normally. Called immediately
after a write in the same turn they report the **pre-write** value:

```ts
taskStore.toggleTaskCollapse('t1');
taskStore.isTaskCollapsed('t1'); // pre-toggle answer
flush();
taskStore.isTaskCollapsed('t1'); // committed
```

`flush()` is legal in event handlers, timers, promise continuations and test
bodies; it is a silent no-op inside an effect's apply and **throws** inside
`onSettled`. The only sanctioned `flush()` in the library is
`useDrag.handleMouseUp`, which commits the final drag move so the DOM
catches up and so the no-move fallback path reads committed geometry — a
stationary press stages nothing, so `onDragEnd` has only the store to
report from. Consumers that report from the drag data (`data.lastGeom`)
no longer depend on it.

The producer-side fix is preferred over `flush()`: a producer returns what it
computed rather than making the caller read it back. `setupDates`,
`changeViewMode` and `extendTimeline` return a `DateWindow`;
`taskStore.collapseAllTasks(ids?)` and `resourceStore.collapseAll(ids?)` take
the ids a same-turn caller already built instead of re-deriving them from a
list that has not committed yet.

### `ColumnDef.render` must be pure

```ts
render?: (
    task: ProcessedTask | undefined,
    resourceId: string,
) => JSX.Element | string | number | null | undefined;
```

It is called from inside a tracking scope on every re-render of its cell, so
it must only return markup — no store writes (they would trip
`REACTIVE_WRITE_IN_OWNED_SCOPE`), no requests, no reactive primitives.

---

## Directory Structure

```
src/
├── components/
│   ├── Arrow.tsx           # Dependency arrow rendering
│   ├── Bar.tsx             # Task bar with drag/resize/progress
│   ├── DateHeaders.tsx     # Month/day headers
│   ├── Gantt.tsx           # Main orchestrator component
│   ├── GanttContainer.tsx  # Scroll container with sticky headers
│   ├── GanttDemo.tsx       # Full Gantt demo page
│   ├── GanttPerfDemo.tsx   # Performance testing demo
│   ├── GanttResourceGroupsDemo.tsx  # Resource groups demo
│   ├── Grid.tsx            # Background grid with rows and ticks
│   ├── Arrow.tsx           # Single dependency arrow
│   ├── ArrowLayerBatched.tsx # Batched arrow rendering
│   ├── SummaryBar.tsx      # Parent/summary task bars
│   ├── ResourceColumn.tsx  # Sticky left column (swimlanes)
│   ├── ShowcaseDemo.tsx    # Interactive props showcase
│   ├── TaskDataModal.tsx   # Debug/detail modal on click
│   ├── TaskDataPopup.tsx   # Hover tooltip popup
│   ├── TaskLayer.tsx       # Container for all bars
│   ├── ExpandedTaskContainer.tsx  # Expanded parent with subtasks
│   └── SubtaskBar.tsx      # Individual subtask bars (50% height)
├── stores/
│   ├── taskStore.ts        # Reactive task state management
│   ├── ganttConfigStore.ts # Configuration state management
│   ├── ganttDateStore.ts   # Date/timeline calculations
│   └── resourceStore.ts    # Resource groups and collapse state
├── utils/
│   ├── barCalculations.ts  # Pure functions for bar geometry
│   ├── constraintEngine.ts # Unified constraint resolution (iterative relaxation)
│   ├── absoluteConstraints.ts # Lock type helpers, absolute time constraints
│   ├── createVirtualViewport.ts # Simple 2D viewport virtualization
│   ├── resourceProcessor.ts # Resource normalization and group display
│   ├── taskProcessor.ts    # Task parsing and position computation
│   ├── taskGenerator.ts    # Test data generation
│   ├── subtaskGenerator.ts # Subtask demo data generation
│   └── rowLayoutCalculator.ts # Variable row heights for subtasks
├── hooks/
│   ├── useDrag.ts          # RAF-based drag state machine
│   ├── useBarDrag.ts       # Bar move/resize/progress gestures
│   ├── useBoxSelect.ts     # Rubber-band multi-select
│   ├── useBarConfig.ts     # Derived bar geometry
│   ├── useGanttModals.ts   # Modal/popup state
│   ├── useGanttScroll.ts   # Scroll + viewport accessors
│   └── useTaskVirtualization.ts # Visible row/column ranges
├── entries/                # Vite entry points for demos
│   ├── gantt.tsx
│   ├── resource-groups.tsx
│   ├── perf.tsx
│   ├── subtask.tsx         # Subtask demo (100 tasks with subtasks)
│   ├── arrow.tsx
│   ├── bar.tsx
│   ├── constraint.tsx
│   ├── showcase.tsx
│   └── ...                 # box-select, critical-path, custom-columns,
│                           # db, experiments, export, filter-search,
│                           # index-test, minimal-test, multi-select,
│                           # perf-isolate, profiler
├── scripts/
│   └── generateCalendar.ts # CLI for generating test data
├── data/
│   ├── fixtures/           # Static test fixtures (constraint-test.json)
│   └── generated/          # CLI-generated data (calendar.json, topology-*.json)
└── styles/
    └── *.css               # Stylesheets
```

---

## Core Components

### Arrow Component (`Arrow.tsx`)

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

**Path Calculation Logic** (`Arrow.tsx:calculateSmartOffset`):

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

### ResourceColumn Component (`ResourceColumn.tsx`)

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
// Must match SVG row positioning in Grid.tsx and barCalculations.computeY
cellTop = headerHeight + padding/2 + index * (barHeight + padding)
```

**Swimlane Layout**:
- Each unique resource gets one row
- Multiple tasks with same resource appear on same row
- Tasks are positioned by resource index, not task index
- Cross-resource dependencies create diagonal arrows between swimlanes

---

### Bar Component (`Bar.tsx`)

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
    colorProgress: '#2980b9', // Progress bar color
    _index: 0,              // Row position
    dependencies: [         // Parsed dependency array
        { id: 'task-0', type: 'FS', lag: 0 }
    ],
    constraints: {
        locked: false       // Prevents movement
    },
    _bar: {                 // Position data
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

**Drag States** (`Bar.tsx:60-174`):
- `idle` - No drag in progress
- `dragging_bar` - Moving entire bar horizontally
- `dragging_left` - Resizing from left edge
- `dragging_right` - Resizing from right edge
- `dragging_progress` - Adjusting progress percentage

---

### TaskDataPopup Component (`TaskDataPopup.tsx`)

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

### Task Store (`taskStore.ts`)

**Purpose**: Reactive state management for task data and positions.

**API**:
```ts
const taskStore = createTaskStore();

// --- readers (COMMITTED state; see the reactivity contract above) ---
const task = taskStore.getTask('task-1');
const pos = taskStore.getBarPosition('task-1'); // { x, y, width, height, index }
const all = taskStore.getAllTasks();
const n = taskStore.taskCount();
const hidden = taskStore.isTaskCollapsed('task-1');

// --- writes ---
taskStore.updateTask('task-1', taskData); // replace the whole task object
taskStore.patchTask('task-1', { name: 'Renamed' }); // merge — only touched leaves notify
taskStore.setTaskProgress('task-1', 60);
taskStore.updateBarPosition('task-1', { x: 100 }); // leaf-mutates _bar
taskStore.setBarYs(ys); // Map<id, y> — one draft write for a whole layout pass
taskStore.updateTasks(tasksArray); // batch replace
taskStore.removeTask('task-1'); // `delete draft[id]`
taskStore.clear();

// --- collapse state ---
taskStore.toggleTaskCollapse('task-1');
taskStore.collapseAllTasks(); // derives ids from committed state
taskStore.collapseAllTasks(idsIJustBuilt); // pass ids when you wrote the list this turn
```

**Internal Structure**:
Uses `createStore({})` for fine-grained reactivity. Each task includes a
`_bar` property with position data. `collapsedTasks` is deliberately **not**
in the store — a `Set` inside a store is not proxied under Solid 2.0, so it
lives in a signal and is replaced (never mutated) on each change.

**Leaf mutation is load-bearing.** `updateBarPosition` and
`batchMovePositions` write `task._bar.x = n` inside the draft rather than
replacing the task object. Replacing it would notify every subscriber of
every other field on that task, which is exactly the fan-out the store exists
to avoid. `patchTask` merges for the same reason; `updateTask` is the
explicit "the whole object changed" path.

**Fine-Grained Reactivity** (December 2025):
The store uses SolidJS `createStore` instead of `createSignal(Map)` to enable path-level dependency tracking:
```javascript
// Reading tasks[taskId]._bar.x only subscribes to that specific path
// NOT the entire tasks object - critical for drag performance
const x = () => props.taskStore.tasks[taskId()]?._bar?.x ?? 0;
```

This allows dragging a single task to update only:
- The dragged Bar component
- Arrows connected to that task

Without affecting the other 400+ tasks in the chart.

---

### Gantt Config Store (`ganttConfigStore.ts`)

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
```ts
const config = createGanttConfigStore({ columnWidth: 45 });

// Access signals
config.columnWidth(); // 45

// Setters are ConfigSetter<T> — void-returning, value or updater
config.setColumnWidth(50);
config.setColumnWidth((w) => w + 5);

// Batch update: one flush across the store field and the expandedTasks signal
config.updateOptions({ barHeight: 40, padding: 20 });

// COMMITTED snapshot — reflects a write from this turn only after a flush
const snapshot = config.getConfig();
```

**Task expansion** (`isTaskExpanded`, `toggleTaskExpansion`, `expandTask`,
`collapseTask`, `expandAllTasks(ids)`, `collapseAllTasks()`) is backed by a
signal holding an immutable `Set<string>`, not by a store field: Solid 2.0
does not proxy a `Set` inside a store, so every mutator builds a new `Set`
and replaces it. The public accessor still presents a `Set<string>`.

---

### Resource Store (`resourceStore.ts`)

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

// COMMITTED-state reader — not a toggle-then-branch oracle in the same turn
resourceStore.isGroupCollapsed('Engineering');

// Bulk collapse. With no argument the ids come from the getGroups() memo,
// i.e. from the COMMITTED resource list. Pass the ids explicitly when the
// resource list was written in this same turn. Mirrors
// taskStore.collapseAllTasks(ids?).
resourceStore.expandAll();
resourceStore.collapseAll();
resourceStore.collapseAll(idsIJustBuilt);

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

### Bar Calculations (`barCalculations.ts`)

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

### Viewport Virtualization (`createVirtualViewport.ts`)

Simple 2D viewport virtualization following the solid-primitives/virtual pattern.

**Pattern**: `offset / itemSize → visible range`

**API**:
```javascript
import { createVirtualViewport } from '../utils/createVirtualViewport.ts';

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
viewport.rowRange()   // { start: 0, end: 30 } - for Grid, TaskLayer, arrow layer
viewport.xRange()     // { start: 0, end: 1800 } - for TaskLayer, arrow layer X filtering
```

**Usage**:
- Single viewport calculation shared by ALL components in Gantt.tsx
- No throttling, no hysteresis - pure reactive updates
- Components filter their own content based on viewport ranges

---

### Constraint Engine (`constraintEngine.ts`)

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
import { resolveConstraints, calculateCascadeUpdates } from './constraintEngine.ts';

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

### Date Utilities (`dateUtils.ts`)

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

### useDrag (`useDrag.ts`)

**Purpose**: RAF-based drag state machine for 60fps performance.

**Features**:
- Request Animation Frame loop for smooth updates
- Batches move updates to prevent jank
- Automatic cleanup on unmount
- SVG coordinate conversion

**The one sanctioned `flush()`.** `handleMouseUp` calls `flush()` after the
final `onDragMove` and before `onDragEnd`. Each rAF frame is its own task, so
every earlier move has already committed — but the last one is still staged
when the gesture ends.

Reporting no longer depends on that flush: every write branch in `useBarDrag`
records what it wrote (`data.lastGeom`, `data.finalProgress`) and `onDragEnd`
reports *that*. The flush stays for the two things the drag data cannot
supply — the DOM has to catch up with the last move before the gesture ends,
and a stationary press (or one that never crossed the 3px threshold) staged
nothing, so its fallback store read must see committed geometry. Mouseup is
an event handler, which is a legal `flush()` site; no other library site may
add one.

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
- Loads pre-generated calendar data from `src/data/generated/calendar.json`
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
pnpm exec tsx src/scripts/generateCalendar.ts --tasks=500  # Custom count
pnpm exec tsx src/scripts/generateCalendar.ts --tasks=10000 --resources=100 --dense  # Stress test
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

**Formula** (`barCalculations.ts` — `computeExpectedProgress`):
```ts
export function computeExpectedProgress(
    taskStart: Date,
    taskEnd: Date,
    unit: TimeScale | string,
    step: number,
): number {
    const today = dateUtils.today();
    const totalDuration = dateUtils.diff(taskEnd, taskStart, 'hour') / step;
    const elapsed = dateUtils.diff(today, taskStart, 'hour') / step;

    // Clamp to 0-100%
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

**Start Anchor Selection** (`Arrow.tsx:autoSelectStartAnchor`):

```
For SS/SF dependencies (start-based):
    If same row → Exit from LEFT edge
    Else → Exit from TOP/BOTTOM

For FS/FF dependencies (finish-based):
    If same row → Exit from RIGHT edge
    Else → Exit from TOP/BOTTOM
```

**End Anchor Selection** (`Arrow.tsx:autoSelectEndAnchor`):

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
pnpm build       # Library bundle (ESM only) -> dist/
pnpm build:demo  # Demo pages -> dist-demo/
```

### Code Quality

```bash
pnpm typecheck       # tsc --noEmit
pnpm lint            # ESLint
pnpm prettier        # Format code
pnpm prettier-check  # Check formatting only
pnpm test            # Vitest (client = jsdom, server = node)
```

The full gate is `pnpm typecheck && pnpm lint && pnpm prettier-check &&
pnpm test && pnpm build && pnpm build:demo`. It does **not** cover the
SolidJS 2.0 dev-build diagnostics (`REACTIVE_WRITE_IN_OWNED_SCOPE`,
`STRICT_READ_UNTRACKED`), which only appear in a browser console — load the
demo pages to clear those.

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
3. **Grid line fix**: Missing horizontal line between row A and B (first row top border issue)

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
| Reading `tasks()` subscribes to ALL tasks | Reading `tasks[id]._bar.x` subscribes to ONE path |
| 400+ Bar re-evaluations per frame | 1 Bar re-evaluation per frame |
| ~10 FPS during drag | 60 FPS during drag |

**Files Modified**:
- `src/stores/taskStore.ts` - Store conversion, path-based updates
- `src/components/Bar.tsx` - Direct store path access, removed 3 unnecessary memos
- `src/components/Arrow.tsx` - Direct store path access
- `src/components/TaskLayer.tsx` - Store object iteration (kept 3 essential memos)
- `src/components/ArrowLayer.tsx` - Store object iteration
- `src/components/SummaryBar.tsx` - Removed 2 unnecessary memos
- `src/components/ExpandedTaskContainer.tsx` - Removed 2 unnecessary memos
- `src/components/SubtaskBar.tsx` - Removed 1 unnecessary memo

**Memo Strategy**:
- **Remove**: Memos for simple calculations in render paths (causes reactive subscriptions)
- **Keep**: Memos for expensive O(n) filtering operations (TaskLayer's `tasksByResource`, `visibleTaskIds`, `splitTaskIds`)

**Virtualization Architecture**:
```
src/utils/createVirtualViewport.ts
└── Single utility providing:
    ├── colRange()  → DateHeaders (which columns to render)
    ├── rowRange()  → Grid, TaskLayer, ArrowLayer (which rows)
    └── xRange()    → TaskLayer, ArrowLayer (X pixel filtering)

Gantt.tsx
└── viewport = createVirtualViewport({...})
    └── Shared by ALL components (single calculation)

TaskLayer.tsx / ArrowLayer.tsx
└── <For each={visibleItems()}> - Keyed by item identity
    └── New items get new components, removed items are destroyed
```

> **Historical note**: the per-arrow `src/components/ArrowLayer.tsx` referenced
> above was deleted in a later cleanup (it had no importer).
> `ArrowLayerBatched.tsx` is the only arrow layer that remains.

**Key Pattern**: solid-primitives/virtual approach
- `offset / itemSize → visible range` for viewport calculation
- `<For>` for item-keyed rendering (components tied to item identity, not array index)

With 10K tasks: 10,000 bars → ~11 rendered, 9,179 arrows → ~11 rendered

### Known Limitations

- No SSR support (SVG rendering is client-side only)

---

## File Quick Reference

| Need to... | Look in... |
|------------|------------|
| Modify arrow appearance | `Arrow.tsx` DEFAULTS object |
| Change anchor logic | `Arrow.tsx` autoSelectStartAnchor, autoSelectEndAnchor |
| Add bar interaction | `Bar.tsx` useDrag callbacks |
| Change grid snapping | `barCalculations.ts` snapToGrid |
| Modify constraint rules | `constraintEngine.ts` resolveConstraints, calculateCascadeUpdates |
| Add new config option | `ganttConfigStore.ts` |
| Change date calculations | `ganttDateStore.ts` |
| Modify task processing | `taskProcessor.ts` processTasks |
| Add/modify resource groups | `resourceStore.ts`, `resourceProcessor.ts` |
| Update Gantt demo tasks | `GanttDemo.tsx` tasks signal |
| Update showcase presets | `ShowcaseDemo.tsx` PRESETS object |
| Modify grid rendering | `Grid.tsx` |
| Change header rendering | `DateHeaders.tsx` |
