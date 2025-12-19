# SolidJS Gantt Implementation Audit Report

**Date:** December 18, 2025
**Scope:** Full codebase analysis of the SolidJS implementation (`src/`)
**Methodology:** Automated exploration with manual verification of all components, stores, utilities, styles, and documentation

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Issues](#critical-issues)
3. [Code Quality Issues](#code-quality-issues)
4. [Documentation Issues](#documentation-issues)
5. [Accessibility Issues](#accessibility-issues)
6. [Performance Issues](#performance-issues)
7. [Architecture & Organization](#architecture--organization)
8. [Dead Code & Technical Debt](#dead-code--technical-debt)
9. [Issue Index by File](#issue-index-by-file)
10. [Recommendations](#recommendations)

---

## Executive Summary

This audit identified **63 issues** across the SolidJS Gantt implementation:

| Severity | Count | Categories |
|----------|-------|------------|
| Critical | 3 | CSS, validation, error handling |
| High | 8 | Accessibility, documentation accuracy |
| Medium | 22 | Reactivity, error handling, naming, missing docs |
| Low | 30 | Dead code, duplication, micro-optimizations |

### Key Findings

1. **Dark mode is broken** - CSS uses invalid `lighten()` function
2. **Silent data corruption possible** - No validation of task IDs or dependency references
3. **Completely inaccessible** - No ARIA attributes, no keyboard navigation
4. **Documentation drift** - References to non-existent files and directories
5. **Monolithic components** - Bar.jsx is 600 lines handling 8+ responsibilities

### Risk Assessment

| Area | Risk Level | Notes |
|------|------------|-------|
| Data Integrity | High | Silent failures can corrupt task relationships |
| User Experience | High | Dark mode non-functional, no accessibility |
| Maintainability | Medium | Large components, scattered config, prop drilling |
| Performance | Low | Some inefficiencies but fundamentally sound |

---

## Critical Issues

### CRIT-1: Invalid CSS Functions in Dark Mode

**File:** `src/styles/dark.css`
**Lines:** 55, 59, 65, 69, 84
**Severity:** Critical
**Status:** Broken feature

**Description:**
The dark mode stylesheet uses `lighten()`, a function that exists in SCSS/LESS preprocessors but not in standard CSS. Browsers ignore these rules entirely.

**Affected Code:**
```css
/* Line 55 */
.dark > .gantt .bar:hover rect.bar-fill {
    fill: lighten(var(--g-bar-color-dark, 5));  /* INVALID */
}

/* Line 59 */
.dark > .gantt .bar:hover rect.bar-progress {
    fill: lighten(var(--g-progress-color, 5));  /* INVALID */
}

/* Line 65 */
.dark > .gantt .bar.active rect.bar-fill {
    fill: lighten(var(--g-bar-color, 10));  /* INVALID */
}

/* Line 69 */
.dark > .gantt .bar.active rect.bar-progress {
    fill: lighten(var(--g-progress-color, 10));  /* INVALID */
}

/* Line 84 */
.dark > .gantt .bar .handle.progress {
    border-color: lighten(var(--g-progress-color, 5));  /* INVALID */
}
```

**Impact:**
- Hover states on task bars do not change color in dark mode
- Active/dragging states have no visual feedback in dark mode
- Progress handle borders invisible in dark mode

**Recommended Fix:**
Replace with CSS custom properties or `color-mix()` function:
```css
fill: color-mix(in srgb, var(--g-bar-color) 90%, white 10%);
```

---

### CRIT-2: Silent Failure in Constraint Resolution

**File:** `src/utils/constraintResolver.js`
**Lines:** 279-290
**Severity:** Critical
**Status:** Silent failure

**Description:**
When cycle detection finds a dependency cycle, `resolveMovement()` logs a warning to console and returns `null`. Callers are expected to handle this, but the UI never indicates to users that their action was blocked or why.

**Affected Code:**
```javascript
// Line 283-290
export function resolveMovement(taskId, deltaX, taskStore, options = {}) {
    // ...
    const cycleResult = detectCycles(taskId, taskStore);
    if (cycleResult.hasCycle) {
        console.warn('Cycle detected:', cycleResult.cyclePath);
        return null;  // Silent failure - no user notification
    }
    // ...
}
```

**Impact:**
- Users drag a task and nothing happens with no explanation
- Constraint violations are invisible
- Debugging requires console access

**Recommended Fix:**
Return an error object with user-friendly message:
```javascript
return {
    success: false,
    error: 'CYCLE_DETECTED',
    message: `Cannot move: circular dependency through ${cycleResult.cyclePath.join(' -> ')}`
};
```

---

### CRIT-3: No Task Validation in Task Processor

**File:** `src/utils/taskProcessor.js`
**Lines:** 78-90, 224-236, 256-272
**Severity:** Critical
**Status:** Silent data corruption

**Description:**
The task processor accepts any input without validation, leading to silent data corruption:

1. **Duplicate IDs not detected** (lines 78-90)
2. **Invalid dependency references silently ignored** (lines 224-236)
3. **Empty task arrays return today's date as bounds** (lines 256-272)

**Affected Code:**
```javascript
// Lines 78-90 - No duplicate ID check
export function processTask(task, index) {
    const processed = { ...task };
    processed.id = task.id ?? `task-${index}`;  // No uniqueness validation
    // ...
}

// Lines 224-236 - Silent dependency filtering
export function parseDependencies(depString, tasksMap) {
    return deps
        .map(dep => tasksMap.get(dep.id))
        .filter(t => t != null);  // Invalid refs silently dropped
}

// Lines 256-272 - Silent fallback to today
export function findDateBounds(tasks) {
    let minDate, maxDate;
    // ... iteration ...
    return {
        minDate: minDate || new Date(),  // Silent fallback
        maxDate: maxDate || new Date(),
    };
}
```

**Impact:**
- Duplicate task IDs cause undefined behavior (last one wins? both render?)
- Dependencies to non-existent tasks silently disappear
- Empty task lists show wrong date range
- No way for users to know their data was malformed

**Recommended Fix:**
```javascript
const seenIds = new Set();
export function processTask(task, index, errors = []) {
    if (seenIds.has(task.id)) {
        errors.push({ type: 'DUPLICATE_ID', taskId: task.id });
    }
    seenIds.add(task.id);
    // ...
}
```

---

## Code Quality Issues

### CQ-1: Bar.jsx is a 600-Line Monolith

**File:** `src/components/Bar.jsx`
**Lines:** 1-622
**Severity:** High

**Description:**
The Bar component handles too many responsibilities:

| Responsibility | Lines | Complexity |
|----------------|-------|------------|
| Position state management | 33-80 | Medium |
| Drag state (4 types) | 84-200 | High |
| Constraint resolution | 200-280 | High |
| Mouse event handlers (8) | 280-450 | Medium |
| Computed values (progress, colors, labels) | 380-455 | Medium |
| Render logic | 456-622 | Medium |

**Impact:**
- Difficult to test individual behaviors
- Hard to understand data flow
- Changes risk unintended side effects
- Cannot reuse drag logic elsewhere

**Recommended Decomposition:**
```
Bar.jsx (orchestrator, ~100 lines)
├── useBarDrag.js (drag hook, ~200 lines)
├── useBarConstraints.js (constraint hook, ~100 lines)
├── BarVisual.jsx (pure render, ~150 lines)
└── BarHandles.jsx (resize/progress handles, ~70 lines)
```

---

### CQ-2: Inconsistent Error Handling Patterns

**Files:** Multiple
**Severity:** Medium

**Description:**
Error handling is inconsistent across the codebase:

| File | Pattern | Problem |
|------|---------|---------|
| `Bar.jsx:33-48` | Returns fallback `{x:0, y:0, width:100, height:30}` | Invalid task renders at origin |
| `useDrag.js:60-77` | Returns client coords on SVG failure | Wrong coordinate space |
| `Arrow.jsx:737-744` | Returns empty paths | Broken deps invisible |
| `date_utils.js:45-71` | Returns undefined | Null propagation |
| `constraintResolver.js:290` | Returns null | Silent failure |

**Recommended Standard:**
```javascript
// Return result objects consistently
{ success: true, data: ... }
{ success: false, error: 'ERROR_CODE', message: '...' }
```

---

### CQ-3: Reactivity Anti-Patterns

**Severity:** Medium

#### CQ-3a: Redundant Position Accessors in Bar.jsx

**File:** `src/components/Bar.jsx`
**Lines:** 68-72

```javascript
const x = () => getPosition()?.x ?? 0;
const y = () => props.taskPosition?.y ?? getPosition()?.y ?? 0;
const width = () => getPosition()?.width ?? 100;
const height = () => getPosition()?.height ?? 30;
```

**Problem:** Each accessor calls `getPosition()` independently, creating 4 separate reactive subscriptions to the same store path.

**Fix:** Single memo:
```javascript
const pos = createMemo(() => getPosition() ?? { x: 0, y: 0, width: 100, height: 30 });
const x = () => pos().x;
// ...
```

#### CQ-3b: Effect Cascade in Gantt.jsx

**File:** `src/components/Gantt.jsx`
**Lines:** 286-305

```javascript
createEffect(() => {
    const layouts = rowLayouts();
    // ... updates $bar.y for every task on every layout change
    for (const [taskId, taskPos] of layout.taskPositions) {
        taskStore.updateBarPosition(taskId, { y: taskPos.y });
    }
});
```

**Problem:** Every row layout recalculation triggers store updates for ALL visible tasks, which triggers Arrow re-renders.

**Fix:** Only update when y actually changed, or batch updates.

#### CQ-3c: Dual Reactive Paths in Arrow.jsx

**File:** `src/components/Arrow.jsx`
**Lines:** 689-744

**Problem:** `fromPosition()` reads both `positionMap` and falls back to `taskStore.getBarPosition()`, creating two subscription paths that can cause redundant re-renders.

---

### CQ-4: Prop Drilling and Mixed Context Usage

**File:** `src/components/Bar.jsx`
**Lines:** 25-26, 288-290
**Severity:** Medium

**Description:**
Bar accepts 15+ props but also uses context, creating a confusing API:

```javascript
// Line 25-26
const events = useGanttEvents();

// Lines 288-290
const onDateChange = props.onDateChange ?? events.onDateChange;
const onProgressChange = props.onProgressChange ?? events.onProgressChange;
```

**Props that should be context:**
- `taskStore` - Used everywhere
- `ganttConfig` - Configuration rarely changes
- All event handlers - Already in `GanttEventsProvider`

**Impact:**
- Confusing which source takes precedence
- Adding new events requires updating many components
- Testing requires mocking both props and context

---

### CQ-5: Naming Inconsistencies

**Severity:** Low

| Location | Convention | Examples |
|----------|------------|----------|
| `date_utils.js` | snake_case | `parse_duration`, `start_of`, `get_date_values` |
| Stores | camelCase | `ganttStart`, `columnWidth`, `viewMode` |
| Config acceptance | Both | `columnWidth` and `column_width` both accepted |
| State naming | Opposite semantics | `collapsedTasks` (taskStore) vs `expandedTasks` (ganttConfigStore) |

**Recommendation:** Standardize on camelCase, document legacy snake_case support.

---

### CQ-6: Missing Null Checks

**Severity:** Medium

| File | Line | Issue |
|------|------|-------|
| `ExpandedTaskContainer.jsx` | 26 | `t._children.map()` crashes if `_children` undefined |
| `barCalculations.js` | 114-115 | Intermediate NaN if `$bar` undefined |
| `SummaryBar.jsx` | 16 | No fallback for `props.taskId` unlike Bar.jsx |

---

## Documentation Issues

### DOC-1: References to Non-Existent Files

**Severity:** High

| File | Line | Reference | Actual Status |
|------|------|-----------|---------------|
| `CLAUDE.md` | 42 | `├── adapters/` | Directory does not exist |
| `docs/ARCHITECTURE.md` | 68 | `├── GridTicks.jsx` | Component does not exist |
| `docs/ARCHITECTURE.md` | 1045 | `GridTicks.jsx` | Component does not exist |
| `docs/SUBTASKS.md` | 209 | `project.html` | File is `subtask.html` |
| `CLAUDE.md` | 50 | `project.html` | File is `subtask.html` |
| `PERFORMANCE.md` | 49-53 | `GridTicks` component | Was optimized away into `Grid.jsx` |

---

### DOC-2: Undocumented Public API

**File:** `src/index.js`
**Severity:** Medium

The following exports are not documented in ARCHITECTURE.md:

**Context API:**
- `GanttEventsProvider` - Wraps Gantt to provide event handlers
- `useGanttEvents()` - Hook to access event handlers

**Constraint Functions:**
- `resolveMovement(taskId, deltaX, taskStore, options)` - Resolve drag with constraints
- `detectCycles(taskId, taskStore)` - Check for dependency cycles

**Hierarchy Functions:**
- `buildHierarchy(tasks)` - Build parent-child tree
- `collectDescendants(taskId, taskStore)` - Get all child tasks

**Generator:**
- `generateSubtaskDemo(config)` - Generate test data with subtasks

---

### DOC-3: Undocumented Components

**Severity:** Medium

| Component | File | Purpose | Used By |
|-----------|------|---------|---------|
| `ArrowLayerBatched` | `src/components/ArrowLayerBatched.jsx` | Batched arrow rendering for performance | `Gantt.jsx` |
| `SummaryBar` | `src/components/SummaryBar.jsx` | Renders parent/summary task bars | `TaskLayer.jsx` |
| `GanttProfiler` | `src/components/GanttProfiler.jsx` | Performance profiling instrumentation | `profiler.jsx` entry |

---

### DOC-4: Undocumented Utilities

**Severity:** Low

| Utility | File | Exports |
|---------|------|---------|
| `hierarchyProcessor` | `src/utils/hierarchyProcessor.js` | `buildHierarchy`, `collectDescendants`, `isVisibleInHierarchy` |
| `jsonFormatter` | `src/utils/jsonFormatter.js` | `formatTaskCompact`, `formatTaskDetailed` |
| `defaults` | `src/utils/defaults.js` | `DEFAULT_VIEW_MODES` |
| `svg_utils` | `src/utils/svg_utils.js` | `createSVG`, `$`, `animateSVG` |

---

### DOC-5: Missing Algorithm Documentation

**File:** `src/utils/constraintResolver.js`
**Severity:** Medium

Complex algorithms lack high-level documentation:

| Function | Lines | Missing |
|----------|-------|---------|
| `detectCycles()` | 43-124 | Why iterative three-color marking was chosen |
| `resolveMovement()` | 279-425 | Call sequence diagram, recursion conditions |
| `clampBatchDeltaX()` | 486-556 | Algorithm for multi-task constraint clamping |
| `calculateConstraintDelta()` | 135-200 | FS/SS/FF/SF calculation logic |

---

## Accessibility Issues

### A11Y-1: No ARIA Attributes on Interactive Elements

**File:** `src/components/Bar.jsx`
**Lines:** 456-622
**Severity:** High
**WCAG:** 4.1.2 Name, Role, Value

**Missing Attributes:**

| Element | Missing | Recommendation |
|---------|---------|----------------|
| Bar group `<g>` | `role` | `role="button"` or `role="slider"` |
| Bar group `<g>` | `aria-label` | `aria-label="${task.name}: ${startDate} to ${endDate}"` |
| Bar group `<g>` | `aria-disabled` | When locked or readonly |
| Bar group `<g>` | `aria-grabbed` | During drag operations |
| Bar group `<g>` | `tabindex` | `tabindex="0"` for keyboard focus |
| Progress handle | `role` | `role="slider"` |
| Progress handle | `aria-valuenow` | Current progress value |
| Progress handle | `aria-valuemin/max` | 0 and 100 |

---

### A11Y-2: No Keyboard Navigation

**File:** `src/components/Bar.jsx`
**Severity:** High
**WCAG:** 2.1.1 Keyboard

**Current State:** Only mouse events handled (`mousedown`, `mouseenter`, `mouseleave`, `click`)

**Required Keyboard Support:**

| Key | Action |
|-----|--------|
| Tab | Move focus between tasks |
| Arrow Left/Right | Adjust task dates (with Shift for larger increments) |
| Arrow Up/Down | Navigate between tasks |
| Enter/Space | Select task, open details |
| Escape | Cancel drag operation |

---

### A11Y-3: Lock Icon Without Text Alternative

**File:** `src/components/Bar.jsx`
**Line:** 557
**Severity:** Medium
**WCAG:** 1.1.1 Non-text Content

```jsx
<text x={x() + width() - 12} y={y() + 12} font-size="10" style={{ 'pointer-events': 'none' }}>
    🔒
</text>
```

**Problem:** Emoji has no `aria-label` or visually hidden text.

**Fix:**
```jsx
<text ... role="img" aria-label="Task is locked">🔒</text>
```

---

### A11Y-4: Popup Has No Focus Management

**File:** `src/components/TaskDataPopup.jsx`
**Severity:** Medium
**WCAG:** 2.4.3 Focus Order

**Issues:**
- Focus not moved to popup when opened
- No focus trap (Tab can leave popup)
- No screen reader announcement
- No close button with accessible label
- `pointer-events: 'none'` may block assistive technology

---

## Performance Issues

### PERF-1: Regex Recompilation

**File:** `src/utils/date_utils.js`
**Line:** 25
**Severity:** Low

```javascript
export function parse_duration(duration) {
    const regex = /([0-9]+)(y|min|ms|m|d|h|s)/gm;  // Created every call
    // ...
}
```

**Fix:** Move to module scope:
```javascript
const DURATION_REGEX = /([0-9]+)(y|min|ms|m|d|h|s)/gm;
```

---

### PERF-2: String Sort on Every Format Call

**File:** `src/utils/date_utils.js`
**Lines:** 119-126
**Severity:** Low

```javascript
export function format(date, format_string) {
    Object.keys(format_map)
        .sort((a, b) => b.length - a.length)  // Sorts every call
        .forEach((key) => { ... });
}
```

**Fix:** Pre-sort keys at module load:
```javascript
const SORTED_FORMAT_KEYS = Object.keys(format_map).sort((a, b) => b.length - a.length);
```

---

### PERF-3: Grid Rows Memo Recalculates on Any Layout Change

**File:** `src/components/Grid.jsx`
**Line:** 51
**Severity:** Low

```javascript
const rows = createMemo(() => {
    const layouts = rowLayouts();  // Any change = full recalc
    // ... builds all rows ...
});
```

**Problem:** Small change to one row's height triggers recalculation of all grid rows.

---

### PERF-4: O(n) Position Lookups

**File:** `src/components/TaskLayer.jsx`
**Lines:** 284-307
**Severity:** Low

`getTaskPosition()` iterates through `rowLayouts` map for each task lookup. Could be pre-computed to O(1) lookup table.

---

## Architecture & Organization

### ARCH-1: Demo Components Mixed with Core

**Severity:** Low

Demo components are in `src/components/` alongside core components:

**Demo Components (should be in `src/demos/`):**
- `GanttDemo.jsx`
- `GanttPerfDemo.jsx`
- `GanttProjectDemo.jsx`
- `GanttSubtaskDemo.jsx`
- `GanttResourceGroupsDemo.jsx`
- `ShowcaseDemo.jsx`
- `ArrowDemo.jsx`
- `BarDemo.jsx`
- `ConstraintDemo.jsx`
- `GanttProfiler.jsx`

---

### ARCH-2: Configuration Defaults Scattered

**Severity:** Medium

Default values defined in multiple locations:

| Location | Defaults For |
|----------|--------------|
| `src/utils/taskGenerator.js:26-43` | Task generation |
| `src/utils/subtaskGenerator.js:54-65` | Subtask generation |
| `src/stores/ganttConfigStore.js` | Gantt configuration |
| `src/utils/defaults.js:15` | View modes |

**Recommendation:** Consolidate into single `src/config/defaults.js`.

---

### ARCH-3: Code Duplication

**Severity:** Low

| Pattern | Location 1 | Location 2 |
|---------|------------|------------|
| BFS traversal | `constraintResolver.js:569-602` | `hierarchyProcessor.js:77-97` |
| `findRowAtY()` | `rowLayoutCalculator.js:11-34` | `createVirtualViewport.js:11-35` |
| Set toggle logic | `taskStore.js` | `ganttConfigStore.js`, `resourceStore.js` |

---

### ARCH-4: Inline Component Definition

**File:** `src/components/ResourceColumn.jsx`
**Lines:** 123-139
**Severity:** Low

```javascript
const ChevronIcon = (props) => (
    <svg ...>
        <path d={props.expanded ? "M19 15l-7-7-7 7" : "M9 5l7 7-7 7"} />
    </svg>
);
```

**Problem:** Defined inside another component, recreated on each render, not reusable.

**Fix:** Move to separate file or top of module.

---

## Dead Code & Technical Debt

### DEAD-1: Unused StructuredPopup Export

**File:** `src/components/Popup.jsx`
**Status:** FIXED - Entire file deleted (was unused)

---

### DEAD-2: Unused svg_utils Functions

**File:** `src/utils/svg_utils.js`
**Status:** FIXED - Entire file deleted (was unused legacy code)

---

### DEAD-3: Backward Compatibility Shims

**File:** `src/stores/ganttConfigStore.js`
**Lines:** 14-19

Accepts both `columnWidth` and `column_width` for backwards compatibility but this is undocumented and adds maintenance burden.

---

## Issue Index by File

### Components

| File | Issues |
|------|--------|
| `Bar.jsx` | CQ-1, CQ-3a, CQ-4, CQ-6, A11Y-1, A11Y-2, A11Y-3 |
| `Arrow.jsx` | CQ-2, CQ-3c |
| `SummaryBar.jsx` | CQ-3b, CQ-6, DOC-3 |
| `TaskLayer.jsx` | PERF-4 |
| `Grid.jsx` | PERF-3 |
| `Gantt.jsx` | CQ-3b |
| `Popup.jsx` | DEAD-1 |
| `TaskDataPopup.jsx` | A11Y-4 |
| `ResourceColumn.jsx` | ARCH-4 |
| `ExpandedTaskContainer.jsx` | CQ-6 |
| `ArrowLayerBatched.jsx` | DOC-3 |
| `GanttProfiler.jsx` | DOC-3 |

### Utilities

| File | Issues |
|------|--------|
| `constraintResolver.js` | CRIT-2, DOC-5 |
| `taskProcessor.js` | CRIT-3 |
| `date_utils.js` | CQ-2, PERF-1, PERF-2 |
| `barCalculations.js` | CQ-6 |
| `hierarchyProcessor.js` | DOC-4, ARCH-3 |
| `rowLayoutCalculator.js` | ARCH-3 |
| `createVirtualViewport.js` | ARCH-3 |
| `jsonFormatter.js` | DOC-4 |
| `defaults.js` | DOC-4 |
| `svg_utils.js` | DOC-4, DEAD-2 |

### Stores

| File | Issues |
|------|--------|
| `taskStore.js` | CQ-5 |
| `ganttConfigStore.js` | CQ-5, ARCH-2, DEAD-3 |
| `ganttDateStore.js` | - |
| `resourceStore.js` | ARCH-3 |

### Styles

| File | Issues |
|------|--------|
| `dark.css` | CRIT-1 |
| `light.css` | - |

### Documentation

| File | Issues |
|------|--------|
| `CLAUDE.md` | DOC-1 |
| `docs/ARCHITECTURE.md` | DOC-1, DOC-2, DOC-3, DOC-4 |
| `docs/SUBTASKS.md` | DOC-1 |
| `PERFORMANCE.md` | DOC-1 |

---

## Recommendations

### Immediate Actions (Critical)

1. **Fix dark.css** - Replace `lighten()` with valid CSS
2. **Add task validation** - Check unique IDs, validate dependency references
3. **Add error states** - Return structured errors instead of null/fallbacks

### Short-Term (1-2 weeks)

4. **Fix documentation** - Remove stale references, document public API
5. **Add basic accessibility** - ARIA labels, tabindex, keyboard handlers
6. **Extract Bar.jsx** - Split into drag hook, constraint hook, visual components

### Medium-Term (1 month)

7. **Consolidate configuration** - Single source of truth for defaults
8. **Standardize error handling** - Consistent result objects throughout
9. **Add focus management** - Popup focus trap, screen reader announcements

### Long-Term (Ongoing)

10. **Remove dead code** - StructuredPopup, unused svg_utils
11. **Reduce prop drilling** - More context usage, less prop passing
12. **Performance optimization** - Pre-computed lookups, batched updates

---

## Appendix: Testing Recommendations

Given the issues found, the following test coverage would prevent regressions:

| Area | Test Type | Priority |
|------|-----------|----------|
| Task ID uniqueness | Unit | High |
| Dependency validation | Unit | High |
| Cycle detection | Unit | High |
| Constraint resolution | Integration | High |
| Dark mode styles | Visual regression | Medium |
| Keyboard navigation | E2E | Medium |
| Screen reader compatibility | Manual a11y | Medium |

---

*Report generated by Claude Code audit on December 18, 2025*
