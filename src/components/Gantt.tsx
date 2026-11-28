import {
    Accessor,
    DEV,
    createEffect,
    createMemo,
    createSignal,
    deep,
    onSettled,
    untrack,
} from 'solid-js';
import type { JSX } from '@solidjs/web';
import {
    DEFAULT_UPPER_HEADER_HEIGHT,
    DEFAULT_LOWER_HEADER_HEIGHT,
} from '../constants';
import { createTaskStore } from '../stores/taskStore';
import { createGanttConfigStore } from '../stores/ganttConfigStore';
import { createGanttDateStore } from '../stores/ganttDateStore';
import { createResourceStore } from '../stores/resourceStore';
import { createSelectionStore } from '../stores/selectionStore';
import { createVirtualViewport } from '../utils/createVirtualViewport';
import {
    calculateRowLayouts,
    calculateSimpleRowLayouts,
    rowLayoutsToSortedArray,
} from '../utils/rowLayoutCalculator';
import { computeCriticalPath } from '../utils/criticalPath';
import { buildExportSvg, svgToBlob, svgToPngBlob } from '../utils/svgExport';
import { initializeTasks } from '../utils/ganttSetup';
import { normalizeResources } from '../utils/resourceProcessor';
import { useGanttModals } from '../hooks/useGanttModals';
import { useGanttScroll, type ContainerAPILike } from '../hooks/useGanttScroll';

import { GanttContainer } from './GanttContainer';
import { Grid } from './Grid';
import { DateHeaders } from './DateHeaders';
import { ResourceColumn } from './ResourceColumn';
import {
    ColumnPanel,
    ColumnPanelHeader,
    computePanelWidth,
    type ColumnDef,
} from './ColumnPanel';
import { TaskLayer } from './TaskLayer';
import { TaskLayerMinimal } from './TaskLayerMinimal';
import { TaskDataPopup } from './TaskDataPopup';
import { TaskDataModal } from './TaskDataModal';
import { GanttEventsProvider } from '../contexts/GanttEvents';
import { useGanttStores } from '../contexts/GanttStores';
import type {
    GanttTask,
    Relationship,
    BarPosition,
    ResourceInput,
    ViewMode,
} from '../types';
import type { RowLayout } from '../utils/rowLayoutCalculator';

interface ArrowConfigOptions {
    stroke?: string;
    curveRadius?: number;
    headShape?: string;
    headSize?: number;
}

export interface GanttOptions {
    viewMode?: string;
    scrollTo?: 'start' | 'today' | string;
    upperHeaderHeight?: number;
    lowerHeaderHeight?: number;
    resourceColumnWidth?: number;
    arrowColor?: string;
    arrow_curve?: number;
    arrow_head_shape?: string;
    arrow_head_size?: number;
    lines?: 'horizontal' | 'vertical' | 'both' | 'none';
    readonly?: boolean;
    readonlyDates?: boolean;
    readonlyProgress?: boolean;
    barHeight?: number;
    padding?: number;
    columnWidth?: number;
    /** Highlight tasks on the project's critical path (zero-slack chain). */
    criticalPath?: boolean;
    /** Hide non-matching rows from the layout entirely. Predicate runs against the raw task. */
    filter?: (task: GanttTask) => boolean;
    /** Highlight tasks whose name (or searchField output) contains this string; dim the rest. */
    search?: string;
    /** Field/getter used by `search`. Defaults to task.name. */
    searchField?: ((task: GanttTask) => string) | keyof GanttTask;
    [key: string]: unknown;
}

export interface GanttProps {
    tasks: GanttTask[];
    resources?: ResourceInput[];
    options?: GanttOptions;
    arrowConfig?: ArrowConfigOptions;
    /**
     * Configurable left-panel columns. When provided, replaces the
     * single resource column with a multi-column grid. The first column
     * still maps to the resource id by default; pass a render fn to
     * customize. Each row corresponds to one resource (the column's
     * render receives the first task on that resource).
     */
    columns?: ColumnDef[];
    taskLayerMode?: 'minimal' | 'full';
    arrowRenderer?: 'batched' | 'individual';
    overscanCols?: number;
    overscanRows?: number;
    overscanX?: number;
    /**
     * The range contains both final dates to the nearest millisecond.
     * The optional position gives the same bar edges in pixels. Both
     * reflect the gesture even while Solid stages the store update.
     */
    onDateChange?: (
        taskId: string,
        range: { start: Date; end: Date },
        position?: { x: number; width: number },
    ) => void;
    onProgressChange?: (taskId: string, progress: number) => void;
    /** `geometry` is the post-resize bar rect in pixels (additive). */
    onResizeEnd?: (
        taskId: string,
        geometry?: { x: number; width: number },
    ) => void;
    onTaskClick?: (taskId: string, event: MouseEvent) => void;
    /**
     * When true, the built-in read-only `TaskDataModal` does NOT open on
     * bar click. Set this when the consumer renders its own edit UI from
     * `onTaskClick` and the popup would just get in the way.
     * Default false (modal still opens for back-compat with existing demos).
     */
    disableTaskClickModal?: boolean;
    /**
     * When true, the built-in `TaskDataPopup` does NOT appear on bar
     * hover. Set this when sweeping the mouse over many bars makes the
     * appearing/disappearing white card read as "flashing." Default
     * false (popup still appears for back-compat with existing demos).
     */
    disableHoverPopup?: boolean;
    /** Fires whenever the multi-selection set changes. Receives a snapshot Set. */
    onSelectionChange?: (selectedIds: Set<string>) => void;
    /**
     * Imperative-handle bridge: receives an API object with side-effect
     * helpers (export, etc.) once the chart is mounted. Stable across
     * renders for the chart's lifetime.
     */
    onReady?: (api: GanttAPI) => void;
}

/** Options accepted by `gantt.export()` / `gantt.exportPng()`. */
export interface GanttExportOptions {
    /** 'all' = full chart geometry; 'visible' = clip to current viewport. */
    range?: 'all' | 'visible';
    /** Background fill (default white; null/'' for transparent). */
    background?: string | null;
    /** Render task name labels inside each bar (default true). */
    showLabels?: boolean;
    /** PNG only: rasterization scale factor (default 2 for crisp output). */
    pngScale?: number;
}

/** Imperative API exposed via the `onReady` callback. */
export interface GanttAPI {
    /** Build a self-contained SVG string for the current chart state. */
    exportSvg(options?: GanttExportOptions): string;
    /** Same as exportSvg but wrapped in a Blob (image/svg+xml). */
    exportSvgBlob(options?: GanttExportOptions): Blob;
    /** Rasterize the export SVG to a PNG Blob. Browser-only. */
    exportPng(options?: GanttExportOptions): Promise<Blob>;
}

declare global {
    interface Window {
        __ganttTaskStore?: ReturnType<typeof createTaskStore>;
        __ganttConfig?: ReturnType<typeof createGanttConfigStore>;
        __ganttDateStore?: ReturnType<typeof createGanttDateStore>;
    }
}

/**
 * Gantt - Main orchestrator component for the Gantt chart.
 */
export function Gantt(props: GanttProps): JSX.Element {
    // Stores: prefer those from a surrounding <GanttProvider>; otherwise
    // create our own so the bare <Gantt tasks={...} /> form keeps working.
    // Initial options seed the stores; later
    // changes reach them through the effects below, so these reads are
    // deliberately untracked (a bare read in a component body is flagged).
    const provided = useGanttStores();
    const stores =
        provided ??
        untrack(() => {
            const options = props.options ?? {};
            return {
                taskStore: createTaskStore(),
                ganttConfig: createGanttConfigStore(options),
                dateStore: createGanttDateStore({
                    ...options,
                    columnWidth: undefined,
                }),
                resourceStore: createResourceStore(),
            };
        });
    const { taskStore, ganttConfig, dateStore, resourceStore } = stores;

    // Selection store is component-local — provider doesn't need to share
    // it across siblings. Multi-select state lives here.
    const selectionStore = createSelectionStore();

    // Notify the parent on every selection change.
    createEffect(
        () => new Set(selectionStore.selectedIds()),
        (ids) => {
            props.onSelectionChange?.(ids);
        },
    );

    // Imperative export API. Built once at mount; reads taskStore /
    // relationships / scroll state lazily so the parent can call it
    // anytime without holding stale refs.
    const buildExportInput = (
        container: ContainerAPILike,
        opts?: GanttExportOptions,
    ): Parameters<typeof buildExportSvg>[0] => {
        const range = opts?.range ?? 'all';
        let visibleRect:
            { x: number; y: number; width: number; height: number } | undefined;
        if (range === 'visible') {
            visibleRect = {
                x: container.getScrollLeft(),
                y: container.getScrollTop(),
                width: container.getContainerWidth(),
                height: container.getContainerHeight(),
            };
        }
        return {
            tasks: taskStore.tasks as Record<
                string,
                import('../types').ProcessedTask | undefined
            >,
            relationships: relationships(),
            range,
            visibleRect,
            background: opts?.background,
            showLabels: opts?.showLabels,
        };
    };

    if (DEV && typeof window !== 'undefined') {
        onSettled(() => {
            window.__ganttTaskStore = taskStore;
            window.__ganttConfig = ganttConfig;
            window.__ganttDateStore = dateStore;
            return () => {
                if (window.__ganttTaskStore !== taskStore) return;
                delete window.__ganttTaskStore;
                delete window.__ganttConfig;
                delete window.__ganttDateStore;
            };
        });
    }

    // Container reference (reactive so effects can depend on it)
    const [containerApi, setContainerApi] =
        createSignal<ContainerAPILike | null>(null);

    // Scroll + viewport-dimension wiring. The hook owns its primitives and
    // derives from the container api accessor, so `onContainerReady` stays
    // free of primitive creation.
    const scroll = useGanttScroll(containerApi);

    // Relationships state (populated by initializeTasks)
    const [relationships, setRelationships] = createSignal<Relationship[]>([]);

    // Legacy resources for backward compat when no resourceStore.resources
    const [legacyResources, setLegacyResources] = createSignal<string[]>([]);

    // Hover popup + click modal state
    const modals = useGanttModals(taskStore, relationships);

    // Take tracking snapshots at the boundary so in-place edits to a Solid
    // store reach setup, and setup consumes plain data in the apply phase.
    const rawTasks = createMemo(() => {
        const tasks = props.tasks ?? [];
        const snapshot = deep(tasks);
        if (snapshot !== tasks) return snapshot;

        // A caller may pass a plain array containing rows from a store.
        let needsCopy = false;
        const rows = tasks.map((task) => {
            const row = deep(task);
            if (row !== task) needsCopy = true;
            return row;
        });
        return needsCopy ? rows : tasks;
    });
    const taskFilter = createMemo(() => props.options?.filter);
    const requestedMode = createMemo(() => {
        const name = props.options?.viewMode;
        return dateStore.viewModes().find((mode) => mode.name === name);
    });
    const requestedWidth = createMemo(() => props.options?.columnWidth);
    const barHeight = createMemo(
        () => props.options?.barHeight ?? ganttConfig.barHeight(),
    );
    const padding = createMemo(
        () => props.options?.padding ?? ganttConfig.padding(),
    );
    const effectiveTasks = createMemo(() => {
        const tasks = rawTasks();
        const filter = taskFilter();
        return typeof filter === 'function' ? tasks.filter(filter) : tasks;
    });
    const rawResources = createMemo(() => props.resources);
    const explicitResources = createMemo(() => {
        const resources = deep(rawResources() ?? []);
        if (resources.length > 0) return normalizeResources(resources);
        const configured = resourceStore.configuredResources();
        return configured.length > 0 ? configured : false;
    });

    // Apply options before setup so timeline fields written by setup describe
    // the same date window as the headers and the task bars.
    createEffect(
        () => {
            const options = props.options;
            if (!options) return;
            // Read option getters while tracking. Task setup owns the column
            // width because the timeline and bars must use the same scale.
            const { columnWidth: _columnWidth, ...config } = deep(options);
            return config;
        },
        (config) => {
            if (config) ganttConfig.updateOptions(config);
        },
    );

    let appliedMode: ViewMode | undefined;
    createEffect(
        () => ({
            tasks: effectiveTasks(),
            resources: explicitResources(),
            collapsedGroups: resourceStore.collapsedGroups(),
            collapsedTasks: taskStore.collapsedTasks(),
            requestedMode: requestedMode(),
            activeMode: dateStore.viewMode(),
            requestedWidth: requestedWidth(),
            barHeight: barHeight(),
            padding: padding(),
        }),
        (inputs, previous) => {
            const mode =
                inputs.requestedMode !== previous?.requestedMode
                    ? (inputs.requestedMode ?? inputs.activeMode)
                    : inputs.activeMode;
            const tasksChanged = inputs.tasks !== previous?.tasks;
            const widthChanged =
                inputs.requestedWidth !== previous?.requestedWidth;
            if (
                !tasksChanged &&
                !widthChanged &&
                inputs.resources === previous?.resources &&
                inputs.collapsedGroups === previous?.collapsedGroups &&
                inputs.collapsedTasks === previous?.collapsedTasks &&
                inputs.barHeight === previous?.barHeight &&
                inputs.padding === previous?.padding &&
                mode === appliedMode
            ) {
                return;
            }

            const resizedWindow = widthChanged
                ? dateStore.setColumnWidthOverride(inputs.requestedWidth)
                : undefined;

            // A task or filter change recomputes the bounds in the chosen
            // view mode. Scale changes preserve the existing bounds.
            const window = tasksChanged
                ? dateStore.setupDates(inputs.tasks, false, mode)
                : mode !== inputs.activeMode
                  ? dateStore.changeViewMode(mode)
                  : (resizedWindow ??
                    untrack(() => ({
                        ganttStart: dateStore.ganttStart(),
                        ganttEnd: dateStore.ganttEnd(),
                        dates: dateStore.dates(),
                        unit: dateStore.unit(),
                        step: dateStore.step(),
                        columnWidth: dateStore.columnWidth(),
                    })));
            appliedMode = mode;
            const result = initializeTasks(inputs.tasks, stores, {
                resources: inputs.resources,
                dateWindow: window,
                geometry: {
                    barHeight: inputs.barHeight,
                    padding: inputs.padding,
                },
            });
            setRelationships(result.relationships);
            setLegacyResources(result.legacyResources);
        },
    );

    // Computed dimensions
    const taskCount = createMemo(() => {
        const tasks = taskStore.tasks;
        return tasks ? Object.keys(tasks).length : 0;
    });

    const resourceCount = createMemo(() => {
        const displayCount = resourceStore.displayCount();
        return displayCount > 0 ? displayCount : legacyResources().length;
    });

    const gridWidth = createMemo(() => dateStore.gridWidth());
    const dateInfos = createMemo(() => dateStore.getAllDateInfos());
    const rowHeight = createMemo(
        () => ganttConfig.barHeight() + ganttConfig.padding(),
    );

    // Row layouts: simple = static heights; detailed = variable per expansion
    const rowLayouts = createMemo((): Map<string, RowLayout> => {
        const resources = resourceStore.displayResources();
        const mode = ganttConfig.renderMode();
        if (!resources || resources.length === 0) return new Map();

        const displayRows = resources.map((r, i) => ({
            id: r.id,
            type: r.type || 'resource',
            displayIndex: i,
            taskId: (r as { taskId?: string }).taskId,
        }));

        const config = {
            barHeight: ganttConfig.barHeight(),
            padding: ganttConfig.padding(),
            subtaskHeightRatio: ganttConfig.subtaskHeightRatio(),
        };

        if (mode === 'simple') {
            return calculateSimpleRowLayouts(displayRows, config);
        }
        return calculateRowLayouts(
            displayRows,
            config,
            ganttConfig.expandedTasks(),
            taskStore.tasks,
        );
    });

    const sortedRowLayouts = createMemo(() =>
        rowLayoutsToSortedArray(rowLayouts()),
    );

    // Sync _bar.y to row layout positions so Arrow (reads _bar.y) and
    // Bar (uses taskPosition.y) stay aligned.
    createEffect(
        () => rowLayouts(),
        (layouts) => {
            if (!layouts || layouts.size === 0) return;
            const ys = new Map<string, number>();
            for (const [resourceId, layout] of layouts) {
                if (resourceId === '__total__') continue;
                if (!layout.taskPositions) continue;
                for (const [taskId, taskPos] of layout.taskPositions) {
                    ys.set(taskId, taskPos.y);
                }
            }
            // One draft write; the store skips entries whose y already matches.
            taskStore.setBarYs(ys);
        },
    );

    // Critical-path lags and interactive dependency bounds share the same scale.
    const criticalSet = createMemo((): Set<string> => {
        if (!props.options?.criticalPath) return new Set();
        const tasks = taskStore.tasks;
        const rels = relationships();
        if (!tasks || rels.length === 0) return new Set();
        return computeCriticalPath(tasks, rels, dateStore.pixelsPerHour())
            .critical;
    });

    // Search overlay: matches set is empty when search is off; otherwise
    // contains every task id whose search field includes the query
    // (case-insensitive). Bar dims when searchActive && id ∉ matches.
    const searchActive = createMemo(
        () => !!props.options?.search && props.options.search.length > 0,
    );
    const searchMatches = createMemo((): Set<string> => {
        if (!searchActive()) return new Set();
        const query = (props.options?.search ?? '').toLowerCase();
        const field = props.options?.searchField ?? 'name';
        const getValue =
            typeof field === 'function'
                ? field
                : (t: GanttTask): string => String(t[field] ?? '');
        const matches = new Set<string>();
        for (const task of effectiveTasks()) {
            if (!task.id) continue;
            if (getValue(task).toLowerCase().includes(query)) {
                matches.add(task.id);
            }
        }
        return matches;
    });

    const totalContentHeight = createMemo(() => {
        const layouts = rowLayouts();
        const total = layouts.get('__total__');
        if (total) return total.height;
        return (resourceCount() || taskCount()) * rowHeight();
    });

    const svgHeight = createMemo(() => {
        const total = totalContentHeight();
        if (total > 0) return total;
        const count = resourceCount() || taskCount();
        return count * (ganttConfig.barHeight() + ganttConfig.padding());
    });

    // Viewport calculation — single source for row/col virtualization
    const viewport = createVirtualViewport({
        scrollX: scroll.scrollLeft,
        scrollY: scroll.scrollTop,
        viewportWidth: scroll.viewportWidth,
        viewportHeight: scroll.viewportHeight,
        columnWidth: () => dateStore.columnWidth(),
        rowHeight,
        totalRows: () => resourceCount() || taskCount(),
        sortedRowLayouts,
        // Plain numbers, read once at creation (the viewport takes values,
        // not accessors, for these), so the reads are untracked on purpose.
        overscanCols: untrack(() => props.overscanCols ?? 5),
        overscanRows: untrack(() => props.overscanRows ?? 5),
        overscanX: untrack(() => props.overscanX ?? 600),
    });

    // Event handlers — bridge to props
    const handleDateChange = (
        taskId: string,
        position: Partial<BarPosition>,
    ): void => {
        if (position.x !== undefined && position.width !== undefined) {
            const start = dateStore.xToDate(position.x);
            const end = dateStore.xToDate(position.x + position.width);
            props.onDateChange?.(
                taskId,
                { start, end },
                { x: position.x, width: position.width },
            );
        }
    };

    const handleProgressChange = (taskId: string, progress: number): void => {
        props.onProgressChange?.(taskId, progress);
    };
    const handleResizeEnd = (
        taskId: string,
        geometry?: { x: number; width: number },
    ): void => {
        props.onResizeEnd?.(taskId, geometry);
    };

    const handleTaskClick = (taskId: string, event: MouseEvent): void => {
        if (!props.disableTaskClickModal) modals.showModal(taskId);
        props.onTaskClick?.(taskId, event);
    };

    // GanttContainer calls this after mount. Capture its measured viewport so
    // an export inside onReady works before the signal write commits.
    const handleContainerReady = (container: ContainerAPILike): void => {
        setContainerApi(container);
        const exportSvg = (options?: GanttExportOptions): string =>
            buildExportSvg(buildExportInput(container, options));
        props.onReady?.({
            exportSvg,
            exportSvgBlob: (options) => svgToBlob(exportSvg(options)),
            exportPng: (options) =>
                svgToPngBlob(exportSvg(options), {
                    scale: options?.pngScale,
                    background: options?.background ?? undefined,
                }),
        });
    };

    // Effect: scroll so today sits one quarter in (scrollTo: 'today').
    // `dateToX` reads the date window, which the setup effect stages in the
    // same flush the container becomes ready — so this is an effect over
    // both, not a read inside `onContainerReady`, and it waits until the
    // window has landed (tasks committed, or there were none to wait for).
    // `containerWidth` is the width GanttContainer measured, handed over as
    // data — not a `getContainerWidth()` signal read-back.
    let todayScrollDone = false;
    createEffect(
        () => ({
            api: containerApi(),
            wanted: props.options?.scrollTo === 'today',
            ready: taskStore.taskCount() > 0 || effectiveTasks().length === 0,
            todayX: dateStore.dateToX(new Date()),
        }),
        ({ api, wanted, ready, todayX }) => {
            if (!todayScrollDone && api && wanted && ready) {
                api.scrollTo(todayX - api.containerWidth / 4, false);
                todayScrollDone = true;
            }
        },
    );

    // Effect: scroll to first task once tasks are ready (scrollTo: 'start')
    let initialScrollDone = false;
    createEffect(
        () => {
            const taskIds = Object.keys(taskStore.tasks);
            const firstTaskId = taskIds[0];
            const firstTask = firstTaskId
                ? taskStore.tasks[firstTaskId]
                : undefined;
            return {
                api: containerApi(),
                wanted: props.options?.scrollTo === 'start',
                x: firstTask?._bar?.x,
            };
        },
        ({ api, wanted, x }) => {
            if (!initialScrollDone && api && wanted && x) {
                api.scrollTo(Math.max(0, x - 50), false);
                initialScrollDone = true;
            }
        },
    );

    // Header / resource-column dimensions
    const upperHeaderHeight = (): number =>
        props.options?.upperHeaderHeight || DEFAULT_UPPER_HEADER_HEIGHT;
    const lowerHeaderHeight = (): number =>
        props.options?.lowerHeaderHeight || DEFAULT_LOWER_HEADER_HEIGHT;
    // When custom columns are provided, the panel width is the sum of
    // the column widths; otherwise fall back to the legacy single-column
    // width set via options.resourceColumnWidth.
    const hasCustomColumns = (): boolean =>
        Array.isArray(props.columns) && props.columns.length > 0;
    const resourceColumnWidth = (): number => {
        if (hasCustomColumns()) {
            return computePanelWidth(props.columns!);
        }
        return props.options?.resourceColumnWidth || 120;
    };

    return (
        <GanttEventsProvider
            onDateChange={handleDateChange}
            onProgressChange={handleProgressChange}
            onResizeEnd={handleResizeEnd}
            onTaskClick={handleTaskClick}
            onHover={props.disableHoverPopup ? undefined : modals.showHover}
            onHoverEnd={props.disableHoverPopup ? undefined : modals.hideHover}
        >
            <GanttContainer
                ganttConfig={ganttConfig}
                svgWidth={gridWidth()}
                svgHeight={svgHeight()}
                headerHeight={ganttConfig.headerHeight()}
                resourceColumnWidth={resourceColumnWidth()}
                resourceHeaderLabel={
                    hasCustomColumns() ? (
                        <ColumnPanelHeader columns={props.columns!} />
                    ) : (
                        'Resource'
                    )
                }
                onContainerReady={handleContainerReady}
                resourceColumn={
                    hasCustomColumns() ? (
                        <ColumnPanel
                            columns={props.columns!}
                            taskStore={taskStore}
                            resourceStore={resourceStore}
                            ganttConfig={ganttConfig}
                            startRow={viewport.rowRange().start}
                            endRow={viewport.rowRange().end}
                            rowLayouts={rowLayouts()}
                        />
                    ) : (
                        <ResourceColumn
                            resourceStore={resourceStore}
                            ganttConfig={ganttConfig}
                            width={resourceColumnWidth()}
                            startRow={viewport.rowRange().start}
                            endRow={viewport.rowRange().end}
                            rowLayouts={rowLayouts()}
                        />
                    )
                }
                header={
                    <DateHeaders
                        dateInfos={dateInfos()}
                        columnWidth={dateStore.columnWidth()}
                        gridWidth={gridWidth()}
                        upperHeaderHeight={upperHeaderHeight()}
                        lowerHeaderHeight={lowerHeaderHeight()}
                        startCol={viewport.colRange().start}
                        endCol={viewport.colRange().end}
                    />
                }
                barsLayer={
                    props.taskLayerMode === 'minimal' ? (
                        <TaskLayerMinimal
                            taskStore={taskStore}
                            resourceStore={resourceStore}
                            startRow={viewport.rowRange().start}
                            endRow={viewport.rowRange().end}
                            startX={viewport.xRange().start}
                            endX={viewport.xRange().end}
                        />
                    ) : (
                        <TaskLayer
                            dateStore={dateStore}
                            taskStore={taskStore}
                            ganttConfig={ganttConfig}
                            relationships={relationships()}
                            resourceStore={resourceStore}
                            selectionStore={selectionStore}
                            criticalSet={criticalSet()}
                            searchActive={searchActive()}
                            searchMatches={searchMatches()}
                            onDateChange={handleDateChange}
                            onProgressChange={handleProgressChange}
                            onResizeEnd={handleResizeEnd}
                            onTaskClick={handleTaskClick}
                            onHover={
                                props.disableHoverPopup
                                    ? undefined
                                    : modals.showHover
                            }
                            onHoverEnd={
                                props.disableHoverPopup
                                    ? undefined
                                    : modals.hideHover
                            }
                            startRow={viewport.rowRange().start}
                            endRow={viewport.rowRange().end}
                            startX={viewport.xRange().start}
                            endX={viewport.xRange().end}
                            rowLayouts={rowLayouts()}
                        />
                    )
                }
            >
                <Grid
                    width={gridWidth()}
                    height={svgHeight()}
                    barHeight={ganttConfig.barHeight()}
                    padding={ganttConfig.padding()}
                    taskCount={resourceCount() || taskCount()}
                    columnWidth={dateStore.columnWidth()}
                    dateInfos={dateInfos()}
                    lines={props.options?.lines || 'both'}
                    startRow={viewport.rowRange().start}
                    endRow={viewport.rowRange().end}
                    resourceStore={resourceStore}
                    rowLayouts={rowLayouts()}
                />
            </GanttContainer>

            {/* Hover popup */}
            <TaskDataPopup
                visible={modals.popupVisible}
                position={modals.popupPosition}
                task={modals.hoveredTask as Accessor<GanttTask | null>}
                barPosition={
                    modals.hoveredBarPosition as Accessor<BarPosition | null>
                }
            />

            {/* Click modal */}
            <TaskDataModal
                visible={modals.modalVisible}
                task={modals.modalTask as Accessor<GanttTask | null>}
                barPosition={
                    modals.modalBarPosition as Accessor<BarPosition | null>
                }
                relationships={modals.modalRelationships}
                onClose={modals.hideModal}
            />
        </GanttEventsProvider>
    );
}

export default Gantt;
