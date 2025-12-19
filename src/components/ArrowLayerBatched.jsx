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
        const goingLeft = end.x < start.x;

        if (goingDown && enteringLeft) {
            if (goingLeft) {
                // Down then curve left
                return `M${start.x},${start.y}V${targetY - curve}a${curve},${curve},0,0,1,${-curve},${curve}H${end.x}`;
            } else {
                // Down then curve right
                return `M${start.x},${start.y}V${targetY - curve}a${curve},${curve},0,0,0,${curve},${curve}H${end.x}`;
            }
        } else if (!goingDown && enteringLeft) {
            if (goingLeft) {
                // Up then curve left
                return `M${start.x},${start.y}V${targetY + curve}a${curve},${curve},0,0,0,${-curve},${-curve}H${end.x}`;
            } else {
                // Up then curve right
                return `M${start.x},${start.y}V${targetY + curve}a${curve},${curve},0,0,1,${curve},${-curve}H${end.x}`;
            }
        }
    }

    if (isVerticalStart) {
        // Vertical first, then horizontal
        const goingUp = dy < 0;
        const goingLeft = dx < 0;
        if (goingUp) {
            if (goingLeft) {
                return `M${start.x},${start.y}V${end.y + curve}a${curve},${curve},0,0,0,${-curve},${-curve}H${end.x}`;
            } else {
                return `M${start.x},${start.y}V${end.y + curve}a${curve},${curve},0,0,1,${curve},${-curve}H${end.x}`;
            }
        } else {
            if (goingLeft) {
                return `M${start.x},${start.y}V${end.y - curve}a${curve},${curve},0,0,1,${-curve},${curve}H${end.x}`;
            } else {
                return `M${start.x},${start.y}V${end.y - curve}a${curve},${curve},0,0,0,${curve},${curve}H${end.x}`;
            }
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
// PATH CACHING (module-level for persistence across renders)
// ═══════════════════════════════════════════════════════════════════════════════

// Per-arrow path cache: arrowIndex → { linePath, headPath }
let arrowPathCache = new Map();
// Cached concatenated result
let cachedResult = { lines: '', heads: '' };
// Track last visible set to detect changes
let lastVisibleSet = new Set();

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

    // Track task count to rebuild index when tasks are loaded
    const taskCount = () => {
        const tasks = props.taskStore?.tasks;
        return tasks ? Object.keys(tasks).length : 0;
    };

    /**
     * SPATIAL INDEX: Map row → Set<relationship indices>
     * Rebuilt when relationships change or task count changes (positions ready).
     * Enables O(visible_rows) lookup instead of O(total_arrows) iteration.
     */
    const spatialIndex = createMemo(() => {
        const rels = props.relationships || [];
        if (rels.length === 0) return { index: new Map(), positions: new Map() };

        const store = props.taskStore;
        if (!store) return { index: new Map(), positions: new Map() };

        // Depend on task count to rebuild when positions become available
        const tc = taskCount();
        if (tc === 0) return { index: new Map(), positions: new Map() };

        // Clear path cache when positions change (task drag, resize, load)
        arrowPathCache.clear();
        lastVisibleSet = new Set();
        cachedResult = { lines: '', heads: '' };

        const rh = rowHeight();
        const index = new Map(); // row → Set<relIndex>
        const positions = new Map(); // relIndex → {from, to, type}

        for (let i = 0; i < rels.length; i++) {
            const rel = rels[i];
            const fromId = rel.from ?? rel.predecessorId;
            const toId = rel.to ?? rel.successorId;

            // Use untrack for individual position reads to avoid per-task deps
            const fromPos = untrack(() => store.getBarPosition(fromId));
            const toPos = untrack(() => store.getBarPosition(toId));

            if (!fromPos || !toPos) continue;

            // Cache positions for this relationship
            positions.set(i, {
                from: fromPos,
                to: toPos,
                type: rel.type || 'FS',
            });

            // Index by row range
            const fromRow = Math.floor(fromPos.y / rh);
            const toRow = Math.floor(toPos.y / rh);
            const minRow = Math.min(fromRow, toRow);
            const maxRow = Math.max(fromRow, toRow);

            // Add to all rows this arrow spans
            for (let row = minRow; row <= maxRow; row++) {
                if (!index.has(row)) index.set(row, new Set());
                index.get(row).add(i);
            }
        }

        return { index, positions };
    });

    /**
     * Build batched paths for visible arrows using spatial index.
     * Uses per-arrow path caching to avoid regenerating unchanged arrows.
     * Only rebuilds when the visible arrow set actually changes.
     */
    const batchedPaths = createMemo(() => {
        const { index, positions } = spatialIndex();
        if (positions.size === 0) return { lines: '', heads: '' };

        const sr = startRow();
        const er = endRow();
        const c = curve();
        const hs = headSize();

        // Collect visible relationship indices from spatial index
        const visibleIndices = new Set();
        for (let row = sr - 3; row <= er + 3; row++) {
            const rowRels = index.get(row);
            if (rowRels) {
                for (const idx of rowRels) visibleIndices.add(idx);
            }
        }

        // Check if visible set is unchanged - return cached result
        const setsEqual =
            visibleIndices.size === lastVisibleSet.size &&
            [...visibleIndices].every((idx) => lastVisibleSet.has(idx));

        if (setsEqual && cachedResult.lines !== '') {
            return cachedResult;
        }

        // Update tracking
        lastVisibleSet = new Set(visibleIndices);

        // Build paths using per-arrow cache
        const lineSegments = [];
        const headSegments = [];

        for (const idx of visibleIndices) {
            // Check per-arrow cache first
            let cached = arrowPathCache.get(idx);

            if (!cached) {
                const pos = positions.get(idx);
                if (pos) {
                    cached = generateArrow(pos.from, pos.to, pos.type, c, hs);
                    arrowPathCache.set(idx, cached);
                }
            }

            if (cached) {
                lineSegments.push(cached.linePath);
                if (cached.headPath) headSegments.push(cached.headPath);
            }
        }

        cachedResult = {
            lines: lineSegments.join(' '),
            heads: headSegments.join(' '),
        };

        return cachedResult;
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
