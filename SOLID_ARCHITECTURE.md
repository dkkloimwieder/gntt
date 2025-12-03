# SolidJS Architecture Documentation

**Last Updated**: November 28, 2025

This document describes the current state of the SolidJS implementation within the Frappe Gantt project. The codebase is in active migration from vanilla JavaScript to SolidJS, following a hybrid architecture that allows both implementations to coexist.

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

The SolidJS implementation lives in `src/solid/` and provides reactive, fine-grained updates for Gantt chart components. The migration follows an incremental approach with adapters for interoperability with the existing vanilla JavaScript codebase.

### Migration Status

| Component | Status | Location |
|-----------|--------|----------|
| Arrow | Complete | `src/solid/components/Arrow.jsx` |
| Bar | Complete | `src/solid/components/Bar.jsx` |
| Popup | Complete | `src/solid/components/Popup.jsx` |
| Task Store | Complete | `src/solid/stores/taskStore.js` |
| Config Store | Complete | `src/solid/stores/ganttConfigStore.js` |
| Constraint System | Complete | `src/solid/utils/constraintResolver.js` |
| Main Gantt Orchestrator | Pending | - |

---

## Directory Structure

```
src/solid/
├── components/
│   ├── Arrow.jsx           # Dependency arrow rendering
│   ├── ArrowDemo.jsx       # Arrow component test page
│   ├── Bar.jsx             # Task bar with drag/resize/progress
│   ├── BarDemo.jsx         # Bar component test page (main demo)
│   ├── ConstraintDemo.jsx  # Constraint system test page
│   ├── CurveDiagnostic.jsx # Arrow curve debugging tool
│   ├── Popup.jsx           # Task detail tooltip
│   ├── TestPopup.jsx       # Popup test page
│   └── TestPrimitives.jsx  # SolidJS primitives test
├── stores/
│   ├── taskStore.js        # Reactive task state management
│   └── ganttConfigStore.js # Configuration state management
├── utils/
│   ├── barCalculations.js  # Pure functions for bar geometry
│   ├── constraintResolver.js # Task relationship constraints
│   ├── date_utils.js       # Date manipulation utilities
│   ├── svg_utils.js        # SVG DOM helpers
│   └── usePrevious.js      # Previous value tracking hook
├── hooks/
│   └── useDrag.js          # RAF-based drag state machine
├── adapters/
│   ├── ArrowAdapter.jsx    # Vanilla API wrapper for Arrow
│   └── PopupAdapter.jsx    # Vanilla API wrapper for Popup
└── *-entry.jsx             # Vite entry points for demos
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
| `endAnchor` | `'auto'\|'left'` | `'auto'` | Where arrow enters successor |
| `startOffset` | `number` | Smart calc | 0-1 position along anchor edge |
| `routing` | `'orthogonal'\|'straight'` | `'orthogonal'` | Path routing style |
| `curveRadius` | `number` | `5` | Radius for rounded corners |
| `stroke` | `string` | `'#666'` | Arrow color |
| `strokeWidth` | `number` | `1.4` | Line thickness |
| `headSize` | `number` | `5` | Arrow head size |
| `headShape` | `'chevron'\|'triangle'\|'none'` | `'chevron'` | Arrow head style |

**Path Calculation Logic** (`Arrow.jsx:117-135`):
```javascript
function calculateSmartOffset(from, to, anchor, curveRadius) {
    if (anchor === 'right') return 0.5;  // Center of right edge

    if (anchor === 'top' || anchor === 'bottom') {
        const defaultOffset = 0.90;  // 10% from right edge
        const maxExitX = to.x - curveRadius;
        const maxOffset = (maxExitX - from.x) / from.width;
        return Math.max(0, Math.min(defaultOffset, maxOffset));
    }

    return 0.5;
}
```

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

**Drag States** (`Bar.jsx:60-174`):
- `idle` - No drag in progress
- `dragging_bar` - Moving entire bar horizontally
- `dragging_left` - Resizing from left edge
- `dragging_right` - Resizing from right edge
- `dragging_progress` - Adjusting progress percentage

---

### Popup Component (`Popup.jsx`)

**Purpose**: Displays task detail tooltips.

**Variants**:
- `Popup` - Simple HTML content popup
- `StructuredPopup` - Title/subtitle/details/actions layout

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `visible` | `() => boolean` | Visibility signal |
| `position` | `() => {x, y}` | Position signal |
| `content` | `() => string` | HTML content |
| `title` | `() => string` | (StructuredPopup) Title |
| `subtitle` | `() => string` | (StructuredPopup) Subtitle |
| `details` | `() => string` | (StructuredPopup) Details |
| `actions` | `() => Action[]` | (StructuredPopup) Button actions |

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
Uses `createSignal(new Map())` for task storage. Each task includes `$bar` property with position data.

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

### Constraint Resolver (`constraintResolver.js`)

Handles relationship constraints between tasks.

**Constraint Types** (on relationships):
| Property | Type | Description |
|----------|------|-------------|
| `minDistance` | `number` | Minimum gap in pixels (push if closer) |
| `maxDistance` | `number` | Maximum gap in pixels (pull if further) |
| `fixedOffset` | `boolean` | Tasks move together as unit |

**Task Constraints**:
| Property | Type | Description |
|----------|------|-------------|
| `locked` | `boolean` | Task cannot move |

**API**:
```javascript
import { resolveMovement, findFixedOffsetLinks, calculateDistance } from './constraintResolver.js';

// Resolve movement with constraints
const result = resolveMovement(taskId, newX, newY, taskStore, relationships, depth);
// Returns:
//   { type: 'single', taskId, x, y } - Single task update
//   { type: 'batch', updates: [...] } - Fixed-offset group update
//   null - Movement blocked

// Find all fixed-offset linked tasks
const links = findFixedOffsetLinks('task-1', relationships);
// Returns: [{ taskId: 'task-2', relationship }]

// Calculate edge-to-edge distance
const gap = calculateDistance(predTask, succTask, predNewX);
```

**Resolution Logic**:
1. Check if task is locked → block movement
2. Check for fixed-offset relationships → move entire group
3. For each minDistance constraint → push successors if too close
4. For each maxDistance constraint → pull successors if too far
5. Enforce hard limit: successor cannot start before predecessor starts

---

### Date Utilities (`date_utils.js`)

Date manipulation functions (unchanged from vanilla).

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

### BarDemo (`/test-bar.html`)

Main demonstration of Bar and Arrow components.

**Features Demonstrated**:
- 8 sample tasks with various configurations
- Relationship constraints (minDistance, maxDistance, fixedOffset)
- Expected progress calculation (dates relative to today)
- Locked task (cannot be moved)
- Debug overlay (shows constraint info)
- Progress adjustment buttons

**Sample Tasks**:
| Task | Description | Constraints |
|------|-------------|-------------|
| Design | Complete task (100%) | - |
| Documentation | Parallel with Design (start-to-start) | minDistance: -Infinity |
| Frontend Dev | After Design (finish-to-start) | minDistance: 0 |
| Backend Dev | After Design, parallel with Frontend | minDistance: 0 |
| Integration | After both parallel tasks, tethered | maxDistance: 90 |
| Locked Task | Cannot be moved | locked: true |
| Sync A / Sync B | Move together | fixedOffset: true |

**Run**: `pnpm run dev:solid` → http://localhost:5173/test-bar.html

---

### ConstraintDemo (`/test-constraints.html`)

Focused constraint system testing with isolated scenarios.

**Scenarios**:
1. Push (minDistance) - Drag predecessor, pushes successor
2. Blocked by Lock - Movement stops at locked task
3. Pull/Tether (maxDistance) - Tasks pulled when gap exceeds limit
4. Bounded (min + max) - Gap constrained between limits
5. Fixed Offset Pair - Two tasks move together
6. Fixed Offset Chain - Three tasks linked A→B→C
7. Parallel Tasks - Overlapping (start-to-start)
8. Arrow Directions - Forward arrows up/down/same level

**Run**: `pnpm run dev:solid` → http://localhost:5173/test-constraints.html

---

### ArrowDemo (`/test-arrow.html`)

Arrow component testing in isolation.

---

## Configuration Options

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
- **Relationships**: Distance constraints (minDistance, maxDistance, fixedOffset)
- **Tasks**: Lock state only (prevents movement)

**Resolution Flow**:
```
User drags task
    ↓
Bar.onConstrainPosition called
    ↓
resolveMovement() checks:
    1. Is task locked? → Block
    2. Fixed-offset links? → Move group
    3. Check minDistance → Push successors
    4. Check maxDistance → Pull successors
    ↓
Return constrained position
    ↓
taskStore.updateBarPosition()
    ↓
Arrow paths recalculate (reactive)
```

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

**Auto-selection Logic** (`Arrow.jsx:81-103`):

```
If tasks overlap horizontally:
    → Exit from TOP or BOTTOM (based on vertical position)

Else if vertically aligned (within 8px):
    → Exit from RIGHT edge (center)

Else if target is above:
    → Exit from TOP

Else:
    → Exit from BOTTOM
```

**Exit Offset Calculation**:
- For TOP/BOTTOM: Default 90% along bar (10% from right edge)
- Clamped to ensure exit point is left of target's left edge
- Leaves room for curve radius

---

## Development Workflow

### Running Demos

```bash
# Install dependencies
pnpm i

# Start SolidJS development server
pnpm run dev:solid

# Open demos:
# http://localhost:5173/test-bar.html       - Main demo
# http://localhost:5173/test-constraints.html - Constraint demo
# http://localhost:5173/test-arrow.html     - Arrow demo
# http://localhost:5173/test-popup.html     - Popup demo
# http://localhost:5173/test-solid.html     - Primitives test
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

1. **Core Components**: Bar, Arrow, Popup fully functional
2. **State Management**: Task and config stores operational
3. **Interactions**: Drag, resize, progress editing working
4. **Constraints**: Full constraint system implemented
5. **Demos**: Interactive test pages for all components

### What's Pending

1. **Main Gantt Orchestrator**: Grid, headers, scroll handling
2. **Public API Wrapper**: Compatibility layer for vanilla API
3. **Infinite Padding**: Timeline extension on scroll
4. **View Mode Switching**: Day/Week/Month/Year support
5. **Cleanup**: Remove adapters, delete vanilla code

### Known Limitations

- No SSR support (SVG rendering is client-side only)
- Demos use hardcoded sample data
- No TypeScript (JavaScript only)
- Test coverage pending (framework skipped per user request)

---

## File Quick Reference

| Need to... | Look in... |
|------------|------------|
| Modify arrow appearance | `Arrow.jsx` DEFAULTS object (line 14-38) |
| Change anchor logic | `Arrow.jsx` autoSelectStartAnchor (line 81-103) |
| Adjust exit offset | `Arrow.jsx` calculateSmartOffset (line 117-135) |
| Add bar interaction | `Bar.jsx` useDrag callbacks (line 60-174) |
| Change grid snapping | `barCalculations.js` snapToGrid |
| Modify constraint rules | `constraintResolver.js` resolveMovement |
| Add new config option | `ganttConfigStore.js` |
| Update sample tasks | `BarDemo.jsx` sampleTasks array |
