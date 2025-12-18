import { createMemo, untrack } from 'solid-js';

/**
 * ArrowLayerBatched - High-performance arrow renderer using batched SVG paths.
 *
 * Trade-offs vs ArrowLayer:
 * - DOM Elements: 2 paths total (vs 2N for N arrows)
 * - Reconciliation: Single update (vs N component updates)
 * - Per-arrow styling: NO (uniform stroke/fill)
 * - Per-arrow hover: NO (no individual interaction)
 * - Per-arrow selection: NO
 *
 * Use this when:
 * - Arrow count is high (>500)
 * - Scroll performance is critical
 * - Per-arrow interaction is not needed
 *
 * The batched approach rebuilds the entire path on every scroll frame,
 * but avoids component reconciliation overhead which dominates at high arrow counts.
 */

// Constants (matching Arrow.jsx)
const DEFAULTS = {
    START_ANCHOR: 'auto',
    END_ANCHOR: 'auto',
    ANCHOR_OFFSET: 0.5,
    ROUTING: 'orthogonal',
    CURVE_RADIUS: 5,
    STROKE: '#666',
    STROKE_WIDTH: 1.4,
    STROKE_OPACITY: 1,
    STROKE_LINECAP: 'round',
    STROKE_LINEJOIN: 'round',
    HEAD_SIZE: 5,
    HEAD_SHAPE: 'chevron',
    HEAD_FILL: false,
    ALIGNMENT_THRESHOLD: 8,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLIFIED PATH GENERATION (inlined for performance)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get anchor point on a bar
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
        default:
            return { x: bar.x + bar.width, y: bar.y + bar.height / 2 };
    }
}

/**
 * Auto-select start anchor based on dependency type
 */
function autoStartAnchor(from, to, depType) {
    const dy = to.y + to.height / 2 - (from.y + from.height / 2);
    const sameRow = Math.abs(dy) <= DEFAULTS.ALIGNMENT_THRESHOLD;

    if (depType === 'SS' || depType === 'SF') {
        return sameRow ? 'left' : dy < 0 ? 'top' : 'bottom';
    }
    return sameRow ? 'right' : dy < 0 ? 'top' : 'bottom';
}

/**
 * Auto-select end anchor based on dependency type
 */
function autoEndAnchor(from, to, depType) {
    const dy = to.y + to.height / 2 - (from.y + from.height / 2);
    const sameRow = Math.abs(dy) <= DEFAULTS.ALIGNMENT_THRESHOLD;

    if (depType === 'FF' || depType === 'SF') {
        return sameRow ? 'right' : 'top';
    }
    return 'left';
}

/**
 * Calculate smart offset for edge anchors
 */
function smartOffset(from, to, anchor, curve, depType) {
    if (anchor === 'right' || anchor === 'left') return 0.5;
    if (anchor === 'top' || anchor === 'bottom') {
        if (depType === 'SS' || depType === 'SF') return 0.1;
        const maxExitX = to.x - curve;
        const maxOffset = (maxExitX - from.x) / from.width;
        return Math.max(0.1, Math.min(0.9, maxOffset));
    }
    return 0.5;
}

/**
 * Generate orthogonal path string between two points
 */
function generateLinePath(start, end, startAnchor, endAnchor, curve) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Nearly same point or horizontal
    if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || Math.abs(dy) < 2) {
        return `M${start.x},${start.y}L${end.x},${end.y}`;
    }

    curve = Math.min(curve, Math.abs(dx) / 2, Math.abs(dy) / 2);
    if (curve < 1) curve = 0;

    const isVerticalStart = startAnchor === 'top' || startAnchor === 'bottom';
    const isHorizontalEnd = endAnchor === 'left' || endAnchor === 'right';

    if (isVerticalStart && isHorizontalEnd) {
        // Vertical exit to horizontal entry (most common)
        const goingDown = startAnchor === 'bottom';
        const enteringLeft = endAnchor === 'left';
        const targetY = end.y;

        if (goingDown && enteringLeft) {
            return `M${start.x},${start.y}V${targetY - curve}a${curve},${curve},0,0,0,${curve},${curve}H${end.x}`;
        } else if (!goingDown && enteringLeft) {
            return `M${start.x},${start.y}V${targetY + curve}a${curve},${curve},0,0,1,${curve},${-curve}H${end.x}`;
        }
    }

    if (isVerticalStart) {
        // Vertical first, then horizontal
        const goingUp = dy < 0;
        if (goingUp) {
            return `M${start.x},${start.y}V${end.y + curve}a${curve},${curve},0,0,1,${curve},${-curve}H${end.x}`;
        } else {
            return `M${start.x},${start.y}V${end.y - curve}a${curve},${curve},0,0,0,${curve},${curve}H${end.x}`;
        }
    }

    // Horizontal first, then vertical (S-curve)
    const midX = start.x + dx / 2;
    const goingUp = dy < 0;
    if (goingUp) {
        return `M${start.x},${start.y}H${midX - curve}a${curve},${curve},0,0,0,${curve},${-curve}V${end.y + curve}a${curve},${curve},0,0,1,${curve},${-curve}H${end.x}`;
    } else {
        return `M${start.x},${start.y}H${midX - curve}a${curve},${curve},0,0,1,${curve},${curve}V${end.y - curve}a${curve},${curve},0,0,0,${curve},${curve}H${end.x}`;
    }
}

/**
 * Generate arrow head path at end point
 */
function generateHeadPath(end, endAnchor, size) {
    if (size <= 0) return '';

    const x = end.x;
    const y = end.y;

    // Chevron shape based on direction
    switch (endAnchor) {
        case 'top': // Arrow points down
            return `M${x - size},${y - size}L${x},${y}L${x + size},${y - size}`;
        case 'bottom': // Arrow points up
            return `M${x - size},${y + size}L${x},${y}L${x + size},${y + size}`;
        case 'right': // Arrow points left
            return `M${x + size},${y - size}L${x},${y}L${x + size},${y + size}`;
        default: // Arrow points right (left entry)
            return `M${x - size},${y - size}L${x},${y}L${x - size},${y + size}`;
    }
}

/**
 * Generate complete arrow paths (line + head) for a single dependency
 */
function generateArrow(from, to, depType, curve, headSize) {
    // Resolve anchors
    const startAnchor = autoStartAnchor(from, to, depType);
    const endAnchor = autoEndAnchor(from, to, depType);
    const startOffset = smartOffset(from, to, startAnchor, curve, depType);

    // Get anchor points
    const start = getAnchorPoint(from, startAnchor, startOffset);
    const end = getAnchorPoint(to, endAnchor, 0.5);

    // Generate paths
    const linePath = generateLinePath(start, end, startAnchor, endAnchor, curve);
    const headPath = generateHeadPath(end, endAnchor, headSize);

    return { linePath, headPath };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function ArrowLayerBatched(props) {
    // Arrow configuration from props or defaults
    const curve = () => props.arrowConfig?.curveRadius ?? DEFAULTS.CURVE_RADIUS;
    const headSize = () => props.arrowConfig?.headSize ?? DEFAULTS.HEAD_SIZE;
    const stroke = () => props.arrowConfig?.stroke ?? DEFAULTS.STROKE;
    const strokeWidth = () =>
        props.arrowConfig?.strokeWidth ?? DEFAULTS.STROKE_WIDTH;
    const strokeOpacity = () =>
        props.arrowConfig?.strokeOpacity ?? DEFAULTS.STROKE_OPACITY;

    // Viewport bounds for filtering
    const startRow = () => props.startRow ?? 0;
    const endRow = () => props.endRow ?? Infinity;
    const rowHeight = () => props.taskStore?.rowHeight ?? 38;

    /**
     * Build batched paths for all visible arrows.
     *
     * This memo runs on every scroll frame that changes startRow/endRow.
     * The O(n) iteration is acceptable because we avoid component reconciliation.
     */
    const batchedPaths = createMemo(() => {
        const rels = props.relationships || [];
        if (rels.length === 0) return { lines: '', heads: '' };

        const store = props.taskStore;
        if (!store) return { lines: '', heads: '' };

        const sr = startRow();
        const er = endRow();
        const rh = rowHeight();
        const c = curve();
        const hs = headSize();

        const lineSegments = [];
        const headSegments = [];

        for (const rel of rels) {
            const fromId = rel.from ?? rel.predecessorId;
            const toId = rel.to ?? rel.successorId;

            // Get positions (untrack to avoid reactive cascade on individual task changes)
            const fromPos = untrack(() => store.getBarPosition(fromId));
            const toPos = untrack(() => store.getBarPosition(toId));

            if (!fromPos || !toPos) continue;

            // Filter by row range (Y virtualization)
            const fromRow = Math.floor(fromPos.y / rh);
            const toRow = Math.floor(toPos.y / rh);
            const minRow = Math.min(fromRow, toRow);
            const maxRow = Math.max(fromRow, toRow);

            // Buffer of 3 rows
            if (maxRow < sr - 3 || minRow > er + 3) continue;

            // Generate arrow
            const depType = rel.type || 'FS';
            const { linePath, headPath } = generateArrow(
                fromPos,
                toPos,
                depType,
                c,
                hs
            );

            lineSegments.push(linePath);
            if (headPath) headSegments.push(headPath);
        }

        return {
            lines: lineSegments.join(' '),
            heads: headSegments.join(' '),
        };
    });

    return (
        <g class="arrow-layer-batched">
            {/* All arrow lines in one path */}
            <path
                d={batchedPaths().lines}
                fill="none"
                stroke={stroke()}
                stroke-width={strokeWidth()}
                stroke-opacity={strokeOpacity()}
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            {/* All arrow heads in one path */}
            <path
                d={batchedPaths().heads}
                fill="none"
                stroke={stroke()}
                stroke-width={strokeWidth()}
                stroke-opacity={strokeOpacity()}
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </g>
    );
}

export default ArrowLayerBatched;
