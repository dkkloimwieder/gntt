/**
 * Hover popup + click modal state for the Gantt component.
 *
 * Encapsulates the four signals (hovered task / popup position /
 * popup visible, modal task / modal visible) and the four computed
 * memos that derive task data + bar position from the active id.
 *
 * Returned API: state + memos for rendering, and the four imperative
 * handlers (showHover/hideHover/showModal/hideModal) the component
 * binds to its onHover/onHoverEnd/onTaskClick callbacks.
 *
 * PROXY HYGIENE (SolidJS 2.0): neither task memo hands out the task
 * store's sub-proxy. A memo whose value IS a store sub-proxy never
 * invalidates — the proxy's identity is stable across every leaf
 * mutation — so downstream consumers would have to track the leaves
 * themselves, and any read they make outside a tracking scope is a
 * `[STRICT_READ_UNTRACKED]` violation. The memos copy instead, which
 * moves the leaf tracking in here: the copy is rebuilt (and consumers
 * re-run) whenever a field of the active task changes.
 */
import { createSignal, createMemo, type Accessor } from 'solid-js';
import type { TaskStore } from '../stores/taskStore';
import type { Relationship, GanttTask, BarPosition } from '../types';

export interface GanttModals {
    // Hover popup
    popupVisible: Accessor<boolean>;
    popupPosition: Accessor<{ x: number; y: number }>;
    /**
     * Plain shallow copy of the hovered task, or null. Not the store's
     * proxy — mutating it writes nothing. `_bar` is carried over as the
     * store's own object, so read bar geometry from
     * {@link GanttModals.hoveredBarPosition}, never from `task._bar`.
     */
    hoveredTask: Accessor<GanttTask | null>;
    hoveredBarPosition: Accessor<BarPosition | null>;
    showHover: (taskId: string, clientX: number, clientY: number) => void;
    hideHover: () => void;

    // Click modal
    modalVisible: Accessor<boolean>;
    /**
     * Plain shallow copy of the clicked task, or null. Same contract as
     * {@link GanttModals.hoveredTask}.
     */
    modalTask: Accessor<GanttTask | null>;
    modalBarPosition: Accessor<BarPosition | null>;
    modalRelationships: Accessor<Relationship[]>;
    showModal: (taskId: string) => void;
    hideModal: () => void;
}

/**
 * Geometry equality for the two bar-position memos.
 *
 * `taskStore.getBarPosition` builds a FRESH object on every read, so under
 * the default reference equality the memos would notify every consumer on
 * every recompute — including recomputes triggered by a leaf the popup does
 * not render (`_index`). Comparing the four rendered leaves keeps the memo
 * value stable, which is also what stops a consumer from ever seeing a
 * position object it has already formatted. Two nulls compare equal
 * (`undefined === undefined` four times over).
 */
function sameBarPosition(
    a: BarPosition | null,
    b: BarPosition | null,
): boolean {
    return (
        a?.x === b?.x &&
        a?.y === b?.y &&
        a?.width === b?.width &&
        a?.height === b?.height
    );
}

/**
 * Shallow PLAIN copy of a task, taken inside a tracking scope.
 *
 * The spread reads every own enumerable field off the store proxy, so the
 * enclosing memo subscribes to all of them and rebuilds the copy when any
 * one changes. `snapshot()` is deliberately NOT used here: it is untracked,
 * so the memo would compute once and hand the popup a frozen task that
 * never reflects a later edit.
 */
function copyTask(task: ReturnType<TaskStore['getTask']>): GanttTask | null {
    if (!task) return null;
    // `_bar` is the leaf that drags mutate; copy it so the published object
    // is not a live sub-proxy of the store.
    return {
        ...task,
        _bar: task._bar ? { ...task._bar } : task._bar,
    } as GanttTask;
}

export function useGanttModals(
    taskStore: TaskStore,
    relationships: Accessor<Relationship[]>,
): GanttModals {
    const [hoveredTaskId, setHoveredTaskId] = createSignal<string | null>(null);
    const [popupPosition, setPopupPosition] = createSignal({ x: 0, y: 0 });
    const [popupVisible, setPopupVisible] = createSignal(false);

    const [modalTaskId, setModalTaskId] = createSignal<string | null>(null);
    const [modalVisible, setModalVisible] = createSignal(false);

    const hoveredTask = createMemo<GanttTask | null>(() => {
        const id = hoveredTaskId();
        return id ? copyTask(taskStore.getTask(id)) : null;
    });

    const hoveredBarPosition = createMemo<BarPosition | null>(
        () => {
            const id = hoveredTaskId();
            return id ? taskStore.getBarPosition(id) : null;
        },
        { equals: sameBarPosition },
    );

    const modalTask = createMemo<GanttTask | null>(() => {
        const id = modalTaskId();
        return id ? copyTask(taskStore.getTask(id)) : null;
    });

    const modalBarPosition = createMemo<BarPosition | null>(
        () => {
            const id = modalTaskId();
            return id ? taskStore.getBarPosition(id) : null;
        },
        { equals: sameBarPosition },
    );

    const modalRelationships = createMemo(() => {
        const id = modalTaskId();
        if (!id) return [];
        return relationships().filter((r) => r.from === id || r.to === id);
    });

    return {
        popupVisible,
        popupPosition,
        hoveredTask,
        hoveredBarPosition,
        showHover: (taskId, clientX, clientY) => {
            setHoveredTaskId(taskId);
            setPopupPosition({ x: clientX, y: clientY });
            setPopupVisible(true);
        },
        hideHover: () => {
            setPopupVisible(false);
            setHoveredTaskId(null);
        },

        modalVisible,
        modalTask,
        modalBarPosition,
        modalRelationships,
        showModal: (taskId) => {
            setModalTaskId(taskId);
            setModalVisible(true);
        },
        hideModal: () => {
            setModalVisible(false);
            setModalTaskId(null);
        },
    };
}
