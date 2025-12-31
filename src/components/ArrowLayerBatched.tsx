import { createMemo, untrack, For, JSX } from 'solid-js';
import type { TaskStore } from '../stores/taskStore';
import type { Relationship, BarPosition, DependencyType } from '../types';

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

interface ArrowConfig {
    curveRadius?: number;
    headSize?: number;
    stroke?: string;
    strokeWidth?: number;
    strokeOpacity?: number;
}

interface ArrowLayerBatchedProps {
    relationships?: Relationship[];
    taskStore?: TaskStore;
    startRow?: number;
    endRow?: number;
    startX?: number;
    endX?: number;
    positionVersion?: number;
    arrowConfig?: ArrowConfig;
}

interface ArrowPaths {
    linePath: string;
    headPath: string;
}

interface Point {
    x: number;
    y: number;
}

interface CachedPosition {
    from: BarPosition;
    to: BarPosition;
    type: DependencyType;
    strokeDasharray?: string;
    stroke?: string;
}

interface StyleGroup {
    key: string;
    lines: string;
    heads: string;
    dasharray: string;
    stroke?: string;
}

type AnchorType = 'top' | 'bottom' | 'left' | 'right';

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
function getAnchorPoint(bar: BarPosition, anchor: AnchorType, offset = 0.5): Point {
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
 * SS/SF: Always exit from left (start point)
 * FF: Always exit from right (end point)
 * FS: Exit from right (end), or top/bottom if different rows
 */
function autoStartAnchor(from: BarPosition, to: BarPosition, depType: DependencyType): AnchorType {
    const dy = to.y + to.height / 2 - (from.y + from.height / 2);
    const sameRow = Math.abs(dy) <= DEFAULTS.ALIGNMENT_THRESHOLD;

    // SS (Start-to-Start): always connect from left (start) of predecessor
    if (depType === 'SS') {
        return 'left';
    }
    // FF (Finish-to-Finish): always connect from right (end) of predecessor
    if (depType === 'FF') {
        return 'right';
    }
    // SF (Start-to-Finish): connect from left (start) of predecessor
    if (depType === 'SF') {
        return 'left';
    }
    // FS (Finish-to-Start): connect from right (end), or top/bottom if different rows
    return sameRow ? 'right' : dy < 0 ? 'top' : 'bottom';
}

/**
 * Auto-select end anchor based on dependency type
 * SS/FS: Always enter from left (start point)
 * FF/SF: Always enter from right (end point)
 */
function autoEndAnchor(_from: BarPosition, _to: BarPosition, depType: DependencyType): AnchorType {
    // FF and SF constrain the successor's END, so enter from right
    if (depType === 'FF' || depType === 'SF') {
        return 'right';
    }
    // SS and FS constrain the successor's START, so enter from left
    return 'left';
}

/**
 * Calculate smart offset for edge anchors
 */
function smartOffset(from: BarPosition, to: BarPosition, anchor: AnchorType, curve: number, depType: DependencyType): number {
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
 * Generate orthogonal path string between two points (right angles only)
 */
function generateLinePath(start: Point, end: Point, startAnchor: AnchorType, endAnchor: AnchorType): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Nearly same point or horizontal - straight line
    if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || Math.abs(dy) < 2) {
        return `M${start.x},${start.y}L${end.x},${end.y}`;
    }

    const isVerticalStart = startAnchor === 'top' || startAnchor === 'bottom';
    const isLeftToLeft = startAnchor === 'left' && endAnchor === 'left';
    const isRightToRight = startAnchor === 'right' && endAnchor === 'right';

    // Left-to-left (SS): bracket shape opening right
    if (isLeftToLeft) {
        const minX = Math.min(start.x, end.x);
        const leftX = Math.max(minX - 20, 2);
        return `M${start.x},${start.y}H${leftX}V${end.y}H${end.x}`;
    }

    // Right-to-right (FF): bracket shape opening left
    if (isRightToRight) {
        const maxX = Math.max(start.x, end.x);
        const rightX = maxX + 20;
        return `M${start.x},${start.y}H${rightX}V${end.y}H${end.x}`;
    }

    // Vertical start (top/bottom anchor): L-shape
    if (isVerticalStart) {
        return `M${start.x},${start.y}V${end.y}H${end.x}`;
    }

    // Default (FS): S-shape with midpoint
    const midX = (start.x + end.x) / 2;
    return `M${start.x},${start.y}H${midX}V${end.y}H${end.x}`;
}

/**
 * Generate arrow head path at end point
 */
function generateHeadPath(end: Point, endAnchor: AnchorType, size: number): string {
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
function generateArrow(from: BarPosition, to: BarPosition, depType: DependencyType, curve: number, headSize: number): ArrowPaths {
    // Resolve anchors
    const startAnchor = autoStartAnchor(from, to, depType);
    const endAnchor = autoEndAnchor(from, to, depType);
    const startOffset = smartOffset(from, to, startAnchor, curve, depType);

    // Get anchor points
    const start = getAnchorPoint(from, startAnchor, startOffset);
    const end = getAnchorPoint(to, endAnchor, 0.5);

    // Generate paths
    const linePath = generateLinePath(start, end, startAnchor, endAnchor);
    const headPath = generateHeadPath(end, endAnchor, headSize);

    return { linePath, headPath };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATH CACHING (module-level for persistence across renders)
// ═══════════════════════════════════════════════════════════════════════════════

// Per-arrow path cache: arrowIndex → { linePath, headPath }
let arrowPathCache = new Map<number, ArrowPaths>();
// Cached concatenated result
let cachedResult: StyleGroup[] = [];
// Track last visible set to detect changes
let lastVisibleSet = new Set<number>();

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function ArrowLayerBatched(props: ArrowLayerBatchedProps): JSX.Element {
    // Arrow configuration from props or defaults
    const curve = (): number => props.arrowConfig?.curveRadius ?? DEFAULTS.CURVE_RADIUS;
    const headSize = (): number => props.arrowConfig?.headSize ?? DEFAULTS.HEAD_SIZE;
    const stroke = (): string => props.arrowConfig?.stroke ?? DEFAULTS.STROKE;
    const strokeWidth = (): number =>
        props.arrowConfig?.strokeWidth ?? DEFAULTS.STROKE_WIDTH;
    const strokeOpacity = (): number =>
        props.arrowConfig?.strokeOpacity ?? DEFAULTS.STROKE_OPACITY;

    // Viewport bounds for filtering (Y-axis)
    const startRow = (): number => props.startRow ?? 0;
    const endRow = (): number => props.endRow ?? Infinity;
    const rowHeight = (): number => 38;

    // Viewport bounds for filtering (X-axis)
    const startX = (): number => props.startX ?? 0;
    const endX = (): number => props.endX ?? Infinity;

    // Track task count to rebuild index when tasks are loaded
    const taskCount = (): number => {
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
        if (rels.length === 0) return { index: new Map<number, Set<number>>(), positions: new Map<number, CachedPosition>() };

        const store = props.taskStore;
        if (!store) return { index: new Map<number, Set<number>>(), positions: new Map<number, CachedPosition>() };

        // Depend on task count to rebuild when positions become available
        const tc = taskCount();
        if (tc === 0) return { index: new Map<number, Set<number>>(), positions: new Map<number, CachedPosition>() };

        // Depend on positionVersion to rebuild when task positions change (during drag)
        // This prop is incremented by GanttPerfIsolate whenever updateBarPosition is called
        const _pv = props.positionVersion;

        // Clear path cache when positions change (task drag, resize, load)
        arrowPathCache.clear();
        lastVisibleSet = new Set();
        cachedResult = [];

        const rh = rowHeight();
        const index = new Map<number, Set<number>>(); // row → Set<relIndex>
        const positions = new Map<number, CachedPosition>(); // relIndex → {from, to, type}

        for (let i = 0; i < rels.length; i++) {
            const rel = rels[i];
            if (!rel) continue;
            const fromId = rel.from;
            const toId = rel.to;

            // Use untrack for individual position reads to avoid per-task deps
            const fromPos = untrack(() => store.getBarPosition(fromId));
            const toPos = untrack(() => store.getBarPosition(toId));

            if (!fromPos || !toPos) continue;

            // Cache positions for this relationship (including style info)
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
                index.get(row)!.add(i);
            }
        }

        return { index, positions };
    });

    /**
     * Build batched paths for visible arrows using spatial index.
     * Uses per-arrow path caching to avoid regenerating unchanged arrows.
     * Only rebuilds when the visible arrow set actually changes.
     */
    const batchedPaths = createMemo((): StyleGroup[] => {
        const { index, positions } = spatialIndex();
        if (positions.size === 0) return [];

        const sr = startRow();
        const er = endRow();
        const sx = startX();
        const ex = endX();
        const c = curve();
        const hs = headSize();

        // Collect visible relationship indices from spatial index (Y-axis filter)
        const rowFilteredIndices = new Set<number>();
        for (let row = sr - 3; row <= er + 3; row++) {
            const rowRels = index.get(row);
            if (rowRels) {
                for (const idx of rowRels) rowFilteredIndices.add(idx);
            }
        }

        // Apply X-axis filter: only include arrows where source OR target is in view
        const visibleIndices = new Set<number>();
        for (const idx of rowFilteredIndices) {
            const pos = positions.get(idx);
            if (!pos) continue;

            const fromRight = pos.from.x + pos.from.width;
            const toRight = pos.to.x + pos.to.width;

            // Arrow visible if source or target overlaps X range
            const sourceInView = fromRight >= sx && pos.from.x <= ex;
            const targetInView = toRight >= sx && pos.to.x <= ex;

            if (sourceInView || targetInView) {
                visibleIndices.add(idx);
            }
        }

        // Check if visible set is unchanged - return cached result
        const setsEqual =
            visibleIndices.size === lastVisibleSet.size &&
            [...visibleIndices].every((idx) => lastVisibleSet.has(idx));

        if (setsEqual && Array.isArray(cachedResult) && cachedResult.length > 0) {
            return cachedResult;
        }

        // Update tracking
        lastVisibleSet = new Set(visibleIndices);

        // Build paths using per-arrow cache, grouped by style
        // styleKey = strokeDasharray|stroke
        const styleGroups = new Map<string, { lines: string[]; heads: string[]; dasharray: string; stroke?: string }>();

        for (const idx of visibleIndices) {
            const pos = positions.get(idx);
            if (!pos) continue;

            // Check per-arrow cache first
            let cached = arrowPathCache.get(idx);
            if (!cached) {
                cached = generateArrow(pos.from, pos.to, pos.type, c, hs);
                arrowPathCache.set(idx, cached);
            }

            if (cached) {
                // Group by style
                const styleKey = `${pos.strokeDasharray || ''}|${pos.stroke || ''}`;
                if (!styleGroups.has(styleKey)) {
                    styleGroups.set(styleKey, {
                        lines: [],
                        heads: [],
                        dasharray: pos.strokeDasharray || '',
                        stroke: pos.stroke,
                    });
                }
                const group = styleGroups.get(styleKey)!;
                group.lines.push(cached.linePath);
                if (cached.headPath) group.heads.push(cached.headPath);
            }
        }

        // Convert to array of style groups with joined paths
        const result: StyleGroup[] = [];
        for (const [key, group] of styleGroups) {
            result.push({
                key,
                lines: group.lines.join(' '),
                heads: group.heads.join(' '),
                dasharray: group.dasharray,
                stroke: group.stroke,
            });
        }

        cachedResult = result;
        return cachedResult;
    });

    return (
        <g class="arrow-layer-batched">
            <For each={batchedPaths()}>
                {(group) => (
                    <>
                        {/* Arrow lines for this style group */}
                        <path
                            d={group.lines}
                            fill="none"
                            stroke={group.stroke || stroke()}
                            stroke-width={strokeWidth()}
                            stroke-opacity={strokeOpacity()}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-dasharray={group.dasharray || undefined}
                        />
                        {/* Arrow heads for this style group */}
                        <path
                            d={group.heads}
                            fill="none"
                            stroke={group.stroke || stroke()}
                            stroke-width={strokeWidth()}
                            stroke-opacity={strokeOpacity()}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </>
                )}
            </For>
        </g>
    );
}

export default ArrowLayerBatched;
