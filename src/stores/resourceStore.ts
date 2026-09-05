import { createSignal, createMemo, Accessor } from 'solid-js';
import {
    normalizeResources,
    computeDisplayResources,
    computeResourceIndexMap,
} from '../utils/resourceProcessor';
import type { Resource, ResourceInput } from '../types';

interface DisplayResource extends Resource {
    displayIndex: number;
    isCollapsed?: boolean;
}

export interface ResourceStore {
    // Signals
    resources: Accessor<Resource[]>;
    collapsedGroups: Accessor<Set<string>>;

    // Computed
    displayResources: Accessor<DisplayResource[]>;
    resourceIndexMap: Accessor<Map<string, number>>;
    displayCount: Accessor<number>;
    getGroups: Accessor<Resource[]>;

    // Actions
    updateResources: (newResources: ResourceInput[]) => void;
    toggleGroup: (groupId: string) => void;
    expandGroup: (groupId: string) => void;
    collapseGroup: (groupId: string) => void;
    /**
     * Answers about the COMMITTED collapse state.
     *
     * Not a toggle-then-branch oracle: `toggleGroup(id)` followed by
     * `isGroupCollapsed(id)` in the same turn reports the state from BEFORE
     * the toggle, because the write has only been staged. Decide from the
     * value you are about to write, not from a read-back.
     */
    isGroupCollapsed: (groupId: string) => boolean;
    expandAll: () => void;
    /**
     * Collapse groups. With no argument, collapses every group in the
     * COMMITTED resource list; pass the ids explicitly when the resource
     * list was written in the same turn.
     */
    collapseAll: (ids?: string[]) => void;
}

/**
 * Reactive resource store for managing resource groups and collapse state.
 *
 * Resources can be:
 * - Simple strings: ['A', 'B', 'C'] (auto-converted to typed objects)
 * - Typed objects: [{ id: 'A', type: 'resource' }, ...]
 * - With groups: [{ id: 'Team1', type: 'group' }, { id: 'A', type: 'resource', group: 'Team1' }, ...]
 */
export function createResourceStore(
    initialResources: ResourceInput[] = [],
): ResourceStore {
    // Normalized resources (all converted to typed objects)
    const [resources, setResources] = createSignal<Resource[]>(
        normalizeResources(initialResources),
    );

    // Set of collapsed group IDs
    const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(
        new Set(),
    );

    // Computed: visible resources with display indices
    // Filters out resources in collapsed groups
    const displayResources = createMemo<DisplayResource[]>(() =>
        computeDisplayResources(resources(), collapsedGroups()),
    );

    // Computed: Map of resource ID to display index (for Y positioning)
    const resourceIndexMap = createMemo<Map<string, number>>(() =>
        computeResourceIndexMap(displayResources()),
    );

    // Computed: count of visible rows
    const displayCount = createMemo(() => displayResources().length);

    // Toggle a group's collapsed state
    const toggleGroup = (groupId: string): void => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    // Expand a group
    const expandGroup = (groupId: string): void => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            next.delete(groupId);
            return next;
        });
    };

    // Collapse a group
    const collapseGroup = (groupId: string): void => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            next.add(groupId);
            return next;
        });
    };

    /**
     * Check if a group is collapsed.
     *
     * COMMITTED-STATE READER. Reads the collapsed set as it stands, which is
     * not necessarily what a mutator called earlier in the same turn staged.
     * Never use it as a toggle-then-branch oracle
     * (`toggleGroup(id); if (isGroupCollapsed(id)) ...` answers about the
     * PREVIOUS state); compute the intended next state and act on that.
     */
    const isGroupCollapsed = (groupId: string): boolean => {
        return collapsedGroups().has(groupId);
    };

    // Update resources (normalizes input)
    const updateResources = (newResources: ResourceInput[]): void => {
        setResources(normalizeResources(newResources));
    };

    // Get all groups
    const getGroups = createMemo(() => {
        return resources().filter((r) => r.type === 'group');
    });

    // Expand all groups
    const expandAll = (): void => {
        setCollapsedGroups(new Set<string>());
    };

    /**
     * Collapse all groups.
     *
     * @param ids Group ids to collapse. When omitted the ids are derived from
     * the `getGroups()` memo — i.e. from the COMMITTED resource list. A caller
     * that has just written the resource list in the same turn must pass the
     * ids it built, otherwise the read-back yields the pre-write groups and
     * the wrong (or no) groups collapse. Mirrors
     * `taskStore.collapseAllTasks(ids?)`.
     */
    const collapseAll = (ids?: string[]): void => {
        const groupIds = ids ?? getGroups().map((g) => g.id);
        setCollapsedGroups(new Set(groupIds));
    };

    return {
        // Signals
        resources,
        collapsedGroups,

        // Computed
        displayResources,
        resourceIndexMap,
        displayCount,
        getGroups,

        // Actions
        updateResources,
        toggleGroup,
        expandGroup,
        collapseGroup,
        isGroupCollapsed,
        expandAll,
        collapseAll,
    };
}
