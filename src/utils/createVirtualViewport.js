import { createMemo } from 'solid-js';
import { findRowAtY } from './rowLayoutCalculator.js';

// Custom equals function for range objects - compare by value, not reference
const rangeEquals = (a, b) => a?.start === b?.start && a?.end === b?.end;

/**
 * createVirtualViewport - Simple 2D viewport virtualization.
 *
 * Following the solid-primitives/virtual pattern:
 * Simple math: offset / itemSize → visible range
 *
 * Supports both fixed row heights and variable row heights.
 * For variable heights, pass sortedRowLayouts (pre-sorted array).
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
 * @param {number} [config.overscanRows=20] - Extra rows to render outside viewport (~1000px buffer)
 * @param {number} [config.overscanX=2500] - Extra pixels for X range filtering
 *
 * @returns {Object} Reactive viewport ranges
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
        overscanRows = 20, // ~1000px at 48px/row - moderate buffer for deferred updates
        overscanX = 2500, // buffer for horizontal scrolling
    } = config;

    // Column range (for DateHeaders) - uses value equality to prevent spurious updates
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
    }, undefined, { equals: rangeEquals });

    // Row range (for Grid, TaskLayer, ArrowLayer) - uses value equality
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
    }, undefined, { equals: rangeEquals });

    // X pixel range (for TaskLayer, ArrowLayer horizontal filtering) - uses value equality
    // Quantized to 100px to reduce update frequency during horizontal scroll
    const X_QUANT = 100;
    const xRange = createMemo(() => {
        const sx = scrollX();
        const vw = viewportWidth();

        return {
            start: Math.max(0, Math.floor((sx - overscanX) / X_QUANT) * X_QUANT),
            end: Math.ceil((sx + vw + overscanX) / X_QUANT) * X_QUANT,
        };
    }, undefined, { equals: rangeEquals });

    // Y pixel range (for ArrowLayer vertical filtering) - uses value equality
    const yRange = createMemo(() => {
        const sy = scrollY();
        const vh = viewportHeight();
        const rh = rowHeight?.() || 48;
        const overscanY = overscanRows * rh;

        return {
            start: Math.max(0, sy - overscanY),
            end: sy + vh + overscanY,
        };
    }, undefined, { equals: rangeEquals });

    return { colRange, rowRange, xRange, yRange };
}
