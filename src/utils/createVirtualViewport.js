import { createMemo } from 'solid-js';
import { findRowAtY } from './rowLayoutCalculator.js';

/**
 * createVirtualViewport - Simple 2D viewport virtualization.
 *
 * Following the solid-primitives/virtual pattern:
 * Simple math: offset / itemSize → visible range
 *
 * Supports both fixed row heights and variable row heights.
 * For variable heights, pass sortedRowLayouts (pre-sorted array).
 *
 * No throttling, no hysteresis - just pure reactive calculations.
 *
 * @param {Object} config
 * @param {Accessor<number>} config.scrollX - Horizontal scroll position
 * @param {Accessor<number>} config.scrollY - Vertical scroll position
 * @param {Accessor<number>} config.viewportWidth - Viewport width in pixels
 * @param {Accessor<number>} config.viewportHeight - Viewport height in pixels
 * @param {Accessor<number>} config.columnWidth - Width of each column
 * @param {Accessor<number>} config.rowHeight - Height of each row (used for fixed mode)
 * @param {Accessor<number>} config.totalRows - Total number of rows
 * @param {Accessor<Array>} [config.sortedRowLayouts] - Sorted array of {y, height} for variable heights
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
        sortedRowLayouts,
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
    // Supports both fixed and variable row heights
    const rowRange = createMemo(() => {
        const sy = scrollY();
        const vh = viewportHeight();
        const total = totalRows();

        if (vh <= 0) {
            return { start: 0, end: Math.min(total, 30) };
        }

        // Check for variable row heights mode
        const layouts = sortedRowLayouts?.();
        if (layouts && layouts.length > 0) {
            // Variable height mode - use binary search
            const startRow = Math.max(0, findRowAtY(layouts, sy) - overscanRows);
            const endRow = Math.min(
                total,
                findRowAtY(layouts, sy + vh) + 1 + overscanRows
            );
            return { start: startRow, end: endRow };
        }

        // Fixed height mode - use simple division
        const rh = rowHeight();
        if (rh <= 0) {
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

    // Y pixel range (for ArrowLayer vertical filtering)
    const yRange = createMemo(() => {
        const sy = scrollY();
        const vh = viewportHeight();
        const overscanY = overscanRows * (rowHeight?.() || 48); // Convert row overscan to pixels

        return {
            start: Math.max(0, sy - overscanY),
            end: sy + vh + overscanY,
        };
    });

    return { colRange, rowRange, xRange, yRange };
}
