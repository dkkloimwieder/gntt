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
 */
import { createSignal, createMemo, type Accessor } from 'solid-js';
import type { TaskStore } from '../stores/taskStore';
import type { Relationship, GanttTask, BarPosition } from '../types';

export interface GanttModals {
    // Hover popup
    popupVisible: Accessor<boolean>;
    popupPosition: Accessor<{ x: number; y: number }>;
    hoveredTask: Accessor<GanttTask | null>;
    hoveredBarPosition: Accessor<BarPosition | null>;
    showHover: (taskId: string, clientX: number, clientY: number) => void;
    hideHover: () => void;

    // Click modal
    modalVisible: Accessor<boolean>;
    modalTask: Accessor<GanttTask | null>;
    modalBarPosition: Accessor<BarPosition | null>;
    modalRelationships: Accessor<Relationship[]>;
    showModal: (taskId: string) => void;
    hideModal: () => void;
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

    const hoveredTask = createMemo(() => {
        const id = hoveredTaskId();
        return (id ? taskStore.getTask(id) : null) as GanttTask | null;
    });

    const hoveredBarPosition = createMemo(() => {
        const id = hoveredTaskId();
        return (id ? taskStore.getBarPosition(id) : null) as BarPosition | null;
    });

    const modalTask = createMemo(() => {
        const id = modalTaskId();
        return (id ? taskStore.getTask(id) : null) as GanttTask | null;
    });

    const modalBarPosition = createMemo(() => {
        const id = modalTaskId();
        return (id ? taskStore.getBarPosition(id) : null) as BarPosition | null;
    });

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
