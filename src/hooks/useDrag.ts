import { createSignal, onCleanup, Accessor } from 'solid-js';

type DragState = 'idle' | 'dragging_bar' | 'dragging_left' | 'dragging_right' | 'dragging_progress';

interface DragMove {
    clientX: number;
    clientY: number;
    svgX: number;
    svgY: number;
    deltaX: number;
    deltaY: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
}

interface DragData {
    svg?: SVGSVGElement | null;
    startClientX: number;
    startClientY: number;
    startSvgX: number;
    startSvgY: number;
    [key: string]: unknown;
}

interface UseDragOptions {
    onDragStart?: (data: DragData, state: DragState) => void;
    onDragMove?: (move: DragMove, data: DragData, state: DragState) => void;
    onDragEnd?: (move: DragMove, data: DragData, state: DragState) => void;
    getSvgPoint?: (clientX: number, clientY: number) => { x: number; y: number };
}

interface UseDragResult {
    dragState: Accessor<DragState>;
    isDragging: Accessor<boolean>;
    startDrag: (e: MouseEvent, state: DragState, data?: Record<string, unknown>) => void;
    createDragHandler: (state: DragState, dataOrGetter?: Record<string, unknown> | ((e: MouseEvent) => Record<string, unknown>)) => (e: MouseEvent) => void;
    toSvgCoords: (clientX: number, clientY: number, svg?: SVGSVGElement | null) => { x: number; y: number };
}

/**
 * Drag state machine with RAF-based updates for 60fps performance.
 */
export function useDrag(options: UseDragOptions = {}): UseDragResult {
    const { onDragStart, onDragMove, onDragEnd, getSvgPoint } = options;

    // Drag state
    const [dragState, setDragState] = createSignal<DragState>('idle');
    const [isDragging, setIsDragging] = createSignal(false);

    // Internal state (not reactive - for performance)
    let rafId: number | null = null;
    let pendingMove: DragMove | null = null;
    let dragData: DragData | null = null;

    // RAF loop for 60fps updates
    const rafLoop = (): void => {
        if (pendingMove && dragData && dragState() !== 'idle') {
            onDragMove?.(pendingMove, dragData, dragState());
            pendingMove = null;
        }

        if (dragState() !== 'idle') {
            rafId = requestAnimationFrame(rafLoop);
        }
    };

    // Start RAF loop
    const startRaf = (): void => {
        if (rafId === null) {
            rafId = requestAnimationFrame(rafLoop);
        }
    };

    // Stop RAF loop
    const stopRaf = (): void => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    };

    // Convert client coordinates to SVG coordinates
    const toSvgCoords = (clientX: number, clientY: number, svg?: SVGSVGElement | null): { x: number; y: number } => {
        if (getSvgPoint) {
            return getSvgPoint(clientX, clientY);
        }

        // Default implementation
        if (!svg) return { x: clientX, y: clientY };

        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;

        const ctm = svg.getScreenCTM();
        if (!ctm) return { x: clientX, y: clientY };

        const svgP = pt.matrixTransform(ctm.inverse());
        return { x: svgP.x, y: svgP.y };
    };

    // Global mouse move handler
    const handleMouseMove = (e: MouseEvent): void => {
        if (dragState() === 'idle' || !dragData) return;

        const svg = dragData.svg;
        const svgCoords = toSvgCoords(e.clientX, e.clientY, svg);

        pendingMove = {
            clientX: e.clientX,
            clientY: e.clientY,
            svgX: svgCoords.x,
            svgY: svgCoords.y,
            deltaX: svgCoords.x - dragData.startSvgX,
            deltaY: svgCoords.y - dragData.startSvgY,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
        };

        // Start RAF if not running
        if (rafId === null) {
            startRaf();
        }
    };

    // Global mouse up handler
    const handleMouseUp = (e: MouseEvent): void => {
        if (dragState() === 'idle' || !dragData) return;

        stopRaf();

        // Process any pending move one last time
        if (pendingMove) {
            onDragMove?.(pendingMove, dragData, dragState());
            pendingMove = null;
        }

        const svg = dragData.svg;
        const svgCoords = toSvgCoords(e.clientX, e.clientY, svg);

        const finalMove: DragMove = {
            clientX: e.clientX,
            clientY: e.clientY,
            svgX: svgCoords.x,
            svgY: svgCoords.y,
            deltaX: svgCoords.x - dragData.startSvgX,
            deltaY: svgCoords.y - dragData.startSvgY,
        };

        onDragEnd?.(finalMove, dragData, dragState());

        // Cleanup
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        setDragState('idle');
        setIsDragging(false);
        dragData = null;
    };

    /**
     * Start a drag operation.
     */
    const startDrag = (e: MouseEvent, state: DragState, data: Record<string, unknown> = {}): void => {
        if (dragState() !== 'idle') {
            return;
        }

        const target = e.currentTarget as Element | null;
        const svg = target?.ownerDocument?.querySelector('svg.gantt') as SVGSVGElement | null
            || (target as SVGElement)?.ownerSVGElement
            || (e.target as SVGElement)?.ownerSVGElement;
        const svgCoords = toSvgCoords(e.clientX, e.clientY, svg);

        dragData = {
            ...data,
            svg,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startSvgX: svgCoords.x,
            startSvgY: svgCoords.y,
        };

        setDragState(state);
        setIsDragging(true);

        onDragStart?.(dragData, state);

        // Add global listeners
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        e.preventDefault();
        e.stopPropagation();
    };

    /**
     * Create mousedown handler for a specific drag type.
     */
    const createDragHandler = (
        state: DragState,
        dataOrGetter: Record<string, unknown> | ((e: MouseEvent) => Record<string, unknown>) = {}
    ): ((e: MouseEvent) => void) => {
        return (e: MouseEvent) => {
            const data = typeof dataOrGetter === 'function'
                ? dataOrGetter(e)
                : dataOrGetter;
            startDrag(e, state, data);
        };
    };

    // Cleanup on unmount
    onCleanup(() => {
        stopRaf();
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    });

    return {
        // State (reactive)
        dragState,
        isDragging,

        // Methods
        startDrag,
        createDragHandler,

        // Utilities
        toSvgCoords,
    };
}

/**
 * Helper: Clamp value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Helper: Check if mouse moved enough to start drag.
 */
export function movedEnough(startX: number, startY: number, currentX: number, currentY: number, threshold = 3): boolean {
    const dx = Math.abs(currentX - startX);
    const dy = Math.abs(currentY - startY);
    return dx > threshold || dy > threshold;
}

export type { DragState, DragMove, DragData, UseDragOptions, UseDragResult };
