# Arrow Constraint System Documentation

## Overview

This document describes the comprehensive arrow rendering and constraint system implemented for the SolidJS Gantt chart component. The system supports directional arrows, temporal constraints, push behavior, task locking, and fixed offset relationships.

## Table of Contents

- [Arrow Rendering System](#arrow-rendering-system)
- [Constraint Types](#constraint-types)
- [Visual Indicators](#visual-indicators)
- [Implementation Details](#implementation-details)
- [Test Scenarios](#test-scenarios)
- [Usage Examples](#usage-examples)

---

## Arrow Rendering System

### Directional Awareness

Arrows automatically adapt their path based on the vertical relationship between predecessor and successor tasks:

1. **Upward Arrows** (predecessor BELOW successor)
   - Exit from predecessor's **top edge**
   - Curve upward to successor
   - Enter successor's left side

2. **Downward Arrows** (predecessor ABOVE successor)
   - Exit from predecessor's **bottom edge**
   - Curve downward to successor
   - Enter successor's left side

3. **Same-Level Arrows** (tasks at same height)
   - Exit from predecessor's **right-center**
   - Straight horizontal line to successor
   - Enter successor's left-center

### Anchor Point System

**Start Anchors** (configurable via `startAnchor` prop):
- `auto` - Automatically selects top-edge, bottom-edge, or right-center based on direction
- `top-edge` - Exit from top edge at calculated offset
- `bottom-edge` - Exit from bottom edge at calculated offset
- `right-center` - Exit from right side center

**End Anchors** (default: `left-center`):
- `left-center` - Enter at left side center
- `left-top`, `left-bottom` - Alternative entry points

### Smooth Offset Calculation

The system calculates a **smooth, proportional offset** for edge anchors instead of binary jumps:

```javascript
const idealExitX = to.x - minClearance;
const offsetRatio = (idealExitX - from.x) / from.width;
anchorOffset = Math.max(0, Math.min(1, offsetRatio));  // Smooth 0-1 range
```

This ensures arrows transition smoothly as tasks are dragged, avoiding sudden jumps from center to edge.

### Path Generation

**Vertical-First Paths** (for top/bottom edge starts):
- Start with vertical segment
- Add rounded corner
- Horizontal segment to target
- Handles near-vertical alignment to avoid bulge artifacts

**Horizontal-First Paths** (for right-center starts):
- Start with horizontal segment
- Add two rounded corners (S-curve shape)
- Vertical segment
- Final horizontal to target

**Near-Vertical Alignment Detection**:
```javascript
const nearlyAligned = Math.abs(dx) < curve;
if (nearlyAligned) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y} ${arrowHead}`;
}
```

---

## Constraint Types

### 1. Temporal Constraints

**Rule**: Successor can start any time **after** the predecessor **starts** (not after it ends).

This allows **temporal overlap** - tasks can execute simultaneously as long as the successor doesn't begin before the predecessor.

```javascript
// Constraint calculation
const minX = predecessor.$bar.x + MIN_GAP;  // Start of predecessor + small gap
newX = Math.max(newX, minX);
```

**MIN_GAP**: Set to 2px to allow close positioning while preventing exact overlap for visual clarity.

### 2. Push Behavior

**Rule**: When a predecessor is dragged forward and would collide with its successor:
- If successor is **unlocked**: Push it forward by the collision distance
- If successor is **locked**: Stop the predecessor at the collision point

```javascript
const isPredecessor = arrows.find(a => a.from === taskId);
if (isPredecessor) {
    const successor = taskStore.getTask(isPredecessor.to);
    const predRightEdge = newX + task.$bar.width;
    const collisionPoint = successor.$bar.x - MIN_GAP;

    if (predRightEdge > collisionPoint) {
        if (successor.locked) {
            // Stop predecessor
            newX = collisionPoint - task.$bar.width;
        } else {
            // Push successor forward
            const pushDistance = predRightEdge - collisionPoint;
            taskStore.updateBarPosition(successor.id, {
                x: successor.$bar.x + pushDistance,
                y: successor.$bar.y
            });
        }
    }
}
```

### 3. Task Locking

**Rule**: Individual tasks can be marked as `locked: true` to prevent all movement.

**Effects**:
- Task cannot be dragged
- Acts as immovable barrier for push behavior
- Blocks fixed offset chain movement if any linked task is locked

**Visual Feedback**:
- Gray fill color (#7f8c8d)
- Red dashed border (#e74c3c, 3px width, 5-5 dash pattern)
- Lock emoji (🔒) displayed on task

### 4. Fixed Offset Locks

**Rule**: Tasks connected by `fixedOffset: true` relationships maintain an exact locked distance and move together **bidirectionally**.

**Characteristics**:
- **Bidirectional**: Dragging either task moves both
- **Cascading**: Chains (A→B→C) work correctly - dragging any task moves entire chain
- **Lock-aware**: Movement blocked if any linked task is locked
- **Maintains offset**: Tasks keep their exact distance relationship

**Implementation**:

```javascript
const findFixedOffsetLinks = (taskId, visited = new Set()) => {
    if (visited.has(taskId)) return [];
    visited.add(taskId);

    const linked = [];

    // Find arrows where this task is the 'from'
    arrows.forEach(arrow => {
        if (arrow.fixedOffset && arrow.from === taskId) {
            linked.push({ taskId: arrow.to, arrow });
            const chainedLinks = findFixedOffsetLinks(arrow.to, visited);
            linked.push(...chainedLinks);
        }
    });

    // Find arrows where this task is the 'to' (bidirectional)
    arrows.forEach(arrow => {
        if (arrow.fixedOffset && arrow.to === taskId) {
            linked.push({ taskId: arrow.from, arrow });
            const chainedLinks = findFixedOffsetLinks(arrow.from, visited);
            linked.push(...chainedLinks);
        }
    });

    return linked;
};
```

**Drag synchronization**:
```javascript
const fixedOffsetLinks = findFixedOffsetLinks(taskId);
if (fixedOffsetLinks.length > 0) {
    // Check if any linked task is locked
    const hasLockedLink = fixedOffsetLinks.some(link => {
        const linkedTask = taskStore.getTask(link.taskId);
        return linkedTask && linkedTask.locked;
    });

    if (hasLockedLink) {
        return; // Cannot move - fixed offset link has a locked task
    }

    // Calculate movement delta
    const deltaX = newX - task.$bar.x;
    const deltaY = newY - task.$bar.y;

    // Move all linked tasks by the same delta
    fixedOffsetLinks.forEach(link => {
        const linkedTask = taskStore.getTask(link.taskId);
        if (linkedTask) {
            taskStore.updateBarPosition(link.taskId, {
                x: linkedTask.$bar.x + deltaX,
                y: linkedTask.$bar.y + deltaY
            });
        }
    });

    // Move the dragged task
    taskStore.updateBarPosition(taskId, { x: newX, y: newY });

    return; // Skip normal constraint logic
}
```

---

## Visual Indicators

### Regular Dependency Arrows

**Appearance**:
- Solid line
- Arrowhead pointing to successor
- Stroke width: 2.5px
- Color varies by scenario (for testing)

**Example**:
```javascript
<Arrow
    fromTaskId="task-a"
    toTaskId="task-b"
    stroke="#3498db"
    strokeWidth={2.5}
/>
```

### Locked Tasks

**Appearance**:
- Fill: Gray (#7f8c8d)
- Border: Red (#e74c3c)
- Border style: Dashed (5-5 pattern)
- Border width: 3px
- Cursor: `not-allowed`
- Label: Lock emoji (🔒)

**Code**:
```javascript
fill={isLocked() ? "#7f8c8d" : "#34495e"}
stroke={isLocked() ? "#e74c3c" : "#2c3e50"}
stroke-width={isLocked() ? "3" : "2"}
stroke-dasharray={isLocked() ? "5,5" : "none"}
```

### Fixed Offset Indicators

**Appearance**:
- Color: Purple (#9c27b0)
- Stroke width: 5px (thicker than regular arrows)
- Stroke dash pattern: 10-5
- **No arrowhead** (arrowSize: 0)

**Rationale**: The bidirectional nature of fixed offset relationships means neither task is truly the "predecessor" - they're synchronized peers. The lack of arrowhead reflects this symmetric relationship.

**Example**:
```javascript
<Arrow
    fromTaskId="task-a"
    toTaskId="task-b"
    stroke="#9c27b0"
    strokeWidth={5}
    strokeDasharray="10,5"
    arrowSize={0}  // No arrowhead
/>
```

**Arrow Definition**:
```javascript
{
    from: 'task-a',
    to: 'task-b',
    color: '#9c27b0',
    label: 'Fixed Offset',
    fixedOffset: true,
    offsetDistance: 90
}
```

---

## Implementation Details

### File Structure

```
src/solid/
├── components/
│   ├── Arrow.jsx                    # Core arrow rendering component
│   ├── TestArrow.jsx               # Basic test component
│   └── TestArrowEdgeCases.jsx      # Comprehensive test with all constraints
├── stores/
│   └── taskStore.js                # Reactive task position store
└── test-arrow-edge-cases-entry.jsx # Entry point for edge cases test
```

### Key Components

#### Arrow.jsx

**Purpose**: Renders SVG path element for dependency arrows

**Props**:
- `fromTaskId`, `toTaskId` - Task IDs to connect
- `taskStore` - Reactive store with task positions
- `startAnchor` - Where arrow exits predecessor (auto/top-edge/bottom-edge/right-center)
- `endAnchor` - Where arrow enters successor (default: left-center)
- `startAnchorOffset` - Position along edge (0-1 ratio)
- `curveRadius` - Corner roundness (default: 5)
- `arrowSize` - Arrowhead size (default: 5, set to 0 for fixed offset)
- `stroke` - Line color
- `strokeWidth` - Line thickness
- `strokeDasharray` - Dash pattern (e.g., "10,5" for fixed offset)

**Key Functions**:
- `getAnchorPoint(bar, anchor, offset)` - Calculate anchor coordinates
- `generateArrowPath(start, end, config, startAnchor)` - Generate SVG path
- `generateForwardArrow(...)` - Generate L-shaped path with curves

#### TestArrowEdgeCases.jsx

**Purpose**: Comprehensive test page with all constraint scenarios

**Features**:
- 8 test scenarios covering all constraint types
- Interactive drag-and-drop
- Live configuration controls (curve radius, anchor type, etc.)
- Debug mode showing Y coordinates
- Comprehensive documentation in UI
- Push behavior demonstration
- Fixed offset lock demonstration

**Test Scenarios**:
1. **Push Unlocked** - Predecessor pushes unlocked successor
2. **Push Locked** - Predecessor stops at locked successor
3. **Successor Free** - Successor can move anywhere after predecessor starts
4. **Overlap Allowed** - Tasks can overlap temporally
5. **Lock Immovable** - Locked task cannot be dragged
6. **Lock Blocks Push** - Locked successor stops predecessor
7. **Fixed Offset Pair** - Simple bidirectional sync between two tasks
8. **Fixed Offset Chain** - Cascading chain (A→B→C) moves together

**Key Functions**:
- `findFixedOffsetLinks(taskId, visited)` - Recursively find all linked tasks
- `handleMouseDown(taskId, event)` - Initialize drag
- `handleMouseMove(event)` - Apply constraints during drag
- `handleMouseUp()` - End drag

### taskStore.js

**Purpose**: Reactive store for task positions using SolidJS signals

**Key Methods**:
- `updateTasks(tasks)` - Initialize task data
- `getTask(id)` - Get task object
- `getBarPosition(id)` - Get bar position (`$bar` property)
- `updateBarPosition(id, position)` - Update bar position reactively

**Data Structure**:
```javascript
{
    id: 'task-1',
    name: 'Task Name',
    _index: 0,
    locked: false,  // Optional
    $bar: {
        x: 100,
        y: 50,
        width: 80,
        height: 20
    }
}
```

---

## Test Scenarios

### Running Tests

1. **Start development server**:
   ```bash
   pnpm run dev:solid
   ```

2. **Open test page**:
   - Navigate to `http://localhost:5173/test-arrow-edge-cases.html`
   - Or use `test-arrow.html` for basic tests

### Test Page Features

**Configuration Controls**:
- Curve Radius (0-20): Adjust corner roundness
- Padding Gap (10-30): Horizontal spacing
- Start Anchor: Auto/Right Center/Top Edge/Bottom Edge
- Edge Position (0-100%): Manual offset along edge
- Show Debug Info: Display Y coordinates

**Interactive Elements**:
- Drag any unlocked task to test constraints
- Observe push behavior in scenarios 1-2
- Test temporal overlap in scenario 4
- Try dragging locked tasks (should fail)
- Drag any task in fixed offset pairs/chains (all move together)

### Expected Behaviors

**Scenario 1: Push Unlocked**
- Drag predecessor right → successor moves forward
- Drag predecessor left → successor stays in place

**Scenario 2: Push Locked**
- Drag predecessor right → stops at successor boundary
- Locked successor shown with red dashed border

**Scenario 3: Successor Free**
- Successor can be dragged anywhere after predecessor start
- Can overlap with predecessor

**Scenario 4: Overlap Allowed**
- Tasks can overlap temporally
- Successor only constrained to start after predecessor starts

**Scenario 5: Lock Immovable**
- Locked task cannot be dragged
- Cursor shows `not-allowed`

**Scenario 6: Lock Blocks Push**
- Predecessor stops when it would push locked successor

**Scenario 7: Fixed Offset Pair**
- Drag either task → both move by same delta
- Purple dashed line indicates relationship
- No arrowhead (bidirectional)

**Scenario 8: Fixed Offset Chain**
- Drag any of A, B, or C → all three move together
- Maintains exact offsets throughout chain

---

## Usage Examples

### Basic Dependency Arrow

```javascript
import { Arrow } from './components/Arrow.jsx';
import { createTaskStore } from './stores/taskStore.js';

const taskStore = createTaskStore();
taskStore.updateTasks([
    { id: 'task-1', name: 'Task 1', _index: 0, $bar: { x: 50, y: 100, width: 80, height: 20 } },
    { id: 'task-2', name: 'Task 2', _index: 1, $bar: { x: 150, y: 150, width: 80, height: 20 } }
]);

<Arrow
    fromTaskId="task-1"
    toTaskId="task-2"
    taskStore={taskStore}
    stroke="#3498db"
    strokeWidth={2.5}
/>
```

### Locked Task

```javascript
taskStore.updateTasks([
    {
        id: 'task-locked',
        name: 'Locked Task',
        locked: true,  // Prevent movement
        _index: 0,
        $bar: { x: 50, y: 100, width: 80, height: 20 }
    }
]);
```

### Fixed Offset Relationship

```javascript
const arrows = [
    {
        from: 'task-a',
        to: 'task-b',
        color: '#9c27b0',
        label: 'Fixed Offset',
        fixedOffset: true,
        offsetDistance: 90
    }
];

<Arrow
    fromTaskId="task-a"
    toTaskId="task-b"
    taskStore={taskStore}
    stroke="#9c27b0"
    strokeWidth={5}
    strokeDasharray="10,5"
    arrowSize={0}  // No arrowhead for bidirectional relationship
/>
```

### Cascading Fixed Offset Chain

```javascript
const arrows = [
    { from: 'task-a', to: 'task-b', fixedOffset: true, offsetDistance: 80 },
    { from: 'task-b', to: 'task-c', fixedOffset: true, offsetDistance: 80 }
];

// Dragging any of A, B, or C will move all three tasks together
```

### Custom Arrow Styling

```javascript
<Arrow
    fromTaskId="task-1"
    toTaskId="task-2"
    taskStore={taskStore}
    curveRadius={10}           // More rounded corners
    horizontalGap={20}         // More horizontal spacing
    arrowSize={8}              // Larger arrowhead
    startAnchor="top-edge"     // Force top edge exit
    startAnchorOffset={0.75}   // Exit at 75% along edge
    stroke="#e74c3c"           // Red color
    strokeWidth={3}            // Thicker line
/>
```

---

## Configuration Reference

### Arrow Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fromTaskId` | string | required | ID of predecessor task |
| `toTaskId` | string | required | ID of successor task |
| `taskStore` | object | required | Reactive task store |
| `startAnchor` | string | `'auto'` | Where arrow exits: auto/top-edge/bottom-edge/right-center |
| `endAnchor` | string | `'left-center'` | Where arrow enters successor |
| `startAnchorOffset` | number | `0.5` | Position along edge (0-1) |
| `curveRadius` | number | `5` | Corner roundness in pixels |
| `horizontalGap` | number | `10` | Horizontal spacing |
| `arrowSize` | number | `5` | Arrowhead size (0 = no arrowhead) |
| `stroke` | string | `'#666'` | Line color |
| `strokeWidth` | number | `1.4` | Line thickness |
| `strokeDasharray` | string | undefined | Dash pattern (e.g., "10,5") |

### Constraint Constants

```javascript
const MIN_GAP = 2;  // Minimum gap between tasks (pixels)
```

### Visual Style Constants

```javascript
// Regular arrows
const REGULAR_STROKE_WIDTH = 2.5;

// Fixed offset arrows
const FIXED_OFFSET_COLOR = '#9c27b0';
const FIXED_OFFSET_STROKE_WIDTH = 5;
const FIXED_OFFSET_DASH_PATTERN = '10,5';
const FIXED_OFFSET_ARROW_SIZE = 0;  // No arrowhead

// Locked tasks
const LOCKED_FILL = '#7f8c8d';
const LOCKED_STROKE = '#e74c3c';
const LOCKED_STROKE_WIDTH = 3;
const LOCKED_DASH_PATTERN = '5,5';
```

---

## Technical Notes

### SolidJS Reactive Patterns

The implementation uses SolidJS reactive primitives:

```javascript
import { createSignal, createMemo, For } from 'solid-js';

// Reactive position tracking
const fromPosition = createMemo(() => props.taskStore.getBarPosition(props.fromTaskId));
const toPosition = createMemo(() => props.taskStore.getBarPosition(props.toTaskId));

// Path recalculates automatically when positions change
const path = createMemo(() => {
    const from = fromPosition();
    const to = toPosition();
    if (!from || !to) return '';
    return generateArrowPath(from, to, config(), startAnchor);
});
```

### SVG Coordinate System

- Origin (0,0) is top-left of SVG viewport
- Y increases downward
- Positive angles rotate clockwise
- Arc sweep flag: 0 = counter-clockwise, 1 = clockwise

### Performance Considerations

- Memoized path calculations prevent unnecessary recalculations
- Recursive fixed offset search uses `visited` set to prevent infinite loops
- Minimal DOM manipulation - only updates position attributes

---

## Change Log

### Recent Changes

**Fixed Offset Locks** (Latest):
- Added `fixedOffset` arrow type
- Implemented bidirectional synchronization
- Added cascading chain support
- Integrated lock conflict detection
- Added purple dashed visual indicator

**Smooth Offset Transitions**:
- Replaced binary anchor offset jumps with proportional calculations
- Added near-vertical alignment detection
- Eliminated bulge artifacts

**Push Behavior**:
- Implemented collision detection
- Added push-forward logic for unlocked successors
- Added stop-at-boundary logic for locked successors

**Temporal Overlap Support**:
- Changed successor constraint from "after predecessor ends" to "after predecessor starts"
- Reduced MIN_GAP from 20px to 2px

**Task Locking**:
- Added individual task lock support
- Implemented visual feedback (gray fill, red dashed border, lock emoji)
- Integrated with constraint system

---

## Future Enhancements

Potential areas for expansion:

1. **Backward Arrows**: Support for arrows pointing backward in time (successor to predecessor visually)
2. **Multiple Dependencies**: Task with multiple predecessors/successors
3. **Dependency Types**: Different constraint rules (FS, SS, FF, SF)
4. **Lag/Lead Times**: Configurable time offsets between tasks
5. **Critical Path**: Highlight critical path through task network
6. **Constraint Violation Detection**: Visual warnings when constraints would be violated
7. **Undo/Redo**: History tracking for drag operations
8. **Snap to Grid**: Optional grid snapping during drag
9. **Animation**: Smooth transitions when tasks are programmatically moved
10. **Touch Support**: Mobile-friendly drag interactions

---

## License

This implementation is part of the Frappe Gantt project.

---

## Contact

For questions or issues, please refer to the main project documentation or open an issue in the project repository.
