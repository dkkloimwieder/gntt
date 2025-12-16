import { For } from 'solid-js';
import { Arrow } from './Arrow.jsx';

/**
 * ArrowLayer - Container for all dependency arrows.
 * Maps dependencies to Arrow components.
 */
export function ArrowLayer(props) {
    // Simple accessor - NO store access here to avoid reactive subscriptions
    const dependencies = () => {
        const rels = props.relationships || [];
        return rels.map((rel) => {
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
    };

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
                        rowLayouts={props.rowLayouts}
                    />
                )}
            </For>
        </g>
    );
}

export default ArrowLayer;
