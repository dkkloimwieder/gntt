/**
 * Path generation for ArrowLayerBatched — the high-performance batched
 * arrow renderer. Differs from the per-arrow Arrow component in two ways:
 *
 * 1. Lines use right-angle SVG (H/V) only — no rounded corners. Cheaper
 *    to recompute every scroll frame at the cost of visual smoothness.
 * 2. Heads only support 'chevron' shape. Other shapes need per-instance
 *    fill control which the batched path can't express in a single <path>.
 *
 * Anchor selection (auto*Anchor) also differs: SS/SF always exit left
 * regardless of row delta; FF/SF always enter right. The per-arrow Arrow
 * component does smarter per-row picks. Batched mode favors predictable
 * routing for visual coherence across hundreds of arrows.
 */
import type { BarPosition, DependencyType } from '../types';
import {
    getAnchorPoint,
    calculateSmartOffset,
    type Point,
} from './arrowAnchors';

// Threshold (px) for "same-row" detection — same constant Arrow uses.
const ALIGNMENT_THRESHOLD = 8;

export type BatchedAnchorType = 'top' | 'bottom' | 'left' | 'right';

export interface ArrowPaths {
    linePath: string;
    headPath: string;
}

/**
 * Anchor selection — see file-header note for why this differs from
 * arrowAnchors.autoSelectStartAnchor.
 */
export function autoStartAnchor(
    from: BarPosition,
    to: BarPosition,
    depType: DependencyType,
): BatchedAnchorType {
    const dy = to.y + to.height / 2 - (from.y + from.height / 2);
    const sameRow = Math.abs(dy) <= ALIGNMENT_THRESHOLD;

    if (depType === 'SS') return 'left';
    if (depType === 'FF') return 'right';
    if (depType === 'SF') return 'left';
    // FS: right on same row, top/bottom across rows.
    return sameRow ? 'right' : dy < 0 ? 'top' : 'bottom';
}

export function autoEndAnchor(
    _from: BarPosition,
    _to: BarPosition,
    depType: DependencyType,
): BatchedAnchorType {
    if (depType === 'FF' || depType === 'SF') return 'right';
    return 'left';
}

/**
 * Right-angle (no curve) line between two points. Uses H/V SVG commands
 * for the smallest possible path string.
 */
export function generateLinePath(
    start: Point,
    end: Point,
    startAnchor: BatchedAnchorType,
    endAnchor: BatchedAnchorType,
): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || Math.abs(dy) < 2) {
        return `M${start.x},${start.y}L${end.x},${end.y}`;
    }

    const isVerticalStart = startAnchor === 'top' || startAnchor === 'bottom';
    const isLeftToLeft = startAnchor === 'left' && endAnchor === 'left';
    const isRightToRight = startAnchor === 'right' && endAnchor === 'right';

    if (isLeftToLeft) {
        // SS: bracket opening right
        const minX = Math.min(start.x, end.x);
        const leftX = Math.max(minX - 20, 2);
        return `M${start.x},${start.y}H${leftX}V${end.y}H${end.x}`;
    }

    if (isRightToRight) {
        // FF: bracket opening left
        const maxX = Math.max(start.x, end.x);
        const rightX = maxX + 20;
        return `M${start.x},${start.y}H${rightX}V${end.y}H${end.x}`;
    }

    if (isVerticalStart) {
        // L-shape
        return `M${start.x},${start.y}V${end.y}H${end.x}`;
    }

    // FS default: S-shape with midpoint
    const midX = (start.x + end.x) / 2;
    return `M${start.x},${start.y}H${midX}V${end.y}H${end.x}`;
}

/**
 * Chevron arrow head at the end point. Direction follows the end anchor.
 * Only chevron is supported — see file header.
 */
export function generateHeadPath(
    end: Point,
    endAnchor: BatchedAnchorType,
    size: number,
): string {
    if (size <= 0) return '';

    const x = end.x;
    const y = end.y;

    switch (endAnchor) {
        case 'top':
            return `M${x - size},${y - size}L${x},${y}L${x + size},${y - size}`;
        case 'bottom':
            return `M${x - size},${y + size}L${x},${y}L${x + size},${y + size}`;
        case 'right':
            return `M${x + size},${y - size}L${x},${y}L${x + size},${y + size}`;
        default:
            return `M${x - size},${y - size}L${x},${y}L${x - size},${y + size}`;
    }
}

/**
 * Compose anchors + line + head into one ArrowPaths for a single dependency.
 */
export function generateArrow(
    from: BarPosition,
    to: BarPosition,
    depType: DependencyType,
    curve: number,
    headSize: number,
): ArrowPaths {
    const startAnchor = autoStartAnchor(from, to, depType);
    const endAnchor = autoEndAnchor(from, to, depType);
    const startOffset = calculateSmartOffset(
        from,
        to,
        startAnchor,
        curve,
        depType,
    );

    const start = getAnchorPoint(from, startAnchor, startOffset);
    const end = getAnchorPoint(to, endAnchor, 0.5);

    return {
        linePath: generateLinePath(start, end, startAnchor, endAnchor),
        headPath: generateHeadPath(end, endAnchor, headSize),
    };
}
