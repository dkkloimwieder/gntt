/**
 * Shared types for the DB-demo CRUD UI. Mirrors the server adapter
 * shape (server/db/adapter.ts) so the wire format stays explicit.
 */

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface TaskApi {
    id: string;
    name: string;
    start: string;
    end: string;
    progress: number;
    resource?: string;
    color?: string;
    colorProgress?: string;
    constraints?: TaskConstraintsApi;
    dependencies?: DepApi[];
}

export interface DepApi {
    /** Predecessor task id. */
    id: string;
    type?: DepType;
    lag?: number;
    /** Undefined = elastic, 0 = fixed gap, N = bounded gap (hours). */
    max?: number;
}

export interface TaskConstraintsApi {
    locked?: boolean | 'start' | 'end' | 'duration';
    minStart?: string;
    maxStart?: string;
    minEnd?: string;
    maxEnd?: string;
    minDuration?: number;
    maxDuration?: number;
    fixedDuration?: number;
}

export interface ResourceApi {
    id: string;
    name: string;
    group?: string;
    order?: number;
}

export interface BlockedSlotApi {
    id: number;
    resource: string;
    start: string;
    end: string;
    reason?: string;
}

export interface BootstrapBundle {
    tasks: TaskApi[];
    resources: ResourceApi[];
    blockedTime: BlockedSlotApi[];
}
