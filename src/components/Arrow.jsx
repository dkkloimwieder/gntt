// Note: createMemo was attempted for optimization but created reactive cascades
// that hurt scroll performance. Plain functions work better here.

import { prof } from '../perf/profiler.js';

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
    ALIGNMENT_THRESHOLD: 8, // pixels - threshold for "same level" detection
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
 * Automatically select the best start anchor based on geometry and dependency type.
 *
 * Gantt chart convention:
 * - Different rows: Exit from BOTTOM (going down) or TOP (going up)
 * - Same row: Exit from side (RIGHT for FS/FF, LEFT for SS/SF)
 */
function autoSelectStartAnchor(from, to, dependencyType = 'FS') {
    const fromCenterY = from.y + from.height / 2;
    const toCenterY = to.y + to.height / 2;
    const dy = toCenterY - fromCenterY;

    // Check if on same row (within threshold)
    const sameRow = Math.abs(dy) <= DEFAULTS.ALIGNMENT_THRESHOLD;

    // SS and SF dependencies exit from the START of the predecessor
    if (dependencyType === 'SS' || dependencyType === 'SF') {
        if (sameRow) {
            return 'left';
        }
        // Different rows: exit from top/bottom
        return dy < 0 ? 'top' : 'bottom';
    }

    // FS and FF dependencies exit from the END of the predecessor
    if (sameRow) {
        return 'right';
    }
    // Different rows: exit from top/bottom
    return dy < 0 ? 'top' : 'bottom';
}

/**
 * Automatically select the best end anchor based on dependency type and geometry.
 *
 * Entry point is determined by what the dependency constrains:
 * - -Start dependencies (FS, SS): enter from LEFT (the start of the task)
 * - -Finish dependencies (FF, SF): enter from RIGHT for same row, TOP for different rows
 */
function autoSelectEndAnchor(from, to, dependencyType = 'FS') {
    const fromCenterY = from.y + from.height / 2;
    const toCenterY = to.y + to.height / 2;
    const dy = toCenterY - fromCenterY;
    const sameRow = Math.abs(dy) <= DEFAULTS.ALIGNMENT_THRESHOLD;

    if (dependencyType === 'FF' || dependencyType === 'SF') {
        // For finish-based dependencies on same row, enter from right
        // For different rows, enter from top (cleaner routing)
        return sameRow ? 'right' : 'top';
    }
    // -Start dependencies always enter from left
    return 'left';
}

/**
 * Calculate optimal offset for edge anchors based on target position.
 * Exit point positioning depends on dependency type:
 * - FS/FF: Exit near the END (right) of the predecessor
 * - SS/SF: Exit near the START (left) of the predecessor
 */
function calculateSmartOffset(
    from,
    to,
    anchor,
    curveRadius,
    dependencyType = 'FS',
) {
    if (anchor === 'right') {
        return 0.5; // Center of right edge
    }

    if (anchor === 'left') {
        return 0.5; // Center of left edge
    }

    if (anchor === 'top' || anchor === 'bottom') {
        // SS/SF: Exit near the START (left) of the predecessor
        if (dependencyType === 'SS' || dependencyType === 'SF') {
            return 0.1; // Exit near left edge for start-based dependencies
        }

        // FS/FF: Exit near the END (right) of the predecessor
        const defaultOffset = 0.9;

        // Clamp to ensure exit is left of target's left edge
        const maxExitX = to.x - curveRadius;
        const maxOffset = (maxExitX - from.x) / from.width;

        return Math.max(0.1, Math.min(defaultOffset, maxOffset));
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
            // Open chevron pointing right: < shape
            return `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}`;
        case 'triangle':
            // Triangle pointing right - draw all sides explicitly (no z to avoid closing to path start)
            return (
                `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}` +
                (fill ? ` l 0 ${-size * 2}` : '')
            );
        case 'diamond':
            // Diamond shape - tip at current position, extends back
            // Draw all 4 sides explicitly to avoid z closing to wrong point
            return `m ${-size * 2} 0 l ${size} ${-size} l ${size} ${size} l ${-size} ${size} l ${-size} ${-size}`;
        case 'circle':
            // Circle at the end point - draw as a complete circle without z
            const r = size * 0.7;
            const k = 0.5523;
            // Move to start of circle, draw 4 bezier curves
            return (
                `m ${-r * 2} 0 ` +
                `c 0 ${-r * k} ${r * (1 - k)} ${-r} ${r} ${-r} ` +
                `c ${r * k} 0 ${r} ${r * (1 - k)} ${r} ${r} ` +
                `c 0 ${r * k} ${-r * (1 - k)} ${r} ${-r} ${r} ` +
                `c ${-r * k} 0 ${-r} ${-r * (1 - k)} ${-r} ${-r}`
            );
        default:
            return `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATH ROUTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a straight line path between two points.
 * Returns just the line path (no arrow head).
 */
function straightPath(start, end) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/**
 * Generate an orthogonal path with rounded corners.
 * Returns just the line path (no arrow head).
 */
function orthogonalPath(start, end, startAnchor, endAnchor, curveRadius) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Same point - straight line
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return straightPath(start, end);
    }

    // Same level (horizontal) - straight line
    // Use fixed threshold (not dependent on curve radius)
    if (Math.abs(dy) < 2) {
        return straightPath(start, end);
    }

    // Limit curve radius to available space
    let curve = Math.min(curveRadius, Math.abs(dx) / 2, Math.abs(dy) / 2);
    if (curve < 1) curve = 0;

    const isVerticalStart = startAnchor === 'top' || startAnchor === 'bottom';
    const isVerticalEnd = endAnchor === 'top' || endAnchor === 'bottom';
    const isHorizontalEnd = endAnchor === 'left' || endAnchor === 'right';

    // Vertical start to vertical end (bottom-to-top or top-to-bottom)
    if (isVerticalStart && isVerticalEnd) {
        return verticalToVerticalPath(start, end, curve);
    }

    // Vertical start to horizontal end (bottom exit to left/right entry)
    if (isVerticalStart && isHorizontalEnd) {
        return verticalToHorizontalPath(
            start,
            end,
            startAnchor,
            endAnchor,
            curve,
        );
    }

    if (isVerticalStart) {
        return verticalFirstPath(start, end, curve);
    } else {
        return horizontalFirstPath(start, end, curve);
    }
}

/**
 * Path from vertical exit to vertical entry (bottom-to-top is most common in Gantt).
 * Goes: down, horizontal, down to target.
 * Returns just the line path (no arrow head).
 */
function verticalToVerticalPath(start, end, curve) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Nearly vertically aligned - straight line
    if (Math.abs(dx) < curve * 2) {
        return straightPath(start, end);
    }

    // Calculate midpoint Y for the horizontal segment
    const midY = start.y + dy / 2;

    if (dy > 0) {
        // Going DOWN: exit bottom, enter top
        // Path: down to midY, curve to horizontal, horizontal, curve to down, down to end
        // Sweep flag: 0 = counter-clockwise, 1 = clockwise
        // When going RIGHT (dx > 0): first curve is CCW (0), second is CW (1)
        // When going LEFT (dx < 0): first curve is CW (1), second is CCW (0)
        const firstSweep = dx > 0 ? '0' : '1';
        const secondSweep = dx > 0 ? '1' : '0';
        const curveX = dx > 0 ? curve : -curve;

        return `
            M ${start.x} ${start.y}
            V ${midY - curve}
            a ${curve} ${curve} 0 0 ${firstSweep} ${curveX} ${curve}
            H ${end.x - curveX}
            a ${curve} ${curve} 0 0 ${secondSweep} ${curveX} ${curve}
            V ${end.y}
        `
            .replace(/\s+/g, ' ')
            .trim();
    } else {
        // Going UP: exit top, enter bottom
        return `
            M ${start.x} ${start.y}
            V ${midY + curve}
            a ${curve} ${curve} 0 0 ${dx > 0 ? '1' : '0'} ${dx > 0 ? curve : -curve} ${-curve}
            H ${end.x - (dx > 0 ? curve : -curve)}
            a ${curve} ${curve} 0 0 ${dx > 0 ? '0' : '1'} ${dx > 0 ? curve : -curve} ${-curve}
            V ${end.y}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
}

/**
 * Path from vertical exit to horizontal entry (bottom to left is most common).
 * Goes: down, then horizontal to the target edge.
 * Returns just the line path (no arrow head).
 */
function verticalToHorizontalPath(start, end, startAnchor, endAnchor, curve) {
    const dy = end.y - start.y;
    const goingDown = startAnchor === 'bottom';
    const enteringLeft = endAnchor === 'left';

    // If nearly aligned horizontally, just do a simple L
    if (Math.abs(dy) < curve * 2) {
        return straightPath(start, end);
    }

    if (goingDown && enteringLeft) {
        // Exit bottom, enter left: down then right
        const targetY = end.y; // Enter at middle height of target
        return `
            M ${start.x} ${start.y}
            V ${targetY - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    } else if (goingDown && !enteringLeft) {
        // Exit bottom, enter right: approach from the right side
        // Path: down, curve right, go past target, then left into right edge
        const targetY = end.y;
        const overshoot = 25;
        const overshootX = end.x + overshoot;

        return `
            M ${start.x} ${start.y}
            V ${targetY - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${overshootX}
            L ${overshootX} ${targetY}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    } else if (!goingDown && enteringLeft) {
        // Exit top, enter left: up then right
        const targetY = end.y;
        return `
            M ${start.x} ${start.y}
            V ${targetY + curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    } else {
        // Exit top, enter right: up then left
        const targetY = end.y;
        return `
            M ${start.x} ${start.y}
            V ${targetY + curve}
            a ${curve} ${curve} 0 0 0 ${-curve} ${-curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
}

/**
 * Path that starts vertical (from top/bottom), then turns horizontal.
 * Simple L-shape - always goes forward (right) since exit point is clamped.
 * Returns just the line path (no arrow head).
 */
function verticalFirstPath(start, end, curve) {
    const dy = end.y - start.y;
    const goingUp = dy < 0;

    // Nearly aligned - straight line
    if (Math.abs(end.x - start.x) < curve) {
        return straightPath(start, end);
    }

    if (goingUp) {
        // Going UP then RIGHT
        return `
            M ${start.x} ${start.y}
            V ${end.y + curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    } else {
        // Going DOWN then RIGHT
        return `
            M ${start.x} ${start.y}
            V ${end.y - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
}

/**
 * Path that starts horizontal (from right edge), then curves to target.
 * S-curve shape for vertical offset.
 * Returns just the line path (no arrow head).
 */
function horizontalFirstPath(start, end, curve) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const goingUp = dy < 0;

    // Nearly horizontal - straight line
    if (Math.abs(dy) < curve * 2) {
        return straightPath(start, end);
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
        `
            .replace(/\s+/g, ' ')
            .trim();
    } else {
        return `
            M ${start.x} ${start.y}
            H ${midX - curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${curve}
            V ${end.y - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PATH GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate arrow head path at a specific position.
 * Returns an absolute-positioned path string.
 * Direction determines which way the arrow points.
 */
function generateArrowHeadPath(
    endPoint,
    shape,
    size,
    fill,
    direction = 'right',
) {
    if (size <= 0 || shape === 'none') {
        return '';
    }

    const x = endPoint.x;
    const y = endPoint.y;

    // Generate arrow head based on direction
    if (direction === 'down') {
        // Arrow pointing DOWN (entering from top)
        switch (shape) {
            case 'chevron':
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size}`;
            case 'triangle':
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size} Z`;
            case 'diamond':
                return `M ${x} ${y - size * 2} L ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size} Z`;
            case 'circle': {
                const r = size * 0.7;
                const cy = y - r;
                return `M ${x} ${cy - r} A ${r} ${r} 0 1 1 ${x} ${cy + r} A ${r} ${r} 0 1 1 ${x} ${cy - r}`;
            }
            default:
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size}`;
        }
    } else if (direction === 'up') {
        // Arrow pointing UP (entering from bottom)
        switch (shape) {
            case 'chevron':
                return `M ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size}`;
            case 'triangle':
                return `M ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size} Z`;
            case 'diamond':
                return `M ${x} ${y + size * 2} L ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size} Z`;
            case 'circle': {
                const r = size * 0.7;
                const cy = y + r;
                return `M ${x} ${cy - r} A ${r} ${r} 0 1 1 ${x} ${cy + r} A ${r} ${r} 0 1 1 ${x} ${cy - r}`;
            }
            default:
                return `M ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size}`;
        }
    } else if (direction === 'left') {
        // Arrow pointing LEFT
        switch (shape) {
            case 'chevron':
                return `M ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size}`;
            case 'triangle':
                return `M ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size} Z`;
            case 'diamond':
                return `M ${x + size * 2} ${y} L ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size} Z`;
            case 'circle': {
                const r = size * 0.7;
                const cx = x + r;
                return `M ${cx - r} ${y} A ${r} ${r} 0 1 1 ${cx + r} ${y} A ${r} ${r} 0 1 1 ${cx - r} ${y}`;
            }
            default:
                return `M ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size}`;
        }
    } else {
        // Arrow pointing RIGHT (default)
        switch (shape) {
            case 'chevron':
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size}`;
            case 'triangle':
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size} Z`;
            case 'diamond':
                return `M ${x - size * 2} ${y} L ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size} Z`;
            case 'circle': {
                const r = size * 0.7;
                const cx = x - r;
                return `M ${cx - r} ${y} A ${r} ${r} 0 1 1 ${cx + r} ${y} A ${r} ${r} 0 1 1 ${cx - r} ${y}`;
            }
            default:
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size}`;
        }
    }
}

/**
 * Determine arrow head direction based on end anchor.
 */
function getArrowHeadDirection(endAnchor) {
    switch (endAnchor) {
        case 'top':
            return 'down'; // Arrow points down into top of bar
        case 'bottom':
            return 'up'; // Arrow points up into bottom of bar
        case 'left':
            return 'right'; // Arrow points right into left of bar
        case 'right':
            return 'left'; // Arrow points left into right of bar
        default:
            return 'right';
    }
}

function generatePath(from, to, config) {
    const endProf = prof.start('Arrow.generatePath');

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
        dependencyType,
    } = config;

    // Resolve auto anchors based on dependency type
    const resolvedStartAnchor =
        startAnchor === 'auto'
            ? autoSelectStartAnchor(from, to, dependencyType)
            : startAnchor;

    const resolvedEndAnchor =
        endAnchor === 'auto'
            ? autoSelectEndAnchor(from, to, dependencyType)
            : endAnchor;

    // Calculate smart offset for edge anchors if not explicitly set
    const resolvedStartOffset =
        startOffset !== undefined
            ? startOffset
            : calculateSmartOffset(
                  from,
                  to,
                  resolvedStartAnchor,
                  curveRadius,
                  dependencyType,
              );

    // Get anchor points
    const start = getAnchorPoint(
        from,
        resolvedStartAnchor,
        resolvedStartOffset,
    );
    const end = getAnchorPoint(to, resolvedEndAnchor, endOffset);

    // Route the line path (no arrow head)
    let linePath;
    if (routing === 'straight') {
        linePath = straightPath(start, end);
    } else {
        linePath = orthogonalPath(
            start,
            end,
            resolvedStartAnchor,
            resolvedEndAnchor,
            curveRadius,
        );
    }

    // Generate arrow head with correct direction based on end anchor
    const headDirection = getArrowHeadDirection(resolvedEndAnchor);
    const headPath = generateArrowHeadPath(
        end,
        headShape,
        headSize,
        headFill,
        headDirection,
    );

    endProf();
    return { linePath, headPath, endPoint: end };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOLIDJS COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Arrow Component
 *
 * A pure visual renderer for arrows between task bars.
 * Assumes successor is always to the right of predecessor.
 * Renders line and arrow head as separate paths for proper fill support.
 */
export function Arrow(props) {
    // Get bar position - prefer positionMap (batch cached) over getBarPosition (per-call)
    // positionMap eliminates 184K getBarPosition calls during V-scroll
    const getAdjustedPosition = (taskId) => {
        // Use positionMap if available (from ArrowLayer batch optimization)
        if (props.positionMap) {
            const pos = props.positionMap.get(taskId);
            if (pos) return pos; // Already has {x, y, width, height}
        }
        // Fallback to getBarPosition
        return props.taskStore?.getBarPosition(taskId) ?? null;
    };

    // Position accessors - plain functions, NOT memos
    // Memoizing these creates subscriptions to rowLayouts that cascade during scroll
    const fromPosition = () => {
        if (props.from) return props.from;
        if (props.taskStore && props.fromId) {
            return getAdjustedPosition(props.fromId);
        }
        return null;
    };

    const toPosition = () => {
        if (props.to) return props.to;
        if (props.taskStore && props.toId) {
            return getAdjustedPosition(props.toId);
        }
        return null;
    };

    // No subtasks - always return false for expanded check
    const fromTaskIsExpanded = () => false;

    // Config accessor - plain function to avoid subscription cascades
    const config = () => {
        const isExpanded = fromTaskIsExpanded();

        // For expanded containers, force 'right' anchor (override 'auto')
        // This ensures arrows exit from container's right edge, not bottom
        let startAnchor = props.startAnchor ?? DEFAULTS.START_ANCHOR;
        if (isExpanded && startAnchor === 'auto') {
            startAnchor = 'right';
        }

        return {
            startAnchor,
            startOffset: props.startOffset,
            endAnchor: props.endAnchor ?? DEFAULTS.END_ANCHOR,
            endOffset: props.endOffset ?? DEFAULTS.ANCHOR_OFFSET,
            routing: props.routing ?? DEFAULTS.ROUTING,
            curveRadius: props.curveRadius ?? DEFAULTS.CURVE_RADIUS,
            headSize: props.headSize ?? DEFAULTS.HEAD_SIZE,
            headShape: props.headShape ?? DEFAULTS.HEAD_SHAPE,
            headFill: props.headFill ?? DEFAULTS.HEAD_FILL,
            dependencyType: props.dependencyType ?? 'FS',
        };
    };

    // Path generation - plain function (not memo)
    // Memoization creates reactive subscriptions that cascade during scroll
    const paths = () => {
        const from = fromPosition();
        const to = toPosition();

        if (!from || !to) return { linePath: '', headPath: '' };

        return generatePath(from, to, config());
    };

    const stroke = () => props.stroke ?? DEFAULTS.STROKE;
    const headShape = () => props.headShape ?? DEFAULTS.HEAD_SHAPE;
    const headFill = () => props.headFill ?? DEFAULTS.HEAD_FILL;

    // Chevron is always stroke-only, never filled
    const shouldFillHead = () => headFill() && headShape() !== 'chevron';

    return (
        <g
            data-arrow-id={props.id}
            data-from={props.fromId}
            data-to={props.toId}
            class={props.class}
        >
            {/* Line path - stroke only, no fill */}
            <path
                d={paths().linePath}
                fill="none"
                stroke={stroke()}
                stroke-width={props.strokeWidth ?? DEFAULTS.STROKE_WIDTH}
                stroke-opacity={props.strokeOpacity ?? DEFAULTS.STROKE_OPACITY}
                stroke-dasharray={props.strokeDasharray}
                stroke-linecap={props.strokeLinecap ?? DEFAULTS.STROKE_LINECAP}
                stroke-linejoin={
                    props.strokeLinejoin ?? DEFAULTS.STROKE_LINEJOIN
                }
            />
            {/* Arrow head path - can have fill */}
            {paths().headPath && (
                <path
                    d={paths().headPath}
                    fill={shouldFillHead() ? stroke() : 'none'}
                    stroke={stroke()}
                    stroke-width={props.strokeWidth ?? DEFAULTS.STROKE_WIDTH}
                    stroke-opacity={
                        props.strokeOpacity ?? DEFAULTS.STROKE_OPACITY
                    }
                    stroke-linecap={
                        props.strokeLinecap ?? DEFAULTS.STROKE_LINECAP
                    }
                    stroke-linejoin={
                        props.strokeLinejoin ?? DEFAULTS.STROKE_LINEJOIN
                    }
                />
            )}
        </g>
    );
}

export {
    getAnchorPoint,
    autoSelectStartAnchor,
    generateArrowHeadRight,
    DEFAULTS as ARROW_DEFAULTS,
};
