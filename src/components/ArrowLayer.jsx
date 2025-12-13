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

    // Get all dependencies from relationships
    const allDependencies = createMemo(() => {
        const rels = props.relationships || [];
        const deps = [];

        for (const rel of rels) {
            // Each relationship defines a dependency arrow
            // Support both 'from/to' and 'predecessorId/successorId' field names
            const fromId = rel.from ?? rel.predecessorId;
            const toId = rel.to ?? rel.successorId;
            deps.push({
                id: `${fromId}-${toId}`,
                fromId,
                toId,
                type: rel.type || 'FS', // FS, SS, FF, SF
                ...rel, // Include any other arrow styling props
            });
        }

        return deps;
    });

    // Filter to only arrows connected to visible rows AND within visible X range
    const dependencies = createMemo(() => {
        const all = allDependencies();
        const rowStart = startRow();
        const rowEnd = endRow();
        const sx = startX();
        const ex = endX();

        // If no task store, return all
        if (!props.taskStore) {
            return all;
        }

        return all.filter((dep) => {
            const fromTask = props.taskStore.getTask(dep.fromId);
            const toTask = props.taskStore.getTask(dep.toId);

            // Row visibility check (if row filtering is enabled)
            if (rowEnd !== Infinity) {
                const fromRow = fromTask?._resourceIndex ?? -1;
                const toRow = toTask?._resourceIndex ?? -1;

                const buffer = 2;
                const rowVisible =
                    (fromRow >= rowStart - buffer && fromRow <= rowEnd + buffer) ||
                    (toRow >= rowStart - buffer && toRow <= rowEnd + buffer);

                if (!rowVisible) return false;
            }

            // X visibility check (if X filtering is enabled)
            if (ex !== Infinity) {
                const fromX = fromTask?.$bar?.x ?? 0;
                const fromWidth = fromTask?.$bar?.width ?? 0;
                const toX = toTask?.$bar?.x ?? 0;
                const toWidth = toTask?.$bar?.width ?? 0;

                // Arrow is visible if either endpoint's bar overlaps viewport
                const fromVisible = fromX + fromWidth >= sx && fromX <= ex;
                const toVisible = toX + toWidth >= sx && toX <= ex;

                if (!fromVisible && !toVisible) return false;
            }

            return true;
        });
    });

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
