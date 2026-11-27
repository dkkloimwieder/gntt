import { createMemo, For } from 'solid-js';
import type { JSX } from '@solidjs/web';
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
 *
 * DEPENDENCIES. `spatialIndex` reads every drawn position through
 * `taskStore.getBarPosition` WITHOUT `untrack`, so whatever that reader
 * touches — store leaves, a scale signal — is a real dependency and a
 * moved bar repaints its arrows on its own. Scroll/viewport props
 * (`startRow`/`endRow`/`startX`/`endX`) are read by `batchedPaths` only,
 * so scrolling never rebuilds the index. Neither memo keeps mutable state
 * outside the component. The per-arrow path cache belongs to the geometry
 * that produced it, and `batchedPaths` compares its own prior result.
 *
 * There is NO manual invalidation protocol. The `positionVersion` counter
 * prop and `GanttPerfIsolate`'s matching `triggerArrowUpdate()` bump were
 * deleted; callers move bars and the arrows follow.
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
    rowHeight?: number;
    startX?: number;
    endX?: number;
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

interface SpatialIndex {
    index: Map<number, Set<number>>;
    positions: Map<number, CachedPosition>;
}

interface ArrowGeometry {
    source: SpatialIndex;
    pathCache: Map<number, ArrowPaths>;
    curve: number;
    headSize: number;
}

interface BatchedPaths {
    geometry: ArrowGeometry;
    visible: Set<number>;
    groups: StyleGroup[];
}

const DEFAULTS = {
    CURVE_RADIUS: 5,
    HEAD_SIZE: 5,
    STROKE: '#666',
    STROKE_WIDTH: 1.4,
    STROKE_OPACITY: 1,
};

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
    const rowHeight = (): number => props.rowHeight ?? 38;

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
     * Rebuilt when relationships change, when the task count changes
     * (positions ready) or when any position this layer draws moves.
     * Enables O(visible_rows) lookup instead of O(total_arrows) iteration.
     */
    const spatialIndex = createMemo((): SpatialIndex => {
        const empty = (): SpatialIndex => ({
            index: new Map<number, Set<number>>(),
            positions: new Map<number, CachedPosition>(),
        });

        const rels = props.relationships || [];
        if (rels.length === 0) return empty();

        const store = props.taskStore;
        if (!store) return empty();

        // Depend on task count to rebuild when positions become available
        const tc = taskCount();
        if (tc === 0) return empty();

        const rh = rowHeight();
        const index = new Map<number, Set<number>>();
        const positions = new Map<number, CachedPosition>();

        for (let i = 0; i < rels.length; i++) {
            const rel = rels[i];
            if (!rel) continue;

            // Tracked on purpose: these reads ARE this memo's position
            // dependency. Whatever `getBarPosition` touches — store leaves,
            // a scale signal — invalidates the index when it changes, so a
            // moved bar repaints its arrows without any manual counter.
            const fromPos = store.getBarPosition(rel.from);
            const toPos = store.getBarPosition(rel.to);
            if (!fromPos || !toPos) continue;

            positions.set(i, {
                from: fromPos,
                to: toPos,
                type: rel.type || 'FS',
            });

            const fromRow = Math.floor(fromPos.y / rh);
            const toRow = Math.floor(toPos.y / rh);
            if (!Number.isFinite(fromRow) || !Number.isFinite(toRow)) continue;
            const minRow = Math.min(fromRow, toRow);
            const maxRow = Math.max(fromRow, toRow);

            for (let row = minRow; row <= maxRow; row++) {
                if (!index.has(row)) index.set(row, new Set());
                index.get(row)!.add(i);
            }
        }

        return { index, positions };
    });

    // Style geometry and endpoint positions jointly determine the cached
    // paths. Keep the generation stable when only the viewport changes.
    const arrowGeometry = createMemo((): ArrowGeometry => ({
        source: spatialIndex(),
        pathCache: new Map<number, ArrowPaths>(),
        curve: curve(),
        headSize: headSize(),
    }));

    /**
     * Build batched paths for visible arrows using spatial index.
     * Per-arrow path cache + visible-set diff: only rebuilds when the
     * visible arrow set or path geometry changes.
     */
    const batchedPaths = createMemo(
        (prev: BatchedPaths | undefined): BatchedPaths => {
            const geometry = arrowGeometry();
            const {
                source: { index, positions },
                pathCache,
            } = geometry;
            if (positions.size === 0) {
                return { geometry, visible: new Set<number>(), groups: [] };
            }

            const sr = startRow();
            const er = endRow();
            const sx = startX();
            const ex = endX();

            // An unbounded viewport or a wide sparse range is cheaper to
            // check against occupied rows than to scan its coordinate space.
            const firstRow = sr - 3;
            const lastRow = er + 3;
            const rowFilteredIndices = new Set<number>();
            if (lastRow - firstRow >= index.size) {
                for (const [row, ids] of index) {
                    if (row < firstRow || row > lastRow) continue;
                    for (const id of ids) rowFilteredIndices.add(id);
                }
            } else {
                for (let row = firstRow; row <= lastRow; row++) {
                    for (const id of index.get(row) ?? []) {
                        rowFilteredIndices.add(id);
                    }
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

            // Reuse the previous output if it came from THIS index
            // generation and covers exactly the same visible set.
            const reusable =
                prev && prev.geometry === geometry ? prev : undefined;
            const setsEqual =
                reusable !== undefined &&
                visibleIndices.size === reusable.visible.size &&
                [...visibleIndices].every((idx) => reusable.visible.has(idx));
            if (setsEqual && reusable.groups.length > 0) {
                return reusable;
            }

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

                let cached = pathCache.get(idx);
                if (!cached) {
                    cached = generateArrow(
                        pos.from,
                        pos.to,
                        pos.type,
                        geometry.curve,
                        geometry.headSize,
                    );
                    pathCache.set(idx, cached);
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

            const groups: StyleGroup[] = [];
            for (const [key, group] of styleGroups) {
                groups.push({
                    key,
                    lines: group.lines.join(' '),
                    heads: group.heads.join(' '),
                    dasharray: group.dasharray,
                    stroke: group.stroke,
                });
            }

            return { geometry, visible: visibleIndices, groups };
        },
    );

    return (
        <g class="arrow-layer-batched">
            <For each={batchedPaths().groups} keyed={(group) => group.key}>
                {(group) => (
                    <>
                        {/* Arrow lines for this style group */}
                        <path
                            d={group().lines}
                            fill="none"
                            stroke={group().stroke || stroke()}
                            stroke-width={strokeWidth()}
                            stroke-opacity={strokeOpacity()}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-dasharray={group().dasharray || undefined}
                        />
                        {/* Arrow heads for this style group */}
                        <path
                            d={group().heads}
                            fill="none"
                            stroke={group().stroke || stroke()}
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
