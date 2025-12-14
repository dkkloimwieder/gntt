import { For, createMemo } from 'solid-js';
import { Arrow } from './Arrow.jsx';

/**
 * ArrowLayer - Container for all dependency arrows.
 * Maps dependencies to Arrow components.
 * Supports row virtualization - only renders arrows connected to visible rows.
 */
export function ArrowLayer(props) {
    // Viewport range for row virtualization
    const startRow = () => props.startRow ?? 0;
    const endRow = () => props.endRow ?? Infinity;

    // Viewport range for horizontal (X) virtualization
    const startX = () => props.startX ?? 0;
    const endX = () => props.endX ?? Infinity;

    // Get all dependencies from relationships and index by "from" task's row
    // This avoids O(n) iteration on every scroll - instead we do O(visible_rows)
    const dependenciesByRow = createMemo(() => {
        const rels = props.relationships || [];
        const byRow = new Map(); // resourceIndex → dependencies[]

        if (!props.taskStore) {
            // Fallback: single bucket for all
            const deps = rels.map((rel) => {
                const fromId = rel.from ?? rel.predecessorId;
                const toId = rel.to ?? rel.successorId;
                return {
                    id: `${fromId}-${toId}`,
                    fromId,
                    toId,
                    type: rel.type || 'FS',
                    ...rel,
                };
            });
            byRow.set(-1, deps);
            return byRow;
        }

        for (const rel of rels) {
            const fromId = rel.from ?? rel.predecessorId;
            const toId = rel.to ?? rel.successorId;
            const fromTask = props.taskStore.getTask(fromId);
            const toTask = props.taskStore.getTask(toId);
            const fromRow = fromTask?._resourceIndex ?? -1;
            const toRow = toTask?._resourceIndex ?? -1;

            const dep = {
                id: `${fromId}-${toId}`,
                fromId,
                toId,
                type: rel.type || 'FS',
                fromRow,
                toRow,
                // Pre-cache bar positions for faster X filtering
                fromX: fromTask?.$bar?.x ?? 0,
                fromWidth: fromTask?.$bar?.width ?? 0,
                toX: toTask?.$bar?.x ?? 0,
                toWidth: toTask?.$bar?.width ?? 0,
                ...rel,
            };

            // Index by both from and to rows (arrow visible if either end's row is visible)
            if (!byRow.has(fromRow)) byRow.set(fromRow, []);
            byRow.get(fromRow).push(dep);

            // Only add to toRow bucket if different from fromRow (avoid duplicates)
            if (toRow !== fromRow) {
                if (!byRow.has(toRow)) byRow.set(toRow, []);
                byRow.get(toRow).push(dep);
            }
        }

        return byRow;
    });

    // Filter to only arrows connected to visible rows AND within visible X range
    // Now O(visible_rows * deps_per_row) instead of O(all_dependencies)
    const dependencies = createMemo(() => {
        const byRow = dependenciesByRow();
        const rowStart = startRow();
        const rowEnd = endRow();
        const sx = startX();
        const ex = endX();
        const buffer = 2;

        // If no row filtering, get all from fallback bucket
        if (rowEnd === Infinity) {
            const all = byRow.get(-1) || [];
            return filterByX(all, sx, ex);
        }

        // Collect dependencies from visible rows only
        const seen = new Set(); // Avoid duplicates from dual-indexing
        const result = [];

        for (let row = rowStart - buffer; row <= rowEnd + buffer; row++) {
            const rowDeps = byRow.get(row);
            if (!rowDeps) continue;

            for (const dep of rowDeps) {
                if (seen.has(dep.id)) continue;
                seen.add(dep.id);

                // X visibility check using pre-cached positions
                if (ex !== Infinity) {
                    const fromVisible = dep.fromX + dep.fromWidth >= sx && dep.fromX <= ex;
                    const toVisible = dep.toX + dep.toWidth >= sx && dep.toX <= ex;
                    const midX = (dep.fromX + dep.fromWidth / 2 + dep.toX + dep.toWidth / 2) / 2;
                    const midVisible = midX >= sx && midX <= ex;

                    if (!fromVisible && !toVisible && !midVisible) continue;
                }

                result.push(dep);
            }
        }

        return result;
    });

    // Helper for X filtering (used when no row filtering)
    function filterByX(deps, sx, ex) {
        if (ex === Infinity) return deps;
        return deps.filter((dep) => {
            const fromVisible = dep.fromX + dep.fromWidth >= sx && dep.fromX <= ex;
            const toVisible = dep.toX + dep.toWidth >= sx && dep.toX <= ex;
            const midX = (dep.fromX + dep.fromWidth / 2 + dep.toX + dep.toWidth / 2) / 2;
            const midVisible = midX >= sx && midX <= ex;
            return fromVisible || toVisible || midVisible;
        });
    }

    // Arrow configuration from props or defaults
    const arrowConfig = () => props.arrowConfig || {};

    return (
        <g class="arrow-layer">
            <For each={dependencies()}>
                {(dep) => (
                    <Arrow
                        id={dep.id}
                        fromId={dep.fromId}
                        toId={dep.toId}
                        taskStore={props.taskStore}
                        dependencyType={dep.type}
                        // Anchoring
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
                        // Routing
                        routing={
                            dep.routing || arrowConfig().routing || 'orthogonal'
                        }
                        curveRadius={
                            dep.curveRadius ?? arrowConfig().curveRadius ?? 5
                        }
                        // Line style
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
                        // Arrow head
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
