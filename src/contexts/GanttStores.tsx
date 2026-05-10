import { createContext, useContext, JSX } from 'solid-js';
import { createTaskStore, type TaskStore } from '../stores/taskStore';
import {
    createGanttConfigStore,
    type GanttConfigStore,
} from '../stores/ganttConfigStore';
import {
    createGanttDateStore,
    type GanttDateStore,
} from '../stores/ganttDateStore';
import {
    createResourceStore,
    type ResourceStore,
} from '../stores/resourceStore';
import type { ResourceInput } from '../types';

export interface GanttStores {
    taskStore: TaskStore;
    ganttConfig: GanttConfigStore;
    dateStore: GanttDateStore;
    resourceStore: ResourceStore;
}

interface GanttProviderProps {
    options?: Record<string, unknown>;
    resources?: ResourceInput[];
    children: JSX.Element;
}

const GanttStoresContext = createContext<GanttStores>();

/**
 * Creates the four Gantt stores once and provides them via context. Useful
 * when sibling components (toolbars, custom panels, devtools) need to read or
 * mutate Gantt state without prop-drilling. The plain `<Gantt tasks={...} />`
 * form still works without a provider.
 */
export function GanttProvider(props: GanttProviderProps): JSX.Element {
    const stores: GanttStores = {
        taskStore: createTaskStore(),
        ganttConfig: createGanttConfigStore(props.options || {}),
        dateStore: createGanttDateStore(props.options || {}),
        resourceStore: createResourceStore(props.resources || []),
    };

    return (
        <GanttStoresContext.Provider value={stores}>
            {props.children}
        </GanttStoresContext.Provider>
    );
}

/**
 * Read the four Gantt stores from a surrounding `<GanttProvider>`. Returns
 * `undefined` when called outside a provider so the caller can fall back to
 * its own store instances.
 */
export function useGanttStores(): GanttStores | undefined {
    return useContext(GanttStoresContext);
}

export default GanttStoresContext;
