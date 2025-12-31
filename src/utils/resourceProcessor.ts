/**
 * Resource processor utilities for handling grouped resources.
 *
 * Supports three input formats:
 * 1. String array: ['A', 'B', 'C'] - simple flat resources
 * 2. Typed array: [{ id: 'A', type: 'resource' }, ...]
 * 3. Grouped array: [{ id: 'Team1', type: 'group' }, { id: 'A', type: 'resource', group: 'Team1' }, ...]
 */

import type { Resource, ResourceInput } from '../types';

interface DisplayResource extends Resource {
    displayIndex: number;
    isCollapsed?: boolean;
}

interface TaskWithResource {
    resource?: string;
}

/**
 * Normalize resources to typed object format.
 * Converts simple string arrays to typed objects.
 */
export function normalizeResources(rawResources: ResourceInput[] | null | undefined): Resource[] {
    if (!rawResources || rawResources.length === 0) {
        return [];
    }

    return rawResources.map((item): Resource => {
        // Already a typed object
        if (typeof item === 'object' && item !== null) {
            return {
                ...item,
                id: item.id || item.name || String(item),
                type: item.type || 'resource',
                group: item.group || undefined,
            };
        }

        // Simple string - convert to resource object
        return {
            id: String(item),
            type: 'resource',
            group: undefined,
        };
    });
}

/**
 * Compute display resources based on collapse state.
 * Filters out resources whose parent group is collapsed.
 */
export function computeDisplayResources(
    resources: Resource[],
    collapsedGroups: Set<string>
): DisplayResource[] {
    const result: DisplayResource[] = [];

    for (const item of resources) {
        // Groups are always visible
        if (item.type === 'group') {
            result.push({
                ...item,
                displayIndex: result.length,
                isCollapsed: collapsedGroups.has(item.id),
            });
            continue;
        }

        // Resources: check if parent group is collapsed
        if (item.group && collapsedGroups.has(item.group)) {
            continue; // Skip - parent group is collapsed
        }

        result.push({
            ...item,
            displayIndex: result.length,
        });
    }

    return result;
}

/**
 * Extract resources from tasks (for backward compatibility).
 * Used when no explicit resources are provided.
 */
export function extractResourcesFromTasks(tasks: TaskWithResource[] | null | undefined): Resource[] {
    if (!tasks || tasks.length === 0) {
        return [];
    }

    const resourceSet = new Set<string>();
    const resources: Resource[] = [];

    for (const task of tasks) {
        const resourceId = task.resource || 'Unassigned';
        if (!resourceSet.has(resourceId)) {
            resourceSet.add(resourceId);
            resources.push({
                id: resourceId,
                type: 'resource',
                group: undefined,
            });
        }
    }

    return resources;
}

/**
 * Build a lookup map for groups by ID.
 */
export function buildGroupMap(resources: Resource[]): Map<string, Resource> {
    const map = new Map<string, Resource>();
    for (const item of resources) {
        if (item.type === 'group') {
            map.set(item.id, item);
        }
    }
    return map;
}

/**
 * Get all resources belonging to a specific group.
 */
export function getResourcesInGroup(resources: Resource[], groupId: string): Resource[] {
    return resources.filter(
        (r) => r.type === 'resource' && r.group === groupId,
    );
}

/**
 * Count resources in each group.
 */
export function countResourcesPerGroup(resources: Resource[]): Map<string, number> {
    const counts = new Map<string, number>();

    for (const item of resources) {
        if (item.type === 'resource' && item.group) {
            const current = counts.get(item.group) || 0;
            counts.set(item.group, current + 1);
        }
    }

    return counts;
}
