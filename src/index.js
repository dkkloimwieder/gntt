/**
 * Frappe Gantt - SolidJS Library Entry Point
 *
 * Main exports for the Gantt chart library.
 */

// Main component
export { Gantt } from './components/Gantt.jsx';

// Stores
export { createTaskStore } from './stores/taskStore.js';
export { createGanttConfigStore } from './stores/ganttConfigStore.js';
export { createGanttDateStore } from './stores/ganttDateStore.js';
export { createResourceStore } from './stores/resourceStore.js';

// Contexts
export { GanttEventsProvider, useGanttEvents } from './contexts/GanttEvents.jsx';

// Utilities
export { resolveMovement, detectCycles } from './utils/constraintResolver.js';
export { buildHierarchy, collectDescendants } from './utils/hierarchyProcessor.js';
export { generateSubtaskDemo } from './utils/subtaskGenerator.js';

// Date utilities
export * from './utils/date_utils.js';
