/**
 * Frappe Gantt - SolidJS Library Entry Point
 *
 * Main exports for the Gantt chart library.
 */

// Main component
export { Gantt } from './components/Gantt';

// Stores
export { createTaskStore, type TaskStore } from './stores/taskStore';
export {
    createGanttConfigStore,
    type GanttConfigStore,
} from './stores/ganttConfigStore';
export {
    createGanttDateStore,
    type GanttDateStore,
} from './stores/ganttDateStore';
export {
    createResourceStore,
    type ResourceStore,
} from './stores/resourceStore';

// Contexts
//
// Both context objects use an explicit `null` default rather than the
// default-less `createContext<T>()` form, because "mounted without the
// matching provider" is a supported state for each of them. The two hooks
// below are the only places that translate that `null` into their own public
// no-provider value, and those two values are the published contract:

/**
 * `useGanttEvents()` ALWAYS returns a full `GanttEventHandlers` set — never
 * `null` or `undefined`. Outside a `<GanttEventsProvider>` it returns no-ops,
 * so a consumer may call any handler unconditionally.
 */
export { GanttEventsProvider, useGanttEvents } from './contexts/GanttEvents';

/**
 * `useGanttStores()` returns `GanttStores | undefined` — `undefined`, never
 * `null`, outside a `<GanttProvider>`, so callers can fall back to their own
 * stores. This is the form README.md documents ("Advanced usage —
 * `<GanttProvider>`") and the form `<Gantt>` itself depends on for the bare
 * `<Gantt tasks={...} />` mount.
 */
export {
    GanttProvider,
    useGanttStores,
    type GanttStores,
} from './contexts/GanttStores';

// Utilities
export {
    resolveConstraints,
    calculateCascadeUpdates,
} from './utils/constraintEngine';
export { buildHierarchy, collectDescendants } from './utils/hierarchyProcessor';
export { generateSubtaskDemo } from './utils/subtaskGenerator';

// Date utilities
export * from './utils/dateUtils';

// Diagnostics — opt in to route validation messages
export {
    setDiagnosticHandler,
    type DiagnosticHandler,
    type DiagnosticLevel,
} from './utils/diagnostics';

// Types
export type {
    DependencyType,
    Dependency,
    NormalizedDependency,
    TaskConstraints,
    NormalizedConstraints,
    LockState,
    GanttTask,
    ProcessedTask,
    BarPosition,
    Relationship,
    ConstraintResult,
    ConstraintContext,
} from './types';
