import { createMemo, Accessor } from 'solid-js';
import { findRowAtY, RowLayout } from './rowLayoutCalculator';

interface Range {
    start: number;
    end: number;
}

interface VirtualViewportConfig {
    scrollX: Accessor<number>;
    scrollY: Accessor<number>;
    viewportWidth: Accessor<number>;
    viewportHeight: Accessor<number>;
    columnWidth: Accessor<number>;
    rowHeight: Accessor<number>;
    totalRows: Accessor<number>;
    sortedRowLayouts?: Accessor<RowLayout[]>;
    overscanCols?: number;
    overscanRows?: number;
    overscanX?: number;
}

interface VirtualViewportResult {
    colRange: Accessor<Range>;
    rowRange: Accessor<Range>;
    xRange: Accessor<Range>;
}

const rangeEquals = (a: Range | undefined, b: Range | undefined): boolean =>
    a?.start === b?.start && a?.end === b?.end;

export function createVirtualViewport(
    config: VirtualViewportConfig,
): VirtualViewportResult {
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
        overscanRows = 20,
        overscanX = 2500,
    } = config;

    const colRange = createMemo<Range>(
        () => {
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
        },
        { equals: rangeEquals },
    );

    const rowRange = createMemo<Range>(
        () => {
            const sy = scrollY();
            const vh = viewportHeight();
            const total = totalRows();

            if (vh <= 0) {
                return { start: 0, end: Math.min(total, 30) };
            }

            const layouts = sortedRowLayouts?.();
            if (layouts && layouts.length > 0) {
                const startRow = Math.max(
                    0,
                    findRowAtY(layouts, sy) - overscanRows,
                );
                const endRow = Math.min(
                    total,
                    findRowAtY(layouts, sy + vh) + 1 + overscanRows,
                );
                return { start: startRow, end: endRow };
            }

            const rh = rowHeight();
            if (rh <= 0) {
                return { start: 0, end: Math.min(total, 30) };
            }

            return {
                start: Math.max(0, Math.floor(sy / rh) - overscanRows),
                end: Math.min(total, Math.ceil((sy + vh) / rh) + overscanRows),
            };
        },
        { equals: rangeEquals },
    );

    const X_QUANT = 100;
    const xRange = createMemo<Range>(
        () => {
            const sx = scrollX();
            const vw = viewportWidth();

            return {
                start: Math.max(
                    0,
                    Math.floor((sx - overscanX) / X_QUANT) * X_QUANT,
                ),
                end: Math.ceil((sx + vw + overscanX) / X_QUANT) * X_QUANT,
            };
        },
        { equals: rangeEquals },
    );

    return { colRange, rowRange, xRange };
}

export type { Range, VirtualViewportConfig, VirtualViewportResult };
