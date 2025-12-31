# Constraint System Documentation

This document describes the constraint system implemented in the Frappe Gantt SolidJS demo.

**Demo URL:** `http://localhost:5173/examples/perf-isolate.html?data=constraint&bar=dragconst&grid=1&resources=1&arrows=1`

---

## Constraint Model Overview

The constraint system enforces rules about how tasks can be positioned relative to each other and within absolute time boundaries.

### Dependency Offset Model (min/max)

Dependencies use a **min/max offset model** to control gap flexibility:

| min | max | Behavior | Push? | Pull? |
|-----|-----|----------|-------|-------|
| 0 | undefined (default) | **Elastic** - gap can grow indefinitely | Yes | No |
| 0 | 0 | **Fixed gap** - gap must be exactly `lag` | Yes | Yes |
| 0 | N | **Bounded** - gap can grow up to N hours | Yes | Yes (if gap > N) |

**Dependency format:**
```json
{
  "id": "predecessor-id",
  "type": "FS",           // FS, SS, FF, SF (default: FS)
  "lag": 0,               // Base offset in hours (default: 0)
  "min": 0,               // Minimum additional offset (default: 0)
  "max": 0                // undefined/null = elastic (default), 0 = fixed, N = bounded
}
```

---

## Dependency Types

### FS (Finish-to-Start) - Default
- **Rule:** `successor.start >= predecessor.end + lag`
- **Behavior:** Successor cannot start until predecessor finishes
- **Use case:** Sequential tasks

### SS (Start-to-Start)
- **Rule:** `successor.start >= predecessor.start + lag`
- **Behavior:** Tasks start together (with optional lag)
- **Use case:** Parallel tasks that must begin at same time

### FF (Finish-to-Finish)
- **Rule:** `successor.end >= predecessor.end + lag`
- **Behavior:** Tasks finish together (with optional lag)
- **Use case:** Tasks that must complete simultaneously

### SF (Start-to-Finish)
- **Rule:** `successor.end >= predecessor.start + lag`
- **Behavior:** Predecessor start triggers successor finish
- **Use case:** Rare, used for "just-in-time" scheduling

---

## Test Scenarios

### 1. FS Chain (elastic, push only)
**Tasks:** FS Chain A → B → C
**Resource label:** "FS Chain (default elastic)"

**Expected behavior:**
- Drag A right → B and C push right (maintaining minimum gap)
- Drag A left → B and C **do NOT pull** (gap can grow, elastic dependency)
- Drag C right → Only C moves (no upstream effect)
- Drag C left → Blocked by B (can't violate minimum gap)

### 2. SS Chain (elastic, push only)
**Tasks:** SS Chain A → B → C
**Resource label:** "SS Chain (elastic)"

**Expected behavior:**
- All tasks share the same start time initially
- Drag A right → B and C push right (starts align)
- Drag A left → B and C **do NOT pull** (gap can grow, elastic dependency)

### 3. SS with Lag (elastic)
**Tasks:** SS+Lag A → B (2h lag)
**Resource label:** "SS+Lag (2h lag)"

**Expected behavior:**
- B starts 2 hours after A starts
- Drag A right → B pushes to maintain 2h gap
- Drag A left → B **does NOT pull** (gap can grow, elastic dependency)

### 4. FF Chain (push+pull)
**Tasks:** FF Chain A → B → C
**Resource label:** "FF Chain (push+pull)"

**Expected behavior:**
- All tasks end at the same time initially
- Drag A right (extends end) → B and C push to align ends
- Resize A's end → B and C adjust to maintain FF

### 5. FF with Lag (fixed gap)
**Tasks:** FF+Lag A → B (2h lag)
**Resource label:** "FF+Lag (2h lag)"

**Expected behavior:**
- B ends 2 hours after A ends
- Resize A right → B pushes to maintain 2h gap at ends
- Resize A left → B pulls to maintain 2h gap at ends

### 6. SF Chain (push+pull)
**Tasks:** SF Chain A → B
**Resource label:** "SF Chain (push+pull)"

**Expected behavior:**
- B's end is constrained by A's start
- Drag A right → B can extend right (end moves with A's start)
- Drag A left → B's end must stay at or after A's start

---

## Lock Scenarios

### 7. Lock at Start of Chain
**Tasks:** LOCKED → After lock → Can move right
**Resource label:** "Lock at start of chain"

**Expected behavior:**
- First task (LOCKED) cannot move at all
- "After lock" can move right but not left (blocked by LOCKED)
- "Can move right" can move freely to the right

### 8. Lock in Middle
**Tasks:** Before lock → LOCKED → After lock
**Resource label:** "Lock in middle"

**Expected behavior:**
- "Before lock" can move left freely, but moving right is blocked by LOCKED
- LOCKED cannot move
- "After lock" can move right freely

### 9. Lock at End (Downstream Block)
**Tasks:** Try push chain → Middle task → LOCKED
**Resource label:** "Lock at end (blocks)"

**Expected behavior:**
- Moving "Try push chain" right is **blocked** because cascade would push LOCKED
- This tests the recursive downstream lock detection
- "Middle task" is also constrained - can't be pushed into LOCKED

### 10. Locked Both Ends
**Tasks:** LOCKED → Squeezed → LOCKED
**Resource label:** "Locked both ends"

**Expected behavior:**
- "Squeezed" cannot move at all (blocked by both locks)
- Demonstrates constraint "squeeze" between two fixed points

---

## Absolute Constraints

### 11. minStart Constraint
**Task:** "Has minStart"
**Resource label:** "minStart: Jan 7 08:00"

**Expected behavior:**
- Task cannot be dragged left past Jan 7 08:00
- Can move freely to the right

### 12. maxStart Constraint
**Task:** "Has maxStart"
**Resource label:** "maxStart: Jan 7 14:00"

**Expected behavior:**
- Task cannot start after Jan 7 14:00
- Can move left freely

### 13. maxEnd Constraint (Deadline)
**Task:** "Has maxEnd"
**Resource label:** "maxEnd: Jan 7 18:00"

**Expected behavior:**
- Task cannot end after Jan 7 18:00
- Blocks rightward movement and right-edge resize

### 14. Combined min+max
**Task:** "min+max bounds"
**Resource label:** "min 08:00, max 18:00"

**Expected behavior:**
- Task constrained to move within the time window
- Cannot start before 08:00 or end after 18:00

---

## Additional Constraints (Untested)

The following constraint fields exist in code (`absoluteConstraints.js`) but have no test coverage:

| Field | Type | Effect |
|-------|------|--------|
| `minEnd` | datetime string | Task cannot end before this time |
| `minDuration` | number (hours) | Task duration cannot be less than this |
| `maxDuration` | number (hours) | Task duration cannot exceed this |
| `fixedDuration` | number (hours) | Task duration must equal this exactly |

**Example:**
```json
{
  "constraints": {
    "minEnd": "2025-01-07 17:00",
    "minDuration": 4,
    "maxDuration": 8
  }
}
```

**Status:** Helper functions exist but behavior during drag/resize is not verified in tests.

---

## Lock Types (Partial Locks)

### 15. locked: "start"
**Task:** "Start locked"
**Resource label:** "locked: start"

**Expected behavior:**
- Cannot move (position locked)
- Cannot resize left edge (start locked)
- CAN resize right edge (duration can increase)

### 16. locked: "end"
**Task:** "End locked"
**Resource label:** "locked: end"

**Expected behavior:**
- Cannot move (position locked)
- CAN resize left edge (start can change)
- Cannot resize right edge (end locked)

### 17. locked: "duration"
**Task:** "Duration locked"
**Resource label:** "locked: duration"

**Expected behavior:**
- CAN move (drag works)
- Cannot resize either edge (width fixed)

---

## Elastic Dependencies

### 19. Elastic Chain (push only)
**Tasks:** Elastic A → B → C
**Resource label:** "Elastic (push only)"

**Expected behavior:**
- Drag A right → B and C push right (gap maintained at minimum)
- Drag A left → B and C **DO NOT** pull (gap can grow infinitely)
- Gap between tasks can grow but never shrink below lag

### 20. Bounded Chain (max 2h gap)
**Tasks:** Bounded A → B → C
**Resource label:** "Bounded (max 2h gap)"

**Expected behavior:**
- Drag A right → B and C push right
- Drag A left slightly → B and C don't move (gap still < 2h)
- Drag A left far → B and C pull once gap exceeds 2h
- Gap can be 0-2 hours, pulls when exceeding max

---

## Implementation Details

### Constraint Engine (constraintEngine.js)

The unified constraint engine provides a single entry point for all constraint resolution:

```javascript
import { resolveConstraints, calculateCascadeUpdates } from '../utils/constraintEngine.js';

// Build context object
const context = {
    getBarPosition: (id) => ({ x, y, width, height }),
    getTask: (id) => task,
    relationships: [...],
    relationshipIndex: {              // Pre-built for O(1) lookups
        byPredecessor: Map,           // taskId → [outgoing relationships]
        bySuccessor: Map,             // taskId → [incoming relationships]
    },
    pixelsPerHour: number,
    ganttStartDate: Date,
};

// Resolve all constraints with single call
const result = resolveConstraints(taskId, proposedX, proposedWidth, context);

// Result contains:
// {
//   constrainedX: number,       // Final X position after constraints
//   constrainedWidth: number,   // Final width
//   blocked: boolean,           // True if move is blocked
//   blockReason: string|null,   // 'locked' or 'conflicting_constraints'
//   cascadeUpdates: Map,        // taskId → { x } for affected successors
// }

// Apply cascade updates
for (const [succId, update] of result.cascadeUpdates) {
    updateBarPosition(succId, update);
}
```

### Iterative Relaxation Algorithm

The cascade update system uses **iterative relaxation** instead of BFS to guarantee correct constraint resolution. This is critical for dependency graphs with multi-path convergence.

**The Problem with BFS**:

When a task has multiple predecessors from different paths:
```
    A ──→ B ──→ D
          ↓
    A ──→ C ──→ D
```

BFS visits D when only B is updated. D gets positioned based on B's constraint, but then C updates. Since D is already "processed", it never re-evaluates against C's new position → **overlap**.

**The Solution - Iterative Relaxation**:

```javascript
function calculateCascadeUpdates(taskId, newX, context) {
    const updates = new Map();
    updates.set(taskId, { x: newX });

    // Step 1: Find ALL reachable successors (single BFS)
    const reachable = new Set();
    const bfsQueue = [taskId];
    while (bfsQueue.length > 0) {
        const current = bfsQueue.shift();
        for (const rel of getSuccessorRels(current)) {
            if (!reachable.has(rel.to)) {
                reachable.add(rel.to);
                bfsQueue.push(rel.to);
            }
        }
    }

    // Step 2: Iterative relaxation until convergence
    let changed = true;
    let iterations = 0;

    while (changed && iterations < MAX_CASCADE_ITERATIONS) {
        changed = false;
        iterations++;

        for (const succId of reachable) {
            // Skip locked tasks
            if (isMovementLocked(task.constraints?.locked)) continue;

            let succBar = getBarPosition(succId);
            if (updates.has(succId)) {
                succBar = { ...succBar, ...updates.get(succId) };
            }

            // Calculate minX from ALL predecessors
            let minX = 0;
            for (const rel of getPredecessorRels(succId)) {
                let predBar = getBarPosition(rel.from);
                if (updates.has(rel.from)) {
                    predBar = { ...predBar, ...updates.get(rel.from) };
                }
                const constraint = getMinSuccessorX(type, predBar, succBar.width, minGap);
                minX = Math.max(minX, constraint);
            }

            // Apply absolute constraints
            minX = Math.max(absMinX, Math.min(minX, absMaxX));

            // If needs to move, record update
            if (minX > succBar.x + EPSILON_PX) {
                updates.set(succId, { x: minX });
                changed = true;
            }
        }
    }

    updates.delete(taskId);  // Caller handles dragged task
    return updates;
}
```

**Why This Works**:
- **Completeness**: All reachable tasks are discovered upfront
- **Correctness**: Each iteration re-evaluates against ALL predecessors, including those updated in previous iterations
- **Convergence**: For DAGs, converges in O(depth) iterations (typically 2-3)
- **Efficiency**: O(iterations × reachable × avg_predecessors)

### Key Functions

**`resolveConstraints(taskId, proposedX, proposedWidth, context)`**
- Main entry point for constraint resolution
- Applies constraints in order: locks → absolute → predecessors → downstream
- Calls `calculateCascadeUpdates` for successor propagation
- Returns constrained position and cascade updates

**`calculateCascadeUpdates(taskId, newX, context)`**
- Calculates push/pull updates for all affected successors
- Uses iterative relaxation algorithm (not BFS)
- Limited to `MAX_CASCADE_ITERATIONS` (100) to prevent infinite loops on cyclic graphs

**`getDepOffsets(rel, pixelsPerHour)`**
- Parses min/max from dependency config
- Returns `{ lag, min, max, minGap, maxGap, isElastic, isFixed }`

**`getMinSuccessorX(type, predBar, succWidth, gap)`**
- Unified calculation for all dependency types (FS, SS, FF, SF)
- Returns minimum X position for successor

**`getMinXFromAbsolute(constraints, ganttStartDate, pixelsPerHour)`**
- Calculates minimum X from absolute time constraints (minStart)

**`getMaxXFromAbsolute(constraints, ganttStartDate, pixelsPerHour)`**
- Calculates maximum X from absolute time constraints (maxStart, maxEnd)

### Constraint Application Order

1. **Lock check** → Block if `locked: true`
2. **Absolute constraints** → minStart, maxStart, maxEnd bounds
3. **Predecessor constraints** → minX from all incoming dependencies
4. **Downstream constraints** → maxX from locked successors (prevents pushing locked tasks)
5. **Position clamping** → Final constrained position within bounds
6. **Cascade updates** → Iterative relaxation propagates to all downstream tasks

### Files

| File | Purpose |
|------|---------|
| `src/utils/constraintEngine.js` | Unified constraint resolution engine |
| `src/utils/absoluteConstraints.js` | Lock type helpers, absolute time constraints |
| `src/demo/GanttPerfIsolate.jsx` | Main component using constraint engine |
| `src/data/constraint-test.json` | Test data with labeled scenarios |
| `src/components/ArrowLayerBatched.jsx` | Arrow rendering with style grouping |

---

## Lock State Behavior Matrix

| Lock Value | Move | Resize Left | Resize Right | Icon | Use Case |
|------------|------|-------------|--------------|------|----------|
| `true` | No | No | No | 🔒 | Completely fixed |
| `"start"` | No | No | Yes | ⊢ | Fixed start, flexible end |
| `"end"` | No | Yes | No | ⊣ | Fixed deadline, flexible start |
| `"duration"` | Yes | No | No | ↔ | Can move, duration fixed |

---

## URL Parameters

```
http://localhost:5173/examples/perf-isolate.html?data=constraint&bar=dragconst&grid=1&resources=1&arrows=1
```

| Parameter | Value | Description |
|-----------|-------|-------------|
| `data` | `constraint` | Use constraint test data |
| `bar` | `dragconst` | Use constraint-aware bar component |
| `grid` | `1` | Show background grid |
| `resources` | `1` | Show resource column (row labels) |
| `arrows` | `1` | Show dependency arrows |

---

## Testing Checklist

### Fixed Gap (Default)
- [ ] A → B: Moving A right pushes B
- [ ] A → B: Moving A left pulls B
- [ ] A → B → C: Chain movement maintains all gaps
- [ ] A → B → C(locked): Moving A blocked by downstream lock

### Elastic (max: null)
- [ ] A → B: Moving A right pushes B
- [ ] A → B: Moving A left does NOT pull B

### Bounded (max: N)
- [ ] A → B: Moving A right pushes B
- [ ] A → B: Moving A left within max doesn't pull
- [ ] A → B: Moving A left past max DOES pull B

### Absolute Constraints
- [ ] minStart blocks leftward movement
- [ ] maxStart blocks rightward movement
- [ ] maxEnd blocks rightward movement/resize

### Lock Types
- [ ] locked: true - no movement or resize
- [ ] locked: "start" - resize right only
- [ ] locked: "end" - resize left only
- [ ] locked: "duration" - move only, no resize

---

## Edge Cases and Known Limitations

### Circular Dependencies
- The iterative relaxation algorithm has a `MAX_CASCADE_ITERATIONS` limit (100) to prevent infinite loops
- Circular dependencies will cause the algorithm to hit this limit and stop
- **Behavior**: Tasks may end up in incorrect positions if cycles exist
- **Recommendation**: Ensure dependency graph is a DAG (Directed Acyclic Graph)

### Multi-Path Convergence (Solved)
- Previously caused overlaps with BFS-based cascade updates
- Now correctly handled by iterative relaxation algorithm
- Each task re-evaluates against ALL predecessors on every iteration
- Guaranteed to converge for DAGs

### Conflicting Constraints
- A task with `minStart > maxEnd` creates an impossible constraint
- The algorithm clamps to bounds, which may result in zero-width or invalid position
- No validation or user feedback is currently provided

### Deep Cascade Chains
- Cascade updates are limited to `MAX_CASCADE_ITERATIONS` (100)
- For DAGs, convergence typically occurs in 2-3 iterations regardless of depth
- Complexity: O(iterations × reachable_tasks × avg_predecessors)
- Very large graphs (1000+ reachable tasks) may have noticeable delay

### Resize vs Move Behavior
- Duration constraints (`minDuration`, `maxDuration`, `fixedDuration`) only apply during resize
- Moving a task preserves its duration regardless of duration constraints
- Absolute constraints (`minStart`, `maxStart`, `maxEnd`) apply to both move and resize

### locked: "position" (Reserved)
- Listed in code comments as a possible value
- Not currently implemented in UI or constraint logic
- Intended to allow resizing both directions while blocking movement

### Pull Constraints (max gap)
- Currently only push constraints (min gap) are implemented in cascade updates
- The `max` field on dependencies defines bounded or fixed gaps
- Pull behavior (moving successors left when predecessor moves left) is not yet implemented

---

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| **Cascade Algorithm** | | |
| Iterative Relaxation | Implemented | Replaced BFS (Dec 2025) |
| Multi-path convergence | Fixed | No more overlaps on convergent DAGs |
| Cycle detection | Limited | Max iterations limit, no explicit detection |
| **Dependency Types** | | |
| FS (Finish-to-Start) | Implemented | Push working |
| SS (Start-to-Start) | Implemented | Push working |
| FF (Finish-to-Finish) | Implemented | Push working |
| SF (Start-to-Finish) | Implemented | Push working |
| **Gap Behavior** | | |
| Elastic (max=undefined) | Implemented | Push only, gap can grow |
| Fixed (max=0) | Partial | Push implemented, pull not yet |
| Bounded (0 < max < Infinity) | Partial | Push implemented, pull not yet |
| **Lock Types** | | |
| locked: true | Implemented | Full lock |
| locked: "start" | Implemented | Right resize only |
| locked: "end" | Implemented | Left resize only |
| locked: "duration" | Implemented | Move only |
| locked: "position" | Not Implemented | Reserved for future |
| **Absolute Constraints** | | |
| minStart | Implemented | Tested |
| maxStart | Implemented | Tested |
| maxEnd | Implemented | Tested |
| minEnd | Untested | Code exists |
| **Duration Constraints** | | |
| minDuration | Untested | Code exists |
| maxDuration | Untested | Code exists |
| fixedDuration | Untested | Code exists |
