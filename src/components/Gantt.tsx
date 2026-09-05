import {
    Accessor,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
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
import type { DateWindow } from '../stores/ganttDateStore';
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
} from '../types';
import type { RowLayout } from '../utils/rowLayoutCalculator';

interface ArrowConfigOptions {
    stroke?: string;
    curveRadius?: number;
    headShape?: string;
    headSize?: number;
}

interface GanttOptions {
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

interface GanttProps {
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
     * `position` is the bar rect the gesture produced, in pixels — the same
     * value the dates were derived from. Additive third argument: existing
     * two-argument consumers are unaffected, and one that needs pixels no
     * longer has to read them back off the store (the write that produced
     * them may still be staged).
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
    // The initial options/resources are read ONCE to seed the stores; later
    // changes reach them through the effects below, so these reads are
    // deliberately untracked (a bare read in a component body is flagged).
    const provided = useGanttStores();
    const stores =
        provided ??
        untrack(() => ({
            taskStore: createTaskStore(),
            ganttConfig: createGanttConfigStore(props.options || {}),
            dateStore: createGanttDateStore(props.options || {}),
            resourceStore: createResourceStore(props.resources || []),
        }));
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
        opts?: GanttExportOptions,
    ): Parameters<typeof buildExportSvg>[0] => {
        const range = opts?.range ?? 'all';
        let visibleRect:
            | { x: number; y: number; width: number; height: number }
            | undefined;
        if (range === 'visible') {
            const api = containerApi();
            visibleRect = {
                x: api?.getScrollLeft() ?? 0,
                y: api?.getScrollTop() ?? 0,
                width: api?.getContainerWidth() ?? 0,
                height: api?.getContainerHeight() ?? 0,
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

    const api: GanttAPI = {
        exportSvg: (opts) => buildExportSvg(buildExportInput(opts)),
        exportSvgBlob: (opts) =>
            svgToBlob(buildExportSvg(buildExportInput(opts))),
        exportPng: (opts) =>
            svgToPngBlob(buildExportSvg(buildExportInput(opts)), {
                scale: opts?.pngScale,
                background:
                    opts?.background === null ? undefined : opts?.background,
            }),
    };
    // Fire onReady once after mount so the parent gets a stable handle.
    // The consumer callback is deferred by a microtask so it never runs
    // inside the mount scope itself: in Solid 2.0 this `onMount` becomes
    // `onSettled`, whose scope is children-forbidden (no primitive
    // creation, no `onCleanup`) and whose return value is validated.
    // Deferring restores the unrestricted scope consumers had on 1.x.
    // Both bodies are blocks so no callback return value escapes.
    // The microtask can outlive the component, which the synchronous call
    // could not; `disposed` restores that guarantee. Registered in the
    // component body, not inside the lifecycle callback, so it stays legal
    // when E3.1 turns this into a children-forbidden `onSettled`.
    let disposed = false;
    onCleanup(() => {
        disposed = true;
    });
    onSettled(() => {
        queueMicrotask(() => {
            if (!disposed) props.onReady?.(api);
        });
    });

    // Expose for profiling (development only)
    if (typeof window !== 'undefined') {
        window.__ganttTaskStore = taskStore;
        window.__ganttConfig = ganttConfig;
        window.__ganttDateStore = dateStore;
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

    // Capture once: did the parent supply an explicit resources prop?
    // This decides whether re-runs (e.g. after a filter change) should
    // re-extract resources from the current task list or leave the
    // store as the parent populated it.
    const hasExplicitResources = untrack(
        () => (props.resources?.length ?? 0) > 0,
    );

    // Run the setup pipeline; commit results into local signals.
    // `dateWindow`, when the caller already has one (a view-mode change gets
    // it back from `changeViewMode`), is handed down instead of letting
    // `initializeTasks` re-derive the same window from the date store.
    const runSetup = (rawTasks: GanttTask[], dateWindow?: DateWindow): void => {
        const result = initializeTasks(
            rawTasks,
            stores,
            true,
            hasExplicitResources,
            dateWindow,
        );
        setRelationships(result.relationships);
        setLegacyResources(result.legacyResources);
    };

    // Filter applied at the entry point — derived task list compresses
    // rows when the predicate excludes tasks. Relationships still reference
    // taskIds; ones that point at filtered-out tasks are skipped naturally
    // by processTasks (predecessor lookup fails).
    const effectiveTasks = createMemo((): GanttTask[] => {
        const filter = props.options?.filter;
        const tasks = props.tasks ?? [];
        return typeof filter === 'function' ? tasks.filter(filter) : tasks;
    });

    // Initial mount + reactive reinit on tasks / filter / collapse changes.
    // This effect also covers the first run, so no separate onMount is needed.
    createEffect(
        // compute: track everything that requires task reinitialization and
        // hand it over as a fresh object so apply runs on every change.
        () => ({
            tasks: effectiveTasks(),
            collapsedGroups: resourceStore.collapsedGroups(),
            collapsedTasks: taskStore.collapsedTasks(),
        }),
        ({ tasks }) => {
            // Filter wiped out everything — clear the store so the empty
            // state renders correctly instead of showing stale rows.
            runSetup(tasks && tasks.length > 0 ? tasks : []);
        },
    );

    // Sync config store when parent passes new options
    createEffect(
        () => props.options,
        (opts) => {
            if (opts) ganttConfig.updateOptions(opts);
        },
    );

    // View-mode change: dateStore swaps mode; tasks must reinit
    let prevViewMode = untrack(() => props.options?.viewMode);
    createEffect(
        () => props.options?.viewMode,
        (viewMode) => {
            if (viewMode && viewMode !== prevViewMode) {
                prevViewMode = viewMode;
                // `changeViewMode` RETURNS the regenerated window; pass it
                // on so `initializeTasks` never re-runs `setupDates` against
                // a date store whose mode write is still staged. `undefined`
                // means an unknown mode name — a documented silent no-op, in
                // which case setup falls back to deriving the window itself.
                const window = dateStore.changeViewMode(viewMode);
                const tasks = untrack(effectiveTasks);
                if (tasks && tasks.length > 0) runSetup(tasks, window);
            }
        },
        { defer: true },
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

    // Critical-path overlay: empty set when feature is off so downstream
    // components can read it unconditionally. Uses columnWidth as the
    // pixels-per-time-unit factor (same convention as taskLayerConstraints).
    const criticalSet = createMemo((): Set<string> => {
        if (!props.options?.criticalPath) return new Set();
        const tasks = taskStore.tasks;
        const rels = relationships();
        if (!tasks || rels.length === 0) return new Set();
        const pph = dateStore.columnWidth();
        return computeCriticalPath(tasks, rels, pph).critical;
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

    // Runs inside GanttContainer's mount scope, which becomes a
    // children-forbidden `onSettled` in 2.0: no primitive creation here,
    // and nothing that reads back a signal that scope just wrote.
    const handleContainerReady = (api: ContainerAPILike): void => {
        setContainerApi(api);
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
