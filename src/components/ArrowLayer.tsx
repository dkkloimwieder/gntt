import { For, createMemo, untrack, JSX } from 'solid-js';
import { Arrow } from './Arrow';
import type { AnchorType, RoutingType, HeadShape } from './Arrow';
import { prof } from '../utils/profiler';
import type { TaskStore } from '../stores/taskStore';
import type { Relationship, BarPosition, DependencyType } from '../types';

interface CachedDependency {
    id: string;
    fromId: string;
    toId: string;
    type: DependencyType;
    startAnchor?: AnchorType;
    endAnchor?: AnchorType;
    startOffset?: number;
    endOffset?: number;
    routing?: RoutingType;
    curveRadius?: number;
    stroke?: string;
    strokeWidth?: number;
    strokeOpacity?: number;
    strokeDasharray?: string;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeLinejoin?: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round';
    headShape?: HeadShape;
    headSize?: number;
    headFill?: boolean;
}

interface ArrowConfig {
    startAnchor?: AnchorType;
    endAnchor?: AnchorType;
    startOffset?: number;
    endOffset?: number;
    routing?: RoutingType;
    curveRadius?: number;
    stroke?: string;
    strokeWidth?: number;
    strokeOpacity?: number;
    strokeDasharray?: string;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeLinejoin?: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round';
    headShape?: HeadShape;
    headSize?: number;
    headFill?: boolean;
}

interface ArrowLayerProps {
    relationships?: Relationship[];
    taskStore?: TaskStore;
    startRow?: number;
    endRow?: number;
    arrowConfig?: ArrowConfig;
}

/**
 * ArrowLayer - Container for all dependency arrows.
 */
export function ArrowLayer(props: ArrowLayerProps): JSX.Element {
    // Cache dependency objects by ID for STABLE references
    const depCache = new Map<string, CachedDependency>();

    // Build all dependencies with stable cached objects
    const allDependencies = createMemo<CachedDependency[]>(() => {
        const rels = props.relationships || [];
        const result: CachedDependency[] = [];

        for (const rel of rels) {
            const fromId = rel.from;
            const toId = rel.to;
            const id = `${fromId}-${toId}`;

            if (!depCache.has(id)) {
                depCache.set(id, {
                    id,
                    fromId,
                    toId,
                    type: rel.type || 'FS',
                } as CachedDependency);
            }
            result.push(depCache.get(id)!);
        }

        return result;
    });

    // Cache for filtering during drag
    let cachedPositionsForFilter = new Map<string, BarPosition>();

    // Batch position lookup
    const positionMap = createMemo<Map<string, BarPosition>>(() => {
        const endProf = prof.start('ArrowLayer.positionMap');

        const isDragging = props.taskStore?.draggingTaskId?.();
        if (isDragging && cachedPositionsForFilter.size > 0) {
            endProf();
            return cachedPositionsForFilter;
        }

        const positions = new Map<string, BarPosition>();
        const tasks = props.taskStore?.tasks;
        if (tasks) {
            untrack(() => {
                for (const taskId in tasks) {
                    const task = tasks[taskId];
                    if (task?._bar) {
                        positions.set(taskId, {
                            x: task._bar.x,
                            y: task._bar.y,
                            width: task._bar.width,
                            height: task._bar.height ?? 38,
                        });
                    }
                }
            });
        }
        cachedPositionsForFilter = positions;
        endProf();
        return positions;
    });

    // Filter to visible arrows
    const visibleDependencies = createMemo<CachedDependency[]>(() => {
        const all = allDependencies();
        const startY = props.startRow;
        const endY = props.endRow;

        if (startY === undefined || endY === undefined) {
            return all;
        }

        const rowHeight = 38;
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
    const arrowConfig = (): ArrowConfig => props.arrowConfig || {};

    // Position map for Arrow components
    const arrowPositionMap = (): Map<string, BarPosition> | null => {
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
                        startAnchor={dep.startAnchor || arrowConfig().startAnchor || 'auto'}
                        endAnchor={dep.endAnchor || arrowConfig().endAnchor || 'auto'}
                        startOffset={dep.startOffset ?? arrowConfig().startOffset}
                        endOffset={dep.endOffset ?? arrowConfig().endOffset ?? 0.5}
                        routing={dep.routing || arrowConfig().routing || 'orthogonal'}
                        curveRadius={dep.curveRadius ?? arrowConfig().curveRadius ?? 5}
                        stroke={dep.stroke || arrowConfig().stroke || '#666'}
                        strokeWidth={dep.strokeWidth ?? arrowConfig().strokeWidth ?? 1.4}
                        strokeOpacity={dep.strokeOpacity ?? arrowConfig().strokeOpacity ?? 1}
                        strokeDasharray={dep.strokeDasharray || arrowConfig().strokeDasharray}
                        strokeLinecap={dep.strokeLinecap || arrowConfig().strokeLinecap || 'round'}
                        strokeLinejoin={dep.strokeLinejoin || arrowConfig().strokeLinejoin || 'round'}
                        headShape={dep.headShape || arrowConfig().headShape || 'chevron'}
                        headSize={dep.headSize ?? arrowConfig().headSize ?? 5}
                        headFill={dep.headFill ?? arrowConfig().headFill ?? false}
                    />
                )}
            </For>
        </g>
    );
}

export default ArrowLayer;
