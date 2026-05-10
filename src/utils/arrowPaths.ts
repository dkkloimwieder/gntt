import type { Point, AnchorType } from './arrowAnchors';

export type RoutingType = 'straight' | 'orthogonal';

/**
 * Straight line between two points.
 */
export function straightPath(start: Point, end: Point): string {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

/**
 * Orthogonal path with rounded corners. Dispatches to a sub-routing
 * function based on the start/end anchor combination.
 */
export function orthogonalPath(
    start: Point,
    end: Point,
    startAnchor: AnchorType,
    endAnchor: AnchorType,
    curveRadius: number,
): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return straightPath(start, end);
    if (Math.abs(dy) < 2) return straightPath(start, end);

    let curve = Math.min(curveRadius, Math.abs(dx) / 2, Math.abs(dy) / 2);
    if (curve < 1) curve = 0;

    const isVerticalStart = startAnchor === 'top' || startAnchor === 'bottom';
    const isVerticalEnd = endAnchor === 'top' || endAnchor === 'bottom';
    const isHorizontalEnd = endAnchor === 'left' || endAnchor === 'right';

    if (isVerticalStart && isVerticalEnd) {
        return verticalToVerticalPath(start, end, curve);
    }

    if (isVerticalStart && isHorizontalEnd) {
        return verticalToHorizontalPath(
            start,
            end,
            startAnchor,
            endAnchor,
            curve,
        );
    }

    if (isVerticalStart) {
        return verticalFirstPath(start, end, curve);
    }
    return horizontalFirstPath(start, end, curve);
}

/**
 * Vertical exit to vertical entry (bottom-to-top is most common in Gantt).
 * Goes: down, horizontal, down to target.
 */
function verticalToVerticalPath(
    start: Point,
    end: Point,
    curve: number,
): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (Math.abs(dx) < curve * 2) return straightPath(start, end);

    const midY = start.y + dy / 2;

    if (dy > 0) {
        // Going DOWN: exit bottom, enter top
        const firstSweep = dx > 0 ? '0' : '1';
        const secondSweep = dx > 0 ? '1' : '0';
        const curveX = dx > 0 ? curve : -curve;

        return `
            M ${start.x} ${start.y}
            V ${midY - curve}
            a ${curve} ${curve} 0 0 ${firstSweep} ${curveX} ${curve}
            H ${end.x - curveX}
            a ${curve} ${curve} 0 0 ${secondSweep} ${curveX} ${curve}
            V ${end.y}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
    // Going UP: exit top, enter bottom
    return `
        M ${start.x} ${start.y}
        V ${midY + curve}
        a ${curve} ${curve} 0 0 ${dx > 0 ? '1' : '0'} ${dx > 0 ? curve : -curve} ${-curve}
        H ${end.x - (dx > 0 ? curve : -curve)}
        a ${curve} ${curve} 0 0 ${dx > 0 ? '0' : '1'} ${dx > 0 ? curve : -curve} ${-curve}
        V ${end.y}
    `
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Vertical exit to horizontal entry (bottom to left is most common).
 * Goes: down, then horizontal to the target edge.
 */
function verticalToHorizontalPath(
    start: Point,
    end: Point,
    startAnchor: AnchorType,
    endAnchor: AnchorType,
    curve: number,
): string {
    const dy = end.y - start.y;
    const goingDown = startAnchor === 'bottom';
    const enteringLeft = endAnchor === 'left';

    if (Math.abs(dy) < curve * 2) return straightPath(start, end);

    if (goingDown && enteringLeft) {
        return `
            M ${start.x} ${start.y}
            V ${end.y - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
    if (goingDown && !enteringLeft) {
        // Approach from the right side: down, curve right, past target, then left in.
        const overshoot = 25;
        const overshootX = end.x + overshoot;

        return `
            M ${start.x} ${start.y}
            V ${end.y - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${curve}
            H ${overshootX}
            L ${overshootX} ${end.y}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
    if (!goingDown && enteringLeft) {
        return `
            M ${start.x} ${start.y}
            V ${end.y + curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
    return `
        M ${start.x} ${start.y}
        V ${end.y + curve}
        a ${curve} ${curve} 0 0 0 ${-curve} ${-curve}
        H ${end.x}
    `
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Starts vertical (from top/bottom), then turns horizontal. Simple L-shape.
 */
function verticalFirstPath(start: Point, end: Point, curve: number): string {
    const dy = end.y - start.y;
    const goingUp = dy < 0;

    if (Math.abs(end.x - start.x) < curve) return straightPath(start, end);

    if (goingUp) {
        return `
            M ${start.x} ${start.y}
            V ${end.y + curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
    return `
        M ${start.x} ${start.y}
        V ${end.y - curve}
        a ${curve} ${curve} 0 0 0 ${curve} ${curve}
        H ${end.x}
    `
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Starts horizontal (from right edge), then S-curves to target.
 */
function horizontalFirstPath(start: Point, end: Point, curve: number): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const goingUp = dy < 0;

    if (Math.abs(dy) < curve * 2) return straightPath(start, end);

    const midX = start.x + dx / 2;

    if (goingUp) {
        return `
            M ${start.x} ${start.y}
            H ${midX - curve}
            a ${curve} ${curve} 0 0 0 ${curve} ${-curve}
            V ${end.y + curve}
            a ${curve} ${curve} 0 0 1 ${curve} ${-curve}
            H ${end.x}
        `
            .replace(/\s+/g, ' ')
            .trim();
    }
    return `
        M ${start.x} ${start.y}
        H ${midX - curve}
        a ${curve} ${curve} 0 0 1 ${curve} ${curve}
        V ${end.y - curve}
        a ${curve} ${curve} 0 0 0 ${curve} ${curve}
        H ${end.x}
    `
        .replace(/\s+/g, ' ')
        .trim();
}
