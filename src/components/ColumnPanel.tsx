import { For, createMemo, JSX } from 'solid-js';
import { DEFAULT_BAR_HEIGHT, DEFAULT_PADDING } from '../constants';
import type { ResourceStore } from '../stores/resourceStore';
import type { TaskStore } from '../stores/taskStore';
import type { GanttConfigStore } from '../stores/ganttConfigStore';
import type { RowLayout } from '../utils/rowLayoutCalculator';
import type { ProcessedTask } from '../types';

/**
 * A single column in the configurable left panel.
 * - render? receives the first task on the row (or undefined when no
 *   task exists) plus the resource id; default cell text is `task[key]`
 *   stringified.
 */
export interface ColumnDef {
    key: string;
    label: string;
    width?: number;
    render?: (
        task: ProcessedTask | undefined,
        resourceId: string,
    ) => JSX.Element | string | number | null | undefined;
}

interface DisplayRow {
    id: string;
    name?: string;
    type: 'resource' | 'group' | 'project';
    displayIndex: number;
}

interface ColumnPanelProps {
    columns: ColumnDef[];
    taskStore?: TaskStore;
    resourceStore?: ResourceStore;
    ganttConfig?: GanttConfigStore;
    rowLayouts?: Map<string, RowLayout> | null;
    startRow?: number;
    endRow?: number;
}

const DEFAULT_COLUMN_WIDTH = 120;

/**
 * Compute the total width occupied by the column set (sum of widths
 * with the default applied per missing entry).
 */
export function computePanelWidth(columns: ColumnDef[]): number {
    let total = 0;
    for (const c of columns) total += c.width ?? DEFAULT_COLUMN_WIDTH;
    return total;
}

/**
 * Header row: one cell per column, labels left-aligned. Mirrors the
 * existing single-cell "Resource" header but spans the panel width.
 */
export function ColumnPanelHeader(props: {
    columns: ColumnDef[];
}): JSX.Element {
    return (
        <div
            class="column-panel-header"
            style={{
                display: 'flex',
                width: '100%',
                height: '100%',
                'align-items': 'stretch',
            }}
        >
            <For each={props.columns}>
                {(col) => (
                    <div
                        class="column-panel-header-cell"
                        data-col-key={col.key}
                        style={{
                            width: `${col.width ?? DEFAULT_COLUMN_WIDTH}px`,
                            'flex-shrink': 0,
                            display: 'flex',
                            'align-items': 'center',
                            'padding-left': '12px',
                            'border-right':
                                '1px solid var(--g-grid-line-color, #e5e7eb)',
                            'font-weight': '600',
                            'font-size': '12px',
                            color: 'var(--g-header-text-color, #333)',
                        }}
                    >
                        {col.label}
                    </div>
                )}
            </For>
        </div>
    );
}

/**
 * Body: one row per visible resource; each row contains N column cells
 * positioned absolutely so they line up with the chart bars.
 */
export function ColumnPanel(props: ColumnPanelProps): JSX.Element {
    const displayResources = (): DisplayRow[] =>
        (props.resourceStore?.displayResources() as DisplayRow[]) || [];

    const startRow = (): number => props.startRow ?? 0;
    const endRow = (): number => props.endRow ?? displayResources().length;

    const barHeight = (): number =>
        props.ganttConfig?.barHeight?.() ?? DEFAULT_BAR_HEIGHT;
    const padding = (): number =>
        props.ganttConfig?.padding?.() ?? DEFAULT_PADDING;

    const baseRowHeight = (): number => barHeight() + padding();

    const rowLayouts = (): Map<string, RowLayout> | null =>
        props.rowLayouts || null;

    const totalHeight = (): number => {
        const layouts = rowLayouts();
        if (layouts) {
            const total = layouts.get('__total__');
            if (total) return total.height;
        }
        return displayResources().length * baseRowHeight();
    };

    // First task that lives on the given resource. Cheap O(N) scan over
    // store keys; the panel is row-virtualized so this only runs for
    // visible rows. Could be cached if it shows up in profiles.
    const firstTaskForResource = (
        resourceId: string,
    ): ProcessedTask | undefined => {
        const tasks = props.taskStore?.tasks;
        if (!tasks) return undefined;
        for (const id of Object.keys(tasks)) {
            const t = tasks[id] as ProcessedTask | undefined;
            if (t && t.resource === resourceId) return t;
        }
        return undefined;
    };

    const visibleResources = createMemo((): DisplayRow[] => {
        const all = displayResources();
        const start = Math.max(0, startRow());
        const end = Math.min(all.length, endRow());
        const visible: DisplayRow[] = [];
        for (let i = start; i < end; i++) {
            const r = all[i];
            if (r) visible.push(r);
        }
        return visible;
    });

    const rowStyle = (item: DisplayRow): Record<string, string | number> => {
        const layouts = rowLayouts();
        const layout = layouts?.get(item.id);
        const top = layout?.y ?? item.displayIndex * baseRowHeight();
        const height = layout?.height ?? baseRowHeight();
        const isGroup = item.type === 'group';
        const isProject = item.type === 'project';
        return {
            position: 'absolute',
            left: '0',
            right: '0',
            top: `${top}px`,
            height: `${height}px`,
            display: 'flex',
            'align-items': 'stretch',
            'background-color':
                isGroup || isProject
                    ? 'var(--g-group-bg-color, #e5e7eb)'
                    : 'transparent',
        };
    };

    const cellStyle = (col: ColumnDef): Record<string, string | number> => ({
        width: `${col.width ?? DEFAULT_COLUMN_WIDTH}px`,
        'flex-shrink': 0,
        display: 'flex',
        'align-items': 'center',
        'padding-left': '12px',
        'border-right': '1px solid var(--g-grid-line-color, #e5e7eb)',
        'font-size': '12px',
        color: 'var(--g-text-color, #333)',
        'user-select': 'none',
        overflow: 'hidden',
        'text-overflow': 'ellipsis',
        'white-space': 'nowrap',
    });

    return (
        <div
            class="column-panel"
            style={{
                position: 'relative',
                width: '100%',
                height: `${totalHeight()}px`,
            }}
        >
            <For each={visibleResources()}>
                {(item) => {
                    const task = firstTaskForResource(item.id);
                    return (
                        <div
                            class="column-panel-row"
                            data-resource={item.id}
                            style={rowStyle(item)}
                        >
                            <For each={props.columns}>
                                {(col) => {
                                    const value = col.render
                                        ? col.render(task, item.id)
                                        : ((task &&
                                              (
                                                  task as unknown as Record<
                                                      string,
                                                      unknown
                                                  >
                                              )[col.key]) ??
                                          '');
                                    return (
                                        <div
                                            class="column-panel-cell"
                                            data-col-key={col.key}
                                            style={cellStyle(col)}
                                        >
                                            {value as JSX.Element}
                                        </div>
                                    );
                                }}
                            </For>
                        </div>
                    );
                }}
            </For>
        </div>
    );
}

export default ColumnPanel;
