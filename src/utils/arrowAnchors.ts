import type { BarPosition, DependencyType } from '../types';

export interface Point {
    x: number;
    y: number;
}

export type AnchorType =
    | 'auto'
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'center';

// Threshold (px) for "same-row" detection in auto-anchor selection.
const ALIGNMENT_THRESHOLD = 8;

/**
 * Calculate the x,y coordinates of an anchor point on a bar.
 */
export function getAnchorPoint(
    bar: BarPosition,
    anchor: AnchorType,
    offset = 0.5,
): Point {
    const t = Math.max(0, Math.min(1, offset));

    switch (anchor) {
        case 'top':
            return { x: bar.x + bar.width * t, y: bar.y };
        case 'bottom':
            return { x: bar.x + bar.width * t, y: bar.y + bar.height };
        case 'left':
            return { x: bar.x, y: bar.y + bar.height * t };
        case 'right':
            return { x: bar.x + bar.width, y: bar.y + bar.height * t };
        case 'center':
            return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
        default:
            return { x: bar.x + bar.width, y: bar.y + bar.height / 2 };
    }
}

/**
 * Automatically select the best start anchor based on geometry and dependency type.
 *
 * Gantt chart convention:
 * - Different rows: Exit from BOTTOM (going down) or TOP (going up)
 * - Same row: Exit from side (RIGHT for FS/FF, LEFT for SS/SF)
 */
export function autoSelectStartAnchor(
    from: BarPosition,
    to: BarPosition,
    dependencyType: DependencyType = 'FS',
): AnchorType {
    const fromCenterY = from.y + from.height / 2;
    const toCenterY = to.y + to.height / 2;
    const dy = toCenterY - fromCenterY;
    const sameRow = Math.abs(dy) <= ALIGNMENT_THRESHOLD;

    if (dependencyType === 'SS' || dependencyType === 'SF') {
        if (sameRow) return 'left';
        return dy < 0 ? 'top' : 'bottom';
    }

    if (sameRow) return 'right';
    return dy < 0 ? 'top' : 'bottom';
}

/**
 * Automatically select the best end anchor based on dependency type and geometry.
 *
 * Entry point depends on what the dependency constrains:
 * - -Start dependencies (FS, SS): enter from LEFT
 * - -Finish dependencies (FF, SF): enter from RIGHT for same row, TOP otherwise
 */
export function autoSelectEndAnchor(
    from: BarPosition,
    to: BarPosition,
    dependencyType: DependencyType = 'FS',
): AnchorType {
    const fromCenterY = from.y + from.height / 2;
    const toCenterY = to.y + to.height / 2;
    const dy = toCenterY - fromCenterY;
    const sameRow = Math.abs(dy) <= ALIGNMENT_THRESHOLD;

    if (dependencyType === 'FF' || dependencyType === 'SF') {
        return sameRow ? 'right' : 'top';
    }
    return 'left';
}

/**
 * Calculate optimal offset for edge anchors based on target position.
 * - FS/FF: Exit near the END (right) of the predecessor
 * - SS/SF: Exit near the START (left) of the predecessor
 */
export function calculateSmartOffset(
    from: BarPosition,
    to: BarPosition,
    anchor: AnchorType,
    curveRadius: number,
    dependencyType: DependencyType = 'FS',
): number {
    if (anchor === 'right' || anchor === 'left') {
        return 0.5;
    }

    if (anchor === 'top' || anchor === 'bottom') {
        if (dependencyType === 'SS' || dependencyType === 'SF') {
            return 0.1;
        }

        const defaultOffset = 0.9;
        const maxExitX = to.x - curveRadius;
        const maxOffset = (maxExitX - from.x) / from.width;

        return Math.max(0.1, Math.min(defaultOffset, maxOffset));
    }

    return 0.5;
}
