import { For, createMemo, untrack } from 'solid-js';
import { Arrow } from './Arrow.jsx';
import { prof } from '../utils/profiler.js';

/**
 * ArrowLayer - Container for all dependency arrows.
 *
 * Performance strategy: Virtualize arrows with STABLE object caching.
 *
 * Key insight: <For> reconciles based on object identity (===).
 * - If filtered array contains the SAME object references, no component recreation
 * - Only arrows entering/leaving viewport trigger component creation/destruction
 *
 * Previous failed approach: createMemo filter that created NEW objects each time
 * - New objects = <For> treats ALL as different = 9353 component reconciliations
 *
 * Current approach: Cache dependency objects by ID, filter returns same objects
 */
export function ArrowLayer(props) {
    // Cache dependency objects by ID for STABLE references
    // This is crucial: <For> uses === to compare items
    const depCache = new Map();

    // Build all dependencies with stable cached objects
    const allDependencies = createMemo(() => {
        const rels = props.relationships || [];
        const result = [];

        for (const rel of rels) {
            const fromId = rel.from ?? rel.predecessorId;
            const toId = rel.to ?? rel.successorId;
            const id = `${fromId}-${toId}`;

            // Return cached object or create and cache new one
            if (!depCache.has(id)) {
                depCache.set(id, {
                    id,
                    fromId,
                    toId,
                    type: rel.type || 'FS',
                    ...rel,
                });
            }
            result.push(depCache.get(id));
        }

        return result;
    });

    // Cache for filtering during drag - keeps last good positions for visibility checks
    let cachedPositionsForFilter = new Map();

    // Batch position lookup - builds a Map for arrow position lookups
    // PERFORMANCE: During drag, return cached map for filtering but Arrow components
    // use getBarPosition() fallback for actual rendering positions
    const positionMap = createMemo(() => {
        const endProf = prof.start('ArrowLayer.positionMap');

        // During drag, return cached positions for filtering (avoids arrow flash)
        // Arrow components will use getBarPosition() fallback for actual positions
        const isDragging = props.taskStore?.draggingTaskId?.();
        if (isDragging && cachedPositionsForFilter.size > 0) {
            endProf();
            return cachedPositionsForFilter;
        }

        const positions = new Map();
        const tasks = props.taskStore?.tasks;
        if (tasks) {
            // Untrack position reads to prevent cascade on position changes
            // Memo still depends on task additions/removals via Object.keys iteration
            untrack(() => {
                for (const taskId in tasks) {
                    const task = tasks[taskId];
                    if (task?.$bar) {
                        positions.set(taskId, {
                            x: task.$bar.x,
                            y: task.$bar.y,
                            width: task.$bar.width,
                            height: task.$bar.height ?? props.taskStore?.rowHeight ?? 38,
                        });
                    }
                }
            });
        }
        cachedPositionsForFilter = positions;
        endProf();
        return positions;
    });

    // Filter to visible arrows - returns SAME cached objects
    // NOTE: For high arrow counts (>500), use ArrowLayerBatched instead.
    // This layer keeps individual Arrow components for per-arrow styling/interaction.
    const visibleDependencies = createMemo(() => {
        const all = allDependencies();
        const startY = props.startRow;
        const endY = props.endRow;

        // If no viewport bounds, render all
        if (startY === undefined || endY === undefined) {
            return all;
        }

        const rowHeight = props.taskStore?.rowHeight ?? 38;
        const positions = positionMap();

        return all.filter((dep) => {
            const fromPos = positions.get(dep.fromId);
            const toPos = positions.get(dep.toId);

            if (!fromPos && !toPos) return false;

            const fromRow = fromPos
                ? Math.floor(fromPos.y / rowHeight)
                : Infinity;
            const toRow = toPos ? Math.floor(toPos.y / rowHeight) : Infinity;
            const minRow = Math.min(fromRow, toRow);
            const maxRow = Math.max(fromRow, toRow);

            if (maxRow < startY - 3 || minRow > endY + 3) return false;
            return true;
        });
    });

    // Arrow configuration from props or defaults
    const arrowConfig = () => props.arrowConfig || {};

    // Position map for Arrow components - null during drag so they use getBarPosition()
    // This ensures arrows render at current positions, not stale cached ones
    const arrowPositionMap = () => {
        const isDragging = props.taskStore?.draggingTaskId?.();
        return isDragging ? null : positionMap();
    };

    return (
        <g class="arrow-layer">
            <For each={visibleDependencies()}>
                {(dep) => (
                    <Arrow
                        id={dep.id}
                        fromId={dep.fromId}
                        toId={dep.toId}
                        taskStore={props.taskStore}
                        positionMap={arrowPositionMap()}
                        dependencyType={dep.type}
                        startAnchor={
                            dep.startAnchor ||
                            arrowConfig().startAnchor ||
                            'auto'
                        }
                        endAnchor={
                            dep.endAnchor || arrowConfig().endAnchor || 'auto'
                        }
                        startOffset={
                            dep.startOffset ?? arrowConfig().startOffset
                        }
                        endOffset={
                            dep.endOffset ?? arrowConfig().endOffset ?? 0.5
                        }
                        routing={
                            dep.routing || arrowConfig().routing || 'orthogonal'
                        }
                        curveRadius={
                            dep.curveRadius ?? arrowConfig().curveRadius ?? 5
                        }
                        stroke={dep.stroke || arrowConfig().stroke || '#666'}
                        strokeWidth={
                            dep.strokeWidth ?? arrowConfig().strokeWidth ?? 1.4
                        }
                        strokeOpacity={
                            dep.strokeOpacity ??
                            arrowConfig().strokeOpacity ??
                            1
                        }
                        strokeDasharray={
                            dep.strokeDasharray || arrowConfig().strokeDasharray
                        }
                        strokeLinecap={
                            dep.strokeLinecap ||
                            arrowConfig().strokeLinecap ||
                            'round'
                        }
                        strokeLinejoin={
                            dep.strokeLinejoin ||
                            arrowConfig().strokeLinejoin ||
                            'round'
                        }
                        headShape={
                            dep.headShape ||
                            arrowConfig().headShape ||
                            'chevron'
                        }
                        headSize={dep.headSize ?? arrowConfig().headSize ?? 5}
                        headFill={
                            dep.headFill ?? arrowConfig().headFill ?? false
                        }
                    />
                )}
            </For>
        </g>
    );
}

export default ArrowLayer;
