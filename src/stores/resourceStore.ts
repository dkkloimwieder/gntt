import { createSignal, createMemo, Accessor } from 'solid-js';
import {
    normalizeResources,
    computeDisplayResources,
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
    isGroupCollapsed: (groupId: string) => boolean;
    expandAll: () => void;
    collapseAll: () => void;
}

/**
 * Reactive resource store for managing resource groups and collapse state.
 *
 * Resources can be:
 * - Simple strings: ['A', 'B', 'C'] (auto-converted to typed objects)
 * - Typed objects: [{ id: 'A', type: 'resource' }, ...]
 * - With groups: [{ id: 'Team1', type: 'group' }, { id: 'A', type: 'resource', group: 'Team1' }, ...]
 */
export function createResourceStore(initialResources: ResourceInput[] = []): ResourceStore {
    // Normalized resources (all converted to typed objects)
    const [resources, setResources] = createSignal<Resource[]>(
        normalizeResources(initialResources),
    );

    // Set of collapsed group IDs
    const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set());

    // Computed: visible resources with display indices
    // Filters out resources in collapsed groups
    const displayResources = createMemo<DisplayResource[]>(() =>
        computeDisplayResources(resources(), collapsedGroups()),
    );

    // Computed: Map of resource ID to display index (for Y positioning)
    const resourceIndexMap = createMemo<Map<string, number>>(() => {
        const map = new Map<string, number>();
        const display = displayResources();
        for (let i = 0; i < display.length; i++) {
            const item = display[i];
            if (item) {
                map.set(item.id, i);
            }
        }
        return map;
    });

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

    // Check if a group is collapsed
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

    // Collapse all groups
    const collapseAll = (): void => {
        const groups = getGroups();
        setCollapsedGroups(new Set(groups.map((g) => g.id)));
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
