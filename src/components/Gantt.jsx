import { createSignal, createMemo, createEffect, onMount, untrack } from 'solid-js';
import { createTaskStore } from '../stores/taskStore.js';
import { createGanttConfigStore } from '../stores/ganttConfigStore.js';
import { createGanttDateStore } from '../stores/ganttDateStore.js';
import { createResourceStore } from '../stores/resourceStore.js';
import { processTasks, findDateBounds } from '../utils/taskProcessor.js';
import { extractResourcesFromTasks } from '../utils/resourceProcessor.js';
import { createVirtualViewport } from '../utils/createVirtualViewport.js';
import { buildHierarchy, isHiddenByCollapsedAncestor } from '../utils/hierarchyProcessor.js';
import { recomputeAllSummaryBounds } from '../utils/barCalculations.js';
import { calculateRowLayouts, rowLayoutsToSortedArray } from '../utils/rowLayoutCalculator.js';

import { GanttContainer } from './GanttContainer.jsx';
import { Grid } from './Grid.jsx';
import { DateHeaders } from './DateHeaders.jsx';
import { ResourceColumn } from './ResourceColumn.jsx';
import { TaskLayer } from './TaskLayer.jsx';
import { ArrowLayer } from './ArrowLayer.jsx';
import { TaskDataPopup } from './TaskDataPopup.jsx';
import { TaskDataModal } from './TaskDataModal.jsx';

/**
 * Gantt - Main orchestrator component for the Gantt chart.
 *
 * @param {Object} props
 * @param {Array} props.tasks - Array of task objects
 * @param {Object} props.options - Configuration options
 * @param {Function} props.onDateChange - Callback when task dates change
 * @param {Function} props.onProgressChange - Callback when task progress changes
 * @param {Function} props.onTaskClick - Callback when task is clicked
 */
export function Gantt(props) {
    // Create stores
    const taskStore = createTaskStore();
    const ganttConfig = createGanttConfigStore(props.options || {});
    const dateStore = createGanttDateStore(props.options || {});
    const resourceStore = createResourceStore(props.resources || []);

    // Container reference for scroll control (reactive so effects can depend on it)
    const [containerApi, setContainerApi] = createSignal(null);

    // Viewport state for virtualization
    const [scrollLeft, setScrollLeft] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [viewportWidth, setViewportWidth] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);

    // Relationships state
    const [relationships, setRelationships] = createSignal([]);

    // Legacy resources signal - for backward compatibility when no resourceStore resources
    const [legacyResources, setLegacyResources] = createSignal([]);

    // Hover state for popup
    const [hoveredTaskId, setHoveredTaskId] = createSignal(null);
    const [popupPosition, setPopupPosition] = createSignal({ x: 0, y: 0 });
    const [popupVisible, setPopupVisible] = createSignal(false);

    // Modal state for click
    const [modalTaskId, setModalTaskId] = createSignal(null);
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
    const initializeTasks = (rawTasks, useResourceStore = true) => {
        if (!rawTasks || rawTasks.length === 0) {
            taskStore.clear();
            setRelationships([]);
            dateStore.setupDates([]);
            return;
        }

        // First, setup dates from task bounds
        const { minDate, maxDate } = findDateBounds(
            rawTasks.map((t) => ({
                _start: t._start || new Date(t.start),
                _end: t._end || new Date(t.end || t.start),
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
        let resourceIndexMap = null;
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
            if (isHiddenByCollapsedAncestor(task.id, taskMap, collapsedTaskSet)) {
                task._isHidden = true;
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

    // Watch for task changes
    createEffect(() => {
        const tasks = props.tasks;
        if (tasks) {
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
        const tasks = taskStore.tasks();
        return tasks ? tasks.size : 0;
    });

    // Resource count for swimlane rows - use displayResources for collapse support
    const resourceCount = createMemo(() => {
        const displayCount = resourceStore.displayCount();
        // Fallback to legacy resources if no resourceStore resources
        return displayCount > 0 ? displayCount : legacyResources().length;
    });

    // Effect: recalculate task positions when resource group collapse state changes
    createEffect(() => {
        // Track collapse state
        const collapsed = resourceStore.collapsedGroups();
        // Recalculate positions if we have tasks
        if (props.tasks && props.tasks.length > 0) {
            untrack(() => initializeTasks(props.tasks));
        }
    });

    // Effect: recalculate task positions when subtask collapse state changes
    createEffect(() => {
        // Track subtask collapse state
        const collapsedTasks = taskStore.collapsedTasks();
        // Recalculate positions if we have tasks
        if (props.tasks && props.tasks.length > 0) {
            untrack(() => initializeTasks(props.tasks));
        }
    });

    const gridWidth = createMemo(() => dateStore.gridWidth());

    // Date infos for headers and ticks
    const dateInfos = createMemo(() => dateStore.getAllDateInfos());

    // Row height for viewport calculations (base height)
    const rowHeight = createMemo(() => ganttConfig.barHeight() + ganttConfig.padding());

    // Compute variable row layouts based on expanded tasks
    // This enables rows to have different heights when tasks are expanded
    const rowLayouts = createMemo(() => {
        const resources = resourceStore.displayResources();
        const expandedTasks = ganttConfig.expandedTasks();
        const taskMap = taskStore.tasks();

        if (!resources || resources.length === 0) {
            return new Map();
        }

        // Build display rows from resources
        const displayRows = resources.map((r, i) => ({
            id: r.id,
            type: r.type || 'resource',
            displayIndex: i,
            taskId: r.taskId, // If resource row has associated task
        }));

        return calculateRowLayouts(
            displayRows,
            {
                barHeight: ganttConfig.barHeight(),
                padding: ganttConfig.padding(),
                subtaskHeightRatio: ganttConfig.subtaskHeightRatio(),
            },
            expandedTasks,
            taskMap
        );
    });

    // Sorted row layouts for binary search in virtualization
    const sortedRowLayouts = createMemo(() => rowLayoutsToSortedArray(rowLayouts()));

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
    const handleDateChange = (taskId, position) => {
        props.onDateChange?.(taskId, position);
    };

    const handleProgressChange = (taskId, progress) => {
        props.onProgressChange?.(taskId, progress);
    };

    const handleResizeEnd = (taskId) => {
        props.onResizeEnd?.(taskId);
    };

    const handleTaskClick = (taskId, event) => {
        // Show modal with task debug info
        setModalTaskId(taskId);
        setModalVisible(true);
        // Also call external handler
        props.onTaskClick?.(taskId, event);
    };

    const handleTaskHover = (taskId, clientX, clientY) => {
        setHoveredTaskId(taskId);
        setPopupPosition({ x: clientX, y: clientY });
        setPopupVisible(true);
    };

    const handleTaskHoverEnd = () => {
        setPopupVisible(false);
        setHoveredTaskId(null);
    };

    const handleModalClose = () => {
        setModalVisible(false);
        setModalTaskId(null);
    };

    const handleContainerReady = (api) => {
        setContainerApi(api);

        // Initialize viewport dimensions
        setViewportWidth(api.getContainerWidth());
        setViewportHeight(api.getContainerHeight());

        // Subscribe to reactive signals from container
        if (api.scrollLeftSignal) {
            createEffect(() => setScrollLeft(api.scrollLeftSignal()));
        }
        if (api.scrollTopSignal) {
            createEffect(() => setScrollTop(api.scrollTopSignal()));
        }
        if (api.containerWidthSignal) {
            createEffect(() => setViewportWidth(api.containerWidthSignal()));
        }
        if (api.containerHeightSignal) {
            createEffect(() => setViewportHeight(api.containerHeightSignal()));
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
        const tasks = taskStore.tasks();
        const api = containerApi(); // Access signal to create dependency
        if (
            !initialScrollDone &&
            api &&
            props.options?.scroll_to === 'start' &&
            tasks &&
            tasks.size > 0
        ) {
            const firstTask = tasks.values().next().value;
            if (firstTask?.$bar?.x) {
                // Scroll to first task with some left margin
                api.scrollTo(Math.max(0, firstTask.$bar.x - 50), false);
                initialScrollDone = true;
            }
        }
    });

    // Header heights from options
    const upperHeaderHeight = () => props.options?.upper_header_height || 45;
    const lowerHeaderHeight = () => props.options?.lower_header_height || 30;

    // Resource column width from options
    const resourceColumnWidth = () => props.options?.resource_column_width || 120;

    // Arrow configuration from options
    const arrowConfig = createMemo(() => ({
        stroke: props.options?.arrow_color || '#666',
        curveRadius: props.options?.arrow_curve || 5,
        headShape: props.options?.arrow_head_shape || 'chevron',
        headSize: props.options?.arrow_head_size || 5,
        ...props.arrowConfig,
    }));

    return (
        <>
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

                {/* Dependency arrows */}
                <ArrowLayer
                    taskStore={taskStore}
                    relationships={relationships()}
                    arrowConfig={arrowConfig()}
                    startRow={viewport.rowRange().start}
                    endRow={viewport.rowRange().end}
                    startX={viewport.xRange().start}
                    endX={viewport.xRange().end}
                    rowLayouts={rowLayouts()}
                />

                {/* Task bars */}
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
            </GanttContainer>

            {/* Hover popup */}
            <TaskDataPopup
                visible={popupVisible}
                position={popupPosition}
                task={hoveredTask}
                barPosition={hoveredBarPosition}
            />

            {/* Click modal */}
            <TaskDataModal
                visible={modalVisible}
                task={modalTask}
                barPosition={modalBarPosition}
                relationships={modalRelationships}
                onClose={handleModalClose}
            />
        </>
    );
}

export default Gantt;
