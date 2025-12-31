/**
 * Frappe Gantt - SolidJS Library Entry Point
 *
 * Main exports for the Gantt chart library.
 */

// Main component
export { Gantt } from './components/Gantt';

// Stores
export { createTaskStore } from './stores/taskStore';
export { createGanttConfigStore } from './stores/ganttConfigStore';
export { createGanttDateStore } from './stores/ganttDateStore';
export { createResourceStore } from './stores/resourceStore';

// Contexts
export { GanttEventsProvider, useGanttEvents } from './contexts/GanttEvents';

// Utilities
export { resolveConstraints, calculateCascadeUpdates } from './utils/constraintEngine';
export { buildHierarchy, collectDescendants } from './utils/hierarchyProcessor';
export { generateSubtaskDemo } from './utils/subtaskGenerator';

// Date utilities
export * from './utils/date_utils';

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
