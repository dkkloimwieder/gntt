import { createSignal, createMemo, createEffect, onMount } from 'solid-js';
import { throttle } from '@solid-primitives/scheduled';
import { createTaskStore } from '../stores/taskStore.js';
import { createGanttConfigStore } from '../stores/ganttConfigStore.js';
import { createGanttDateStore } from '../stores/ganttDateStore.js';
import { processTasks, findDateBounds } from '../utils/taskProcessor.js';

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

    // Container reference for scroll control (reactive so effects can depend on it)
    const [containerApi, setContainerApi] = createSignal(null);

    // Viewport state for virtualization
    const [scrollLeft, setScrollLeft] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [viewportWidth, setViewportWidth] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);

    // Arrow-specific scroll signals with slower throttle (100ms vs 16ms)
    // This reduces arrow filter recalcs from 60/sec to 10/sec
    const [arrowScrollLeft, setArrowScrollLeft] = createSignal(0);
    const [arrowScrollTop, setArrowScrollTop] = createSignal(0);
    const throttledArrowScrollLeft = throttle(setArrowScrollLeft, 100);
    const throttledArrowScrollTop = throttle(setArrowScrollTop, 100);

    // Hysteresis for stable task viewport range
    // Instead of throttling (which causes batch spikes), we use hysteresis
    // to only update the range when scroll exceeds a threshold
    const [committedXRange, setCommittedXRange] = createSignal({ startX: 0, endX: 3000 });
    const [committedRowRange, setCommittedRowRange] = createSignal({ startRow: 0, endRow: 30 });

    // Relationships state
    const [relationships, setRelationships] = createSignal([]);

    // Resources list (unique resources for swimlane rows)
    const [resources, setResources] = createSignal([]);

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
    const initializeTasks = (rawTasks) => {
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

        const {
            tasks: processedTasks,
            relationships: taskRelationships,
            resources: taskResources,
        } = processTasks(rawTasks, config);

        // Update stores
        taskStore.updateTasks(processedTasks);
        setRelationships(taskRelationships);
        setResources(taskResources);
    };

    // Initialize on mount and when tasks change
    onMount(() => {
        initializeTasks(props.tasks);
    });

    // Watch for task changes
    createEffect(() => {
        const tasks = props.tasks;
        if (tasks) {
            initializeTasks(tasks);
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
                initializeTasks(props.tasks);
            }
        }
    });

    // Computed dimensions
    const taskCount = createMemo(() => {
        const tasks = taskStore.tasks();
        return tasks ? tasks.size : 0;
    });

    // Resource count for swimlane rows
    const resourceCount = createMemo(() => resources().length);

    const gridWidth = createMemo(() => dateStore.gridWidth());

    // SVG height - content area only (NO headerHeight)
    // Headers are now rendered separately outside the SVG
    // Rows start at y=0, so total height = count * rowHeight
    const svgHeight = createMemo(() => {
        const bh = ganttConfig.barHeight();
        const pad = ganttConfig.padding();
        // Use resource count for swimlane layout
        const count = resourceCount() || taskCount();
        const rowHeight = bh + pad;

        return count * rowHeight;
    });

    // Date infos for headers and ticks
    const dateInfos = createMemo(() => dateStore.getAllDateInfos());

    // Row height for viewport calculations
    const rowHeight = createMemo(() => ganttConfig.barHeight() + ganttConfig.padding());

    // Viewport range calculations for virtualization
    const BUFFER_COLS = 5; // Extra columns to render outside viewport
    const BUFFER_ROWS = 3; // Extra rows to render outside viewport

    // Column range for DateHeaders virtualization
    const viewportCols = createMemo(() => {
        const colWidth = dateStore.columnWidth();
        const sl = scrollLeft();
        const vw = viewportWidth();

        if (colWidth <= 0 || vw <= 0) {
            return { startCol: 0, endCol: 100 }; // Fallback for initial render
        }

        const startCol = Math.max(0, Math.floor(sl / colWidth) - BUFFER_COLS);
        const endCol = Math.ceil((sl + vw) / colWidth) + BUFFER_COLS;

        return { startCol, endCol };
    });

    // Pixel-based X range for Grid horizontal virtualization (uses main scroll)
    const BUFFER_X = 600; // Extra pixels to render outside viewport (increased for smooth scroll)
    const viewportXRange = createMemo(() => {
        const sl = scrollLeft();
        const vw = viewportWidth();

        return {
            startX: Math.max(0, sl - BUFFER_X),
            endX: sl + vw + BUFFER_X,
        };
    });

    // Task-specific viewport X range with HYSTERESIS (not throttle)
    // Hysteresis prevents edge thrashing without batching DOM updates
    // Only commits new range when scroll exceeds HYSTERESIS_X threshold
    const TASK_BUFFER_X = 800; // Buffer for task visibility
    const HYSTERESIS_X = 400; // Dead zone to prevent rapid range commits

    const stableTaskXRange = createMemo(() => {
        const sl = scrollLeft(); // Use main scroll (not throttled)
        const vw = viewportWidth();
        const newStart = Math.max(0, sl - TASK_BUFFER_X);
        const newEnd = sl + vw + TASK_BUFFER_X;

        const current = committedXRange();
        const deltaStart = Math.abs(newStart - current.startX);
        const deltaEnd = Math.abs(newEnd - current.endX);

        // Only commit new range if change exceeds hysteresis threshold
        if (deltaStart > HYSTERESIS_X || deltaEnd > HYSTERESIS_X) {
            setCommittedXRange({ startX: newStart, endX: newEnd });
            return { startX: newStart, endX: newEnd };
        }

        return current; // Return stable (cached) range
    });

    // Task-specific viewport ROW range with HYSTERESIS (not throttle)
    // Same approach as X range - prevents edge thrashing during vertical scroll
    const TASK_BUFFER_ROWS = 5; // Buffer rows above/below viewport
    const HYSTERESIS_ROWS = 3; // Dead zone to prevent rapid range commits

    const stableRowRange = createMemo(() => {
        const rh = rowHeight();
        const st = scrollTop();
        const vh = viewportHeight();
        const totalRows = resourceCount() || taskCount();

        if (rh <= 0 || vh <= 0) {
            return { startRow: 0, endRow: Math.min(totalRows, 30) };
        }

        const newStart = Math.max(0, Math.floor(st / rh) - TASK_BUFFER_ROWS);
        const newEnd = Math.min(totalRows, Math.ceil((st + vh) / rh) + TASK_BUFFER_ROWS);

        const current = committedRowRange();
        const deltaStart = Math.abs(newStart - current.startRow);
        const deltaEnd = Math.abs(newEnd - current.endRow);

        // Only commit new range if change exceeds hysteresis threshold
        if (deltaStart > HYSTERESIS_ROWS || deltaEnd > HYSTERESIS_ROWS) {
            setCommittedRowRange({ startRow: newStart, endRow: newEnd });
            return { startRow: newStart, endRow: newEnd };
        }

        return current; // Return stable (cached) range
    });

    // Arrow-specific viewport ranges with slower update rate (100ms throttle)
    // Uses wider buffer since updates are less frequent
    const ARROW_BUFFER_X = 1000; // Wider buffer for arrow updates
    const ARROW_BUFFER_ROWS = 5; // Extra buffer for arrow row updates

    const arrowViewportXRange = createMemo(() => {
        const sl = arrowScrollLeft();
        const vw = viewportWidth();
        return {
            startX: Math.max(0, sl - ARROW_BUFFER_X),
            endX: sl + vw + ARROW_BUFFER_X,
        };
    });

    const arrowViewportRows = createMemo(() => {
        const rh = rowHeight();
        const st = arrowScrollTop();
        const vh = viewportHeight();
        const totalRows = resourceCount() || taskCount();

        if (rh <= 0 || vh <= 0) {
            return { startRow: 0, endRow: Math.min(totalRows, 30) };
        }

        const startRow = Math.max(0, Math.floor(st / rh) - ARROW_BUFFER_ROWS);
        const endRow = Math.min(totalRows, Math.ceil((st + vh) / rh) + ARROW_BUFFER_ROWS);
        return { startRow, endRow };
    });

    // Row range for Grid, TaskLayer, ResourceColumn, ArrowLayer virtualization
    const viewportRows = createMemo(() => {
        const rh = rowHeight();
        const st = scrollTop();
        const vh = viewportHeight();
        const totalRows = resourceCount() || taskCount();

        if (rh <= 0 || vh <= 0) {
            return { startRow: 0, endRow: Math.min(totalRows, 30) }; // Fallback
        }

        const startRow = Math.max(0, Math.floor(st / rh) - BUFFER_ROWS);
        const endRow = Math.min(totalRows, Math.ceil((st + vh) / rh) + BUFFER_ROWS);

        return { startRow, endRow };
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

        // Arrow signals with 100ms throttle (instead of 16ms for main scroll)
        // This decouples arrow updates from main scroll for better performance
        if (api.scrollLeftSignal) {
            createEffect(() => throttledArrowScrollLeft(api.scrollLeftSignal()));
        }
        if (api.scrollTopSignal) {
            createEffect(() => throttledArrowScrollTop(api.scrollTopSignal()));
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
                resourceColumnWidth={60}
                resourceHeaderLabel="Resource"
                onContainerReady={handleContainerReady}
                resourceColumn={
                    <ResourceColumn
                        resources={resources()}
                        ganttConfig={ganttConfig}
                        width={60}
                        startRow={viewportRows().startRow}
                        endRow={viewportRows().endRow}
                    />
                }
                header={
                    <DateHeaders
                        dateInfos={dateInfos()}
                        columnWidth={dateStore.columnWidth()}
                        gridWidth={gridWidth()}
                        upperHeaderHeight={upperHeaderHeight()}
                        lowerHeaderHeight={lowerHeaderHeight()}
                        startCol={viewportCols().startCol}
                        endCol={viewportCols().endCol}
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
                    startRow={viewportRows().startRow}
                    endRow={viewportRows().endRow}
                />

                {/* Dependency arrows - uses separate 100ms throttle for better scroll perf */}
                <ArrowLayer
                    taskStore={taskStore}
                    relationships={relationships()}
                    arrowConfig={arrowConfig()}
                    startRow={arrowViewportRows().startRow}
                    endRow={arrowViewportRows().endRow}
                    startX={arrowViewportXRange().startX}
                    endX={arrowViewportXRange().endX}
                />

                {/* Task bars - uses hysteresis for stable X range (not throttle) */}
                <TaskLayer
                    taskStore={taskStore}
                    ganttConfig={ganttConfig}
                    relationships={relationships()}
                    resources={resources()}
                    onDateChange={handleDateChange}
                    onProgressChange={handleProgressChange}
                    onResizeEnd={handleResizeEnd}
                    onTaskClick={handleTaskClick}
                    onHover={handleTaskHover}
                    onHoverEnd={handleTaskHoverEnd}
                    startRow={stableRowRange().startRow}
                    endRow={stableRowRange().endRow}
                    startX={stableTaskXRange().startX}
                    endX={stableTaskXRange().endX}
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
