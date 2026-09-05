import { createContext, useContext } from 'solid-js';
import type { JSX } from '@solidjs/web';
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

/**
 * Explicit `null` default, NOT a default-less
 * `createContext<GanttEventHandlers>()`.
 *
 * "No provider" is a supported state: `Bar` and the demo harnesses that mount
 * bars without a `<GanttEventsProvider>` (BarDemo, ShowcaseDemo,
 * GanttMinimalTest, GanttPerfIsolate, GanttExperiments) rely on
 * `useGanttEvents` handing back no-ops instead of failing. A default-less
 * context signals absence by throwing on read, which those mounts cannot
 * survive; a `null` default keeps absence a testable value.
 */
const GanttEventsContext = createContext<GanttEventHandlers | null>(null);

/**
 * Provider component that wraps the Gantt chart and provides event handlers.
 */
export function GanttEventsProvider(
    props: GanttEventsProviderProps,
): JSX.Element {
    // Block bodies on purpose: each bridge hands control to consumer code
    // across the component boundary, so it must not leak a return value.
    const handlers: GanttEventHandlers = {
        onDateChange: (taskId, position) => {
            props.onDateChange?.(taskId, position);
        },
        onProgressChange: (taskId, progress) => {
            props.onProgressChange?.(taskId, progress);
        },
        onResizeEnd: (taskId) => {
            props.onResizeEnd?.(taskId);
        },
        onTaskClick: (taskId, event) => {
            props.onTaskClick?.(taskId, event);
        },
        onHover: (taskId, clientX, clientY) => {
            props.onHover?.(taskId, clientX, clientY);
        },
        onHoverEnd: () => {
            props.onHoverEnd?.();
        },
    };

    return (
        <GanttEventsContext value={handlers}>
            {props.children}
        </GanttEventsContext>
    );
}

/**
 * Hook to access Gantt event handlers from any nested component.
 *
 * PUBLIC CONTRACT — always returns a fully populated handler set, never
 * `null`/`undefined`. Outside a `<GanttEventsProvider>` the context reads as
 * `null` and the no-op set below is returned, so consumers may call every
 * handler unconditionally.
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
