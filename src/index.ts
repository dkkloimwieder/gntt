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
export { GanttEventsProvider, useGanttEvents } from './contexts/GanttEvents';
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
