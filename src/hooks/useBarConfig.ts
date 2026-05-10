/**
 * Bar configuration accessors.
 *
 * Each memo resolves: ganttConfig store value → prop fallback → default.
 * Memoizing here avoids repeated optional chaining on every reactive read.
 *
 * Extracted from Bar.tsx purely for line-count / single-responsibility —
 * no behavior change.
 */
import { createMemo, type Accessor } from 'solid-js';
import { DEFAULT_COLUMN_WIDTH } from '../constants';
import type { GanttConfigStore } from '../stores/ganttConfigStore';

export interface BarConfigProps {
    ganttConfig?: GanttConfigStore;
    cornerRadius?: number;
    readonly?: boolean;
    readonlyDates?: boolean;
    readonlyProgress?: boolean;
    showExpectedProgress?: boolean;
    columnWidth?: number;
    ignoredPositions?: number[];
}

export interface BarConfig {
    barCornerRadius: Accessor<number>;
    readonly: Accessor<boolean>;
    readonlyDates: Accessor<boolean>;
    readonlyProgress: Accessor<boolean>;
    showExpectedProgress: Accessor<boolean>;
    columnWidth: Accessor<number>;
    ignoredPositions: Accessor<number[]>;
}

export function useBarConfig(props: BarConfigProps): BarConfig {
    return {
        barCornerRadius: createMemo(
            () =>
                props.ganttConfig?.barCornerRadius?.() ??
                props.cornerRadius ??
                3,
        ),
        readonly: createMemo(
            () => props.ganttConfig?.readonly?.() ?? props.readonly ?? false,
        ),
        readonlyDates: createMemo(
            () =>
                props.ganttConfig?.readonlyDates?.() ??
                props.readonlyDates ??
                false,
        ),
        readonlyProgress: createMemo(
            () =>
                props.ganttConfig?.readonlyProgress?.() ??
                props.readonlyProgress ??
                false,
        ),
        showExpectedProgress: createMemo(
            () =>
                props.ganttConfig?.showExpectedProgress?.() ??
                props.showExpectedProgress ??
                false,
        ),
        columnWidth: createMemo(
            () =>
                props.ganttConfig?.columnWidth?.() ??
                props.columnWidth ??
                DEFAULT_COLUMN_WIDTH,
        ),
        ignoredPositions: createMemo(
            () =>
                props.ganttConfig?.ignoredPositions?.() ??
                props.ignoredPositions ??
                [],
        ),
    };
}
