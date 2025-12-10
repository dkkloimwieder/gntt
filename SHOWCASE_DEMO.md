# ShowcaseDemo - Interactive Props Showcase

Interactive demonstration of all task bar and connector configuration options.

**File:** `src/solid/components/ShowcaseDemo.jsx`
**URL:** `http://localhost:5173/showcase-demo.html`

---

## Quick Start

```bash
pnpm run dev:solid
# Open http://localhost:5173/showcase-demo.html
```

---

## Presets

| Preset | Purpose | Key Settings |
|--------|---------|--------------|
| **Default** | Baseline configuration | Gray task, chevron arrow, no constraints |
| **Colorful** | Visual emphasis | Red task, purple arrow, filled triangle head |
| **Minimal** | Clean aesthetic | Gray, straight routing, no arrow head, 0.5 opacity |
| **Constrained** | Push/pull demo | Blue task, minDistance: 20px, maxDistance: 200px |
| **Locked** | Immutable task | Gray locked task, dashed red arrow |
| **Fixed Offset** | Linked movement | Purple, dashed arrow, tasks move together |

---

## Configuration Reference

### Task Configuration

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `name` | string | - | "Task" | Display label |
| `color` | hex | - | #b8c2cc | Bar background |
| `color_progress` | hex | - | #a3a3ff | Progress fill |
| `progress` | number | 0-100 | 50 | Completion % |
| `cornerRadius` | number | 0-15 | 3 | Border radius (px) |
| `locked` | boolean | - | false | Prevent all interaction |
| `invalid` | boolean | - | false | Visual error state |

### Connector Configuration

#### Anchoring

| Parameter | Type | Options | Default |
|-----------|------|---------|---------|
| `startAnchor` | string | auto, top, bottom, left, right, center | auto |
| `endAnchor` | string | auto, top, bottom, left, right, center | auto |
| `startOffset` | number | 0-1 (null = auto) | null |
| `endOffset` | number | 0-1 | 0.5 |

#### Path Shape

| Parameter | Type | Options/Range | Default |
|-----------|------|---------------|---------|
| `routing` | string | orthogonal, straight | orthogonal |
| `curveRadius` | number | 0-30 | 5 |

#### Line Style

| Parameter | Type | Range | Default |
|-----------|------|-------|---------|
| `stroke` | hex | - | #666 |
| `strokeWidth` | number | 0.5-6 | 1.4 |
| `strokeOpacity` | number | 0-1 | 1 |
| `strokeDasharray` | string | solid, 8,4, 4,4, 2,4, 12,4,4,4 | "" |

#### Arrow Head

| Parameter | Type | Options | Default | Notes |
|-----------|------|---------|---------|-------|
| `headShape` | string | chevron, triangle, diamond, circle, none | chevron | |
| `headSize` | number | 0-15 | 5 | pixels |
| `headFill` | boolean | - | false | Chevron never fills |

### Constraint Configuration

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `minDistance` | number/null | 0-200 | null | Min gap (px). Push if closer. |
| `maxDistance` | number/null | 50-500 | null | Max gap (px). Pull if further. |
| `fixedOffset` | boolean | - | false | Tasks move as unit |
| `allowOverlap` | boolean | - | true | Allow parallel positioning |

### Global Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `readonly` | boolean | false | Disable all interactions |
| `readonlyDates` | boolean | false | Disable position changes |
| `readonlyProgress` | boolean | false | Disable progress dragging |
| `showExpectedProgress` | boolean | false | Show expected vs actual (requires task dates) |
| `snapToGrid` | boolean | true | Snap to column boundaries |
| `columnWidth` | number | 45 | Grid cell width (1-90px) |

---

## Constraint Behavior

### Hard Limit
Successor (Task B) cannot start before predecessor (Task A) starts.
```
Task B.x >= Task A.x  // Always enforced
```

### minDistance (Push)
When gap between Task A's end and Task B's start falls below minDistance, Task B is pushed right.
```
gap = TaskB.x - (TaskA.x + TaskA.width)
if (gap < minDistance) push TaskB
```

### maxDistance (Pull)
When gap exceeds maxDistance, Task B is pulled toward Task A.
```
if (gap > maxDistance) pull TaskB
```

### fixedOffset
Tasks maintain exact distance. Moving one moves the other by same delta.

### allowOverlap
- **true**: Tasks can occupy same horizontal space (parallel)
- **false**: Default minDistance of 10px enforced

### Locked Tasks
- Visual: Gray fill, red dashed border, lock icon
- Behavior: Cannot move, resize, or adjust progress
- Constraint: Blocks push/pull from relationships

---

## Known Limitations

| Feature | Limitation |
|---------|------------|
| `showExpectedProgress` | Requires task `start`/`end` date properties. Demo tasks use position-only data, so this toggle has no visual effect. |

---

## Recent Fixes

| Issue | Resolution |
|-------|------------|
| Arrow fill applied to entire path | Split into separate line + head `<path>` elements |
| Predecessor could move past successor | Hard limit enforced after push/pull logic |
| Grid snap not toggleable | Added `snapToGrid` checkbox + columnWidth control |

---

## Potential Enhancements

1. **Task B Full Config** - Expand Task B controls to match Task A (cornerRadius, invalid)
2. **More Presets** - Domain-specific (Sprint Planning, Project Timeline)
3. **Export/Import** - Save/load configurations as JSON
4. **Multiple Tasks** - Demo with 3+ tasks and complex dependency chains
5. **Animation Controls** - Transition effects for arrow updates
6. **Undo/Redo** - Configuration history navigation

---

## File References

| File | Purpose |
|------|---------|
| `src/solid/components/ShowcaseDemo.jsx` | Main demo component |
| `src/solid/components/Bar.jsx` | Task bar component |
| `src/solid/components/Arrow.jsx` | Connector component |
| `src/solid/stores/taskStore.js` | Task state management |
| `src/solid/utils/constraintResolver.js` | Constraint logic |
