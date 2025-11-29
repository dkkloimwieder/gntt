import { createSignal, onCleanup } from 'solid-js';

/**
 * Drag state machine with RAF-based updates for 60fps performance.
 *
 * States:
 * - 'idle': No drag in progress
 * - 'dragging_bar': Dragging the entire bar
 * - 'dragging_left': Resizing from left handle
 * - 'dragging_right': Resizing from right handle
 * - 'dragging_progress': Dragging progress handle
 *
 * @param {Object} options
 * @param {Function} options.onDragStart - Called when drag starts
 * @param {Function} options.onDragMove - Called on each RAF frame during drag
 * @param {Function} options.onDragEnd - Called when drag ends
 * @param {Function} options.getSvgPoint - Function to convert client coords to SVG coords
 * @returns {Object} Drag state and handlers
 */
export function useDrag(options = {}) {
    const {
        onDragStart,
        onDragMove,
        onDragEnd,
        getSvgPoint,
    } = options;

    // Drag state
    const [dragState, setDragState] = createSignal('idle');
    const [isDragging, setIsDragging] = createSignal(false);

    // Internal state (not reactive - for performance)
    let rafId = null;
    let pendingMove = null;
    let dragData = null;

    // RAF loop for 60fps updates
    const rafLoop = () => {
        if (pendingMove && dragState() !== 'idle') {
            onDragMove?.(pendingMove, dragData, dragState());
            pendingMove = null;
        }

        if (dragState() !== 'idle') {
            rafId = requestAnimationFrame(rafLoop);
        }
    };

    // Start RAF loop
    const startRaf = () => {
        if (rafId === null) {
            rafId = requestAnimationFrame(rafLoop);
        }
    };

    // Stop RAF loop
    const stopRaf = () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    };

    // Convert client coordinates to SVG coordinates
    const toSvgCoords = (clientX, clientY, svg) => {
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
    const handleMouseMove = (e) => {
        if (dragState() === 'idle') return;

        const svg = dragData?.svg;
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
    const handleMouseUp = (e) => {
        if (dragState() === 'idle') return;

        stopRaf();

        // Process any pending move one last time
        if (pendingMove) {
            onDragMove?.(pendingMove, dragData, dragState());
            pendingMove = null;
        }

        const svg = dragData?.svg;
        const svgCoords = toSvgCoords(e.clientX, e.clientY, svg);

        const finalMove = {
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
     * Call this from mousedown handler.
     *
     * @param {MouseEvent} e - The mousedown event
     * @param {string} state - Drag state ('dragging_bar', 'dragging_left', etc.)
     * @param {Object} data - Additional data to pass to callbacks
     */
    const startDrag = (e, state, data = {}) => {
        if (dragState() !== 'idle') return;

        const svg = e.currentTarget?.ownerSVGElement || e.target?.ownerSVGElement;
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
     *
     * @param {string} state - Drag state
     * @param {Object|Function} dataOrGetter - Static data or function returning data
     * @returns {Function} Event handler
     */
    const createDragHandler = (state, dataOrGetter = {}) => {
        return (e) => {
            const data = typeof dataOrGetter === 'function' ? dataOrGetter(e) : dataOrGetter;
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
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Helper: Check if mouse moved enough to start drag (prevents accidental clicks).
 */
export function movedEnough(startX, startY, currentX, currentY, threshold = 3) {
    const dx = Math.abs(currentX - startX);
    const dy = Math.abs(currentY - startY);
    return dx > threshold || dy > threshold;
}
