import { createSignal, createMemo, createEffect, onMount, untrack, batch, Accessor, JSX } from 'solid-js';
import { createTaskStore } from '../stores/taskStore';
import { createGanttConfigStore } from '../stores/ganttConfigStore';
import { createGanttDateStore } from '../stores/ganttDateStore';
import { createResourceStore } from '../stores/resourceStore';
import { processTasks, findDateBounds } from '../utils/taskProcessor';
import { extractResourcesFromTasks } from '../utils/resourceProcessor';
import { createVirtualViewport } from '../utils/createVirtualViewport';
import { buildHierarchy, isHiddenByCollapsedAncestor } from '../utils/hierarchyProcessor';
import { recomputeAllSummaryBounds } from '../utils/barCalculations';
import { calculateRowLayouts, calculateSimpleRowLayouts, rowLayoutsToSortedArray } from '../utils/rowLayoutCalculator';

import { GanttContainer } from './GanttContainer';
import { Grid } from './Grid';
import { DateHeaders } from './DateHeaders';
import { ResourceColumn } from './ResourceColumn';
import { TaskLayer } from './TaskLayer';
import { TaskLayerMinimal } from './TaskLayerMinimal';
import { TaskDataPopup } from './TaskDataPopup';
import { TaskDataModal } from './TaskDataModal';
import { GanttEventsProvider } from '../contexts/GanttEvents';
import type { GanttTask, ProcessedTask, Relationship, BarPosition, ResourceInput } from '../types';
import type { RowLayout } from '../utils/rowLayoutCalculator';

interface ContainerAPI {
    scrollTo: (x: number, smooth?: boolean) => void;
    getScrollLeft: () => number;
    getScrollTop: () => number;
    getContainerWidth: () => number;
    getContainerHeight: () => number;
    scrollLeftSignal?: Accessor<number>;
    scrollTopSignal?: Accessor<number>;
    containerWidthSignal?: Accessor<number>;
    containerHeightSignal?: Accessor<number>;
}

interface ArrowConfigOptions {
    stroke?: string;
    curveRadius?: number;
    headShape?: string;
    headSize?: number;
}

interface GanttOptions {
    view_mode?: string;
    scroll_to?: 'start' | 'today' | string;
    upper_header_height?: number;
    lower_header_height?: number;
    resource_column_width?: number;
    arrow_color?: string;
    arrow_curve?: number;
    arrow_head_shape?: string;
    arrow_head_size?: number;
    lines?: 'horizontal' | 'vertical' | 'both' | 'none';
    readonly?: boolean;
    bar_height?: number;
    padding?: number;
    column_width?: number;
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
    onDateChange?: (taskId: string, position: { x: number; width: number }) => void;
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
    // Create stores
    const taskStore = createTaskStore();
    const ganttConfig = createGanttConfigStore(props.options || {});
    const dateStore = createGanttDateStore(props.options || {});
    const resourceStore = createResourceStore(props.resources || []);

    // Expose for profiling (development only)
    if (typeof window !== 'undefined') {
        window.__ganttTaskStore = taskStore;
        window.__ganttConfig = ganttConfig;
        window.__ganttDateStore = dateStore;
    }

    // Container reference for scroll control (reactive so effects can depend on it)
    const [containerApi, setContainerApi] = createSignal<ContainerAPI | null>(null);

    // Viewport state for virtualization
    const [scrollLeft, setScrollLeft] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [viewportWidth, setViewportWidth] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);

    // Fast scroll detection - hide arrows during rapid scrolling for performance
    const [isScrolling, setIsScrolling] = createSignal(false);
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

    // Relationships state
    const [relationships, setRelationships] = createSignal<Relationship[]>([]);

    // Legacy resources signal - for backward compatibility when no resourceStore resources
    const [legacyResources, setLegacyResources] = createSignal<string[]>([]);

    // Hover state for popup
    const [hoveredTaskId, setHoveredTaskId] = createSignal<string | null>(null);
    const [popupPosition, setPopupPosition] = createSignal({ x: 0, y: 0 });
    const [popupVisible, setPopupVisible] = createSignal(false);

    // Modal state for click
    const [modalTaskId, setModalTaskId] = createSignal<string | null>(null);
    const [modalVisible, setModalVisible] = createSignal(false);

    // Computed task/position for popup
    const hoveredTask = createMemo(() => {
        const id = hoveredTaskId();
        return id ? taskStore.getTask(id) : null;
    });

    const hoveredBarPosition = createMemo(() => {
        const id = hoveredTaskId();
        return id ? taskStore.getBarPosition(id) : null;
    });

    // Computed task/position for modal
    const modalTask = createMemo(() => {
        const id = modalTaskId();
        return id ? taskStore.getTask(id) : null;
    });

    const modalBarPosition = createMemo(() => {
        const id = modalTaskId();
        return id ? taskStore.getBarPosition(id) : null;
    });

    // Filter relationships for modal task
    const modalRelationships = createMemo(() => {
        const id = modalTaskId();
        if (!id) return [];
        return relationships().filter((r) => r.from === id || r.to === id);
    });

    // Initialize tasks and compute positions
    const initializeTasks = (rawTasks: GanttTask[], useResourceStore = true): void => {
        if (!rawTasks || rawTasks.length === 0) {
            taskStore.clear();
            setRelationships([]);
            dateStore.setupDates([]);
            return;
        }

        // First, setup dates from task bounds
        const { minDate, maxDate } = findDateBounds(
            rawTasks.map((t) => ({
                _start: new Date(t.start),
                _end: new Date(t.end || t.start),
            })),
        );

        // Setup date store with task bounds
        dateStore.setupDates(rawTasks);

        // Update ganttConfig with date store values
        ganttConfig.setGanttStart(dateStore.ganttStart());
        ganttConfig.setGanttEnd(dateStore.ganttEnd());
        ganttConfig.setUnit(dateStore.unit());
        ganttConfig.setStep(dateStore.step());
        ganttConfig.setColumnWidth(dateStore.columnWidth());

        // Process tasks with computed positions
        const config = {
            ganttStart: dateStore.ganttStart(),
            ganttEnd: dateStore.ganttEnd(),
            unit: dateStore.unit(),
            step: dateStore.step(),
            columnWidth: dateStore.columnWidth(),
            headerHeight: ganttConfig.headerHeight(),
            barHeight: ganttConfig.barHeight(),
            padding: ganttConfig.padding(),
        };

        // Determine resource index map to use
        // If resourceStore has explicit resources, use its map (respects collapse state)
        // Otherwise, extract resources from tasks for backward compatibility
        let resourceIndexMap: Map<string, number> | null = null;
        const hasExplicitResources = resourceStore.resources().length > 0;

        if (hasExplicitResources && useResourceStore) {
            resourceIndexMap = resourceStore.resourceIndexMap();
        } else if (!hasExplicitResources) {
            // Extract resources from tasks and update resourceStore
            const extracted = extractResourcesFromTasks(rawTasks);
            resourceStore.updateResources(extracted);
            resourceIndexMap = resourceStore.resourceIndexMap();
        }

        const {
            tasks: processedTasks,
            relationships: taskRelationships,
            resources: taskResources,
        } = processTasks(rawTasks, config, resourceIndexMap);

        // Build task hierarchy (parent-child relationships)
        const taskMap = buildHierarchy(processedTasks);

        // Recompute summary bar bounds (span from earliest to latest child)
        recomputeAllSummaryBounds(taskMap);

        // Apply subtask collapse visibility
        const collapsedTaskSet = taskStore.collapsedTasks();
        for (const task of taskMap.values()) {
            // Check if hidden by collapsed ancestor (in addition to resource group collapse)
            const processedTask = task as ProcessedTask;
            if (isHiddenByCollapsedAncestor(processedTask.id, taskMap as Map<string, ProcessedTask>, collapsedTaskSet)) {
                processedTask._isHidden = true;
            }
        }

        // Update stores
        taskStore.updateTasks(Array.from(taskMap.values()));
        setRelationships(taskRelationships);
        // Store legacy resources for backward compatibility
        setLegacyResources(taskResources);
    };

    // Initialize on mount and when tasks change
    onMount(() => {
        initializeTasks(props.tasks);
    });

    // Consolidated effect: reinitialize tasks when tasks, collapse state, or subtask collapse changes
    // This replaces 3 separate effects that all called initializeTasks
    createEffect(() => {
        // Track all dependencies that require task reinitialization
        const tasks = props.tasks;
        const _collapsed = resourceStore.collapsedGroups(); // Track resource group collapse
        const _collapsedTasks = taskStore.collapsedTasks(); // Track subtask collapse

        if (tasks && tasks.length > 0) {
            // Use untrack to prevent initializeTasks from creating reactive dependencies
            untrack(() => initializeTasks(tasks));
        }
    });

    // Watch for options changes and sync to config store
    // This ensures store stays in sync when parent passes new options
    // Note: dateStore handles view_mode changes via the separate effect below
    createEffect(() => {
        const opts = props.options;
        if (opts) {
            ganttConfig.updateOptions(opts);
        }
    });

    // Watch for view mode changes - use signal to track previous value
    const [prevViewMode, setPrevViewMode] = createSignal(props.options?.view_mode);
    createEffect(() => {
        const viewMode = props.options?.view_mode;
        const prev = prevViewMode();
        if (viewMode && viewMode !== prev) {
            setPrevViewMode(viewMode);
            dateStore.changeViewMode(viewMode);
            // Re-initialize tasks with new view mode settings
            if (props.tasks && props.tasks.length > 0) {
                untrack(() => initializeTasks(props.tasks));
            }
        }
    });

    // Computed dimensions
    const taskCount = createMemo(() => {
        const tasks = taskStore.tasks;
        return tasks ? Object.keys(tasks).length : 0;
    });

    // Resource count for swimlane rows - use displayResources for collapse support
    const resourceCount = createMemo(() => {
        const displayCount = resourceStore.displayCount();
        // Fallback to legacy resources if no resourceStore resources
        return displayCount > 0 ? displayCount : legacyResources().length;
    });

    const gridWidth = createMemo(() => dateStore.gridWidth());

    // Date infos for headers and ticks
    const dateInfos = createMemo(() => dateStore.getAllDateInfos());

    // Row height for viewport calculations (base height)
    const rowHeight = createMemo(() => ganttConfig.barHeight() + ganttConfig.padding());

    // Compute row layouts based on render mode
    // Simple mode: static heights, maximum performance
    // Detailed mode: variable heights based on expanded tasks
    const rowLayouts = createMemo((): Map<string, RowLayout> => {
        const resources = resourceStore.displayResources();
        const mode = ganttConfig.renderMode();

        if (!resources || resources.length === 0) {
            return new Map();
        }

        // Build display rows from resources
        const displayRows = resources.map((r, i) => ({
            id: r.id,
            type: r.type || 'resource',
            displayIndex: i,
            taskId: (r as { taskId?: string }).taskId, // If resource row has associated task
        }));

        const config = {
            barHeight: ganttConfig.barHeight(),
            padding: ganttConfig.padding(),
            subtaskHeightRatio: ganttConfig.subtaskHeightRatio(),
        };

        // Simple mode: skip all subtask/expansion logic
        if (mode === 'simple') {
            return calculateSimpleRowLayouts(displayRows, config);
        }

        // Detailed mode: full layout with variable heights
        const expandedTasks = ganttConfig.expandedTasks();
        return calculateRowLayouts(displayRows, config, expandedTasks, taskStore.tasks);
    });

    // Sorted row layouts for binary search in virtualization
    const sortedRowLayouts = createMemo(() => rowLayoutsToSortedArray(rowLayouts()));

    // Sync _bar.y values with row layout positions
    // This ensures Arrow components (which read from _bar.y) match Bar rendering (which uses taskPosition.y)
    createEffect(() => {
        const layouts = rowLayouts();
        if (!layouts || layouts.size === 0) return;

        // Use untrack to avoid subscribing to individual task changes
        // This effect should only re-run when rowLayouts() changes, not when tasks change
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

    // Total content height (variable based on expanded rows)
    const totalContentHeight = createMemo(() => {
        const layouts = rowLayouts();
        const total = layouts.get('__total__');
        if (total) return total.height;
        // Fallback to fixed height calculation
        return (resourceCount() || taskCount()) * rowHeight();
    });

    // SVG height - content area only (NO headerHeight)
    // Uses totalContentHeight for variable row heights
    const svgHeight = createMemo(() => {
        const total = totalContentHeight();
        if (total > 0) return total;

        // Fallback: fixed row height calculation
        const bh = ganttConfig.barHeight();
        const pad = ganttConfig.padding();
        const count = resourceCount() || taskCount();
        return count * (bh + pad);
    });

    // Single viewport calculation - used by ALL components
    // Simple virtualization: offset / itemSize → visible range
    // Supports variable row heights via sortedRowLayouts
    const viewport = createVirtualViewport({
        scrollX: scrollLeft,
        scrollY: scrollTop,
        viewportWidth,
        viewportHeight,
        columnWidth: () => dateStore.columnWidth(),
        rowHeight,
        totalRows: () => resourceCount() || taskCount(),
        sortedRowLayouts, // For variable height support
        overscanCols: props.overscanCols ?? 5,
        overscanRows: props.overscanRows ?? 5,
        overscanX: props.overscanX ?? 600,
    });

    // Event handlers
    const handleDateChange = (taskId: string, position: Partial<BarPosition>): void => {
        if (position.x !== undefined && position.width !== undefined) {
            props.onDateChange?.(taskId, { x: position.x, width: position.width });
        }
    };

    const handleProgressChange = (taskId: string, progress: number): void => {
        props.onProgressChange?.(taskId, progress);
    };

    const handleResizeEnd = (taskId: string): void => {
        props.onResizeEnd?.(taskId);
    };

    const handleTaskClick = (taskId: string, event: MouseEvent): void => {
        // Show modal with task debug info
        setModalTaskId(taskId);
        setModalVisible(true);
        // Also call external handler
        props.onTaskClick?.(taskId, event);
    };

    const handleTaskHover = (taskId: string, clientX: number, clientY: number): void => {
        setHoveredTaskId(taskId);
        setPopupPosition({ x: clientX, y: clientY });
        setPopupVisible(true);
    };

    const handleTaskHoverEnd = (): void => {
        setPopupVisible(false);
        setHoveredTaskId(null);
    };

    const handleModalClose = (): void => {
        setModalVisible(false);
        setModalTaskId(null);
    };

    const handleContainerReady = (api: ContainerAPI): void => {
        setContainerApi(api);

        // Initialize viewport dimensions
        setViewportWidth(api.getContainerWidth());
        setViewportHeight(api.getContainerHeight());

        // Subscribe to reactive signals from container - batch to avoid double cascade
        if (api.scrollLeftSignal && api.scrollTopSignal) {
            createEffect(() => {
                const sl = api.scrollLeftSignal!();
                const st = api.scrollTopSignal!();
                batch(() => {
                    setScrollLeft(sl);
                    setScrollTop(st);
                });
            });
        } else {
            if (api.scrollLeftSignal) {
                createEffect(() => setScrollLeft(api.scrollLeftSignal!()));
            }
            if (api.scrollTopSignal) {
                createEffect(() => setScrollTop(api.scrollTopSignal!()));
            }
        }

        // Fast scroll detection - set isScrolling while scroll events are firing
        let lastScrollTop = scrollTop();
        let lastScrollLeft = scrollLeft();
        createEffect(() => {
            // Subscribe to both scroll signals
            const sl = scrollLeft();
            const st = scrollTop();

            // Only set scrolling if values actually changed (skip first run)
            if (sl !== lastScrollLeft || st !== lastScrollTop) {
                lastScrollLeft = sl;
                lastScrollTop = st;

                // Mark as scrolling
                setIsScrolling(true);

                // Clear timeout and set new one
                if (scrollTimeout) clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    setIsScrolling(false);
                }, 150); // Show arrows again 150ms after scroll stops
            }
        });
        if (api.containerWidthSignal) {
            createEffect(() => setViewportWidth(api.containerWidthSignal!()));
        }
        if (api.containerHeightSignal) {
            createEffect(() => setViewportHeight(api.containerHeightSignal!()));
        }

        // Handle 'today' scroll immediately (doesn't depend on tasks)
        if (props.options?.scroll_to === 'today') {
            const todayX = dateStore.dateToX(new Date());
            api.scrollTo(todayX - api.getContainerWidth() / 4, false);
        }
    };

    // Track if initial scroll to 'start' has been done
    let initialScrollDone = false;

    // Effect to scroll to first task when tasks are loaded
    // This handles scroll_to: 'start' which depends on tasks being ready
    createEffect(() => {
        const tasks = taskStore.tasks;
        const api = containerApi(); // Access signal to create dependency
        const taskIds = Object.keys(tasks);
        if (
            !initialScrollDone &&
            api &&
            props.options?.scroll_to === 'start' &&
            tasks &&
            taskIds.length > 0
        ) {
            const firstTaskId = taskIds[0];
            const firstTask = firstTaskId ? tasks[firstTaskId] : undefined;
            if (firstTask?._bar?.x) {
                // Scroll to first task with some left margin
                api.scrollTo(Math.max(0, firstTask._bar.x - 50), false);
                initialScrollDone = true;
            }
        }
    });

    // Header heights from options
    const upperHeaderHeight = (): number => props.options?.upper_header_height || 45;
    const lowerHeaderHeight = (): number => props.options?.lower_header_height || 30;

    // Resource column width from options
    const resourceColumnWidth = (): number => props.options?.resource_column_width || 120;

    // Arrow configuration from options
    const arrowConfig = createMemo(() => ({
        stroke: props.options?.arrow_color || '#666',
        curveRadius: props.options?.arrow_curve || 5,
        headShape: props.options?.arrow_head_shape || 'chevron',
        headSize: props.options?.arrow_head_size || 5,
        ...props.arrowConfig,
    }));

    return (
        <GanttEventsProvider
            onDateChange={handleDateChange}
            onProgressChange={handleProgressChange}
            onResizeEnd={handleResizeEnd}
            onTaskClick={handleTaskClick}
            onHover={handleTaskHover}
            onHoverEnd={handleTaskHoverEnd}
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
                            onDateChange={handleDateChange}
                            onProgressChange={handleProgressChange}
                            onResizeEnd={handleResizeEnd}
                            onTaskClick={handleTaskClick}
                            onHover={handleTaskHover}
                            onHoverEnd={handleTaskHoverEnd}
                            startRow={viewport.rowRange().start}
                            endRow={viewport.rowRange().end}
                            startX={viewport.xRange().start}
                            endX={viewport.xRange().end}
                            rowLayouts={rowLayouts()}
                        />
                    )
                }
            >
                {/* Grid background, rows, and vertical lines (via SVG pattern) */}
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
                visible={popupVisible}
                position={popupPosition}
                task={hoveredTask as Accessor<GanttTask | null>}
                barPosition={hoveredBarPosition as Accessor<BarPosition | null>}
            />

            {/* Click modal */}
            <TaskDataModal
                visible={modalVisible}
                task={modalTask as Accessor<GanttTask | null>}
                barPosition={modalBarPosition as Accessor<BarPosition | null>}
                relationships={modalRelationships}
                onClose={handleModalClose}
            />
        </GanttEventsProvider>
    );
}

export default Gantt;
