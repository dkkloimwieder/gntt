import { createContext, useContext } from 'solid-js';

/**
 * GanttEventsContext provides event handlers to deeply nested components
 * without prop drilling through intermediate layers.
 *
 * Events provided:
 * - onDateChange(taskId, position) - Task dates changed via drag
 * - onProgressChange(taskId, progress) - Progress percentage changed
 * - onResizeEnd(taskId) - Task resize completed
 * - onTaskClick(taskId, event) - Task bar clicked
 * - onHover(taskId, clientX, clientY) - Mouse entered task bar
 * - onHoverEnd() - Mouse left task bar
 */
const GanttEventsContext = createContext();

/**
 * Provider component that wraps the Gantt chart and provides event handlers.
 *
 * @param {Object} props
 * @param {Function} props.onDateChange - Handler for date changes
 * @param {Function} props.onProgressChange - Handler for progress changes
 * @param {Function} props.onResizeEnd - Handler for resize completion
 * @param {Function} props.onTaskClick - Handler for task clicks
 * @param {Function} props.onHover - Handler for hover start
 * @param {Function} props.onHoverEnd - Handler for hover end
 * @param {JSX.Element} props.children - Child components
 */
export function GanttEventsProvider(props) {
    const handlers = {
        onDateChange: (taskId, position) => props.onDateChange?.(taskId, position),
        onProgressChange: (taskId, progress) => props.onProgressChange?.(taskId, progress),
        onResizeEnd: (taskId) => props.onResizeEnd?.(taskId),
        onTaskClick: (taskId, event) => props.onTaskClick?.(taskId, event),
        onHover: (taskId, clientX, clientY) => props.onHover?.(taskId, clientX, clientY),
        onHoverEnd: () => props.onHoverEnd?.(),
    };

    return (
        <GanttEventsContext.Provider value={handlers}>
            {props.children}
        </GanttEventsContext.Provider>
    );
}

/**
 * Hook to access Gantt event handlers from any nested component.
 *
 * @returns {Object} Event handlers object
 * @example
 * const { onDateChange, onTaskClick } = useGanttEvents();
 * onDateChange(taskId, { x: 100, width: 200 });
 */
export function useGanttEvents() {
    const context = useContext(GanttEventsContext);
    if (!context) {
        // Return no-op handlers if used outside provider
        return {
            onDateChange: () => {},
            onProgressChange: () => {},
            onResizeEnd: () => {},
            onTaskClick: () => {},
            onHover: () => {},
            onHoverEnd: () => {},
        };
    }
    return context;
}

export default GanttEventsContext;
