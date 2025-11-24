import { createMemo } from 'solid-js';

/**
 * Arrow component for rendering dependency arrows between tasks.
 * Properly handles directional curves for all task relationships.
 */

/**
 * Calculate anchor point on a bar
 * @param {Object} bar - Bar position {x, y, width, height}
 * @param {string} anchor - Anchor type
 * @param {number} offset - Optional offset ratio (0-1) for top/bottom anchors
 */
function getAnchorPoint(bar, anchor, offset = 0.5) {
    switch (anchor) {
        case 'center-right':
            return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
        case 'right-top':
            return { x: bar.x + bar.width, y: bar.y };
        case 'right-center':
            return { x: bar.x + bar.width, y: bar.y + bar.height / 2 };
        case 'right-bottom':
            return { x: bar.x + bar.width, y: bar.y + bar.height };
        case 'left-center':
            return { x: bar.x, y: bar.y + bar.height / 2 };
        case 'left-top':
            return { x: bar.x, y: bar.y };
        case 'left-bottom':
            return { x: bar.x, y: bar.y + bar.height };
        case 'center':
            return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
        case 'top-edge':
            // Position along top edge: offset 0 = left, 0.5 = center, 1 = right
            return { x: bar.x + bar.width * offset, y: bar.y };
        case 'bottom-edge':
            // Position along bottom edge: offset 0 = left, 0.5 = center, 1 = right
            return { x: bar.x + bar.width * offset, y: bar.y + bar.height };
        default:
            return { x: bar.x + bar.width, y: bar.y + bar.height / 2 };
    }
}

/**
 * Generate arrow path with proper directional awareness
 */
function generateArrowPath(start, end, config, startAnchor) {
    const {
        curveRadius = 5,
        horizontalGap = 10,
        arrowSize = 5
    } = config;

    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Key: determine vertical relationship for proper curve direction
    const from_is_below_to = start.y > end.y;

    // Dynamic clockwise flag based on vertical relationship
    const clockwise = from_is_below_to ? 1 : 0;

    // Dynamic curve_y: negative when source is below target, positive otherwise
    let curve_y = from_is_below_to ? -curveRadius : curveRadius;

    const isForward = dx > horizontalGap;

    // Arrow head
    const arrowHead = `m -${arrowSize} -${arrowSize} l ${arrowSize} ${arrowSize} l -${arrowSize} ${arrowSize}`;

    // Check if starting from top or bottom edge
    const startsFromEdge = startAnchor === 'top-edge' || startAnchor === 'bottom-edge';

    if (isForward) {
        return generateForwardArrow(start, end, curveRadius, clockwise, arrowHead, startsFromEdge);
    } else {
        return generateBackwardArrow(start, end, curveRadius, curve_y, clockwise, horizontalGap, arrowHead);
    }
}

/**
 * Forward arrow: L-shape with directionally-aware rounded corners
 * Can start either horizontal-first or vertical-first depending on anchor
 */
function generateForwardArrow(start, end, curveRadius, clockwise, arrowHead, startsFromEdge = false) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Same level - straight line
    if (Math.abs(dy) < 1) {
        return `M ${start.x} ${start.y} L ${end.x} ${end.y} ${arrowHead}`;
    }

    // Limit curve to available space
    let curve = Math.min(curveRadius, Math.abs(dx) / 2, Math.abs(dy) / 2);

    // Adjust if not enough horizontal space
    if (end.x < start.x + curve) {
        curve = end.x - start.x;
    }

    // Calculate midpoint for the corner
    const midX = start.x + (end.x - start.x) / 2;
    const midY = start.y + (end.y - start.y) / 2;

    if (startsFromEdge) {
        // VERTICAL FIRST (for top/bottom edge starts)
        // Simple L-shape: Vertical → Curve → Horizontal to target

        // Going UP (start below end, exiting from top edge)
        if (dy < 0) {
            return `
                M ${start.x} ${start.y}
                V ${end.y + curve}
                a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
                H ${end.x}
                ${arrowHead}
            `.trim().replace(/\s+/g, ' ');
        }

        // Going DOWN (start above end, exiting from bottom edge)
        return `
            M ${start.x} ${start.y}
            V ${end.y - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${end.x}
            ${arrowHead}
        `.trim().replace(/\s+/g, ' ');
    } else {
        // HORIZONTAL FIRST (for right-center starts)
        // Going UP (start below end)
        if (dy < 0) {
            return `
                M ${start.x} ${start.y}
                H ${midX - curve}
                a ${curve} ${curve} 0 0 0 ${curve} ${-curve}
                V ${end.y + curve}
                a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
                H ${end.x}
                ${arrowHead}
            `.trim().replace(/\s+/g, ' ');
        }

        // Going DOWN (start above end)
        return `
            M ${start.x} ${start.y}
            H ${midX - curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${curve}
            V ${end.y - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${end.x}
            ${arrowHead}
        `.trim().replace(/\s+/g, ' ');
    }
}

/**
 * Backward arrow: U-shape with directionally-aware corners
 * Replicates vanilla JS logic with dynamic clockwise and curve_y
 */
function generateBackwardArrow(start, end, curveRadius, curve_y, clockwise, horizontalGap, arrowHead) {
    const dy = end.y - start.y;

    // Adaptive curve radius
    let curve = Math.min(curveRadius, horizontalGap / 2);

    // Calculate initial down distance
    let down_1 = horizontalGap / 2 - curve;
    if (down_1 < 0) {
        down_1 = 0;
        curve = horizontalGap / 2;
        // Recalculate curve_y with adjusted curve
        curve_y = (start.y > end.y) ? -curve : curve;
    }

    // Calculate the y-coordinate to reach before final approach
    const down_2 = end.y + (end.height || 0) / 2 - curve_y;

    // Left extent of the backward loop
    const left = end.x - horizontalGap;

    return `
        M ${start.x} ${start.y}
        v ${down_1}
        a ${curve} ${curve} 0 0 1 ${-curve} ${curve}
        H ${left}
        a ${curve} ${curve} 0 0 ${clockwise} ${-curve} ${curve_y}
        V ${down_2}
        a ${curve} ${curve} 0 0 ${clockwise} ${curve} ${curve_y}
        L ${end.x} ${end.y}
        ${arrowHead}
    `.trim().replace(/\s+/g, ' ');
}

/**
 * SolidJS Arrow Component
 */
export function Arrow(props) {
    const fromPosition = createMemo(() => props.taskStore.getBarPosition(props.fromTaskId));
    const toPosition = createMemo(() => props.taskStore.getBarPosition(props.toTaskId));

    const config = createMemo(() => ({
        startAnchor: props.startAnchor || 'auto',
        endAnchor: props.endAnchor || 'left-center',
        startAnchorOffset: props.startAnchorOffset ?? 0.5, // 0-1 position along edge
        curveRadius: props.curveRadius ?? 5,
        horizontalGap: props.horizontalGap ?? 10,
        arrowSize: props.arrowSize ?? 5
    }));

    const path = createMemo(() => {
        const from = fromPosition();
        const to = toPosition();

        if (!from || !to) return '';

        const cfg = config();

        // Auto-select start anchor based on arrow direction
        let startAnchor = cfg.startAnchor;
        if (startAnchor === 'auto') {
            const dy = to.y - from.y;
            if (Math.abs(dy) < 1) {
                // Same level - use right center
                startAnchor = 'right-center';
            } else if (dy < 0) {
                // Going UP - use top edge
                startAnchor = 'top-edge';
            } else {
                // Going DOWN - use bottom edge
                startAnchor = 'bottom-edge';
            }
        }

        const start = getAnchorPoint(from, startAnchor, cfg.startAnchorOffset);
        const end = getAnchorPoint(to, cfg.endAnchor);

        return generateArrowPath(start, end, cfg, startAnchor);
    });

    return (
        <path
            d={path()}
            data-from={props.fromTaskId}
            data-to={props.toTaskId}
            fill="transparent"
            stroke={props.stroke || '#666'}
            stroke-width={props.strokeWidth || 1.4}
        />
    );
}
