import type { Point, AnchorType } from './arrowAnchors';

export type HeadShape = 'chevron' | 'triangle' | 'diamond' | 'circle' | 'none';
export type HeadDirection = 'right' | 'left' | 'up' | 'down';

/**
 * Generate arrow head pointing RIGHT (relative path; for use after a line path).
 * Used by ArrowLayerBatched's append-after-line pattern.
 */
export function generateArrowHeadRight(
    shape: HeadShape,
    size: number,
    fill: boolean,
): string {
    if (size <= 0 || shape === 'none') return '';

    switch (shape) {
        case 'chevron':
            return `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}`;
        case 'triangle':
            return (
                `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}` +
                (fill ? ` l 0 ${-size * 2}` : '')
            );
        case 'diamond':
            return `m ${-size * 2} 0 l ${size} ${-size} l ${size} ${size} l ${-size} ${size} l ${-size} ${-size}`;
        case 'circle': {
            const r = size * 0.7;
            const k = 0.5523;
            return (
                `m ${-r * 2} 0 ` +
                `c 0 ${-r * k} ${r * (1 - k)} ${-r} ${r} ${-r} ` +
                `c ${r * k} 0 ${r} ${r * (1 - k)} ${r} ${r} ` +
                `c 0 ${r * k} ${-r * (1 - k)} ${r} ${-r} ${r} ` +
                `c ${-r * k} 0 ${-r} ${-r * (1 - k)} ${-r} ${-r}`
            );
        }
        default:
            return `m ${-size} ${-size} l ${size} ${size} l ${-size} ${size}`;
    }
}

/**
 * Generate arrow head as an absolute-positioned path string.
 * Direction selects which way the arrow tip points.
 */
export function generateArrowHeadPath(
    endPoint: Point,
    shape: HeadShape,
    size: number,
    fill: boolean,
    direction: HeadDirection = 'right',
): string {
    if (size <= 0 || shape === 'none') return '';

    const x = endPoint.x;
    const y = endPoint.y;

    if (direction === 'down') {
        switch (shape) {
            case 'chevron':
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size}`;
            case 'triangle':
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size} Z`;
            case 'diamond':
                return `M ${x} ${y - size * 2} L ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size} Z`;
            case 'circle': {
                const r = size * 0.7;
                const cy = y - r;
                return `M ${x} ${cy - r} A ${r} ${r} 0 1 1 ${x} ${cy + r} A ${r} ${r} 0 1 1 ${x} ${cy - r}`;
            }
            default:
                return `M ${x - size} ${y - size} L ${x} ${y} L ${x + size} ${y - size}`;
        }
    }
    if (direction === 'up') {
        switch (shape) {
            case 'chevron':
                return `M ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size}`;
            case 'triangle':
                return `M ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size} Z`;
            case 'diamond':
                return `M ${x} ${y + size * 2} L ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size} Z`;
            case 'circle': {
                const r = size * 0.7;
                const cy = y + r;
                return `M ${x} ${cy - r} A ${r} ${r} 0 1 1 ${x} ${cy + r} A ${r} ${r} 0 1 1 ${x} ${cy - r}`;
            }
            default:
                return `M ${x - size} ${y + size} L ${x} ${y} L ${x + size} ${y + size}`;
        }
    }
    if (direction === 'left') {
        switch (shape) {
            case 'chevron':
                return `M ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size}`;
            case 'triangle':
                return `M ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size} Z`;
            case 'diamond':
                return `M ${x + size * 2} ${y} L ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size} Z`;
            case 'circle': {
                const r = size * 0.7;
                const cx = x + r;
                return `M ${cx - r} ${y} A ${r} ${r} 0 1 1 ${cx + r} ${y} A ${r} ${r} 0 1 1 ${cx - r} ${y}`;
            }
            default:
                return `M ${x + size} ${y - size} L ${x} ${y} L ${x + size} ${y + size}`;
        }
    }
    // direction === 'right'
    switch (shape) {
        case 'chevron':
            return `M ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size}`;
        case 'triangle':
            return `M ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size} Z`;
        case 'diamond':
            return `M ${x - size * 2} ${y} L ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size} Z`;
        case 'circle': {
            const r = size * 0.7;
            const cx = x - r;
            return `M ${cx - r} ${y} A ${r} ${r} 0 1 1 ${cx + r} ${y} A ${r} ${r} 0 1 1 ${cx - r} ${y}`;
        }
        default:
            return `M ${x - size} ${y - size} L ${x} ${y} L ${x - size} ${y + size}`;
    }
}

/**
 * Map an end-anchor to the direction the arrow head should point.
 */
export function getArrowHeadDirection(endAnchor: AnchorType): HeadDirection {
    switch (endAnchor) {
        case 'top':
            return 'down';
        case 'bottom':
            return 'up';
        case 'left':
            return 'right';
        case 'right':
            return 'left';
        default:
            return 'right';
    }
}
