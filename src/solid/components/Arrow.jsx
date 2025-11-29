import { createMemo } from 'solid-js';

/**
 * Arrow Component - Decorative/Informative Only
 *
 * A pure visual renderer for dependency arrows between task bars.
 * Successor must be to the RIGHT of predecessor (no backward arrows).
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
    // Anchoring
    START_ANCHOR: 'auto',
    END_ANCHOR: 'auto',
    ANCHOR_OFFSET: 0.5,

    // Path shape
    ROUTING: 'orthogonal',
    CURVE_RADIUS: 5,

    // Line style
    STROKE: '#666',
    STROKE_WIDTH: 1.4,
    STROKE_OPACITY: 1,
    STROKE_LINECAP: 'round',
    STROKE_LINEJOIN: 'round',

    // Arrow head
    HEAD_SIZE: 5,
    HEAD_SHAPE: 'chevron',
    HEAD_FILL: false,

    // Thresholds
    ALIGNMENT_THRESHOLD: 8,  // pixels - threshold for "same level" detection
};

// ═══════════════════════════════════════════════════════════════════════════════
// ANCHOR POINT CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate the x,y coordinates of an anchor point on a bar.
 */
function getAnchorPoint(bar, anchor, offset = 0.5) {
    const t = Math.max(0, Math.min(1, offset));

    switch (anchor) {
        case 'top':
            return { x: bar.x + bar.width * t, y: bar.y };
        case 'bottom':
            return { x: bar.x + bar.width * t, y: bar.y + bar.height };
        case 'left':
            return { x: bar.x, y: bar.y + bar.height * t };
        case 'right':
            return { x: bar.x + bar.width, y: bar.y + bar.height * t };
        case 'center':
            return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
        default:
            return { x: bar.x + bar.width, y: bar.y + bar.height / 2 };
    }
}

/**
 * Check if tasks overlap horizontally (parallel tasks).
 * Overlap exists when successor starts before predecessor ends.
 */
function hasHorizontalOverlap(from, to) {
    const fromRightEdge = from.x + from.width;
    return to.x < fromRightEdge;
}

/**
 * Automatically select the best start anchor based on geometry.
 *
 * - TOP/BOTTOM: if target is above/below (or if tasks overlap horizontally)
 * - RIGHT: only if target is to the right AND vertically aligned
 */
function autoSelectStartAnchor(from, to) {
    const fromCenterY = from.y + from.height / 2;
    const toCenterY = to.y + to.height / 2;
    const dy = toCenterY - fromCenterY;

    // If tasks overlap horizontally, must exit from top/bottom
    if (hasHorizontalOverlap(from, to)) {
        return dy < 0 ? 'top' : 'bottom';
    }

    // Check if vertically aligned (within threshold)
    if (Math.abs(dy) <= DEFAULTS.ALIGNMENT_THRESHOLD) {
        return 'right';
    }

    // Target is above - exit from top
    if (dy < 0) {
        return 'top';
    }

    // Target is below - exit from bottom
    return 'bottom';
}

/**
 * Automatically select the best end anchor based on geometry.
 * Always returns 'left' - arrows always enter at the START of the successor task.
 */
function autoSelectEndAnchor(from, to) {
    return 'left';
}

/**
 * Calculate optimal offset for edge anchors based on target position.
 * Exit point must ALWAYS be to the LEFT of target's start.
 */
function calculateSmartOffset(from, to, anchor, curveRadius) {
    if (anchor === 'right') {
        return 0.5;  // Center of right edge
    }

    if (anchor === 'top' || anchor === 'bottom') {
        // Default: exit at 90% along bar (10% from right edge)
        const defaultOffset = 0.90;

        // But clamp to ensure exit is left of target's left edge
        const maxExitX = to.x - curveRadius;  // Leave room for curve
        const maxOffset = (maxExitX - from.x) / from.width;

        // Use default unless it would place exit past target
        return Math.max(0, Math.min(defaultOffset, maxOffset));
    }

    return 0.5;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARROW HEAD GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate arrow head pointing RIGHT (for horizontal entry from left)
 */
function generateArrowHeadRight(shape, size, fill) {
    if (size <= 0 || shape === 'none') {
        return '';
    }

    switch (shape) {
        case 'chevron':
            return `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}`;
        case 'triangle':
            if (fill) {
                return `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size} z`;
            }
            return `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}`;
        default:
            return `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}`;
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// PATH ROUTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a straight line path between two points.
 */
function straightPath(start, end, arrowHead) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y} ${arrowHead}`;
}

/**
 * Generate an orthogonal path with rounded corners.
 */
function orthogonalPath(start, end, startAnchor, endAnchor, curveRadius, arrowHead) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Same point - straight line
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return straightPath(start, end, arrowHead);
    }

    // Limit curve radius to available space
    let curve = Math.min(curveRadius, Math.abs(dx) / 2, Math.abs(dy) / 2);
    if (curve < 1) curve = 0;

    const isVerticalStart = startAnchor === 'top' || startAnchor === 'bottom';

    if (isVerticalStart) {
        return verticalFirstPath(start, end, curve, arrowHead);
    } else {
        return horizontalFirstPath(start, end, curve, arrowHead);
    }
}

/**
 * Path that starts vertical (from top/bottom), then turns horizontal.
 * Simple L-shape - always goes forward (right) since exit point is clamped.
 */
function verticalFirstPath(start, end, curve, arrowHead) {
    const dy = end.y - start.y;
    const goingUp = dy < 0;

    // Nearly aligned - straight line
    if (Math.abs(end.x - start.x) < curve) {
        return straightPath(start, end, arrowHead);
    }

    if (goingUp) {
        // Going UP then RIGHT
        return `
            M ${start.x} ${start.y}
            V ${end.y + curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
            H ${end.x}
            ${arrowHead}
        `.replace(/\s+/g, ' ').trim();
    } else {
        // Going DOWN then RIGHT
        return `
            M ${start.x} ${start.y}
            V ${end.y - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${end.x}
            ${arrowHead}
        `.replace(/\s+/g, ' ').trim();
    }
}

/**
 * Path that starts horizontal (from right edge), then curves to target.
 * S-curve shape for vertical offset.
 */
function horizontalFirstPath(start, end, curve, arrowHead) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const goingUp = dy < 0;

    // Nearly horizontal - straight line
    if (Math.abs(dy) < curve * 2) {
        return straightPath(start, end, arrowHead);
    }

    // S-curve: horizontal, curve, vertical, curve, horizontal
    const midX = start.x + dx / 2;

    if (goingUp) {
        return `
            M ${start.x} ${start.y}
            H ${midX - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${-curve}
            V ${end.y + curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
            H ${end.x}
            ${arrowHead}
        `.replace(/\s+/g, ' ').trim();
    } else {
        return `
            M ${start.x} ${start.y}
            H ${midX - curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${curve}
            V ${end.y - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${end.x}
            ${arrowHead}
        `.replace(/\s+/g, ' ').trim();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PATH GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

function generatePath(from, to, config) {
    const {
        startAnchor,
        startOffset,
        endAnchor,
        endOffset,
        routing,
        curveRadius,
        headSize,
        headShape,
        headFill,
    } = config;

    // Resolve auto anchors
    const resolvedStartAnchor = startAnchor === 'auto'
        ? autoSelectStartAnchor(from, to)
        : startAnchor;

    const resolvedEndAnchor = endAnchor === 'auto'
        ? autoSelectEndAnchor(from, to)
        : endAnchor;

    // Calculate smart offset for edge anchors if not explicitly set
    const resolvedStartOffset = startOffset !== undefined
        ? startOffset
        : calculateSmartOffset(from, to, resolvedStartAnchor, curveRadius);

    // Get anchor points
    const start = getAnchorPoint(from, resolvedStartAnchor, resolvedStartOffset);
    const end = getAnchorPoint(to, resolvedEndAnchor, endOffset);

    // Arrow always enters from left, so head always points right
    const arrowHead = generateArrowHeadRight(headShape, headSize, headFill);

    // Route the path
    if (routing === 'straight') {
        return straightPath(start, end, arrowHead);
    }
    return orthogonalPath(start, end, resolvedStartAnchor, resolvedEndAnchor, curveRadius, arrowHead);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOLIDJS COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Arrow Component
 *
 * A pure visual renderer for arrows between task bars.
 * Assumes successor is always to the right of predecessor.
 */
export function Arrow(props) {
    const fromPosition = createMemo(() => {
        if (props.from) return props.from;
        if (props.taskStore && props.fromId) {
            return props.taskStore.getBarPosition(props.fromId);
        }
        return null;
    });

    const toPosition = createMemo(() => {
        if (props.to) return props.to;
        if (props.taskStore && props.toId) {
            return props.taskStore.getBarPosition(props.toId);
        }
        return null;
    });

    const config = createMemo(() => ({
        startAnchor: props.startAnchor ?? DEFAULTS.START_ANCHOR,
        startOffset: props.startOffset,
        endAnchor: props.endAnchor ?? DEFAULTS.END_ANCHOR,
        endOffset: props.endOffset ?? DEFAULTS.ANCHOR_OFFSET,
        routing: props.routing ?? DEFAULTS.ROUTING,
        curveRadius: props.curveRadius ?? DEFAULTS.CURVE_RADIUS,
        headSize: props.headSize ?? DEFAULTS.HEAD_SIZE,
        headShape: props.headShape ?? DEFAULTS.HEAD_SHAPE,
        headFill: props.headFill ?? DEFAULTS.HEAD_FILL,
    }));

    const path = createMemo(() => {
        const from = fromPosition();
        const to = toPosition();

        if (!from || !to) return '';

        return generatePath(from, to, config());
    });

    return (
        <path
            d={path()}
            fill={props.headFill && props.headShape !== 'chevron' ? (props.stroke ?? DEFAULTS.STROKE) : 'none'}
            stroke={props.stroke ?? DEFAULTS.STROKE}
            stroke-width={props.strokeWidth ?? DEFAULTS.STROKE_WIDTH}
            stroke-opacity={props.strokeOpacity ?? DEFAULTS.STROKE_OPACITY}
            stroke-dasharray={props.strokeDasharray}
            stroke-linecap={props.strokeLinecap ?? DEFAULTS.STROKE_LINECAP}
            stroke-linejoin={props.strokeLinejoin ?? DEFAULTS.STROKE_LINEJOIN}
            data-arrow-id={props.id}
            data-from={props.fromId}
            data-to={props.toId}
            class={props.class}
        />
    );
}

export { getAnchorPoint, autoSelectStartAnchor, generateArrowHeadRight, DEFAULTS as ARROW_DEFAULTS };
