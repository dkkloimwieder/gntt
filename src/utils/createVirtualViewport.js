import { createMemo } from 'solid-js';

/**
 * createVirtualViewport - Simple 2D viewport virtualization.
 *
 * Following the solid-primitives/virtual pattern:
 * Simple math: offset / itemSize → visible range
 *
 * No throttling, no hysteresis - just pure reactive calculations.
 *
 * @param {Object} config
 * @param {Accessor<number>} config.scrollX - Horizontal scroll position
 * @param {Accessor<number>} config.scrollY - Vertical scroll position
 * @param {Accessor<number>} config.viewportWidth - Viewport width in pixels
 * @param {Accessor<number>} config.viewportHeight - Viewport height in pixels
 * @param {Accessor<number>} config.columnWidth - Width of each column
 * @param {Accessor<number>} config.rowHeight - Height of each row
 * @param {Accessor<number>} config.totalRows - Total number of rows
 * @param {number} [config.overscanCols=5] - Extra columns to render outside viewport
 * @param {number} [config.overscanRows=3] - Extra rows to render outside viewport
 * @param {number} [config.overscanX=600] - Extra pixels for X range filtering
 *
 * @returns {Object} Reactive viewport ranges
 * @returns {Accessor<{start: number, end: number}>} colRange - Visible column range
 * @returns {Accessor<{start: number, end: number}>} rowRange - Visible row range
 * @returns {Accessor<{start: number, end: number}>} xRange - Visible X pixel range
 */
export function createVirtualViewport(config) {
    const {
        scrollX,
        scrollY,
        viewportWidth,
        viewportHeight,
        columnWidth,
        rowHeight,
        totalRows,
        overscanCols = 5,
        overscanRows = 3,
        overscanX = 600,
    } = config;

    // Column range (for DateHeaders)
    const colRange = createMemo(() => {
        const cw = columnWidth();
        const sx = scrollX();
        const vw = viewportWidth();

        if (cw <= 0 || vw <= 0) {
            return { start: 0, end: 100 };
        }

        return {
            start: Math.max(0, Math.floor(sx / cw) - overscanCols),
            end: Math.ceil((sx + vw) / cw) + overscanCols,
        };
    });

    // Row range (for Grid, TaskLayer, ArrowLayer)
    const rowRange = createMemo(() => {
        const rh = rowHeight();
        const sy = scrollY();
        const vh = viewportHeight();
        const total = totalRows();

        if (rh <= 0 || vh <= 0) {
            return { start: 0, end: Math.min(total, 30) };
        }

        return {
            start: Math.max(0, Math.floor(sy / rh) - overscanRows),
            end: Math.min(total, Math.ceil((sy + vh) / rh) + overscanRows),
        };
    });

    // X pixel range (for TaskLayer, ArrowLayer horizontal filtering)
    const xRange = createMemo(() => {
        const sx = scrollX();
        const vw = viewportWidth();

        return {
            start: Math.max(0, sx - overscanX),
            end: sx + vw + overscanX,
        };
    });

    return { colRange, rowRange, xRange };
}
