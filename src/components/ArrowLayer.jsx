import { For, createMemo, untrack } from 'solid-js';
import { Arrow } from './Arrow.jsx';

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

    // Filter to visible arrows - returns SAME cached objects
    // IMPORTANT: Only filter by Y (rows), NOT X position
    // Reading startX/endX creates reactive deps that run O(9353) filter on every H-scroll frame
    // The filter cost is worse than rendering extra off-screen arrows
    const visibleDependencies = createMemo(() => {
        const all = allDependencies();
        const startY = props.startRow;
        const endY = props.endRow;

        // If no viewport bounds, render all
        if (startY === undefined || endY === undefined) {
            return all;
        }

        const rowHeight = props.taskStore?.rowHeight ?? 38;

        return all.filter((dep) => {
            // Use untrack to prevent reactive cascade - we WANT to re-run
            // this memo when viewport changes (via startY/endY props)
            // but NOT when individual task positions change
            const fromPos = untrack(() =>
                props.taskStore?.getBarPosition(dep.fromId)
            );
            const toPos = untrack(() =>
                props.taskStore?.getBarPosition(dep.toId)
            );

            if (!fromPos && !toPos) return false;

            // Check Y range (row-based) only
            const fromRow = fromPos
                ? Math.floor(fromPos.y / rowHeight)
                : Infinity;
            const toRow = toPos ? Math.floor(toPos.y / rowHeight) : Infinity;
            const minRow = Math.min(fromRow, toRow);
            const maxRow = Math.max(fromRow, toRow);

            // Buffer of 3 rows for arrows that span across visible area
            if (maxRow < startY - 3 || minRow > endY + 3) return false;

            return true;
        });
    });

    // Arrow configuration from props or defaults
    const arrowConfig = () => props.arrowConfig || {};

    return (
        <g class="arrow-layer">
            <For each={visibleDependencies()}>
                {(dep) => (
                    <Arrow
                        id={dep.id}
                        fromId={dep.fromId}
                        toId={dep.toId}
                        taskStore={props.taskStore}
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
