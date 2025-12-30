import { render, Dynamic } from 'solid-js/web';
import { createSignal, createMemo, Index, Show, onMount, onCleanup, createContext, useContext, createEffect } from 'solid-js';
import { createStore } from 'solid-js/store';
import { createRAF } from '@solid-primitives/raf';
import calendarData from '../data/generated/calendar.json';
import { useDrag } from '../hooks/useDrag.js';

// Mock context (like GanttEvents in real app)
const TestEventsContext = createContext({
    onHover: null,
    onClick: null,
    onDragStart: null,
    onDragEnd: null,
    onResize: null,
});
const useTestEvents = () => useContext(TestEventsContext);

// ═══════════════════════════════════════════════════════════════════════════
// INDEX RECYCLING DIAGNOSTIC DEMO
// Purpose: Test <Index> DOM recycling WITHOUT scroll complexity
// Question: How fast can <Index> update 340 DOM nodes when task IDs change?
// ═══════════════════════════════════════════════════════════════════════════

// Inject optimized CSS for V7b
const OPTIMIZED_CSS = `
.bar-opt {
    position: absolute;
    will-change: transform;
    cursor: move;
    contain: layout style paint;
}
.bar-opt-inner {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 3px;
    opacity: 0.1;
    box-sizing: border-box;
}
.bar-opt-progress {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: 3px;
    background-color: #a3a3ff;
    opacity: 0.3;
}
.bar-opt-label {
    position: absolute;
    top: 50%;
    left: 8px;
    transform: translateY(-50%);
    white-space: nowrap;
    pointer-events: none;
    font-size: 12px;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100% - 16px);
}
.bar-opt-lock {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: 10px;
    pointer-events: none;
}
.bar-opt-handle {
    position: absolute;
    top: 25%;
    width: 4px;
    height: 50%;
    border-radius: 1px;
    background-color: #ddd;
    cursor: ew-resize;
    opacity: 0;
}
.bar-opt-handle-left { left: -2px; }
.bar-opt-handle-right { right: -2px; }
.bar-opt-handle-progress {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: #fff;
    border: 2px solid #a3a3ff;
    cursor: ew-resize;
    opacity: 0;
    box-sizing: border-box;
}
`;

// Inject/update CSS
if (typeof document !== 'undefined') {
    let style = document.getElementById('bar-opt-styles');
    if (!style) {
        style = document.createElement('style');
        style.id = 'bar-opt-styles';
        document.head.appendChild(style);
    }
    style.textContent = OPTIMIZED_CSS;
}

const VISIBLE_COUNT = 340; // Same as real gantt viewport
const UPDATE_INTERVAL = 16; // 60fps target
const SCROLL_STEP = 10; // How many tasks to shift per "frame"

// ═══════════════════════════════════════════════════════════════════════════
// TEST BAR VARIANTS - Progressively add complexity to find the bottleneck
// ═══════════════════════════════════════════════════════════════════════════

/**
 * V1: Absolute minimum - just a div with inline styles
 * Position comes from SLOT (fixed), data comes from TASK (changes)
 */
function TestBarMinimal(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    // FIXED position from slot index - this never changes for this DOM node
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${pos().x}px, ${pos().y}px)`,
            width: `${SLOT_WIDTH}px`,
            height: `${SLOT_HEIGHT}px`,
            background: task()?.color ?? '#3b82f6',
            'border-radius': '3px',
        }}>
            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
                overflow: 'hidden',
                'white-space': 'nowrap',
            }}>
                {task()?.name ?? ''}
            </span>
        </div>
    );
}

/**
 * V2: With memoized properties (like real Bar)
 */
function TestBarWithMemo(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // Memoize task properties like real Bar does
    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${pos().x}px, ${pos().y}px)`,
            width: `${SLOT_WIDTH}px`,
            height: `${SLOT_HEIGHT}px`,
            background: color(),
            'border-radius': '3px',
        }}>
            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
                overflow: 'hidden',
                'white-space': 'nowrap',
            }}>
                {name()}
            </span>
        </div>
    );
}

/**
 * V3: With <Show> conditions (suspected cause of cleanNode)
 */
function TestBarWithShow(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${pos().x}px, ${pos().y}px)`,
            width: `${SLOT_WIDTH}px`,
            height: `${SLOT_HEIGHT}px`,
            background: color(),
            'border-radius': '3px',
        }}>
            {/* This <Show> might cause cleanNode when taskId changes! */}
            <Show when={progress() > 0}>
                <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: `${(SLOT_WIDTH * progress()) / 100}px`,
                    height: '100%',
                    background: 'rgba(0,0,0,0.3)',
                    'border-radius': '3px',
                }} />
            </Show>

            {/* Another <Show> - lock indicator */}
            <Show when={isLocked()}>
                <div style={{
                    position: 'absolute',
                    right: '4px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#fff',
                    'font-size': '10px',
                }}>
                    🔒
                </div>
            </Show>

            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
                overflow: 'hidden',
                'white-space': 'nowrap',
            }}>
                {name()}
            </span>
        </div>
    );
}

/**
 * V4: Using CSS visibility instead of <Show> (potential fix)
 */
function TestBarCSSOnly(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${pos().x}px, ${pos().y}px)`,
            width: `${SLOT_WIDTH}px`,
            height: `${SLOT_HEIGHT}px`,
            background: color(),
            'border-radius': '3px',
        }}>
            {/* CSS display:none instead of <Show> - no unmount/remount */}
            <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${(SLOT_WIDTH * progress()) / 100}px`,
                height: '100%',
                background: 'rgba(0,0,0,0.3)',
                'border-radius': '3px',
                display: progress() > 0 ? 'block' : 'none',
            }} />

            {/* Lock indicator with CSS display */}
            <div style={{
                position: 'absolute',
                right: '4px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#fff',
                'font-size': '10px',
                display: isLocked() ? 'block' : 'none',
            }}>
                🔒
            </div>

            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
                overflow: 'hidden',
                'white-space': 'nowrap',
            }}>
                {name()}
            </span>
        </div>
    );
}

/**
 * V5: Many Memos (like real Bar - 15+ memos)
 */
function TestBarManyMemos(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // Simulate real Bar's 20+ memos
    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);

    // Config memos (like real Bar)
    const barCornerRadius = createMemo(() => 3);
    const readonly = createMemo(() => false);
    const readonlyDates = createMemo(() => false);
    const readonlyProgress = createMemo(() => false);
    const showExpectedProgress = createMemo(() => false);
    const columnWidth = createMemo(() => 45);

    // Computed memos (like real Bar)
    const progressWidth = createMemo(() => (SLOT_WIDTH * progress()) / 100);
    const barColor = createMemo(() => task()?.color ?? '#b8c2cc');
    const progressColor = createMemo(() => task()?.color_progress ?? '#a3a3ff');
    const hasSubtasks = createMemo(() => task()?._children?.length > 0);
    const isInvalid = createMemo(() => task()?.invalid ?? false);
    const customClass = createMemo(() => task()?.custom_class ?? '');
    const showHandles = createMemo(() => !readonly());
    const showDateHandles = createMemo(() => showHandles() && !readonlyDates());
    const showProgressHandle = createMemo(() => showHandles() && !readonlyProgress());
    const barTransform = createMemo(() => `translate(${pos().x}px, ${pos().y}px)`);

    return (
        <div style={{
            position: 'absolute',
            transform: barTransform(),
            width: `${SLOT_WIDTH}px`,
            height: `${SLOT_HEIGHT}px`,
            background: color(),
            'border-radius': `${barCornerRadius()}px`,
        }}>
            <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${progressWidth()}px`,
                height: '100%',
                background: 'rgba(0,0,0,0.3)',
                'border-radius': `${barCornerRadius()}px`,
                display: progress() > 0 ? 'block' : 'none',
            }} />
            <div style={{
                position: 'absolute',
                right: '4px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#fff',
                'font-size': '10px',
                display: isLocked() ? 'block' : 'none',
            }}>🔒</div>
            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
                overflow: 'hidden',
                'white-space': 'nowrap',
            }}>{name()}</span>
        </div>
    );
}

/**
 * V6: Event Handlers (8 handlers like real Bar)
 */
function TestBarWithHandlers(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);

    // 8 event handlers like real Bar
    const handleBarMouseDown = (e) => { /* noop */ };
    const handleMouseEnter = (e) => { /* noop */ };
    const handleMouseLeave = () => { /* noop */ };
    const handleClick = (e) => { /* noop */ };
    const handleLeftHandleMouseDown = (e) => { /* noop */ };
    const handleRightHandleMouseDown = (e) => { /* noop */ };
    const handleProgressMouseDown = (e) => { /* noop */ };

    return (
        <div
            onMouseDown={handleBarMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            style={{
                position: 'absolute',
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
                background: color(),
                'border-radius': '3px',
            }}
        >
            <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${(SLOT_WIDTH * progress()) / 100}px`,
                height: '100%',
                background: 'rgba(0,0,0,0.3)',
                display: progress() > 0 ? 'block' : 'none',
            }} />
            <div
                onMouseDown={handleLeftHandleMouseDown}
                style={{
                    position: 'absolute',
                    left: '-2px',
                    top: '25%',
                    width: '4px',
                    height: '50%',
                    cursor: 'ew-resize',
                    display: 'none',
                }}
            />
            <div
                onMouseDown={handleRightHandleMouseDown}
                style={{
                    position: 'absolute',
                    right: '-2px',
                    top: '25%',
                    width: '4px',
                    height: '50%',
                    cursor: 'ew-resize',
                    display: 'none',
                }}
            />
            <div
                onMouseDown={handleProgressMouseDown}
                style={{
                    position: 'absolute',
                    left: `${(SLOT_WIDTH * progress()) / 100 - 5}px`,
                    top: '50%',
                    width: '10px',
                    height: '10px',
                    cursor: 'ew-resize',
                    display: 'none',
                }}
            />
            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
            }}>{name()}</span>
        </div>
    );
}

/**
 * V7: Full DOM Structure (all child elements like real Bar)
 */
function TestBarFullDOM(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);
    const progressWidth = createMemo(() => (SLOT_WIDTH * progress()) / 100);

    return (
        <div
            class="bar-wrapper"
            style={{
                position: 'absolute',
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
                cursor: 'move',
                'will-change': 'transform',
            }}
        >
            {/* Main bar */}
            <div
                class="bar"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    'border-radius': '3px',
                    'background-color': color(),
                    opacity: 0.1,
                    border: `1.5px solid ${color()}`,
                    'box-sizing': 'border-box',
                }}
            />
            {/* Expected progress bar */}
            <div
                class="bar-expected-progress"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '0px',
                    height: '100%',
                    'border-radius': '3px',
                    'background-color': 'rgba(0,0,0,0.2)',
                    display: 'none',
                }}
            />
            {/* Progress bar */}
            <div
                class="bar-progress"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${progressWidth()}px`,
                    height: '100%',
                    'border-radius': '3px',
                    'background-color': '#a3a3ff',
                    opacity: 0.3,
                }}
            />
            {/* Label */}
            <div
                class="bar-label"
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: `${SLOT_WIDTH + 5}px`,
                    transform: 'translateY(-50%)',
                    'white-space': 'nowrap',
                    'pointer-events': 'none',
                    'font-size': '12px',
                    color: '#333',
                }}
            >
                {name()}
            </div>
            {/* Lock icon */}
            <div
                style={{
                    position: 'absolute',
                    top: '2px',
                    right: '4px',
                    'font-size': '10px',
                    'pointer-events': 'none',
                    display: isLocked() ? 'block' : 'none',
                }}
            >🔒</div>
            {/* Left handle */}
            <div
                class="handle handle-left"
                style={{
                    position: 'absolute',
                    left: '-2px',
                    top: '25%',
                    width: '4px',
                    height: '50%',
                    'border-radius': '1px',
                    'background-color': '#ddd',
                    cursor: 'ew-resize',
                    opacity: 0,
                    display: 'block',
                }}
            />
            {/* Right handle */}
            <div
                class="handle handle-right"
                style={{
                    position: 'absolute',
                    right: '-2px',
                    top: '25%',
                    width: '4px',
                    height: '50%',
                    'border-radius': '1px',
                    'background-color': '#ddd',
                    cursor: 'ew-resize',
                    opacity: 0,
                    display: 'block',
                }}
            />
            {/* Progress handle */}
            <div
                class="handle handle-progress"
                style={{
                    position: 'absolute',
                    left: `${progressWidth() - 5}px`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '10px',
                    height: '10px',
                    'border-radius': '50%',
                    'background-color': '#fff',
                    border: '2px solid #a3a3ff',
                    cursor: 'ew-resize',
                    opacity: 0,
                    'box-sizing': 'border-box',
                    display: progress() > 0 ? 'block' : 'none',
                }}
            />
        </div>
    );
}

/**
 * V7b: OPTIMIZED Full DOM - CSS custom properties
 * Key optimizations:
 * - contain: strict on wrapper
 * - CSS custom properties for dynamic values (single style update)
 * - Fewer individual style properties to recalculate
 */
function TestBarFullDOMOptimized(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);
    const progressWidth = createMemo(() => (SLOT_WIDTH * progress()) / 100);

    // Use CSS custom properties - single style object update
    return (
        <div
            class="bar-opt"
            style={{
                '--x': `${pos().x}px`,
                '--y': `${pos().y}px`,
                '--w': `${SLOT_WIDTH}px`,
                '--h': `${SLOT_HEIGHT}px`,
                '--color': color(),
                '--pw': `${progressWidth()}px`,
                '--lock': isLocked() ? 'block' : 'none',
                '--prog-vis': progress() > 0 ? 'block' : 'none',
                transform: `translate(var(--x), var(--y))`,
                width: 'var(--w)',
                height: 'var(--h)',
            }}
        >
            <div class="bar-opt-inner" style={{
                'background-color': 'var(--color)',
                'border-color': 'var(--color)',
            }} />
            <div class="bar-opt-progress" style={{ width: 'var(--pw)' }} />
            <div class="bar-opt-label">{name()}</div>
            <div class="bar-opt-lock" style={{ display: 'var(--lock)' }}>🔒</div>
            <div class="bar-opt-handle bar-opt-handle-left" />
            <div class="bar-opt-handle bar-opt-handle-right" />
            <div class="bar-opt-handle-progress" style={{
                left: `calc(var(--pw) - 5px)`,
                display: 'var(--prog-vis)',
            }} />
        </div>
    );
}

/**
 * V7c: MINIMAL Full DOM - Same elements but NO text updates
 * Tests if text node updates are the bottleneck
 */
function TestBarFullDOMNoText(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const progress = createMemo(() => task()?.progress ?? 0);
    const progressWidth = createMemo(() => (SLOT_WIDTH * progress()) / 100);

    return (
        <div
            class="bar-opt"
            style={{
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
            }}
        >
            <div class="bar-opt-inner" style={{
                'background-color': color(),
                'border': `1.5px solid ${color()}`,
            }} />
            <div class="bar-opt-progress" style={{ width: `${progressWidth()}px` }} />
            {/* NO text update - static placeholder */}
            <div class="bar-opt-label">Task</div>
            <div class="bar-opt-handle bar-opt-handle-left" />
            <div class="bar-opt-handle bar-opt-handle-right" />
            <div class="bar-opt-handle-progress" style={{
                left: `${progressWidth() - 5}px`,
                display: progress() > 0 ? 'block' : 'none',
            }} />
        </div>
    );
}

/**
 * V7d: Full DOM with name MEMO but no render
 * Tests if the memo evaluation itself is slow (vs text node rendering)
 */
function TestBarFullDOMOptText(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    // Memo exists but NOT rendered - tests if memo eval is the bottleneck
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);
    const progressWidth = createMemo(() => (SLOT_WIDTH * progress()) / 100);

    // Force memo to evaluate (but don't render result)
    void name();

    return (
        <div
            class="bar-opt"
            style={{
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
            }}
        >
            <div class="bar-opt-inner" style={{
                'background-color': color(),
                'border': `1.5px solid ${color()}`,
            }} />
            <div class="bar-opt-progress" style={{ width: `${progressWidth()}px` }} />
            {/* Static text - memo evaluated but not rendered */}
            <div class="bar-opt-label">Task</div>
            <div class="bar-opt-lock" style={{ display: isLocked() ? 'block' : 'none' }}>🔒</div>
            <div class="bar-opt-handle bar-opt-handle-left" />
            <div class="bar-opt-handle bar-opt-handle-right" />
            <div class="bar-opt-handle-progress" style={{
                left: `${progressWidth() - 5}px`,
                display: progress() > 0 ? 'block' : 'none',
            }} />
        </div>
    );
}

/**
 * V7e: NO MEMOS - Direct property access, NO TEXT RENDER
 * Tests if memo wrapper itself adds overhead (vs direct access)
 */
function TestBarNoMemos(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // NO MEMOS - direct property access
    // Force evaluation but don't render
    void (task()?.name ?? '');

    return (
        <div
            class="bar-opt"
            style={{
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
            }}
        >
            <div class="bar-opt-inner" style={{
                'background-color': task()?.color ?? '#3b82f6',
                'border': `1.5px solid ${task()?.color ?? '#3b82f6'}`,
            }} />
            <div class="bar-opt-progress" style={{
                width: `${(SLOT_WIDTH * (task()?.progress ?? 0)) / 100}px`
            }} />
            <div class="bar-opt-label">Task</div>
            <div class="bar-opt-lock" style={{
                display: task()?.locked ? 'block' : 'none'
            }}>🔒</div>
            <div class="bar-opt-handle bar-opt-handle-left" />
            <div class="bar-opt-handle bar-opt-handle-right" />
            <div class="bar-opt-handle-progress" style={{
                left: `${(SLOT_WIDTH * (task()?.progress ?? 0)) / 100 - 5}px`,
                display: (task()?.progress ?? 0) > 0 ? 'block' : 'none',
            }} />
        </div>
    );
}

/**
 * V7f: SINGLE MEMO - Batch all task properties, NO TEXT RENDER
 * Tests if single batched memo is faster than multiple memos
 */
function TestBarSingleMemo(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // SINGLE memo that reads all properties at once
    const taskData = createMemo(() => {
        const t = task();
        return {
            color: t?.color ?? '#3b82f6',
            name: t?.name ?? '',
            progress: t?.progress ?? 0,
            locked: t?.locked ?? false,
        };
    });

    // Derive from single memo
    const progressWidth = () => (SLOT_WIDTH * taskData().progress) / 100;

    // Evaluate name but don't render
    void taskData().name;

    return (
        <div
            class="bar-opt"
            style={{
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
            }}
        >
            <div class="bar-opt-inner" style={{
                'background-color': taskData().color,
                'border': `1.5px solid ${taskData().color}`,
            }} />
            <div class="bar-opt-progress" style={{ width: `${progressWidth()}px` }} />
            <div class="bar-opt-label">Task</div>
            <div class="bar-opt-lock" style={{
                display: taskData().locked ? 'block' : 'none'
            }}>🔒</div>
            <div class="bar-opt-handle bar-opt-handle-left" />
            <div class="bar-opt-handle bar-opt-handle-right" />
            <div class="bar-opt-handle-progress" style={{
                left: `${progressWidth() - 5}px`,
                display: taskData().progress > 0 ? 'block' : 'none',
            }} />
        </div>
    );
}

/**
 * V7g: Full DOM WITH text render (the actual bottleneck test)
 * Same as V7 but with name rendered
 */
function TestBarWithText(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);
    const progressWidth = createMemo(() => (SLOT_WIDTH * progress()) / 100);

    return (
        <div
            class="bar-opt"
            style={{
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
            }}
        >
            <div class="bar-opt-inner" style={{
                'background-color': color(),
                'border': `1.5px solid ${color()}`,
            }} />
            <div class="bar-opt-progress" style={{ width: `${progressWidth()}px` }} />
            {/* ACTUAL text render - this is the bottleneck */}
            <div class="bar-opt-label">{name()}</div>
            <div class="bar-opt-lock" style={{ display: isLocked() ? 'block' : 'none' }}>🔒</div>
            <div class="bar-opt-handle bar-opt-handle-left" />
            <div class="bar-opt-handle bar-opt-handle-right" />
            <div class="bar-opt-handle-progress" style={{
                left: `${progressWidth() - 5}px`,
                display: progress() > 0 ? 'block' : 'none',
            }} />
        </div>
    );
}

/**
 * V7h: Direct task object (no store lookup in component)
 * Uses CSS classes + custom properties for dynamic values
 */
function TestBarDirectTask(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // Single memo - one read, cached result
    const t = createMemo(() => {
        const task = getTask();
        return {
            color: task?.color ?? '#3b82f6',
            progress: task?.progress ?? 0,
            name: task?.name ?? '',
            pw: (SLOT_WIDTH * (task?.progress ?? 0)) / 100,
        };
    });

    return (
        <div
            class="bar-opt"
            style={{
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
            }}
        >
            <div class="bar-opt-inner" style={{
                'background-color': t().color,
                'border': `1.5px solid ${t().color}`,
            }} />
            <div class="bar-opt-progress" style={{ width: `${t().pw}px` }} />
            <div class="bar-opt-label">{t().name}</div>
        </div>
    );
}

/**
 * V7i: V7h + lock icon + extra text (find breaking point)
 */
function TestBarDirectTaskFull(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const t = createMemo(() => {
        const task = getTask();
        const progress = task?.progress ?? 0;
        return {
            color: task?.color ?? '#3b82f6',
            progress,
            name: task?.name ?? '',
            pw: (SLOT_WIDTH * progress) / 100,
            locked: task?.locked ?? false,
            id: task?.id ?? '',
        };
    });

    return (
        <div
            class="bar-opt"
            style={{
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
            }}
        >
            <div class="bar-opt-inner" style={{
                'background-color': t().color,
                'border': `1.5px solid ${t().color}`,
            }} />
            <div class="bar-opt-progress" style={{ width: `${t().pw}px` }} />
            <div class="bar-opt-label">{t().name}</div>
            <div class="bar-opt-lock" style={{
                display: t().locked ? 'block' : 'none'
            }}>🔒</div>
            <div style={{
                position: 'absolute',
                bottom: '2px',
                right: '4px',
                'font-size': '9px',
                color: '#888',
                'pointer-events': 'none',
            }}>{t().id}</div>
        </div>
    );
}

/**
 * V7j: Minimal CSS - no contain, will-change, etc.
 */
function TestBarMinimalCSS(props) {
    const getTask = () => typeof props.task === 'function' ? props.task() : props.task;
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const t = createMemo(() => {
        const task = getTask();
        const progress = task?.progress ?? 0;
        return {
            color: task?.color ?? '#3b82f6',
            progress,
            name: task?.name ?? '',
            pw: (SLOT_WIDTH * progress) / 100,
            locked: task?.locked ?? false,
            id: task?.id ?? '',
        };
    });

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${pos().x}px, ${pos().y}px)`,
            width: `${SLOT_WIDTH}px`,
            height: `${SLOT_HEIGHT}px`,
        }}>
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                'background-color': t().color,
                opacity: 0.15,
                'border-radius': '3px',
            }} />
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${t().pw}px`,
                'background-color': '#a3a3ff',
                opacity: 0.3,
                'border-radius': '3px',
            }} />
            <div style={{
                position: 'absolute',
                top: '50%',
                left: '8px',
                transform: 'translateY(-50%)',
                color: '#fff',
                'font-size': '12px',
            }}>{t().name}</div>
            <div style={{
                position: 'absolute',
                top: '2px',
                right: '4px',
                'font-size': '10px',
                display: t().locked ? 'block' : 'none',
            }}>🔒</div>
            <div style={{
                position: 'absolute',
                bottom: '2px',
                right: '4px',
                'font-size': '9px',
                color: '#888',
            }}>{t().id}</div>
        </div>
    );
}

/**
 * V8: With Context (reads from context like real Bar reads GanttEvents)
 */
function TestBarWithContext(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // Read from context (like real Bar reads GanttEvents)
    const events = useTestEvents();
    const onHover = props.onHover ?? events.onHover;
    const onClick = props.onClick ?? events.onClick;

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);

    const handleMouseEnter = (e) => { onHover?.(taskId(), e); };
    const handleClick = (e) => { onClick?.(taskId(), e); };

    return (
        <div
            onMouseEnter={handleMouseEnter}
            onClick={handleClick}
            style={{
                position: 'absolute',
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
                background: color(),
                'border-radius': '3px',
            }}
        >
            <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${(SLOT_WIDTH * progress()) / 100}px`,
                height: '100%',
                background: 'rgba(0,0,0,0.3)',
                display: progress() > 0 ? 'block' : 'none',
            }} />
            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
            }}>{name()}</span>
        </div>
    );
}

/**
 * V10: Real Store Pattern (uses $bar structure like real taskStore)
 * This tests whether store proxy access patterns cause subscriptions
 */
function TestBarRealStore(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;

    // Access store the way real Bar.jsx does (through $bar)
    const getPosition = () => {
        const id = taskId();
        if (props.taskStore && id) {
            const task = props.taskStore.tasks[id];
            if (task?.$bar) {
                return task.$bar;
            }
        }
        // Fallback to slot position
        return slotPositions[props.slotIndex] ?? { x: 0, y: 0, width: SLOT_WIDTH, height: SLOT_HEIGHT };
    };

    const task = () => {
        const id = taskId();
        return props.taskStore?.tasks[id] ?? props.tasks?.[id] ?? {};
    };

    const position = createMemo(() => getPosition());
    const x = () => position()?.x ?? 0;
    const y = () => position()?.y ?? 0;
    const width = () => position()?.width ?? SLOT_WIDTH;
    const height = () => position()?.height ?? SLOT_HEIGHT;

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);

    return (
        <div style={{
            position: 'absolute',
            transform: `translate(${x()}px, ${y()}px)`,
            width: `${width()}px`,
            height: `${height()}px`,
            background: color(),
            'border-radius': '3px',
        }}>
            <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${(width() * progress()) / 100}px`,
                height: '100%',
                background: 'rgba(0,0,0,0.3)',
                display: progress() > 0 ? 'block' : 'none',
            }} />
            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
            }}>{name()}</span>
        </div>
    );
}

/**
 * V9: With useDrag hook (like real Bar)
 * Tests if useDrag's global listeners and RAF cause issues
 */
function TestBarWithDrag(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);

    // useDrag hook like real Bar
    const { dragState, isDragging, startDrag } = useDrag({
        onDragStart: (data, state) => {
            data.originalX = pos().x;
            data.originalY = pos().y;
        },
        onDragMove: (move, data, state) => {
            // Noop - just testing the hook overhead
        },
        onDragEnd: (move, data, state) => {
            // Noop
        },
    });

    const dragStateClass = () => {
        const state = dragState();
        if (state === 'idle') return '';
        return `dragging ${state}`;
    };

    const handleBarMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag(e, 'dragging_bar');
    };

    return (
        <div
            class={`bar-wrapper ${dragStateClass()}`}
            onMouseDown={handleBarMouseDown}
            style={{
                position: 'absolute',
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
                background: isDragging() ? '#2c3e50' : color(),
                'border-radius': '3px',
                cursor: 'grab',
            }}
        >
            <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${(SLOT_WIDTH * progress()) / 100}px`,
                height: '100%',
                background: 'rgba(0,0,0,0.3)',
                display: progress() > 0 ? 'block' : 'none',
            }} />
            <span style={{
                color: '#fff',
                'font-size': '11px',
                padding: '4px',
                display: 'block',
            }}>{name()}</span>
        </div>
    );
}

/**
 * V11: Combined - Many memos + handlers + useDrag + context + full DOM
 * This matches the real Bar.jsx complexity
 */
function TestBarCombined(props) {
    const taskId = () => typeof props.taskId === 'function' ? props.taskId() : props.taskId;
    const task = () => props.tasks[taskId()];
    const pos = () => slotPositions[props.slotIndex] ?? { x: 0, y: 0 };

    // Context (like real Bar)
    const events = useTestEvents();
    const onHover = props.onHover ?? events.onHover;

    // Many memos (like real Bar - 15+)
    const color = createMemo(() => task()?.color ?? '#3b82f6');
    const name = createMemo(() => task()?.name ?? '');
    const progress = createMemo(() => task()?.progress ?? 0);
    const isLocked = createMemo(() => task()?.locked ?? false);
    const barCornerRadius = createMemo(() => 3);
    const readonly = createMemo(() => false);
    const readonlyDates = createMemo(() => false);
    const readonlyProgress = createMemo(() => false);
    const columnWidth = createMemo(() => 45);
    const progressWidth = createMemo(() => (SLOT_WIDTH * progress()) / 100);
    const barColor = createMemo(() => task()?.color ?? '#b8c2cc');
    const progressColor = createMemo(() => task()?.color_progress ?? '#a3a3ff');
    const hasSubtasks = createMemo(() => task()?._children?.length > 0);
    const showHandles = createMemo(() => !readonly());
    const showDateHandles = createMemo(() => showHandles() && !readonlyDates());
    const showProgressHandle = createMemo(() => showHandles() && !readonlyProgress());

    // useDrag hook (like real Bar)
    const { dragState, isDragging, startDrag } = useDrag({
        onDragStart: (data, state) => {
            data.originalX = pos().x;
        },
        onDragMove: (move, data, state) => { /* noop */ },
        onDragEnd: (move, data, state) => { /* noop */ },
    });

    const dragStateClass = () => {
        const state = dragState();
        return state === 'idle' ? '' : `dragging ${state}`;
    };

    // Event handlers (like real Bar - 8 handlers)
    const handleBarMouseDown = (e) => {
        if (readonly()) return;
        e.preventDefault();
        e.stopPropagation();
        startDrag(e, 'dragging_bar');
    };
    const handleMouseEnter = (e) => { onHover?.(taskId(), e); };
    const handleMouseLeave = () => { /* noop */ };
    const handleClick = (e) => { /* noop */ };
    const handleLeftHandleMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag(e, 'dragging_left');
    };
    const handleRightHandleMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag(e, 'dragging_right');
    };
    const handleProgressMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag(e, 'dragging_progress');
    };

    return (
        <div
            class={`bar-wrapper ${dragStateClass()}`}
            data-id={taskId()}
            onMouseDown={handleBarMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            style={{
                position: 'absolute',
                transform: `translate(${pos().x}px, ${pos().y}px)`,
                width: `${SLOT_WIDTH}px`,
                height: `${SLOT_HEIGHT}px`,
                cursor: readonly() ? 'default' : 'grab',
                'will-change': 'transform',
            }}
        >
            {/* Main bar */}
            <div
                class="bar"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    'border-radius': `${barCornerRadius()}px`,
                    'background-color': isDragging() ? '#2c3e50' : barColor(),
                    opacity: 0.15,
                    border: `1.5px solid ${barColor()}`,
                    'box-sizing': 'border-box',
                }}
            />
            {/* Progress bar */}
            <div
                class="bar-progress"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${progressWidth()}px`,
                    height: '100%',
                    'border-radius': `${barCornerRadius()}px`,
                    'background-color': progressColor(),
                    opacity: 0.4,
                    display: progress() > 0 ? 'block' : 'none',
                }}
            />
            {/* Label */}
            <div
                class="bar-label"
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: `${SLOT_WIDTH + 5}px`,
                    transform: 'translateY(-50%)',
                    'white-space': 'nowrap',
                    'pointer-events': 'none',
                    'font-size': '12px',
                    color: '#333',
                }}
            >
                {name()}
            </div>
            {/* Lock icon */}
            <div
                style={{
                    position: 'absolute',
                    top: '2px',
                    right: '4px',
                    'font-size': '10px',
                    'pointer-events': 'none',
                    display: isLocked() ? 'block' : 'none',
                }}
            >🔒</div>
            {/* Left handle */}
            <div
                class="handle handle-left"
                onMouseDown={handleLeftHandleMouseDown}
                style={{
                    position: 'absolute',
                    left: '-2px',
                    top: '25%',
                    width: '4px',
                    height: '50%',
                    'border-radius': '1px',
                    'background-color': '#ddd',
                    cursor: 'ew-resize',
                    opacity: 0,
                    display: showDateHandles() && !isLocked() ? 'block' : 'none',
                }}
            />
            {/* Right handle */}
            <div
                class="handle handle-right"
                onMouseDown={handleRightHandleMouseDown}
                style={{
                    position: 'absolute',
                    right: '-2px',
                    top: '25%',
                    width: '4px',
                    height: '50%',
                    'border-radius': '1px',
                    'background-color': '#ddd',
                    cursor: 'ew-resize',
                    opacity: 0,
                    display: showDateHandles() && !isLocked() ? 'block' : 'none',
                }}
            />
            {/* Progress handle */}
            <div
                class="handle handle-progress"
                onMouseDown={handleProgressMouseDown}
                style={{
                    position: 'absolute',
                    left: `${progressWidth() - 5}px`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '10px',
                    height: '10px',
                    'border-radius': '50%',
                    'background-color': '#fff',
                    border: `2px solid ${progressColor()}`,
                    cursor: 'ew-resize',
                    opacity: 0,
                    'box-sizing': 'border-box',
                    display: showProgressHandle() && progress() > 0 && !isLocked() ? 'block' : 'none',
                }}
            />
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// V12: Simple Arrow Layer (like ArrowLayerBatched)
// ═══════════════════════════════════════════════════════════════════════════

function SimpleArrowLayer(props) {
    // Generate arrow paths between visible task slots
    const arrowPaths = createMemo(() => {
        const ids = props.visibleTaskIds || [];
        if (ids.length < 2) return '';

        const paths = [];
        // Draw arrows between consecutive tasks (simulates dependencies)
        for (let i = 0; i < ids.length - 1; i++) {
            const fromSlot = slotPositions[i];
            const toSlot = slotPositions[i + 1];
            if (!fromSlot || !toSlot) continue;

            // Simple line from right of one bar to left of next
            const startX = fromSlot.x + SLOT_WIDTH;
            const startY = fromSlot.y + SLOT_HEIGHT / 2;
            const endX = toSlot.x;
            const endY = toSlot.y + SLOT_HEIGHT / 2;

            // Skip if same row (would overlap)
            if (Math.abs(startY - endY) < 5) continue;

            paths.push(`M${startX},${startY}L${endX},${endY}`);
        }
        return paths.join(' ');
    });

    return (
        <svg
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                'pointer-events': 'none',
                overflow: 'visible',
            }}
        >
            <path
                d={arrowPaths()}
                fill="none"
                stroke="#666"
                stroke-width="1.5"
                stroke-opacity="0.5"
            />
        </svg>
    );
}

// Map variant names to components
const BAR_VARIANTS = {
    minimal: TestBarMinimal,
    memo: TestBarWithMemo,
    show: TestBarWithShow,
    css: TestBarCSSOnly,
    manyMemos: TestBarManyMemos,
    handlers: TestBarWithHandlers,
    fullDOM: TestBarFullDOM,
    fullDOMOpt: TestBarFullDOMOptimized,
    fullDOMNoText: TestBarFullDOMNoText,
    fullDOMOptText: TestBarFullDOMOptText,
    noMemos: TestBarNoMemos,
    singleMemo: TestBarSingleMemo,
    withText: TestBarWithText,
    directTask: TestBarDirectTask,
    directTaskFull: TestBarDirectTaskFull,
    minimalCSS: TestBarMinimalCSS,
    context: TestBarWithContext,
    realStore: TestBarRealStore,
    useDrag: TestBarWithDrag,
    combined: TestBarCombined,
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DEMO COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

// Pre-process tasks into flat object (just task data, no positions)
const initialTasks = (() => {
    const result = {};
    calendarData.tasks.forEach((task, i) => {
        result[task.id] = {
            ...task,
            // Add some variety for Show testing
            locked: i % 7 === 0, // ~14% locked
            progress: task.progress || 0,
        };
    });
    return result;
})();

// FIXED screen positions for the 340 slots - these NEVER change
// The DOM nodes stay here, only their DATA changes
const COLS = 4;
const ROWS = 85; // 4 * 85 = 340 slots
const SLOT_WIDTH = 180;
const SLOT_HEIGHT = 28;
const GAP = 4;

const slotPositions = [];
for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
        slotPositions.push({
            x: col * (SLOT_WIDTH + GAP),
            y: row * (SLOT_HEIGHT + GAP),
        });
    }
}

function IndexTestDemo() {
    // Use pre-processed tasks
    const [tasks] = createStore(initialTasks);

    // All task IDs
    const allTaskIds = Object.keys(tasks);
    console.log(`Loaded ${allTaskIds.length} tasks`);

    // Current visible window offset
    const [offset, setOffset] = createSignal(0);

    // Visible task IDs (simulates what virtualization returns)
    const visibleTaskIds = createMemo(() => {
        const start = offset();
        const end = Math.min(start + VISIBLE_COUNT, allTaskIds.length);
        return allTaskIds.slice(start, end);
    });

    // Visible tasks as objects (for V7h - no store lookup in component)
    const visibleTasks = createMemo(() => {
        const start = offset();
        const end = Math.min(start + VISIBLE_COUNT, allTaskIds.length);
        return allTaskIds.slice(start, end).map(id => tasks[id]);
    });

    // Test controls
    const [running, setRunning] = createSignal(false);
    const [variant, setVariant] = createSignal('minimal');
    const [showArrows, setShowArrows] = createSignal(false);
    const [realScrollMode, setRealScrollMode] = createSignal(false);
    const [updateTime, setUpdateTime] = createSignal(0);
    const [fps, setFps] = createSignal(0);
    const [worstFrame, setWorstFrame] = createSignal(0);
    const [avgFrame, setAvgFrame] = createSignal(0);
    const [direction, setDirection] = createSignal(1);
    let scrollContainerRef;

    // Frame timing - measure ACTUAL frame-to-frame time (includes render)
    let frameTimes = [];
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let lastFrameTime = performance.now();

    // FPS counter - measures actual rendered frames
    const [, startFps, stopFps] = createRAF((timestamp) => {
        frameCount++;

        // Measure actual frame duration (includes all rendering)
        const frameDuration = timestamp - lastFrameTime;
        lastFrameTime = timestamp;

        // Only record if we're running and it's a real frame (not first one)
        if (running() && frameDuration < 500) {
            frameTimes.push(frameDuration);
            setUpdateTime(frameDuration.toFixed(2));
        }

        const elapsed = timestamp - lastFpsUpdate;
        if (elapsed >= 1000) {
            setFps(Math.round((frameCount * 1000) / elapsed));
            frameCount = 0;
            lastFpsUpdate = timestamp;

            if (frameTimes.length > 0) {
                setWorstFrame(Math.max(...frameTimes).toFixed(2));
                setAvgFrame((frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length).toFixed(2));
            }
            frameTimes = [];
        }
    });

    // Simulate scroll updates
    let intervalId = null;
    let scrollAnimId = null;

    // Real scroll handler - just update offset, frame timing measured in RAF
    const handleScroll = (e) => {
        if (!running() || !realScrollMode()) return;

        const scrollTop = e.target.scrollTop;
        const rowHeight = SLOT_HEIGHT + GAP;
        const newOffset = Math.floor(scrollTop / rowHeight) * COLS;

        setOffset(Math.max(0, Math.min(newOffset, allTaskIds.length - VISIBLE_COUNT)));
    };

    // Auto-scroll animation for real scroll mode
    const autoScroll = () => {
        if (!scrollContainerRef || !running() || !realScrollMode()) return;

        const maxScroll = scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight;
        let currentScroll = scrollContainerRef.scrollTop;

        currentScroll += direction() * 5;

        if (currentScroll >= maxScroll) {
            setDirection(-1);
            currentScroll = maxScroll;
        } else if (currentScroll <= 0) {
            setDirection(1);
            currentScroll = 0;
        }

        scrollContainerRef.scrollTop = currentScroll;
        scrollAnimId = requestAnimationFrame(autoScroll);
    };

    const startTest = () => {
        if (running()) {
            stopTest();
            return;
        }

        setRunning(true);
        frameTimes = [];
        frameCount = 0;
        lastFpsUpdate = performance.now();
        startFps();

        if (realScrollMode()) {
            // Start auto-scroll animation
            scrollAnimId = requestAnimationFrame(autoScroll);
        } else {
            // Interval mode - just update offset, frame timing measured in RAF
            intervalId = setInterval(() => {
                setOffset(prev => {
                    let next = prev + direction() * SCROLL_STEP;

                    // Bounce at edges
                    if (next >= allTaskIds.length - VISIBLE_COUNT) {
                        setDirection(-1);
                        next = allTaskIds.length - VISIBLE_COUNT;
                    } else if (next <= 0) {
                        setDirection(1);
                        next = 0;
                    }

                    return next;
                });
            }, UPDATE_INTERVAL);
        }
    };

    const stopTest = () => {
        setRunning(false);
        if (scrollAnimId) {
            cancelAnimationFrame(scrollAnimId);
            scrollAnimId = null;
        }
        stopFps();
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    };

    onCleanup(() => {
        if (intervalId) clearInterval(intervalId);
    });

    // Stats color helpers
    const fpsColor = () => fps() >= 55 ? '#10b981' : fps() >= 30 ? '#f59e0b' : '#ef4444';
    const frameColor = (v) => parseFloat(v) <= 16 ? '#10b981' : parseFloat(v) <= 33 ? '#f59e0b' : '#ef4444';

    return (
        <div style={{
            height: '100vh',
            display: 'flex',
            'flex-direction': 'column',
            padding: '15px',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                gap: '20px',
                'align-items': 'center',
                'margin-bottom': '15px',
                'flex-wrap': 'wrap',
            }}>
                <h1 style={{ margin: 0, 'font-size': '18px' }}>
                    Index Recycling Test
                </h1>

                {/* Stats */}
                <div style={{
                    display: 'flex',
                    gap: '15px',
                    padding: '8px 15px',
                    background: '#2d2d44',
                    'border-radius': '6px',
                    'font-family': 'monospace',
                    'font-size': '13px',
                }}>
                    <span>
                        <span style={{ color: '#888' }}>Visible: </span>
                        <span style={{ color: '#10b981' }}>{visibleTaskIds().length}</span>
                    </span>
                    <span>
                        <span style={{ color: '#888' }}>Offset: </span>
                        <span style={{ color: '#60a5fa' }}>{offset()}</span>
                    </span>
                    <span>
                        <span style={{ color: '#888' }}>FPS: </span>
                        <span style={{ color: fpsColor() }}>{fps()}</span>
                    </span>
                    <span>
                        <span style={{ color: '#888' }}>Update: </span>
                        <span style={{ color: frameColor(updateTime()) }}>{updateTime()}ms</span>
                    </span>
                    <span>
                        <span style={{ color: '#888' }}>Worst: </span>
                        <span style={{ color: frameColor(worstFrame()) }}>{worstFrame()}ms</span>
                    </span>
                    <span>
                        <span style={{ color: '#888' }}>Avg: </span>
                        <span style={{ color: frameColor(avgFrame()) }}>{avgFrame()}ms</span>
                    </span>
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', gap: '10px', 'align-items': 'center' }}>
                    <select
                        value={variant()}
                        onChange={(e) => setVariant(e.target.value)}
                        style={{
                            padding: '6px 10px',
                            'border-radius': '4px',
                            border: '1px solid #444',
                            background: '#2d2d44',
                            color: '#fff',
                            cursor: 'pointer',
                        }}
                    >
                        <option value="minimal">V1: Minimal</option>
                        <option value="memo">V2: + Memos</option>
                        <option value="show">V3: + Show (suspected)</option>
                        <option value="css">V4: CSS Only (fix)</option>
                        <option value="manyMemos">V5: + Many Memos (20+)</option>
                        <option value="handlers">V6: + Event Handlers (8)</option>
                        <option value="fullDOM">V7: + Full DOM (8 elements)</option>
                        <option value="fullDOMOpt">V7b: Full DOM + CSS vars</option>
                        <option value="fullDOMNoText">V7c: Full DOM NO TEXT</option>
                        <option value="fullDOMOptText">V7d: Memo eval only (no render)</option>
                        <option value="noMemos">V7e: NO MEMOS (no text)</option>
                        <option value="singleMemo">V7f: SINGLE MEMO (no text)</option>
                        <option value="withText">V7g: WITH TEXT RENDER</option>
                        <option value="directTask">V7h: DIRECT TASK (no lookup)</option>
                        <option value="directTaskFull">V7i: + lock + id text</option>
                        <option value="minimalCSS">V7j: MINIMAL CSS (no contain/will-change)</option>
                        <option value="context">V8: + Context</option>
                        <option value="useDrag">V9: + useDrag Hook</option>
                        <option value="realStore">V10: Real Store Pattern</option>
                        <option value="combined">V11: COMBINED (all features)</option>
                    </select>

                    <button
                        onClick={startTest}
                        style={{
                            padding: '8px 16px',
                            'border-radius': '4px',
                            border: 'none',
                            background: running() ? '#ef4444' : '#3b82f6',
                            color: '#fff',
                            cursor: 'pointer',
                            'font-weight': 'bold',
                        }}
                    >
                        {running() ? 'Stop' : 'Start'}
                    </button>

                    <label style={{ display: 'flex', 'align-items': 'center', gap: '5px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={showArrows()}
                            onChange={(e) => setShowArrows(e.target.checked)}
                        />
                        <span style={{ color: '#aaa', 'font-size': '12px' }}>+ Arrows</span>
                    </label>

                    <label style={{ display: 'flex', 'align-items': 'center', gap: '5px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={realScrollMode()}
                            onChange={(e) => setRealScrollMode(e.target.checked)}
                        />
                        <span style={{ color: '#aaa', 'font-size': '12px' }}>Real Scroll</span>
                    </label>
                </div>
            </div>

            {/* Explanation */}
            <div style={{
                padding: '10px 15px',
                background: '#2d2d44',
                'border-radius': '6px',
                'margin-bottom': '15px',
                'font-size': '11px',
                color: '#aaa',
            }}>
                <strong style={{ color: '#fff' }}>Test variants (progressive complexity):</strong>
                <div style={{ display: 'flex', gap: '20px', 'margin-top': '5px' }}>
                    <ul style={{ margin: 0, 'padding-left': '15px' }}>
                        <li><strong>V1:</strong> Minimal div</li>
                        <li><strong>V2:</strong> + memos (2)</li>
                        <li><strong>V3:</strong> + Show (SLOW)</li>
                        <li><strong>V4:</strong> CSS display</li>
                    </ul>
                    <ul style={{ margin: 0, 'padding-left': '15px' }}>
                        <li><strong>V5:</strong> + 20 memos</li>
                        <li><strong>V6:</strong> + 8 handlers</li>
                        <li><strong>V7:</strong> + Full DOM</li>
                        <li><strong>V7e:</strong> NO memos</li>
                        <li><strong>V7f:</strong> Single memo</li>
                    </ul>
                    <ul style={{ margin: 0, 'padding-left': '15px' }}>
                        <li><strong>V9:</strong> + useDrag hook</li>
                        <li><strong>V10:</strong> Real store</li>
                        <li><strong style={{ color: '#f59e0b' }}>V11:</strong> ALL COMBINED</li>
                    </ul>
                </div>
            </div>

            {/* Bar container */}
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                style={{
                    flex: 1,
                    position: 'relative',
                    background: '#16162a',
                    'border-radius': '8px',
                    overflow: realScrollMode() ? 'auto' : 'hidden',
                }}
            >
                {/* Virtual scroll content height (for real scroll mode) */}
                {realScrollMode() && (
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '1px',
                        height: `${(allTaskIds.length / COLS) * (SLOT_HEIGHT + GAP)}px`,
                        'pointer-events': 'none',
                    }} />
                )}

                {/* Arrows layer (conditional) */}
                {showArrows() && <SimpleArrowLayer visibleTaskIds={visibleTaskIds()} />}

                {variant() === 'directTask' ? (
                    <Index each={visibleTasks()}>
                        {(task, slotIndex) => (
                            <TestBarDirectTask task={task} slotIndex={slotIndex} />
                        )}
                    </Index>
                ) : variant() === 'directTaskFull' ? (
                    <Index each={visibleTasks()}>
                        {(task, slotIndex) => (
                            <TestBarDirectTaskFull task={task} slotIndex={slotIndex} />
                        )}
                    </Index>
                ) : variant() === 'minimalCSS' ? (
                    <Index each={visibleTasks()}>
                        {(task, slotIndex) => (
                            <TestBarMinimalCSS task={task} slotIndex={slotIndex} />
                        )}
                    </Index>
                ) : (
                    <Index each={visibleTaskIds()}>
                        {(taskId, slotIndex) => (
                            <Dynamic
                                component={BAR_VARIANTS[variant()]}
                                taskId={taskId}
                                slotIndex={slotIndex}
                                tasks={tasks}
                            />
                        )}
                    </Index>
                )}
            </div>
        </div>
    );
}

render(() => (
    <TestEventsContext.Provider value={{
        onHover: (id, e) => { /* noop */ },
        onClick: (id, e) => { /* noop */ },
        onDragStart: null,
        onDragEnd: null,
        onResize: null,
    }}>
        <IndexTestDemo />
    </TestEventsContext.Provider>
), document.getElementById('app'));
