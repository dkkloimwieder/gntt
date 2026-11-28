/**
 * Box-select interaction — pointer-down on empty grid space draws a
 * translucent rectangle, on pointer-up the rect's intersection with bar
 * geometry replaces (or extends, when shift/ctrl held) the selection.
 *
 * Coordinate system: chart-content space (same as `_bar.x/_bar.y`). The
 * task-layer fills `gantt-content`, so `clientX - rect.left` already
 * accounts for horizontal scroll (rect.left becomes negative as the user
 * scrolls).
 *
 * Coexists with bar drag because the bar mousedown handler calls
 * `e.stopPropagation()` (see `useDrag.startDrag`); only empty-space
 * mousedowns reach the task-layer's listener.
 */
import { createSignal, onCleanup, Accessor } from 'solid-js';
import type { TaskStore } from '../stores/taskStore';
import type { SelectionStore } from '../stores/selectionStore';
import type { ProcessedTask } from '../types';

export interface BoxOverlay {
    visible: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface UseBoxSelectDeps {
    taskStore?: TaskStore;
    selectionStore?: SelectionStore;
    includeTask?: (task: ProcessedTask) => boolean;
    /** Returns the task-layer DOM node — used to translate client → content coords. */
    getLayerEl: () => HTMLElement | undefined;
}

export interface UseBoxSelectResult {
    /** Attach to the task-layer mousedown. Bars stop propagation, so this only fires on empty space. */
    handleMouseDown: (e: MouseEvent) => void;
    /** Reactive overlay rect (chart-content coordinates); render iff visible. */
    overlay: Accessor<BoxOverlay>;
}

const DRAG_THRESHOLD_PX = 5;

const HIDDEN: BoxOverlay = {
    visible: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
};

/** Axis-aligned rectangle in chart-content space. */
export interface BoxRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Pure: collect ids of visible tasks whose `_bar` rect intersects the
 * given box. Hidden tasks (`_isHidden`) and tasks with no `_bar` are
 * skipped. Exposed for unit tests; the hook calls this on mouseup.
 */
export function findBoxHits(
    box: BoxRect,
    tasks: Record<string, ProcessedTask | undefined>,
    includeTask?: (task: ProcessedTask) => boolean,
): string[] {
    const hits: string[] = [];
    const x1 = box.x;
    const y1 = box.y;
    const x2 = box.x + box.width;
    const y2 = box.y + box.height;
    for (const id of Object.keys(tasks)) {
        const t = tasks[id];
        if (!t || t._isHidden) continue;
        const bar = t._bar;
        if (!bar) continue;
        const bx1 = bar.x;
        const by1 = bar.y;
        const bx2 = bar.x + bar.width;
        const by2 = bar.y + bar.height;
        if (
            x1 < bx2 &&
            x2 > bx1 &&
            y1 < by2 &&
            y2 > by1 &&
            (includeTask?.(t) ?? true)
        ) {
            hits.push(id);
        }
    }
    return hits;
}

export function useBoxSelect(deps: UseBoxSelectDeps): UseBoxSelectResult {
    const [overlay, setOverlay] = createSignal<BoxOverlay>(HIDDEN);

    // Non-reactive gesture state — updated 60fps from mousemove
    let active = false;
    let startX = 0;
    let startY = 0;
    let startShift = false;
    let startCtrl = false;
    let passedThreshold = false;

    const layerCoords = (e: MouseEvent): { x: number; y: number } | null => {
        const el = deps.getLayerEl();
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const boxAt = (pt: { x: number; y: number }): BoxRect => ({
        x: Math.min(startX, pt.x),
        y: Math.min(startY, pt.y),
        width: Math.abs(pt.x - startX),
        height: Math.abs(pt.y - startY),
    });

    const exceedsThreshold = (box: BoxRect): boolean =>
        box.width > DRAG_THRESHOLD_PX || box.height > DRAG_THRESHOLD_PX;

    const handleMouseMove = (e: MouseEvent): void => {
        if (!active) return;
        const pt = layerCoords(e);
        if (!pt) return;

        const box = boxAt(pt);
        if (!passedThreshold && !exceedsThreshold(box)) return;
        passedThreshold = true;
        setOverlay({ visible: true, ...box });
    };

    const handleMouseUp = (e: MouseEvent): void => {
        if (!active) return;
        active = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        setOverlay(HIDDEN);

        const sel = deps.selectionStore;
        const store = deps.taskStore;
        const pt = layerCoords(e);
        if (!sel || !store || !pt) return;

        // Scrolling can change the layer's origin between move and release.
        const current = boxAt(pt);
        // Click-not-drag: clear selection. Honor shift/ctrl as "no-op"
        // so a user mid-modifier-clicking doesn't lose state by jitter.
        if (!passedThreshold && !exceedsThreshold(current)) {
            if (!startShift && !startCtrl) sel.clear();
            return;
        }

        const hits = findBoxHits(current, store.tasks, deps.includeTask);

        if (startShift || startCtrl) {
            for (const id of hits) sel.add(id);
        } else {
            sel.replace(hits);
        }
    };

    const handleMouseDown = (e: MouseEvent): void => {
        // Only react to primary button on empty space. Bars stopPropagation
        // before this fires; modal/popup elements live in a sibling layer.
        if (e.button !== 0) return;
        const pt = layerCoords(e);
        if (!pt) return;

        active = true;
        startX = pt.x;
        startY = pt.y;
        startShift = e.shiftKey;
        startCtrl = e.ctrlKey || e.metaKey;
        passedThreshold = false;
        setOverlay(HIDDEN);

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Don't preventDefault — we still want the user to e.g. focus the
        // chart. But stop bubbling so an outer container can't also react.
        e.stopPropagation();
    };

    onCleanup(() => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    });

    return { handleMouseDown, overlay };
}
