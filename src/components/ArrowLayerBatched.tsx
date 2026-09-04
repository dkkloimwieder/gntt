import { createMemo, untrack, For, JSX } from 'solid-js';
import type { TaskStore } from '../stores/taskStore';
import type { Relationship, BarPosition, DependencyType } from '../types';
import { generateArrow, type ArrowPaths } from '../utils/arrowBatchPaths';

/**
 * ArrowLayerBatched - High-performance arrow renderer using batched SVG paths.
 *
 * Trade-offs vs rendering one <Arrow> per dependency (the removed
 * ArrowLayer approach):
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
 * Path generation lives in src/utils/arrowBatchPaths.ts (right-angle
 * lines, chevron-only heads — see that file for the perf trade-offs).
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

const DEFAULTS = {
    CURVE_RADIUS: 5,
    HEAD_SIZE: 5,
    STROKE: '#666',
    STROKE_WIDTH: 1.4,
    STROKE_OPACITY: 1,
};

// Module-level caches: persist across renders so re-mounting the
// component doesn't pay the full rebuild cost.
let arrowPathCache = new Map<number, ArrowPaths>();
let cachedResult: StyleGroup[] = [];
let lastVisibleSet = new Set<number>();

export function ArrowLayerBatched(props: ArrowLayerBatchedProps): JSX.Element {
    const curve = (): number =>
        props.arrowConfig?.curveRadius ?? DEFAULTS.CURVE_RADIUS;
    const headSize = (): number =>
        props.arrowConfig?.headSize ?? DEFAULTS.HEAD_SIZE;
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
        const empty = {
            index: new Map<number, Set<number>>(),
            positions: new Map<number, CachedPosition>(),
        };

        const rels = props.relationships || [];
        if (rels.length === 0) return empty;

        const store = props.taskStore;
        if (!store) return empty;

        // Depend on task count to rebuild when positions become available
        const tc = taskCount();
        if (tc === 0) return empty;

        // Depend on positionVersion to rebuild when task positions change.
        // This prop is incremented whenever updateBarPosition is called.
        void props.positionVersion;

        // Clear path cache when positions change (task drag, resize, load)
        arrowPathCache.clear();
        lastVisibleSet = new Set();
        cachedResult = [];

        const rh = rowHeight();
        const index = new Map<number, Set<number>>();
        const positions = new Map<number, CachedPosition>();

        for (let i = 0; i < rels.length; i++) {
            const rel = rels[i];
            if (!rel) continue;

            // Use untrack for individual position reads to avoid per-task deps
            const fromPos = untrack(() => store.getBarPosition(rel.from));
            const toPos = untrack(() => store.getBarPosition(rel.to));
            if (!fromPos || !toPos) continue;

            positions.set(i, {
                from: fromPos,
                to: toPos,
                type: rel.type || 'FS',
            });

            const fromRow = Math.floor(fromPos.y / rh);
            const toRow = Math.floor(toPos.y / rh);
            const minRow = Math.min(fromRow, toRow);
            const maxRow = Math.max(fromRow, toRow);

            for (let row = minRow; row <= maxRow; row++) {
                if (!index.has(row)) index.set(row, new Set());
                index.get(row)!.add(i);
            }
        }

        return { index, positions };
    });

    /**
     * Build batched paths for visible arrows using spatial index.
     * Per-arrow path cache + visible-set diff: only rebuilds when the
     * visible arrow set actually changes.
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

        // Y-axis filter via spatial index (with 3-row overscan)
        const rowFilteredIndices = new Set<number>();
        for (let row = sr - 3; row <= er + 3; row++) {
            const rowRels = index.get(row);
            if (rowRels) {
                for (const idx of rowRels) rowFilteredIndices.add(idx);
            }
        }

        // X-axis filter: source OR target overlaps view
        const visibleIndices = new Set<number>();
        for (const idx of rowFilteredIndices) {
            const pos = positions.get(idx);
            if (!pos) continue;

            const fromRight = pos.from.x + pos.from.width;
            const toRight = pos.to.x + pos.to.width;
            const sourceInView = fromRight >= sx && pos.from.x <= ex;
            const targetInView = toRight >= sx && pos.to.x <= ex;

            if (sourceInView || targetInView) {
                visibleIndices.add(idx);
            }
        }

        // Reuse cached output if the visible set is unchanged
        const setsEqual =
            visibleIndices.size === lastVisibleSet.size &&
            [...visibleIndices].every((idx) => lastVisibleSet.has(idx));
        if (setsEqual && cachedResult.length > 0) {
            return cachedResult;
        }

        lastVisibleSet = new Set(visibleIndices);

        // Group by visual style: dasharray + stroke
        const styleGroups = new Map<
            string,
            {
                lines: string[];
                heads: string[];
                dasharray: string;
                stroke?: string;
            }
        >();

        for (const idx of visibleIndices) {
            const pos = positions.get(idx);
            if (!pos) continue;

            let cached = arrowPathCache.get(idx);
            if (!cached) {
                cached = generateArrow(pos.from, pos.to, pos.type, c, hs);
                arrowPathCache.set(idx, cached);
            }

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
