import { describe, it, expect } from 'vitest';
import {
    normalizeResources,
    computeDisplayResources,
    extractResourcesFromTasks,
    buildGroupMap,
    getResourcesInGroup,
    countResourcesPerGroup,
} from '../src/utils/resourceProcessor';
import type { Resource } from '../src/types';

describe('normalizeResources', () => {
    it('returns [] for null/undefined/empty', () => {
        expect(normalizeResources(null)).toEqual([]);
        expect(normalizeResources(undefined)).toEqual([]);
        expect(normalizeResources([])).toEqual([]);
    });

    it('converts string entries to typed Resource objects', () => {
        const r = normalizeResources(['A', 'B']);
        expect(r).toEqual([
            { id: 'A', type: 'resource', group: undefined },
            { id: 'B', type: 'resource', group: undefined },
        ]);
    });

    it('preserves typed object entries and defaults type=resource', () => {
        const r = normalizeResources([
            { id: 'X', type: 'group' },
            { id: 'Y' } as unknown as Resource,
            { id: 'Z', group: 'X' } as unknown as Resource,
        ]);
        expect(r[0]?.type).toBe('group');
        expect(r[1]?.type).toBe('resource');
        expect(r[2]?.group).toBe('X');
    });

    it('falls back from id to name when id missing', () => {
        const r = normalizeResources([
            { name: 'Alpha' } as unknown as Resource,
        ]);
        expect(r[0]?.id).toBe('Alpha');
    });
});

describe('computeDisplayResources', () => {
    it('passes through all when no groups collapsed', () => {
        const resources: Resource[] = [
            { id: 'G1', type: 'group' },
            { id: 'A', type: 'resource', group: 'G1' },
            { id: 'B', type: 'resource', group: 'G1' },
            { id: 'C', type: 'resource' },
        ];
        const out = computeDisplayResources(resources, new Set());
        expect(out.map((r) => r.id)).toEqual(['G1', 'A', 'B', 'C']);
        expect(out[0]?.isCollapsed).toBe(false);
    });

    it('hides resources whose group is collapsed; keeps the group itself with isCollapsed=true', () => {
        const resources: Resource[] = [
            { id: 'G1', type: 'group' },
            { id: 'A', type: 'resource', group: 'G1' },
            { id: 'G2', type: 'group' },
            { id: 'B', type: 'resource', group: 'G2' },
        ];
        const out = computeDisplayResources(resources, new Set(['G1']));
        expect(out.map((r) => r.id)).toEqual(['G1', 'G2', 'B']);
        const g1 = out.find((r) => r.id === 'G1')!;
        expect(g1.isCollapsed).toBe(true);
    });

    it('assigns sequential displayIndex matching final order', () => {
        const resources: Resource[] = [
            { id: 'G', type: 'group' },
            { id: 'A', type: 'resource', group: 'G' },
            { id: 'B', type: 'resource', group: 'G' },
        ];
        const out = computeDisplayResources(resources, new Set());
        expect(out.map((r) => r.displayIndex)).toEqual([0, 1, 2]);
    });

    it('keeps ungrouped resources visible regardless of collapsed set', () => {
        const resources: Resource[] = [
            { id: 'G', type: 'group' },
            { id: 'lonely', type: 'resource' }, // no group
        ];
        const out = computeDisplayResources(resources, new Set(['G']));
        expect(out.map((r) => r.id)).toEqual(['G', 'lonely']);
    });
});

describe('extractResourcesFromTasks', () => {
    it('returns [] for null/empty', () => {
        expect(extractResourcesFromTasks(null)).toEqual([]);
        expect(extractResourcesFromTasks([])).toEqual([]);
    });

    it('collects unique resources in first-appearance order', () => {
        const r = extractResourcesFromTasks([
            { resource: 'B' },
            { resource: 'A' },
            { resource: 'B' },
            { resource: 'A' },
        ]);
        expect(r.map((x) => x.id)).toEqual(['B', 'A']);
        expect(r.every((x) => x.type === 'resource')).toBe(true);
    });

    it('uses "Unassigned" for tasks without resource', () => {
        const r = extractResourcesFromTasks([{ resource: 'A' }, {}]);
        expect(r.map((x) => x.id)).toEqual(['A', 'Unassigned']);
    });
});

describe('buildGroupMap', () => {
    it('only indexes type=group entries', () => {
        const resources: Resource[] = [
            { id: 'G1', type: 'group' },
            { id: 'A', type: 'resource', group: 'G1' },
            { id: 'G2', type: 'group' },
        ];
        const map = buildGroupMap(resources);
        expect(map.size).toBe(2);
        expect(map.get('G1')?.id).toBe('G1');
        expect(map.has('A')).toBe(false);
    });

    it('returns empty map when no groups present', () => {
        const map = buildGroupMap([{ id: 'A', type: 'resource' }]);
        expect(map.size).toBe(0);
    });
});

describe('getResourcesInGroup', () => {
    it('returns resources matching the group id', () => {
        const resources: Resource[] = [
            { id: 'G', type: 'group' },
            { id: 'A', type: 'resource', group: 'G' },
            { id: 'B', type: 'resource', group: 'G' },
            { id: 'C', type: 'resource', group: 'Other' },
            { id: 'D', type: 'resource' },
        ];
        const out = getResourcesInGroup(resources, 'G');
        expect(out.map((r) => r.id)).toEqual(['A', 'B']);
    });

    it('returns [] when group has no members', () => {
        expect(getResourcesInGroup([], 'G')).toEqual([]);
    });

    it('does not return groups themselves', () => {
        const resources: Resource[] = [
            { id: 'G', type: 'group' }, // even if we asked for 'G', groups aren't members of themselves
        ];
        expect(getResourcesInGroup(resources, 'G')).toEqual([]);
    });
});

describe('countResourcesPerGroup', () => {
    it('counts members per group', () => {
        const resources: Resource[] = [
            { id: 'G1', type: 'group' },
            { id: 'A', type: 'resource', group: 'G1' },
            { id: 'B', type: 'resource', group: 'G1' },
            { id: 'G2', type: 'group' },
            { id: 'C', type: 'resource', group: 'G2' },
            { id: 'D', type: 'resource' }, // ungrouped — not counted
        ];
        const counts = countResourcesPerGroup(resources);
        expect(counts.get('G1')).toBe(2);
        expect(counts.get('G2')).toBe(1);
        expect(counts.size).toBe(2);
    });

    it('returns empty map when nothing is grouped', () => {
        const counts = countResourcesPerGroup([{ id: 'A', type: 'resource' }]);
        expect(counts.size).toBe(0);
    });
});
