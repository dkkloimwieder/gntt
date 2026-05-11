import {
    createSignal,
    createMemo,
    createEffect,
    onMount,
    untrack,
    Accessor,
    JSX,
} from 'solid-js';
import {
    DEFAULT_UPPER_HEADER_HEIGHT,
    DEFAULT_LOWER_HEADER_HEIGHT,
} from '../constants';
import { createTaskStore } from '../stores/taskStore';
import { createGanttConfigStore } from '../stores/ganttConfigStore';
import { createGanttDateStore } from '../stores/ganttDateStore';
import { createResourceStore } from '../stores/resourceStore';
import { createVirtualViewport } from '../utils/createVirtualViewport';
import {
    calculateRowLayouts,
    calculateSimpleRowLayouts,
    rowLayoutsToSortedArray,
} from '../utils/rowLayoutCalculator';
import { computeCriticalPath } from '../utils/criticalPath';
import { initializeTasks } from '../utils/ganttSetup';
import { useGanttModals } from '../hooks/useGanttModals';
import { useGanttScroll, type ContainerAPILike } from '../hooks/useGanttScroll';

import { GanttContainer } from './GanttContainer';
import { Grid } from './Grid';
import { DateHeaders } from './DateHeaders';
import { ResourceColumn } from './ResourceColumn';
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
    [key: string]: unknown;
}

interface GanttProps {
    tasks: GanttTask[];
    resources?: ResourceInput[];
    options?: GanttOptions;
    arrowConfig?: ArrowConfigOptions;
    taskLayerMode?: 'minimal' | 'full';
    arrowRenderer?: 'batched' | 'individual';
    overscanCols?: number;
    overscanRows?: number;
    overscanX?: number;
    onDateChange?: (taskId: string, range: { start: Date; end: Date }) => void;
    onProgressChange?: (taskId: string, progress: number) => void;
    onResizeEnd?: (taskId: string) => void;
    onTaskClick?: (taskId: string, event: MouseEvent) => void;
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
    const provided = useGanttStores();
    const stores = provided ?? {
        taskStore: createTaskStore(),
        ganttConfig: createGanttConfigStore(props.options || {}),
        dateStore: createGanttDateStore(props.options || {}),
        resourceStore: createResourceStore(props.resources || []),
    };
    const { taskStore, ganttConfig, dateStore, resourceStore } = stores;

    // Expose for profiling (development only)
    if (typeof window !== 'undefined') {
        window.__ganttTaskStore = taskStore;
        window.__ganttConfig = ganttConfig;
        window.__ganttDateStore = dateStore;
    }

    // Container reference (reactive so effects can depend on it)
    const [containerApi, setContainerApi] =
        createSignal<ContainerAPILike | null>(null);

    // Scroll + viewport-dimension wiring
    const scroll = useGanttScroll();

    // Relationships state (populated by initializeTasks)
    const [relationships, setRelationships] = createSignal<Relationship[]>([]);

    // Legacy resources for backward compat when no resourceStore.resources
    const [legacyResources, setLegacyResources] = createSignal<string[]>([]);

    // Hover popup + click modal state
    const modals = useGanttModals(taskStore, relationships);

    // Run the setup pipeline; commit results into local signals.
    const runSetup = (rawTasks: GanttTask[]): void => {
        const result = initializeTasks(rawTasks, stores);
        setRelationships(result.relationships);
        setLegacyResources(result.legacyResources);
    };

    // Initial mount + reactive reinit on tasks / collapse changes
    onMount(() => runSetup(props.tasks));

    createEffect(() => {
        // Track all dependencies that require task reinitialization
        const tasks = props.tasks;
        const _collapsed = resourceStore.collapsedGroups();
        const _collapsedTasks = taskStore.collapsedTasks();

        if (tasks && tasks.length > 0) {
            // untrack so initializeTasks doesn't create reactive deps
            untrack(() => runSetup(tasks));
        }
    });

    // Sync config store when parent passes new options
    createEffect(() => {
        const opts = props.options;
        if (opts) ganttConfig.updateOptions(opts);
    });

    // View-mode change: dateStore swaps mode; tasks must reinit
    const [prevViewMode, setPrevViewMode] = createSignal(
        props.options?.viewMode,
    );
    createEffect(() => {
        const viewMode = props.options?.viewMode;
        const prev = prevViewMode();
        if (viewMode && viewMode !== prev) {
            setPrevViewMode(viewMode);
            dateStore.changeViewMode(viewMode);
            if (props.tasks && props.tasks.length > 0) {
                untrack(() => runSetup(props.tasks));
            }
        }
    });

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
    createEffect(() => {
        const layouts = rowLayouts();
        if (!layouts || layouts.size === 0) return;

        // Don't subscribe to per-task changes — only react to layout changes.
        untrack(() => {
            for (const [resourceId, layout] of layouts) {
                if (resourceId === '__total__') continue;
                if (!layout.taskPositions) continue;

                for (const [taskId, taskPos] of layout.taskPositions) {
                    const task = taskStore.tasks[taskId];
                    if (task && task._bar && task._bar.y !== taskPos.y) {
                        taskStore.updateBarPosition(taskId, { y: taskPos.y });
                    }
                }
            }
        });
    });

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
        overscanCols: props.overscanCols ?? 5,
        overscanRows: props.overscanRows ?? 5,
        overscanX: props.overscanX ?? 600,
    });

    // Event handlers — bridge to props
    const handleDateChange = (
        taskId: string,
        position: Partial<BarPosition>,
    ): void => {
        if (position.x !== undefined && position.width !== undefined) {
            const start = dateStore.xToDate(position.x);
            const end = dateStore.xToDate(position.x + position.width);
            props.onDateChange?.(taskId, { start, end });
        }
    };

    const handleProgressChange = (taskId: string, progress: number): void =>
        props.onProgressChange?.(taskId, progress);
    const handleResizeEnd = (taskId: string): void =>
        props.onResizeEnd?.(taskId);

    const handleTaskClick = (taskId: string, event: MouseEvent): void => {
        modals.showModal(taskId);
        props.onTaskClick?.(taskId, event);
    };

    const handleContainerReady = (api: ContainerAPILike): void => {
        setContainerApi(api);
        scroll.handleContainerReady(api);

        // Handle 'today' scroll immediately (doesn't depend on tasks)
        if (props.options?.scrollTo === 'today') {
            const todayX = dateStore.dateToX(new Date());
            api.scrollTo(todayX - api.getContainerWidth() / 4, false);
        }
    };

    // Effect: scroll to first task once tasks are ready (scrollTo: 'start')
    let initialScrollDone = false;
    createEffect(() => {
        const tasks = taskStore.tasks;
        const api = containerApi();
        const taskIds = Object.keys(tasks);
        if (
            !initialScrollDone &&
            api &&
            props.options?.scrollTo === 'start' &&
            tasks &&
            taskIds.length > 0
        ) {
            const firstTaskId = taskIds[0];
            const firstTask = firstTaskId ? tasks[firstTaskId] : undefined;
            if (firstTask?._bar?.x) {
                api.scrollTo(Math.max(0, firstTask._bar.x - 50), false);
                initialScrollDone = true;
            }
        }
    });

    // Header / resource-column dimensions
    const upperHeaderHeight = (): number =>
        props.options?.upperHeaderHeight || DEFAULT_UPPER_HEADER_HEIGHT;
    const lowerHeaderHeight = (): number =>
        props.options?.lowerHeaderHeight || DEFAULT_LOWER_HEADER_HEIGHT;
    const resourceColumnWidth = (): number =>
        props.options?.resourceColumnWidth || 120;

    return (
        <GanttEventsProvider
            onDateChange={handleDateChange}
            onProgressChange={handleProgressChange}
            onResizeEnd={handleResizeEnd}
            onTaskClick={handleTaskClick}
            onHover={modals.showHover}
            onHoverEnd={modals.hideHover}
        >
            <GanttContainer
                ganttConfig={ganttConfig}
                svgWidth={gridWidth()}
                svgHeight={svgHeight()}
                headerHeight={ganttConfig.headerHeight()}
                resourceColumnWidth={resourceColumnWidth()}
                resourceHeaderLabel="Resource"
                onContainerReady={handleContainerReady}
                resourceColumn={
                    <ResourceColumn
                        resourceStore={resourceStore}
                        ganttConfig={ganttConfig}
                        width={resourceColumnWidth()}
                        startRow={viewport.rowRange().start}
                        endRow={viewport.rowRange().end}
                        rowLayouts={rowLayouts()}
                    />
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
                            criticalSet={criticalSet()}
                            onDateChange={handleDateChange}
                            onProgressChange={handleProgressChange}
                            onResizeEnd={handleResizeEnd}
                            onTaskClick={handleTaskClick}
                            onHover={modals.showHover}
                            onHoverEnd={modals.hideHover}
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
