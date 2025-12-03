# Arrow & Constraint System

## Overview

Arrows visualize task dependencies. Constraints enforce task positioning rules.

**Key Principles:**
- Arrows are purely visual (decorative)
- Constraints are enforced during drag operations
- Successor cannot start before predecessor

---

## Arrow Behavior

### Routing Rules

1. **End Point**: Always enters at successor's LEFT edge (task start)
2. **Exit Point**: Always to the LEFT of successor's start
3. **Direction**: Always goes forward (right), never backward

### Start Anchor Selection (automatic)

| Condition | Exit From |
|-----------|-----------|
| Successor above | Predecessor's TOP edge |
| Successor below | Predecessor's BOTTOM edge |
| Vertically aligned | Predecessor's RIGHT edge |

### Exit Point Offset

When exiting from TOP or BOTTOM edges, the arrow exits at **90% along the bar** (10% from the right edge) by default. This ensures arrows don't exit from the very corner, which looks awkward.

The offset is automatically clamped to ensure the exit point is always to the left of the successor's start, leaving room for the curve.

| Anchor | Default Offset | Notes |
|--------|----------------|-------|
| RIGHT | 50% (center) | Middle of right edge |
| TOP/BOTTOM | 90% | 10% from right edge, clamped if needed |

### Path Shapes

- **Vertical-first (L-shape)**: Exit top/bottom → curve → horizontal to target
- **Horizontal-first (S-curve)**: Exit right → curve → vertical → curve → horizontal to target

---

## Constraint Types

### 1. Hard Limit: Successor Position

**Rule**: `successor.x >= predecessor.x`

Successor cannot start before predecessor starts. This is always enforced.

### 2. minDistance (Push)

**Rule**: Minimum gap between predecessor's END and successor's START.

- Drag predecessor forward → pushes successor if gap < minDistance
- Set `minDistance: -Infinity` to allow overlap (parallel tasks)

### 3. maxDistance (Pull/Tether)

**Rule**: Maximum gap between predecessor's END and successor's START.

- Drag predecessor backward → pulls successor if gap > maxDistance

### 4. fixedOffset

**Rule**: Tasks maintain exact distance and move together.

- Bidirectional: drag either task, both move
- Chains work: A→B→C all move together

### 5. Task Locking

**Rule**: `locked: true` prevents all movement.

- Task cannot be dragged
- Blocks push/pull from relationships
- Blocks fixed-offset chain movement

---

## Visual Indicators

| Element | Appearance |
|---------|------------|
| Regular arrow | Solid line with chevron head |
| Fixed offset | Purple dashed line, no arrowhead |
| Locked task | Gray fill, red dashed border, lock icon |

---

## Usage

### Basic Arrow

```jsx
<Arrow
  taskStore={taskStore}
  fromId="task-a"
  toId="task-b"
  stroke="#3498db"
/>
```

### Relationship with Constraints

```javascript
relationships: [
  { from: 'a', to: 'b', minDistance: 10 },           // Push if closer than 10px
  { from: 'a', to: 'b', maxDistance: 100 },          // Pull if further than 100px
  { from: 'a', to: 'b', minDistance: -Infinity },    // Allow overlap (parallel)
  { from: 'a', to: 'b', fixedOffset: true },         // Move together
]
```

### Locked Task

```javascript
{ id: 'task-1', constraints: { locked: true } }
```

---

## Files

| File | Purpose |
|------|---------|
| `Arrow.jsx` | Arrow rendering component |
| `Bar.jsx` | Task bar with drag/resize/progress |
| `BarDemo.jsx` | Main demo with all features |
| `ConstraintDemo.jsx` | Interactive demo with constraint scenarios |
| `constraintResolver.js` | Constraint resolution logic |
| `taskStore.js` | Reactive task position store |

---

## See Also

For comprehensive documentation including all components, stores, and utilities, see `SOLID_ARCHITECTURE.md`.
