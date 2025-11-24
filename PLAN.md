# SolidJS Migration Plan for Frappe Gantt

**Migration Strategy**: Incremental hybrid architecture with progressive component replacement, maintaining API compatibility and a working demo at every step.

**Core Principle**: No phase begins until the previous phase is fully validated with passing tests and no regressions.

---

## Migration Progress

### ✅ Completed Phases

#### Phase 0: Foundation & Testing Infrastructure (COMPLETE)
- ✅ SolidJS core dependencies installed (v1.9.10)
- ✅ Vite plugin and Babel preset configured
- ✅ Solid Primitives installed: raf, scheduled, scroll, resize-observer
- ✅ Directory structure created (`src/solid/{components,utils,adapters,stores}`)
- ✅ Dual-build infrastructure (`vite.config.solid.js`, `pnpm run dev:solid`)
- ✅ Test component created (working demo at http://localhost:5173/test-solid.html)
- ⚠️ Testing infrastructure (Vitest) skipped per user request - will add tests later

#### Phase 1: Pure Utility Functions (COMPLETE)
- ✅ `date_utils.js` migrated to `src/solid/utils/date_utils.js`
- ✅ `svg_utils.js` migrated to `src/solid/utils/svg_utils.js`
- ✅ `usePrevious` helper created (`src/solid/utils/usePrevious.js`)
- ✅ No changes needed (pure functions work identically in SolidJS)

#### Phase 2: Popup Component (COMPLETE)
- ✅ SolidJS `Popup.jsx` component created (supports custom HTML and structured layout)
- ✅ `PopupAdapter.jsx` created - maintains vanilla `show()`/`hide()` API
- ✅ Reactive state management (visibility, position, content, title, subtitle, details, actions)
- ✅ Test component created (`TestPopup.jsx`)
- ✅ Working demo at http://localhost:5173/test-popup.html
- ✅ **Proof of hybrid architecture**: Adapter pattern successfully bridges vanilla and SolidJS

#### Phase 3: Arrow Component (COMPLETE)
- ✅ Reactive task store created (`src/solid/stores/taskStore.js`)
- ✅ `Arrow.jsx` component with complex SVG path calculation
- ✅ Reactive path updates when task positions change
- ✅ `ArrowAdapter.jsx` created - maintains vanilla `update()` API (reactivity makes it a no-op)
- ✅ Test component created (`TestArrow.jsx`)
- ✅ Working demo at http://localhost:5173/test-arrow.html
- ✅ **Supports both forward and backward arrow paths** (with curves)
- ✅ **Reactive dependency tracking** via task store

### 🚧 Remaining Phases

#### Phase 4: Bar Component (Most Complex)
- 🔲 Static bar rendering
- 🔲 Drag state machine with createRAF
- 🔲 60fps drag operations
- 🔲 Resize handles (left/right)
- 🔲 Progress bar dragging
- 🔲 Ignored dates handling
- 🔲 Dependency validation
- 🔲 BarAdapter

#### Phase 5: Main Gantt Orchestrator
- 🔲 Reactive grid rendering
- 🔲 Header rendering with date formatting
- 🔲 Scroll handling with infinite padding (using @solid-primitives/scroll)
- 🔲 Resize observer integration (using @solid-primitives/resize-observer)
- 🔲 Reactive ignored dates calculation
- 🔲 Public API compatibility layer
- 🔲 Event system preservation

#### Phase 6: Cleanup & Optimization
- 🔲 Remove adapters
- 🔲 Delete vanilla code
- 🔲 Performance tuning
- 🔲 Code quality improvements
- 🔲 Migration guide for consumers

### Key Files Created

```
src/solid/
├── components/
│   ├── TestPrimitives.jsx ✅
│   ├── TestPopup.jsx ✅
│   ├── Popup.jsx ✅
│   ├── TestArrow.jsx ✅
│   └── Arrow.jsx ✅
├── utils/
│   ├── date_utils.js ✅
│   ├── svg_utils.js ✅
│   └── usePrevious.js ✅
├── adapters/
│   ├── PopupAdapter.jsx ✅
│   └── ArrowAdapter.jsx ✅
├── stores/
│   └── taskStore.js ✅
├── test-entry.jsx ✅
├── test-popup-entry.jsx ✅
└── test-arrow-entry.jsx ✅

vite.config.solid.js ✅
test-solid.html ✅
test-popup.html ✅
test-arrow.html ✅
```

### Lessons Learned

1. **JSX files must use `.jsx` extension** - Vite's SolidJS plugin requires `.jsx` for JSX syntax
2. **createPrevious doesn't exist** - Had to create manual `usePrevious` helper
3. **Adapter pattern works perfectly** - PopupAdapter and ArrowAdapter successfully maintain vanilla API while using SolidJS underneath
4. **Reactive signals translate well** - Converting imperative show/hide to signals is straightforward
5. **Task store enables reactive dependencies** - Arrows automatically update when task positions change via reactive task store
6. **createMemo is efficient** - Complex path calculations only re-run when dependencies actually change

---

## Phase 0: Foundation & Testing Infrastructure

**Goal**: Establish testing framework and build infrastructure before touching any application code.

### Critical First Steps

1. **Set up Vitest + @solidjs/testing-library**
   ```bash
   pnpm add -D vitest @solidjs/testing-library @testing-library/user-event jsdom
   ```
   - Configure `vitest.config.js` with jsdom environment
   - Add `pnpm test` and `pnpm test:watch` scripts to package.json

2. **Write baseline tests for existing vanilla code**
   - `tests/date_utils.test.js` - Expand existing test file to 100% coverage
   - `tests/svg_utils.test.js` - Test all helper functions
   - `tests/bar.test.js` - Test drag/drop/resize interactions using user-event
   - `tests/arrow.test.js` - Test path calculations
   - `tests/gantt.test.js` - Test public API methods
   - **Success Criterion**: 80%+ code coverage baseline before ANY migration

3. **Install SolidJS dependencies**
   ```bash
   pnpm add solid-js
   pnpm add -D vite-plugin-solid babel-preset-solid
   ```

4. **Create dual-build infrastructure**
   - Add `vite.config.solid.js` - Separate config for SolidJS builds
   - Modify existing `vite.config.js` to support feature flags
   - Create environment variable `SOLID_MODE=true|false` to toggle builds
   - Ensure both builds output to `dist/` with proper naming:
     - `frappe-gantt.umd.js` (vanilla or hybrid based on flag)
     - `frappe-gantt.es.js` (vanilla or hybrid based on flag)

5. **Create directory structure**
   ```
   src/
   ├── vanilla/          (existing code moved here during migration)
   ├── solid/            (new SolidJS components)
   │   ├── components/
   │   ├── utils/
   │   └── adapters/     (interop layer)
   ├── index.js          (entry point, routes to vanilla or solid)
   └── ...
   ```

**Risks & Mitigation**:
- **Risk**: Tests are time-consuming to write for untested codebase
  - **Mitigation**: Focus on critical paths (drag/drop, date calculations, public API) first
- **Risk**: Build configuration complexity
  - **Mitigation**: Keep separate configs, don't try to merge too early

**Rollback Criteria**: If setting up tests takes longer than writing 200 tests, consider hiring QA or accepting lower coverage threshold (60%).

---

## Solid Primitives Integration Strategy

**Goal**: Leverage battle-tested SolidJS primitives to solve performance-critical challenges.

### Critical Primitives to Install

```bash
pnpm add @solid-primitives/raf @solid-primitives/scheduled @solid-primitives/scroll @solid-primitives/resize-observer
```

### Primitive Usage by Use Case

#### 1. `@solid-primitives/raf` (Request Animation Frame)
**Purpose**: Maintain 60fps during drag operations.

**Use in**: Phase 4 (Bar component drag/drop/resize)

**Why critical**: The Bar component has complex drag interactions that must feel smooth. Using RAF ensures imperative DOM updates happen at display refresh rate without blocking reactivity.

**Pattern**:
```javascript
import { createRAF } from "@solid-primitives/raf";

const [isDragging, startDrag, stopDrag] = createRAF((deltaTime) => {
  // Update DOM imperatively at 60fps
  if (pendingPosition) {
    barRef.setAttribute('x', pendingPosition.x);
    pendingPosition = null;
  }
});
```

#### 2. `@solid-primitives/scheduled` (Throttle/Debounce)
**Purpose**: Rate-limit expensive operations.

**Use in**:
- Phase 3 (Arrow updates during drag) - throttle to 60fps
- Phase 4 (Bar drag arrow cascade) - throttle arrow recalculations
- Phase 5 (Scroll-triggered timeline extension) - debounce extension

**Pattern**:
```javascript
import { throttle, debounce } from "@solid-primitives/scheduled";

// Throttle arrow updates to 60fps max
const throttledArrowUpdate = throttle(() => {
  arrows.forEach(arrow => recalculatePath(arrow));
}, 16); // 16ms = 60fps

// Debounce timeline extension to avoid excessive re-renders
const debouncedExtend = debounce((scrollX) => {
  if (scrollX > threshold) extendTimeline();
}, 150);
```

#### 3. `@solid-primitives/scroll` (Scroll Position Tracking)
**Purpose**: Reactively track scroll position for infinite padding.

**Use in**: Phase 5 (Gantt infinite padding, label repositioning)

**Pattern**:
```javascript
import { createScrollPosition } from "@solid-primitives/scroll";

let containerRef;
const scroll = createScrollPosition(() => containerRef);

createEffect(() => {
  const x = scroll.x;
  if (x + viewportWidth > contentWidth - 100) {
    extendTimelineRight();
  }
});
```

#### 4. `@solid-primitives/resize-observer` (Container Resize)
**Purpose**: Reactively track container size changes.

**Use in**: Phase 5 (Responsive container, auto-height calculation)

**Pattern**:
```javascript
import { createResizeObserver } from "@solid-primitives/resize-observer";

let containerRef;
const size = createResizeObserver(() => containerRef);

createEffect(() => {
  setViewportWidth(size.width);
  setViewportHeight(size.height);
  // Triggers grid/bar re-rendering
});
```

#### 5. Manual Previous Value Tracking
**Purpose**: Detect changes and avoid unnecessary recalculations.

**Use in**: Phase 3 (Arrow path updates)

**Note**: `@solid-primitives/memo` does not provide a `createPrevious` function. Use manual tracking instead.

**Pattern**:
```javascript
import { createSignal, createEffect } from "solid-js";

// Create a reusable helper
export function usePrevious(value) {
  let prev;
  const [previous, setPrevious] = createSignal();

  createEffect(() => {
    const current = value();
    setPrevious(prev);
    prev = current;
  });

  return previous;
}

// Usage in Arrow component:
const fromX = () => from_task.x();
const prevFromX = usePrevious(fromX);

const path = createMemo(() => {
  // Only recalculate if position actually changed
  if (fromX() !== prevFromX()) {
    return calculatePath(...);
  }
});
```

### Why NOT Use Other Primitives

**`@solid-primitives/mouse`**: Raw event handlers are simpler for delta tracking during drag.

**`@solid-primitives/pointer`**: Unifying mouse/touch can come later; not critical for initial migration.

**`@solid-primitives/event-listener`**: SolidJS's `onCleanup` provides more granular control for conditional cleanup (e.g., removing mousemove listener on mouseup, not just on component unmount).

**`@solid-primitives/intersection-observer`**: Grid virtualization is coordinate-based for SVG. Manual calculation is more efficient than DOM-based intersection observation.

**`@solid-primitives/bounds`**: SVG elements use `getBBox()` not `getBoundingClientRect()`. Manual calculation required.

### SVG-Specific Considerations

Most Solid Primitives assume DOM elements, not SVG. Use primitives for **high-level interactions** (scroll, resize, RAF timing) but keep **SVG coordinate calculations manual**:

```javascript
// Use primitive for scroll
const scroll = createScrollPosition(() => containerRef);

// But calculate SVG coordinates manually
const svgX = createMemo(() => {
  const matrix = svgElement.getScreenCTM();
  return (scroll.x - matrix.e) / matrix.a;
});
```

---

## Phase 1: Pure Utility Functions

**Goal**: Migrate stateless utility functions to establish patterns and build confidence.

### 1.1 Migrate date_utils.js

**Technical Challenge**: These are pure functions with zero dependencies - easiest migration target.

**Implementation Steps**:

1. Create `src/solid/utils/date_utils.js`
   - Copy vanilla implementation verbatim initially
   - No reactivity needed (pure functions)
   - Ensure identical exports

2. **Add equivalence tests**:
   ```javascript
   // tests/date_utils.equivalence.test.js
   import vanillaDateUtils from '../src/date_utils';
   import solidDateUtils from '../src/solid/utils/date_utils';

   // Test every function with identical inputs produces identical outputs
   ```

3. **Create adapter** (future-proofing):
   ```javascript
   // src/solid/adapters/date_utils_adapter.js
   // Simple re-export for now, but allows future reactivity if needed
   export { default } from '../utils/date_utils';
   ```

4. **Update imports conditionally**:
   ```javascript
   // src/index.js
   const date_utils = SOLID_MODE
     ? await import('./solid/utils/date_utils')
     : await import('./date_utils');
   ```

**Success Criteria**:
- ✅ All existing date_utils tests pass with new module
- ✅ Equivalence tests verify identical behavior
- ✅ Demo works identically

### 1.2 Migrate svg_utils.js

**Technical Challenge**: Contains DOM manipulation helpers - needs careful translation.

**Critical Issues**:
- `$()` selector function - trivial to migrate
- `createSVG()` - imperative DOM creation; in SolidJS should use JSX
- `animateSVG()` - uses `requestAnimationFrame`; may conflict with SolidJS reactivity

**Implementation Steps**:

1. Create `src/solid/utils/svg_utils.js`
   - Keep `$()` selector as-is (still useful for vanilla DOM queries)
   - **Keep `createSVG()` imperative** for now - adapter pattern will handle
   - **Do NOT convert to JSX yet** - too early, will break adapters
   - Export identical API

2. **Add ref-based helpers** for future SolidJS components:
   ```javascript
   // New helper for SolidJS components
   export function useSVGRef() {
     let ref;
     const setRef = (el) => ref = el;
     const getRef = () => ref;
     return [setRef, getRef];
   }
   ```

3. Test animation timing with SolidJS's `createEffect`
   - Verify no race conditions between `animateSVG` and reactive updates

**Success Criteria**:
- ✅ Vanilla components can still use these utilities unchanged
- ✅ No performance degradation in animations

**Risks & Mitigation**:
- **Risk**: `animateSVG` may cause jank with SolidJS reactivity
  - **Mitigation**: Add `untrack()` around animation loops if needed

---

## Phase 2: Popup Component (Simplest Component)

**Goal**: First proof-of-concept for hybrid architecture with adapter pattern.

### Technical Challenges

1. **Popup is currently imperative** - created via `new Popup()`, renders via `show()/hide()`
2. **Needs to integrate with vanilla Gantt class** - must expose same API
3. **Portal rendering** - popup renders outside SVG tree, needs `<Portal>`
4. **Custom HTML option** - `popup` config can return HTML string

### Implementation Steps

#### 2.1 Create SolidJS Popup Component

```javascript
// src/solid/components/Popup.jsx
import { createSignal, Show, Portal } from 'solid-js';

export function Popup(props) {
  const [visible, setVisible] = createSignal(false);
  const [position, setPosition] = createSignal({ x: 0, y: 0 });

  return (
    <Portal mount={props.container}>
      <Show when={visible()}>
        <div
          class="gantt-popup"
          style={{
            left: `${position().x}px`,
            top: `${position().y}px`
          }}
        >
          {props.content()}
        </div>
      </Show>
    </Portal>
  );
}
```

#### 2.2 Create Popup Adapter (Critical)

**Challenge**: Vanilla code expects `popup.show()` / `popup.hide()` methods. SolidJS components don't have methods.

```javascript
// src/solid/adapters/PopupAdapter.js
import { render } from 'solid-js/web';
import { Popup } from '../components/Popup';

export class PopupAdapter {
  constructor(parent, custom_html) {
    this.parent = parent;
    this.custom_html = custom_html;

    // Create reactive state outside component
    const [visible, setVisible] = createSignal(false);
    const [content, setContent] = createSignal('');

    this.setVisible = setVisible;
    this.setContent = setContent;

    // Render SolidJS component into DOM
    this.dispose = render(
      () => <Popup
        container={parent}
        visible={visible}
        content={content}
      />,
      parent
    );
  }

  // Expose vanilla API
  show() {
    this.setVisible(true);
  }

  hide() {
    this.setVisible(false);
  }

  destroy() {
    this.dispose();
  }
}
```

#### 2.3 Feature Flag Integration

```javascript
// src/index.js (in Gantt class constructor)
if (SOLID_MODE) {
  this.popup = new PopupAdapter(this.$popup_wrapper, options.popup);
} else {
  this.popup = new Popup(this.$popup_wrapper, options.popup);
}
```

### Testing Strategy

1. **Unit tests** for Popup component in isolation
2. **Integration tests** for PopupAdapter API compatibility
3. **Visual regression tests** - screenshot comparison
4. **Event tests** - verify `popup_on: 'click'` and `popup_on: 'hover'` both work

**Success Criteria**:
- ✅ Demo shows identical popup behavior
- ✅ All `popup` config options work (custom HTML, actions, etc.)
- ✅ No console errors or warnings
- ✅ PopupAdapter exposes exact same API as vanilla Popup

**Risks & Mitigation**:
- **Risk**: Portal rendering causes z-index issues
  - **Mitigation**: Test with complex stacking contexts, ensure popup stays on top
- **Risk**: Custom HTML XSS vulnerability
  - **Mitigation**: Use `innerHTML` same as vanilla (no change in security posture)

---

## Phase 3: Arrow Component

**Goal**: Reactive dependency arrows with dynamic path recalculation.

### Technical Challenges

1. **Dynamic SVG path calculation** - arrows curve between task bars
2. **Reactive to task position changes** - must update when bars move
3. **Dependency graph** - needs to track which tasks depend on which
4. **SVG rendering** - currently imperative `createSVG()`, needs JSX

### Critical Implementation Details

#### 3.1 Reactive Path Calculation with Solid Primitives

**Challenge**: Arrow paths are calculated from bar positions. In vanilla code, paths are recalculated imperatively when bars move. In SolidJS, this should be reactive AND optimized to avoid unnecessary recalculations.

**Solution**: Manual previous value tracking + `@solid-primitives/scheduled` (throttle)

```javascript
// src/solid/components/Arrow.jsx
import { createMemo, createSignal, createEffect } from 'solid-js';
import { throttle } from '@solid-primitives/scheduled';

// Reusable previous value tracker
function usePrevious(value) {
  let prev;
  const [previous, setPrevious] = createSignal();

  createEffect(() => {
    const current = value();
    setPrevious(prev);
    prev = current;
  });

  return previous;
}

export function Arrow(props) {
  const from_task = () => props.gantt.getTask(props.dependency.from);
  const to_task = () => props.gantt.getTask(props.dependency.to);

  // Track previous positions to detect actual changes
  const fromX = () => from_task().x();
  const fromY = () => from_task().y();
  const toX = () => to_task().x();
  const toY = () => to_task().y();

  const prevFromX = usePrevious(fromX);
  const prevFromY = usePrevious(fromY);
  const prevToX = usePrevious(toX);
  const prevToY = usePrevious(toY);

  // Throttled path calculation - max 60fps updates
  const path = createMemo(throttle(() => {
    const from = from_task();
    const to = to_task();

    const start_x = from.x() + from.width();
    const start_y = from.y() + from.height() / 2;
    const end_x = to.x();
    const end_y = to.y() + to.height() / 2;

    // Only recalculate if positions actually changed
    if (
      start_x === prevFromX() && start_y === prevFromY() &&
      end_x === prevToX() && end_y === prevToY()
    ) {
      return; // Skip recalculation
    }

    return calculatePath(start_x, start_y, end_x, end_y, props.curve);
  }, 16)); // 60fps = 16ms

  return (
    <path
      d={path()}
      class="arrow"
      data-from={props.dependency.from}
      data-to={props.dependency.to}
    />
  );
}

function calculatePath(x1, y1, x2, y2, curve) {
  const down = y2 > y1;
  const dx = x2 - x1;
  const dy = Math.abs(y2 - y1);

  // Original vanilla logic for curved paths
  const curve_x = dx / 2;
  const curve_y = down ? curve : -curve;

  return `M ${x1} ${y1}
          C ${x1 + curve_x} ${y1} ${x1 + curve_x} ${y1 + curve_y}
            ${x1 + dx / 2} ${y1 + dy / 2}
          C ${x2 - curve_x} ${y2 - curve_y} ${x2 - curve_x} ${y2}
            ${x2} ${y2}`;
}
```

**Why this works**:
- `usePrevious` helper avoids recalculating path if positions haven't changed
- `throttle(16)` ensures arrow updates happen at max 60fps, preventing jank during rapid bar movements
- Memoization caches result until dependencies change

**Problem**: This requires task positions to be reactive signals. But tasks are currently plain objects.

**Solution**: Need reactive task store.

#### 3.2 Create Reactive Task Store

**Critical architectural decision**: Tasks need to be reactive for arrows to work.

```javascript
// src/solid/stores/taskStore.js
import { createStore } from 'solid-js/store';

export function createTaskStore(tasks) {
  const [store, setStore] = createStore(
    tasks.map(task => ({
      ...task,
      _x: task.x,
      _y: task.y,
      _width: task.width,
      _height: task.height
    }))
  );

  return {
    tasks: store,
    updateTaskPosition(id, { x, y, width, height }) {
      setStore(
        task => task.id === id,
        { _x: x, _y: y, _width: width, _height: height }
      );
    },
    getTask(id) {
      return store.find(t => t.id === id);
    }
  };
}
```

**Implications**:
- This store must be created in Phase 4 (Gantt) for Arrow to consume
- Arrow migration is blocked on reactive task positions
- May need to **reconsider migration order**: Do Bar before Arrow?

#### 3.3 Arrow Adapter

```javascript
// src/solid/adapters/ArrowAdapter.js
export class ArrowAdapter {
  constructor(gantt, from_task, to_task) {
    this.gantt = gantt;
    this.from_task = from_task;
    this.to_task = to_task;

    // Render SolidJS Arrow into SVG layer
    this.dispose = render(
      () => <Arrow
        gantt={gantt}
        dependency={{ from: from_task.id, to: to_task.id }}
        curve={gantt.options.arrow_curve}
      />,
      gantt.$arrow_layer
    );
  }

  update() {
    // No-op: SolidJS handles reactive updates
  }

  destroy() {
    this.dispose();
  }
}
```

### Testing Strategy

1. **Unit test** path calculation algorithm (pure function)
2. **Integration test** reactivity - move task, verify arrow updates
3. **Stress test** - 1000 dependencies, verify performance
4. **Visual test** - verify curves match vanilla exactly

**Success Criteria**:
- ✅ Arrows update automatically when tasks move (no manual `update()` calls)
- ✅ Path shapes identical to vanilla
- ✅ No performance regression with many arrows

**Risks & Mitigation**:
- **Risk**: Reactivity overhead causes jank during drag
  - **Mitigation**: Use `createMemo` to batch updates; consider `requestAnimationFrame`
- **Risk**: Circular dependencies cause infinite loops
  - **Mitigation**: Validate task graph on setup, error if cycles detected

**Decision Point**: If reactive store is too complex, consider migrating Bar before Arrow.

---

## Phase 4: Bar Component (Most Complex)

**Goal**: Migrate drag/drop/resize interactions to SolidJS while maintaining exact behavior.

### Technical Challenges (Critical)

This is the hardest component due to:

1. **Complex state machine** - Tracks drag state (idle → dragging_bar → dragging_left_handle → dragging_right_handle → dragging_progress)
2. **Imperative SVG manipulation** - Directly sets attributes via `setAttribute`
3. **Global prototype pollution** - Adds `getX()`, `getY()` methods to `SVGElement.prototype`
4. **Performance-critical** - Drag must be 60fps, any jank is unacceptable
5. **Scroll integration** - Dragging near edge triggers infinite padding
6. **Dependency constraints** - Can't drag task before its dependencies
7. **Ignored dates** - Must skip weekends/holidays during drag
8. **Progress bar** - Nested SVG rect that updates during drag
9. **Label positioning** - Auto-repositions during horizontal scroll

### Implementation Strategy

**Do NOT attempt to convert all of Bar at once.** Break into sub-phases.

#### 4.1 Sub-Phase: Static Bar Rendering

First, just render bars without any interactivity.

```javascript
// src/solid/components/Bar.jsx
import { createMemo } from 'solid-js';

export function Bar(props) {
  const x = createMemo(() => props.task.x());
  const y = createMemo(() => props.task.y());
  const width = createMemo(() => props.task.width());
  const height = () => props.gantt.options.bar_height;

  const progressWidth = createMemo(() =>
    width() * (props.task.progress / 100)
  );

  return (
    <g class="bar-wrapper" data-id={props.task.id}>
      <g class="bar-group">
        {/* Main bar */}
        <rect
          x={x()}
          y={y()}
          width={width()}
          height={height()}
          rx={props.gantt.options.bar_corner_radius}
          class="bar"
          style={{ fill: props.task.color }}
        />

        {/* Progress bar */}
        <rect
          x={x()}
          y={y()}
          width={progressWidth()}
          height={height()}
          rx={props.gantt.options.bar_corner_radius}
          class="bar-progress"
        />

        {/* Label */}
        <text
          x={x() + 5}
          y={y() + height() / 2}
          class="bar-label"
        >
          {props.task.name}
        </text>
      </g>

      <g class="handle-group">
        {/* Left handle */}
        <rect
          x={x()}
          y={y()}
          width={8}
          height={height()}
          class="handle handle-left"
        />

        {/* Right handle */}
        <rect
          x={x() + width() - 8}
          y={y()}
          width={8}
          height={height()}
          class="handle handle-right"
        />
      </g>
    </g>
  );
}
```

**Test**: Verify bars render identically to vanilla (positions, colors, sizes).

#### 4.2 Sub-Phase: Drag State Machine with RAF (CRITICAL)

**Solution**: Use `@solid-primitives/raf` for 60fps drag + `@solid-primitives/scheduled` for arrow throttling.

This solves the performance requirement without manual `requestAnimationFrame` management.

```javascript
// src/solid/components/Bar.jsx
import { createSignal, batch, onCleanup } from 'solid-js';
import { createRAF } from '@solid-primitives/raf';
import { throttle } from '@solid-primitives/scheduled';

export function Bar(props) {
  const [dragState, setDragState] = createSignal('idle');

  let barRef;
  let initialX = 0;
  let initialWidth = 0;
  let startMouseX = 0;
  let pendingUpdate = null;

  // RAF loop for 60fps drag updates
  const [isDragging, startDrag, stopDrag] = createRAF((deltaTime) => {
    if (!pendingUpdate) {
      stopDrag(); // Auto-stop when no pending updates
      return;
    }

    // Imperative DOM update at 60fps
    const { type, x, width, progress } = pendingUpdate;

    switch (type) {
      case 'position':
        barRef.querySelector('.bar').setAttribute('x', x);
        barRef.querySelector('.bar-progress').setAttribute('x', x);
        barRef.querySelector('.bar-label').setAttribute('x', x + 5);
        break;
      case 'width':
        barRef.querySelector('.bar').setAttribute('width', width);
        barRef.querySelector('.handle-right').setAttribute('x', x + width - 8);
        break;
      case 'progress':
        barRef.querySelector('.bar-progress').setAttribute('width', progress);
        break;
    }

    pendingUpdate = null;
  });

  // Throttle arrow updates to 60fps
  const throttledArrowUpdate = throttle(() => {
    props.gantt.arrows
      .filter(arrow =>
        arrow.from === props.task.id || arrow.to === props.task.id
      )
      .forEach(arrow => arrow.recalculate());
  }, 16);

  const handleMouseDown = (e) => {
    const target = e.target;

    // Determine drag type
    if (target.classList.contains('handle-left')) {
      setDragState('dragging_left_handle');
      initialX = parseFloat(barRef.querySelector('.bar').getAttribute('x'));
      initialWidth = parseFloat(barRef.querySelector('.bar').getAttribute('width'));
    } else if (target.classList.contains('handle-right')) {
      setDragState('dragging_right_handle');
      initialWidth = parseFloat(barRef.querySelector('.bar').getAttribute('width'));
    } else if (target.classList.contains('bar-progress')) {
      setDragState('dragging_progress');
    } else {
      setDragState('dragging_bar');
      initialX = parseFloat(barRef.querySelector('.bar').getAttribute('x'));
    }

    startMouseX = e.clientX;

    // Attach global listeners
    const handleMouseMove = (e) => {
      const dx = e.clientX - startMouseX;
      const state = dragState();

      switch (state) {
        case 'dragging_bar':
          const newX = initialX + dx;

          // Validate against dependencies (synchronous check)
          const valid = validatePosition(newX);
          if (!valid) return;

          pendingUpdate = { type: 'position', x: newX };
          throttledArrowUpdate();
          break;

        case 'dragging_left_handle':
          const newLeftX = initialX + dx;
          const newLeftWidth = initialWidth - dx;
          if (newLeftWidth > 10) { // Min width
            pendingUpdate = {
              type: 'both',
              x: newLeftX,
              width: newLeftWidth
            };
            throttledArrowUpdate();
          }
          break;

        case 'dragging_right_handle':
          const newRightWidth = initialWidth + dx;
          if (newRightWidth > 10) {
            pendingUpdate = {
              type: 'width',
              x: initialX,
              width: newRightWidth
            };
            throttledArrowUpdate();
          }
          break;

        case 'dragging_progress':
          const progressWidth = Math.max(0, Math.min(initialWidth, initialWidth * 0 + dx));
          pendingUpdate = {
            type: 'progress',
            progress: progressWidth
          };
          break;
      }

      // Start RAF if not running
      if (!isDragging()) startDrag();
    };

    const handleMouseUp = () => {
      stopDrag();

      // Sync final position to reactive store (triggers all reactive updates)
      batch(() => {
        const finalX = parseFloat(barRef.querySelector('.bar').getAttribute('x'));
        const finalWidth = parseFloat(barRef.querySelector('.bar').getAttribute('width'));
        const finalProgress = parseFloat(barRef.querySelector('.bar-progress').getAttribute('width'));

        props.gantt.taskStore.updateTaskPosition(props.task.id, {
          x: finalX,
          y: props.task.y(),
          width: finalWidth,
          height: props.task.height(),
          progress: (finalProgress / finalWidth) * 100
        });
      });

      // Trigger event
      props.gantt.trigger_event('task_changed', [props.task]);

      // Cleanup
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setDragState('idle');
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Validate position against dependencies
  const validatePosition = (newX) => {
    return props.task.dependencies.every(depId => {
      const dep = props.gantt.getTask(depId);
      return newX >= dep.x() + dep.width();
    });
  };

  onCleanup(() => {
    stopDrag(); // Ensure RAF stops on unmount
  });

  return (
    <g
      class="bar-wrapper"
      onMouseDown={handleMouseDown}
      ref={barRef}
    >
      {/* ... rest of JSX */}
    </g>
  );
}
```

**Why this achieves 60fps**:
1. **RAF loop**: Updates DOM imperatively at display refresh rate (16.67ms intervals on 60Hz displays)
2. **Batched reactive updates**: Only sync to store on mouseup, avoiding reactive overhead during drag
3. **Throttled arrow updates**: Arrows recalculate at max 60fps, not on every pixel moved
4. **Auto-stop**: RAF stops when no pending updates, saving CPU

**Critical advantages over manual approach**:
- No manual `requestAnimationFrame` calls
- Automatic cleanup via `onCleanup`
- `stopDrag()` is idempotent and safe to call multiple times
- `startDrag()` won't create duplicate loops

#### 4.3 Sub-Phase: Ignored Dates During Drag

**Problem**: When dragging, if the new position lands on a weekend/holiday, the bar should snap to the next valid date.

**Vanilla implementation**: Manually calculates ignored positions in pixels, then adjusts `x` attribute.

**SolidJS approach**: Create computed signal that snaps to valid positions.

```javascript
const validX = createMemo(() => {
  const rawX = props.task.x();
  const ignored = props.gantt.config.ignored_positions;

  // Check if rawX falls in ignored range
  for (const range of ignored) {
    if (rawX >= range.start && rawX < range.end) {
      return range.end; // Snap to end of ignored period
    }
  }

  return rawX;
});

// Use validX() instead of props.task.x() in rendering
```

**Issue**: This creates a feedback loop if store uses validX.

**Solution**: Separate `task._rawX` (what user dragged to) from `task.x` (snapped position).

#### 4.4 Sub-Phase: Performance Optimization

**Critical**: Dragging must be 60fps. Reactivity overhead could cause jank.

**Strategies**:

1. **Use `untrack()` in mousemove handler**:
   ```javascript
   const handleMouseMove = (e) => {
     untrack(() => {
       // Don't trigger reactive updates during drag
       // Only update on mouseup
     });
   };
   ```

2. **Batch updates**:
   ```javascript
   import { batch } from 'solid-js';

   const updateBarPosition = (dx) => {
     batch(() => {
       setX(newX);
       setWidth(newWidth);
       setProgress(newProgress);
     });
   };
   ```

3. **Throttle arrow updates**:
   ```javascript
   const throttledArrowUpdate = createMemo((prev) => {
     // Only update arrows every 16ms (60fps)
     if (Date.now() - prev.lastUpdate < 16) return prev;
     return { lastUpdate: Date.now(), value: calculateArrows() };
   });
   ```

4. **Consider imperative updates during drag**:
   ```javascript
   // Controversial: Skip reactivity during drag, only sync on mouseup
   const handleMouseMove = (e) => {
     // Directly manipulate DOM (imperative)
     barRef.setAttribute('x', newX);

     // On mouseup, sync to store (reactive)
   };
   ```

**Trade-off**: Imperative drag preserves 60fps but loses reactivity benefits. Decide per use case.

### Bar Adapter

```javascript
// src/solid/adapters/BarAdapter.js
export class BarAdapter {
  constructor(gantt, task) {
    this.gantt = gantt;
    this.task = task;

    this.dispose = render(
      () => <Bar gantt={gantt} task={task} />,
      gantt.$bar_layer
    );
  }

  update() {
    // No-op if fully reactive
    // Or: trigger manual update if using imperative drag
  }

  destroy() {
    this.dispose();
  }
}
```

### Testing Strategy

1. **Unit tests** - Drag state machine transitions
2. **Integration tests** - Full drag/drop/resize scenarios
3. **Performance tests** - Verify 60fps during drag (use Chrome DevTools)
4. **Dependency tests** - Verify can't drag before dependencies
5. **Ignored dates tests** - Verify weekend snapping
6. **Visual regression** - Screenshot every drag state

**Success Criteria**:
- ✅ Drag/drop feels identical to vanilla (no lag, no jank)
- ✅ All edge cases work (dependencies, ignored dates, infinite padding)
- ✅ No memory leaks (verify event listeners cleaned up)
- ✅ Chrome DevTools shows 60fps during drag

**Risks & Mitigation**:
- **Risk**: Reactivity causes jank during drag
  - **Mitigation**: Use imperative updates during drag, sync on mouseup
- **Risk**: Memory leaks from event listeners
  - **Mitigation**: Use `onCleanup` to remove listeners
- **Risk**: Prototype pollution breaks
  - **Mitigation**: Replace `barRef.getX()` with `barRef.getAttribute('x')`

**Rollback Criteria**: If 60fps cannot be achieved after 50 optimization attempts, revert Bar to vanilla and keep hybrid architecture indefinitely.

---

## Phase 5: Main Gantt Orchestrator

**Goal**: Coordinate all SolidJS components and maintain public API compatibility.

### Technical Challenges

1. **Grid rendering** - Hundreds of SVG lines for timeline grid
2. **Header rendering** - Date labels with complex formatting logic
3. **Scroll handling** - Infinite padding, horizontal/vertical scroll
4. **Ignored dates algorithm** - Calculate pixel positions of weekends/holidays
5. **View mode switching** - Re-render entire chart
6. **Public API** - `update_options()`, `change_view_mode()`, `update_task()`
7. **Event system** - Custom events (`date_change`, `progress_change`, etc.)

### Implementation Strategy

#### 5.1 Reactive Grid

**Challenge**: Grid lines are calculated from `gantt_start`, `gantt_end`, and `column_width`. These should be reactive.

```javascript
// src/solid/components/Grid.jsx
import { For, createMemo } from 'solid-js';

export function Grid(props) {
  const dates = createMemo(() => {
    const start = props.gantt.gantt_start();
    const end = props.gantt.gantt_end();
    const step = props.gantt.config.step();
    const unit = props.gantt.config.unit();

    const dates = [];
    let current = start;
    while (current < end) {
      dates.push(current);
      current = date_utils.add(current, step, unit);
    }
    return dates;
  });

  const gridLines = createMemo(() =>
    dates().map((date, i) => ({
      x: i * props.gantt.config.column_width(),
      date: date
    }))
  );

  return (
    <g class="grid">
      <For each={gridLines()}>
        {(line) => (
          <line
            x1={line.x}
            y1={0}
            x2={line.x}
            y2={props.gantt.options.container_height()}
            class="grid-line"
          />
        )}
      </For>
    </g>
  );
}
```

**Problem**: Rendering 1000+ SVG lines on every reactive update is slow.

**Solution**: Memoize aggressively + virtualization.

```javascript
const visibleGridLines = createMemo(() => {
  const scrollX = props.gantt.scrollX();
  const viewportWidth = props.gantt.containerWidth();

  return gridLines().filter(line =>
    line.x >= scrollX - 100 &&
    line.x <= scrollX + viewportWidth + 100
  );
});

return (
  <For each={visibleGridLines()}>
    {/* Only render visible lines */}
  </For>
);
```

#### 5.2 Reactive Ignored Dates Calculation

**Challenge**: Ignored dates algorithm calculates pixel ranges for weekends/holidays. Currently runs in `setup_tasks()` (one-time). Should be reactive to view mode changes.

**Critical**: This is a complex algorithm (60+ lines in vanilla). Don't break it.

```javascript
// src/solid/stores/ganttStore.js
import { createMemo } from 'solid-js';

export function createGanttStore(tasks, options) {
  const [viewMode, setViewMode] = createSignal(options.view_mode);
  const [columnWidth, setColumnWidth] = createSignal(45);

  const ignoredPositions = createMemo(() => {
    const positions = [];
    const start = ganttStart();
    const end = ganttEnd();

    // Port vanilla ignored dates algorithm
    let current = start;
    while (current < end) {
      if (shouldIgnoreDate(current)) {
        const x = calculatePosition(current);
        positions.push({ start: x, end: x + columnWidth() });
      }
      current = date_utils.add(current, 1, 'day');
    }

    return positions;
  });

  return {
    viewMode,
    setViewMode,
    ignoredPositions,
    // ... other state
  };
}
```

#### 5.3 Public API Compatibility

**Critical**: Existing consumers use:
```javascript
gantt.update_options({ bar_height: 40 });
gantt.change_view_mode('Week');
gantt.update_task('task-1', { progress: 50 });
```

These must continue to work.

**Solution**: Gantt class wraps SolidJS store, proxies method calls to setters.

```javascript
// src/solid/components/Gantt.jsx
export class Gantt {
  constructor(wrapper, tasks, options) {
    this.store = createGanttStore(tasks, options);

    // Render SolidJS app
    this.dispose = render(
      () => <GanttChart store={this.store} />,
      wrapper
    );
  }

  // Public API - proxies to store
  update_options(new_options) {
    this.store.updateOptions(new_options);
  }

  change_view_mode(mode) {
    this.store.setViewMode(mode);
  }

  update_task(id, updates) {
    this.store.updateTask(id, updates);
  }

  // Event system - keep vanilla implementation
  trigger_event(event, args) {
    this.events[event]?.forEach(cb => cb(...args));
  }

  on(event, callback) {
    this.events[event] = this.events[event] || [];
    this.events[event].push(callback);
  }
}
```

**Important**: `Gantt` is still a class, not a component. It instantiates the SolidJS app internally.

#### 5.4 Infinite Padding & Responsive Container with Solid Primitives

**Challenge**: When user scrolls to edge, extend timeline. When container resizes, recalculate layout.

**Solution**: Use `@solid-primitives/scroll` + `@solid-primitives/resize-observer` + `@solid-primitives/scheduled`

This replaces manual event listeners with reactive primitives.

```javascript
// Inside GanttChart component
import { createScrollPosition } from '@solid-primitives/scroll';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { debounce } from '@solid-primitives/scheduled';

export function GanttChart(props) {
  let containerRef;

  // Reactive scroll tracking (replaces manual addEventListener)
  const scroll = createScrollPosition(() => containerRef);

  // Reactive container size tracking (handles auto-height, responsive width)
  const size = createResizeObserver(() => containerRef);

  // Container dimensions as signals
  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);

  // Update viewport dimensions on resize
  createEffect(() => {
    if (size.width) setViewportWidth(size.width);
    if (size.height) setViewportHeight(size.height);
  });

  // Debounced timeline extension (prevents excessive re-renders)
  const extendTimeline = debounce((scrollX) => {
    const contentWidth = (ganttEnd() - ganttStart()) * columnWidth();

    if (scrollX + viewportWidth() > contentWidth - 100) {
      // Extend right
      const savedScroll = scrollX;
      setGanttEnd(date_utils.add(ganttEnd(), 10, 'day'));

      // Restore scroll position after re-render
      queueMicrotask(() => {
        if (containerRef) containerRef.scrollLeft = savedScroll;
      });
    }

    if (scrollX < 100 && scrollX > 0) {
      // Extend left
      const savedScroll = scrollX;
      const oldStart = ganttStart();
      setGanttStart(date_utils.add(ganttStart(), -10, 'day'));

      // Adjust scroll to maintain visual position
      queueMicrotask(() => {
        if (containerRef) {
          const addedWidth = (ganttStart() - oldStart) * columnWidth();
          containerRef.scrollLeft = savedScroll + addedWidth;
        }
      });
    }
  }, 150); // Debounce 150ms to avoid scroll jank

  // Watch scroll position and trigger extension
  createEffect(() => {
    const x = scroll.x;
    if (x !== undefined) {
      extendTimeline(x);
    }
  });

  // Recalculate grid on resize
  createEffect(() => {
    const width = viewportWidth();
    const height = viewportHeight();

    // Trigger grid/bar layout recalculation
    if (width && height) {
      recalculateLayout(width, height);
    }
  });

  return (
    <div ref={containerRef} class="gantt-container">
      {/* SVG content */}
    </div>
  );
}
```

**Why this is better than manual approach**:
1. **No manual event listeners** - Primitives handle addEventListener/removeEventListener
2. **Automatic cleanup** - No memory leaks on unmount
3. **Debouncing** - Timeline extension is debounced to prevent scroll jank
4. **Resize handling** - Container responsiveness is automatic (supports `container_height: 'auto'`)
5. **Reactive** - Scroll/resize changes propagate through signal graph

**Scroll position restoration**:
- When extending timeline right: Maintain current scroll position
- When extending timeline left: Adjust scroll to account for prepended content
- Use `queueMicrotask` to wait for DOM update before restoring scroll

### Testing Strategy

1. **Integration tests** - Full Gantt lifecycle (init → render → interact → update)
2. **API tests** - Verify all public methods work
3. **Event tests** - Verify all events fire correctly
4. **Scroll tests** - Verify infinite padding extends timeline
5. **View mode tests** - Switch between Day/Week/Month/Year
6. **Performance tests** - 1000 tasks renders in <1 second

**Success Criteria**:
- ✅ All public API methods work identically
- ✅ All events fire with correct arguments
- ✅ Demo works identically to vanilla
- ✅ Performance within 10% of vanilla

**Risks & Mitigation**:
- **Risk**: Scroll handling causes infinite loop
  - **Mitigation**: Debounce scroll updates, use `untrack()` carefully

---

## Phase 6: Cleanup & Optimization

**Goal**: Remove adapters, delete vanilla code, optimize bundle size and performance.

### Steps

1. **Remove all adapters**
   - Delete `src/solid/adapters/` directory
   - Update imports to use components directly
   - Remove `SOLID_MODE` feature flags

2. **Delete vanilla code**
   - `rm -rf src/vanilla/` (or delete `src/*.js` if not moved)
   - Update `package.json` `main` to point to SolidJS build

3. **Performance tuning**
   - Profile with Chrome DevTools
   - Optimize hot paths (drag handlers, grid rendering)
   - Use `createMemo` aggressively
   - Consider `createSelector` for task lookups
   - Benchmark: 1000 tasks, 60fps drag, <100ms initial render

4. **Code quality**
   - Add JSDoc comments
   - Ensure all tests pass
   - Run `pnpm lint` and fix issues
   - Update README if needed

5. **Migration guide for consumers**
   - Document any breaking changes (hopefully none)
   - Provide upgrade path from v1.x to v2.x
   - Update examples in README

### Success Criteria

- ✅ No vanilla code remains
- ✅ All tests pass (300+ tests)
- ✅ No console errors/warnings
- ✅ Performance ≥ 90% of vanilla
- ✅ Demo works identically

**Rollback Criteria**: If performance drops below 80% of vanilla after all optimization attempts, **keep hybrid architecture** and ship v2.0 with both vanilla and SolidJS builds, let users choose.

---

## Risk Register

### High-Priority Risks

1. **Drag performance degradation**
   - **Likelihood**: Medium
   - **Impact**: Critical (jank is unacceptable)
   - **Mitigation**: Use imperative updates during drag if needed
   - **Rollback**: Keep Bar.js as vanilla, adapt into SolidJS

2. **Infinite reactivity loops**
   - **Likelihood**: Medium
   - **Impact**: High (breaks app)
   - **Mitigation**: Extensive testing, use `untrack()`, careful effect design
   - **Rollback**: Add circuit breakers in effects

3. **API compatibility breaks**
   - **Likelihood**: Low
   - **Impact**: Critical (breaks existing users)
   - **Mitigation**: Comprehensive API tests, semver major version bump
   - **Rollback**: Maintain v1.x branch indefinitely

### Medium-Priority Risks

4. **SVG rendering differences**
   - **Likelihood**: Low
   - **Impact**: Medium (visual differences)
   - **Mitigation**: Visual regression tests
   - **Rollback**: Fix CSS/SVG attributes

5. **Memory leaks**
   - **Likelihood**: Medium
   - **Impact**: High (crashes browser)
   - **Mitigation**: Use `onCleanup` for all listeners, test with Chrome heap profiler
   - **Rollback**: Find and fix leaks (not optional)

6. **Test coverage insufficient**
   - **Likelihood**: High
   - **Impact**: Medium (bugs slip through)
   - **Mitigation**: Mandate 80% coverage before any migration
   - **Rollback**: Hire QA or write more tests (not optional)

---

## Success Metrics

### Quantitative

- **Performance**: ≥ 90% of vanilla (measure: initial render, drag fps, view mode switch)
- **Test coverage**: ≥ 80%
- **Zero regressions**: All existing features work identically
- **Memory**: No leaks (heap size stable after 10 minutes interaction)

### Qualitative

- **Developer experience**: SolidJS code is more maintainable than vanilla (subjective)
- **User experience**: No perceptible difference from vanilla
- **Community reception**: GitHub issues/PRs show positive sentiment

---

## Rollback Strategies

### Per-Phase Rollback

Each phase is isolated. If Phase N fails, rollback steps:

1. Revert git branch to pre-phase commit
2. Delete `src/solid/components/ComponentN.jsx`
3. Remove adapter for ComponentN
4. Update feature flags to disable ComponentN
5. Continue with hybrid architecture

### Full Migration Abort

If multiple phases fail or fundamental issues emerge:

1. **Keep hybrid architecture permanently**
2. Ship v2.0 with both vanilla and SolidJS builds
3. Let users opt-in via `import { Gantt } from 'frappe-gantt/solid'`
4. Document trade-offs (bundle size vs reactivity)
5. Maintain both codebases

**This is an acceptable outcome.** Hybrid is still better than nothing.

---

## Open Questions

1. **SSR Support**: Should SolidJS version support server-side rendering?
   - **Answer**: Not initially. Add in Phase 7 if requested.

2. **TypeScript**: Should we add TypeScript during migration?
   - **Answer**: No, keep JavaScript. TypeScript is separate effort.

3. **Breaking Changes**: Are any breaking changes acceptable?
   - **Answer**: No, unless absolutely unavoidable. Bump to v2.0 if needed.

4. **Vanilla Maintenance**: If hybrid ships, maintain both codebases?
   - **Answer**: Vanilla enters maintenance mode (bugs only, no features).

5. **CDN Build**: Should CDN build be SolidJS or vanilla?
   - **Answer**: Offer both. Default to vanilla for backwards compatibility.

---

## Appendix: Alternative Strategies Considered

### Strategy A: Clean Rewrite

**Pros**: No technical debt, greenfield
**Cons**: Months of work, all new bugs, risky

**Verdict**: Rejected. Too risky for production library.

### Strategy B: Keep Vanilla Forever

**Pros**: Zero risk
**Cons**: No benefits of reactivity

**Verdict**: Rejected. Reactivity is valuable.

### Strategy C: Use React/Vue Instead

**Pros**: Larger ecosystems
**Cons**: Overkill for this use case

**Verdict**: Rejected. SolidJS is perfect fit (fine-grained reactivity).

### Strategy D: Hybrid Permanent Architecture (CHOSEN FALLBACK)

**Pros**: Low risk, users choose, both maintained
**Cons**: Maintenance burden

**Verdict**: Acceptable fallback if full migration fails.

---

## Conclusion

This migration is **high-risk, high-reward**. Success means better DX and maintainability. Failure means wasted effort. The hybrid architecture provides a safety net. **Do not rush**. Validate each phase thoroughly before proceeding.
