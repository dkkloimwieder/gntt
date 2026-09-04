// Note: createMemo was attempted for optimization but created reactive cascades
// that hurt scroll performance. Plain functions work better here.

import { JSX } from 'solid-js';
import { prof } from '../utils/profiler';
import type { TaskStore } from '../stores/taskStore';
import type { BarPosition, DependencyType } from '../types';
import {
    getAnchorPoint,
    autoSelectStartAnchor,
    autoSelectEndAnchor,
    calculateSmartOffset,
    type Point,
    type AnchorType,
} from '../utils/arrowAnchors';
import {
    straightPath,
    orthogonalPath,
    type RoutingType,
} from '../utils/arrowPaths';
import {
    generateArrowHeadPath,
    generateArrowHeadRight,
    getArrowHeadDirection,
    type HeadShape,
} from '../utils/arrowHeads';

interface ArrowConfig {
    startAnchor: AnchorType;
    startOffset?: number;
    endAnchor: AnchorType;
    endOffset: number;
    routing: RoutingType;
    curveRadius: number;
    headSize: number;
    headShape: HeadShape;
    headFill: boolean;
    dependencyType: DependencyType;
}

interface PathResult {
    linePath: string;
    headPath: string;
    endPoint: Point;
}

interface ArrowProps {
    id?: string;
    fromId?: string;
    toId?: string;
    from?: BarPosition;
    to?: BarPosition;
    taskStore?: TaskStore;
    positionMap?: Map<string, BarPosition> | null;
    dependencyType?: DependencyType;
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
    class?: string;
}

const DEFAULTS = {
    // Anchoring
    START_ANCHOR: 'auto' as AnchorType,
    END_ANCHOR: 'auto' as AnchorType,
    ANCHOR_OFFSET: 0.5,

    // Path shape
    ROUTING: 'orthogonal' as RoutingType,
    CURVE_RADIUS: 5,

    // Line style
    STROKE: '#666',
    STROKE_WIDTH: 1.4,
    STROKE_OPACITY: 1,
    STROKE_LINECAP: 'round' as const,
    STROKE_LINEJOIN: 'round' as const,

    // Arrow head
    HEAD_SIZE: 5,
    HEAD_SHAPE: 'chevron' as HeadShape,
    HEAD_FILL: false,
};

/**
 * Compose anchor + path + head into a renderable arrow path.
 */
function generatePath(
    from: BarPosition,
    to: BarPosition,
    config: ArrowConfig,
): PathResult {
    const endProf = prof.start('Arrow.generatePath');

    const {
        startAnchor,
        startOffset,
        endAnchor,
        endOffset,
        routing,
        curveRadius,
        headSize,
        headShape,
        headFill,
        dependencyType,
    } = config;

    const resolvedStartAnchor =
        startAnchor === 'auto'
            ? autoSelectStartAnchor(from, to, dependencyType)
            : startAnchor;

    const resolvedEndAnchor =
        endAnchor === 'auto'
            ? autoSelectEndAnchor(from, to, dependencyType)
            : endAnchor;

    const resolvedStartOffset =
        startOffset !== undefined
            ? startOffset
            : calculateSmartOffset(
                  from,
                  to,
                  resolvedStartAnchor,
                  curveRadius,
                  dependencyType,
              );

    const start = getAnchorPoint(
        from,
        resolvedStartAnchor,
        resolvedStartOffset,
    );
    const end = getAnchorPoint(to, resolvedEndAnchor, endOffset);

    const linePath =
        routing === 'straight'
            ? straightPath(start, end)
            : orthogonalPath(
                  start,
                  end,
                  resolvedStartAnchor,
                  resolvedEndAnchor,
                  curveRadius,
              );

    const headDirection = getArrowHeadDirection(resolvedEndAnchor);
    const headPath = generateArrowHeadPath(
        end,
        headShape,
        headSize,
        headFill,
        headDirection,
    );

    endProf();
    return { linePath, headPath, endPoint: end };
}

/**
 * Arrow Component
 *
 * A pure visual renderer for arrows between task bars.
 * Renders line and arrow head as separate paths for proper fill support.
 */
export function Arrow(props: ArrowProps): JSX.Element {
    // Get bar position - prefer positionMap (batch cached) over getBarPosition (per-call)
    // positionMap eliminates 184K getBarPosition calls during V-scroll
    const getAdjustedPosition = (taskId: string): BarPosition | null => {
        if (props.positionMap) {
            const pos = props.positionMap.get(taskId);
            if (pos) return pos;
        }
        return props.taskStore?.getBarPosition(taskId) ?? null;
    };

    // Position accessors - plain functions, NOT memos.
    // Memoizing creates subscriptions to rowLayouts that cascade during scroll.
    const fromPosition = (): BarPosition | null => {
        if (props.from) return props.from;
        if (props.taskStore && props.fromId) {
            return getAdjustedPosition(props.fromId);
        }
        return null;
    };

    const toPosition = (): BarPosition | null => {
        if (props.to) return props.to;
        if (props.taskStore && props.toId) {
            return getAdjustedPosition(props.toId);
        }
        return null;
    };

    const config = (): ArrowConfig => ({
        startAnchor: props.startAnchor ?? DEFAULTS.START_ANCHOR,
        startOffset: props.startOffset,
        endAnchor: props.endAnchor ?? DEFAULTS.END_ANCHOR,
        endOffset: props.endOffset ?? DEFAULTS.ANCHOR_OFFSET,
        routing: props.routing ?? DEFAULTS.ROUTING,
        curveRadius: props.curveRadius ?? DEFAULTS.CURVE_RADIUS,
        headSize: props.headSize ?? DEFAULTS.HEAD_SIZE,
        headShape: props.headShape ?? DEFAULTS.HEAD_SHAPE,
        headFill: props.headFill ?? DEFAULTS.HEAD_FILL,
        dependencyType: props.dependencyType ?? 'FS',
    });

    const paths = (): { linePath: string; headPath: string } => {
        const from = fromPosition();
        const to = toPosition();
        if (!from || !to) return { linePath: '', headPath: '' };
        return generatePath(from, to, config());
    };

    const stroke = (): string => props.stroke ?? DEFAULTS.STROKE;
    const headShape = (): HeadShape => props.headShape ?? DEFAULTS.HEAD_SHAPE;
    const headFill = (): boolean => props.headFill ?? DEFAULTS.HEAD_FILL;

    // Chevron is always stroke-only, never filled
    const shouldFillHead = (): boolean =>
        headFill() && headShape() !== 'chevron';

    return (
        <g
            data-arrow-id={props.id}
            data-from={props.fromId}
            data-to={props.toId}
            class={props.class}
        >
            {/* Line path - stroke only, no fill */}
            <path
                d={paths().linePath}
                fill="none"
                stroke={stroke()}
                stroke-width={props.strokeWidth ?? DEFAULTS.STROKE_WIDTH}
                stroke-opacity={props.strokeOpacity ?? DEFAULTS.STROKE_OPACITY}
                stroke-dasharray={props.strokeDasharray}
                stroke-linecap={props.strokeLinecap ?? DEFAULTS.STROKE_LINECAP}
                stroke-linejoin={
                    props.strokeLinejoin ?? DEFAULTS.STROKE_LINEJOIN
                }
            />
            {/* Arrow head path - can have fill */}
            {paths().headPath && (
                <path
                    d={paths().headPath}
                    fill={shouldFillHead() ? stroke() : 'none'}
                    stroke={stroke()}
                    stroke-width={props.strokeWidth ?? DEFAULTS.STROKE_WIDTH}
                    stroke-opacity={
                        props.strokeOpacity ?? DEFAULTS.STROKE_OPACITY
                    }
                    stroke-linecap={
                        props.strokeLinecap ?? DEFAULTS.STROKE_LINECAP
                    }
                    stroke-linejoin={
                        props.strokeLinejoin ?? DEFAULTS.STROKE_LINEJOIN
                    }
                />
            )}
        </g>
    );
}

// Backward-compatible re-exports for existing consumers (ArrowDemo, etc.)
export {
    getAnchorPoint,
    autoSelectStartAnchor,
    generateArrowHeadRight,
    DEFAULTS as ARROW_DEFAULTS,
};

export type {
    ArrowProps,
    ArrowConfig,
    AnchorType,
    RoutingType,
    HeadShape,
    Point,
};
