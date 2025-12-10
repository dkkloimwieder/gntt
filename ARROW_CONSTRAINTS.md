# Dependency & Constraint System

## Overview

This document describes the dependency constraint system for the Gantt chart. The system uses standard project management dependency types (FS, SS, FF, SF) with lag/lead support.

---

## Dependency Types

| Type | Name | Constraint | Arrow Direction |
|------|------|------------|-----------------|
| **FS** | Finish-to-Start | succ.start >= pred.end + lag | pred.right → succ.left |
| **SS** | Start-to-Start | succ.start >= pred.start + lag | pred.left → succ.left |
| **FF** | Finish-to-Finish | succ.end >= pred.end + lag | pred.right → succ.right |
| **SF** | Start-to-Finish | succ.end >= pred.start + lag | pred.left → succ.right |

### Position Calculations

```javascript
// In pixels:
FS: succ.x >= pred.x + pred.width + lag
SS: succ.x >= pred.x + lag
FF: succ.x >= pred.x + pred.width - succ.width + lag
SF: succ.x >= pred.x - succ.width + lag
```

---

## Relationship Schema

```javascript
relationship = {
    from: 'task-a',        // Predecessor task ID
    to: 'task-b',          // Successor task ID
    type: 'FS',            // FS | SS | FF | SF (default: 'FS')
    lag: 0,                // Offset (positive = delay, negative = lead)
    elastic: true          // true = minimum distance, false = fixed distance
}
```

### Lag / Lead Time

- **Positive lag**: Delay between tasks (e.g., `lag: 20` = 20px gap)
- **Negative lag (lead)**: Overlap allowed (e.g., `lag: -10` = 10px overlap)

### Elastic vs Fixed

- **elastic: true** (default): Lag is the MINIMUM distance. Tasks can be further apart but not closer.
- **elastic: false**: Exact distance maintained. Both tasks move together as a unit (replaces old `fixedOffset`).

---

## Constraint Behavior

### When Dragging Predecessor

| Type | Elastic | Behavior |
|------|---------|----------|
| FS | true | Push successor if gap < lag |
| FS | false | Successor moves with predecessor (fixed gap) |
| SS | true | Push successor if offset < lag |
| FF | true | Push successor if end-to-end offset < lag |
| SF | true | Push successor if start-to-end offset < lag |

### When Dragging Successor

| Type | Elastic | Behavior |
|------|---------|----------|
| FS | true | Cannot get closer than lag to predecessor's end |
| FS | false | Predecessor moves with successor |
| SS | true | Cannot get closer than lag to predecessor's start |
| FF | true | Successor's end cannot get closer than lag to predecessor's end |
| SF | true | Successor's end cannot get closer than lag to predecessor's start |

### When Duration Changes

After a task is resized:
1. If it's a predecessor: Recalculate successor positions
2. If it's a successor (FF/SF): Recalculate own position if constraint violated
3. Cascade changes through dependent tasks

---

## Arrow Rendering

### Anchor Selection by Type

Arrow entry points are determined by what the dependency constrains:
- **-Start dependencies (FS, SS)**: Enter from LEFT (the start of the task)
- **-Finish dependencies (FF, SF)**: Enter from TOP for vertically stacked tasks, RIGHT for same row

| Type | Start Anchor | End Anchor |
|------|--------------|------------|
| FS | bottom (or right if same row) | left |
| SS | bottom (or right if same row) | left |
| FF | bottom (or right if same row) | top (or right if same row) |
| SF | bottom (or right if same row) | top (or right if same row) |

### Arrow Head Shapes

| Shape | Description | Fill Support |
|-------|-------------|--------------|
| `chevron` | Open angle bracket (default) | No (stroke only) |
| `triangle` | Closed triangular point | Yes |
| `diamond` | Four-sided rhombus | Yes |
| `circle` | Circular endpoint | Yes |
| `none` | No arrow head | N/A |

---

## Task Locking

```javascript
task.constraints = { locked: true }
```

- Locked task cannot move
- If constraint would require moving locked task, the OTHER task is constrained
- Visual: Gray fill with red dashed border and lock icon

---

## Usage Examples

### Basic Finish-to-Start

```javascript
{ from: 'a', to: 'b', type: 'FS', lag: 0, elastic: true }
// Task B starts when Task A finishes
```

### Finish-to-Start with Lag

```javascript
{ from: 'a', to: 'b', type: 'FS', lag: 90, elastic: true }
// Task B starts 90px (e.g., 2 days) after Task A finishes
```

### Start-to-Start (Parallel Work)

```javascript
{ from: 'a', to: 'b', type: 'SS', lag: 0, elastic: true }
// Task B starts when Task A starts (parallel work)
```

### Finish-to-Finish (Synchronized End)

```javascript
{ from: 'a', to: 'b', type: 'FF', lag: 0, elastic: true }
// Task B finishes when Task A finishes
```

### Fixed Offset (Move Together)

```javascript
{ from: 'a', to: 'b', type: 'FS', lag: 45, elastic: false }
// Task B maintains exactly 45px gap from Task A's end
// Dragging either task moves both
```

### Lead Time (Overlap)

```javascript
{ from: 'a', to: 'b', type: 'FS', lag: -20, elastic: true }
// Task B can start 20px before Task A finishes
```

---

## Files

| File | Purpose |
|------|---------|
| `src/solid/utils/constraintResolver.js` | Core constraint logic |
| `src/solid/components/Arrow.jsx` | Arrow rendering with dependency type support |
| `src/solid/components/Bar.jsx` | Task bar with drag/resize/progress |
| `src/solid/components/ShowcaseDemo.jsx` | Interactive demo |
| `src/solid/stores/taskStore.js` | Reactive task position store |

---

## Migration from Old API

| Old Property | New Equivalent |
|--------------|----------------|
| `minDistance: 10` | `{ type: 'FS', lag: 10, elastic: true }` |
| `allowOverlap: true` | `{ type: 'SS', lag: 0, elastic: true }` |
| `allowOverlap: false` | `{ type: 'FS', lag: 0, elastic: true }` |
| `fixedOffset: true` | `{ type: 'FS', lag: <gap>, elastic: false }` |
| `maxDistance` | Removed (not standard in scheduling) |
