import { createContext, useContext, JSX } from 'solid-js';
import type { BarPosition } from '../types';

interface GanttEventHandlers {
    onDateChange: (taskId: string, position: Partial<BarPosition>) => void;
    onProgressChange: (taskId: string, progress: number) => void;
    onResizeEnd: (taskId: string) => void;
    onTaskClick: (taskId: string, event: MouseEvent) => void;
    onHover: (taskId: string, clientX: number, clientY: number) => void;
    onHoverEnd: () => void;
}

interface GanttEventsProviderProps {
    onDateChange?: (taskId: string, position: Partial<BarPosition>) => void;
    onProgressChange?: (taskId: string, progress: number) => void;
    onResizeEnd?: (taskId: string) => void;
    onTaskClick?: (taskId: string, event: MouseEvent) => void;
    onHover?: (taskId: string, clientX: number, clientY: number) => void;
    onHoverEnd?: () => void;
    children: JSX.Element;
}

const GanttEventsContext = createContext<GanttEventHandlers>();

/**
 * Provider component that wraps the Gantt chart and provides event handlers.
 */
export function GanttEventsProvider(props: GanttEventsProviderProps): JSX.Element {
    const handlers: GanttEventHandlers = {
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
 */
export function useGanttEvents(): GanttEventHandlers {
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
