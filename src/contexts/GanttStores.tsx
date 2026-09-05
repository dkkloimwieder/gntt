import { createContext, useContext } from 'solid-js';
import type { JSX } from '@solidjs/web';
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

/**
 * Explicit `null` default, NOT a default-less `createContext<GanttStores>()`.
 *
 * "No provider" is a supported, load-bearing state here: it is the bare
 * `<Gantt tasks={...} />` form, the library's most common usage. A
 * default-less context signals that absence by throwing on read, which would
 * kill that form outright; a `null` default keeps it a value the caller can
 * test. `useGanttStores` maps that `null` back to `undefined` so the public
 * signature stays `GanttStores | undefined` (see below).
 */
const GanttStoresContext = createContext<GanttStores | null>(null);

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
        <GanttStoresContext value={stores}>{props.children}</GanttStoresContext>
    );
}

/**
 * Read the four Gantt stores from a surrounding `<GanttProvider>`. Returns
 * `undefined` when called outside a provider so the caller can fall back to
 * its own store instances.
 *
 * PUBLIC CONTRACT — `GanttStores | undefined`, never `null`. The context's own
 * no-provider value is `null` (see above); the `?? undefined` here is the
 * single place that translation happens, so the documented signature
 * (README.md, "Advanced usage — `<GanttProvider>`") and `Gantt.tsx`'s
 * `useGanttStores() ?? { ...own stores }` both stay exactly as they are.
 */
export function useGanttStores(): GanttStores | undefined {
    return useContext(GanttStoresContext) ?? undefined;
}

export default GanttStoresContext;
