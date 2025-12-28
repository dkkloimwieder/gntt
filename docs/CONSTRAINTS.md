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

### Visual Indicators

| Constraint Type | Arrow Style | Color |
|----------------|-------------|-------|
| Elastic (default) | Solid line | Default gray |
| Fixed (max: 0) | Solid line | Pink (#f472b6) |
| Bounded (max: N) | Dashed line | Amber (#fbbf24) |

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

### 1. FS Chain (push+pull)
**Tasks:** FS Chain A → B → C
**Resource label:** "FS Chain (push+pull)"

**Expected behavior:**
- Drag A right → B and C push right (maintaining gaps)
- Drag A left → B and C pull left (maintaining gaps)
- Drag C right → Only C moves (no upstream effect)
- Drag C left → Blocked by B (can't violate gap)

### 2. SS Chain (push+pull)
**Tasks:** SS Chain A → B → C
**Resource label:** "SS Chain (push+pull)"

**Expected behavior:**
- All tasks share the same start time initially
- Drag A right → B and C push right (starts align)
- Drag A left → B and C pull left (starts align)

### 3. SS with Lag
**Tasks:** SS+Lag A → B (2h lag)
**Resource label:** "SS with 2h lag"

**Expected behavior:**
- B starts 2 hours after A starts
- Drag A right → B pushes to maintain 2h gap
- Drag A left → B pulls to maintain 2h gap

### 4. FF Chain (push+pull)
**Tasks:** FF Chain A → B → C
**Resource label:** "FF Chain (push+pull)"

**Expected behavior:**
- All tasks end at the same time initially
- Drag A right (extends end) → B and C push to align ends
- Resize A's end → B and C adjust to maintain FF

### 5. FF with Lag
**Tasks:** FF+Lag A → B (2h lag)
**Resource label:** "FF with 2h lag"

**Expected behavior:**
- B ends 2 hours after A ends
- Resize A right → B pushes to maintain 2h gap at ends

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

## Lock Types (Partial Locks)

### 15. locked: "start"
**Task:** "Start locked"
**Resource label:** "locked: start"

**Expected behavior:**
- Cannot move (position locked)
- Cannot resize left edge (start locked)
- CAN resize right edge (duration can increase)
- Visual: Red with ⊢ icon

### 16. locked: "end"
**Task:** "End locked"
**Resource label:** "locked: end"

**Expected behavior:**
- Cannot move (position locked)
- CAN resize left edge (start can change)
- Cannot resize right edge (end locked)
- Visual: Orange with ⊣ icon

### 17. locked: "duration"
**Task:** "Duration locked"
**Resource label:** "locked: duration"

**Expected behavior:**
- CAN move (drag works)
- Cannot resize either edge (width fixed)
- Visual: Blue with ↔ icon

---

## Elastic Dependencies

### 19. Elastic Chain (push only)
**Tasks:** Elastic A → B → C
**Resource label:** "Elastic (push only)"

**Expected behavior:**
- Drag A right → B and C push right (gap maintained at minimum)
- Drag A left → B and C **DO NOT** pull (gap can grow infinitely)
- Gap between tasks can grow but never shrink below lag
- Visual: Dotted cyan arrow lines

### 20. Bounded Chain (max 2h gap)
**Tasks:** Bounded A → B → C
**Resource label:** "Bounded (max 2h gap)"

**Expected behavior:**
- Drag A right → B and C push right
- Drag A left slightly → B and C don't move (gap still < 2h)
- Drag A left far → B and C pull once gap exceeds 2h
- Gap can be 0-2 hours, pulls when exceeding max
- Visual: Dashed amber arrow lines

---

## Implementation Details

### Key Functions

**`getDepOffsets(rel, pixelsPerHour)`**
- Parses min/max from dependency config
- Returns `{ lag, min, max, minGap, maxGap, isElastic, isFixed }`

**`getMaxEndFromDownstream(taskId, ...)`**
- Recursively finds maximum end position considering all downstream constraints
- Handles both locked successors (hard stop) and unlocked successors (pushable)

**`pushSuccessorsIfNeeded(taskId, ...)`**
- Cascades position updates after a task moves
- Push when: `currentGap < minGap`
- Pull when: `currentGap > maxGap` AND `maxGap !== Infinity`

**`handleConstrainPosition(taskId, newX)`**
1. Check if task is fully locked → block move
2. Apply predecessor constraints (minX)
3. Apply downstream lock constraints (maxX via recursive check)
4. Apply absolute constraints (minStart, maxStart, maxEnd)
5. Clamp position to valid range
6. Update task position
7. Cascade push/pull to successors

### Files

| File | Purpose |
|------|---------|
| `src/components/GanttPerfIsolate.jsx` | Main component with constraint logic |
| `src/utils/absoluteConstraints.js` | Lock type helpers, absolute constraint calculations |
| `src/data/constraint-test.json` | Test data with labeled scenarios |
| `src/components/ArrowLayerBatched.jsx` | Arrow rendering with style grouping |

---

## Lock State Behavior Matrix

| Lock Value | Move | Resize Left | Resize Right | Visual | Use Case |
|------------|------|-------------|--------------|--------|----------|
| `true` | No | No | No | 🔒 Gray | Completely fixed |
| `"start"` | No | No | Yes | ⊢ Red | Fixed start, flexible end |
| `"end"` | No | Yes | No | ⊣ Orange | Fixed deadline, flexible start |
| `"duration"` | Yes | No | No | ↔ Blue | Can move, duration fixed |

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
- [ ] Visual: Dotted cyan arrows

### Bounded (max: N)
- [ ] A → B: Moving A right pushes B
- [ ] A → B: Moving A left within max doesn't pull
- [ ] A → B: Moving A left past max DOES pull B
- [ ] Visual: Dashed amber arrows

### Absolute Constraints
- [ ] minStart blocks leftward movement
- [ ] maxStart blocks rightward movement
- [ ] maxEnd blocks rightward movement/resize

### Lock Types
- [ ] locked: true - no movement or resize
- [ ] locked: "start" - resize right only
- [ ] locked: "end" - resize left only
- [ ] locked: "duration" - move only, no resize
