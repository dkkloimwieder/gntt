/**
 * Resource processor utilities for handling grouped resources.
 *
 * Supports three input formats:
 * 1. String array: ['A', 'B', 'C'] - simple flat resources
 * 2. Typed array: [{ id: 'A', type: 'resource' }, ...]
 * 3. Grouped array: [{ id: 'Team1', type: 'group' }, { id: 'A', type: 'resource', group: 'Team1' }, ...]
 */

/**
 * Normalize resources to typed object format.
 * Converts simple string arrays to typed objects.
 *
 * @param {Array<string|Object>} rawResources - Input resources
 * @returns {Array<Object>} Normalized resources with type and id
 */
export function normalizeResources(rawResources) {
    if (!rawResources || rawResources.length === 0) {
        return [];
    }

    return rawResources.map((item) => {
        // Already a typed object
        if (typeof item === 'object' && item !== null) {
            return {
                ...item,
                id: item.id || item.name || String(item),
                type: item.type || 'resource',
                group: item.group || null,
            };
        }

        // Simple string - convert to resource object
        return {
            id: String(item),
            type: 'resource',
            group: null,
        };
    });
}

/**
 * Compute display resources based on collapse state.
 * Filters out resources whose parent group is collapsed.
 *
 * @param {Array<Object>} resources - Normalized resources
 * @param {Set<string>} collapsedGroups - Set of collapsed group IDs
 * @returns {Array<Object>} Visible resources with displayIndex
 */
export function computeDisplayResources(resources, collapsedGroups) {
    const result = [];

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
 *
 * @param {Array<Object>} tasks - Array of tasks
 * @returns {Array<Object>} Extracted resources as typed objects
 */
export function extractResourcesFromTasks(tasks) {
    if (!tasks || tasks.length === 0) {
        return [];
    }

    const resourceSet = new Set();
    const resources = [];

    for (const task of tasks) {
        const resourceId = task.resource || 'Unassigned';
        if (!resourceSet.has(resourceId)) {
            resourceSet.add(resourceId);
            resources.push({
                id: resourceId,
                type: 'resource',
                group: null,
            });
        }
    }

    return resources;
}

/**
 * Build a lookup map for groups by ID.
 *
 * @param {Array<Object>} resources - Normalized resources
 * @returns {Map<string, Object>} Map of group ID to group object
 */
export function buildGroupMap(resources) {
    const map = new Map();
    for (const item of resources) {
        if (item.type === 'group') {
            map.set(item.id, item);
        }
    }
    return map;
}

/**
 * Get all resources belonging to a specific group.
 *
 * @param {Array<Object>} resources - Normalized resources
 * @param {string} groupId - Group ID to filter by
 * @returns {Array<Object>} Resources in the group
 */
export function getResourcesInGroup(resources, groupId) {
    return resources.filter(
        (r) => r.type === 'resource' && r.group === groupId,
    );
}

/**
 * Count resources in each group.
 *
 * @param {Array<Object>} resources - Normalized resources
 * @returns {Map<string, number>} Map of group ID to resource count
 */
export function countResourcesPerGroup(resources) {
    const counts = new Map();

    for (const item of resources) {
        if (item.type === 'resource' && item.group) {
            const current = counts.get(item.group) || 0;
            counts.set(item.group, current + 1);
        }
    }

    return counts;
}
