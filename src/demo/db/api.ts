/**
 * Thin fetch wrappers around the demo backend. Centralizing them keeps
 * URL/method choices out of the components and makes error handling
 * consistent (always throws Error with the server's `error` message).
 */
import type {
    BlockedSlotApi,
    BootstrapBundle,
    DepApi,
    ResourceApi,
    TaskApi,
} from './types';

async function readError(res: Response): Promise<string> {
    try {
        const body = await res.json();
        if (body && typeof body === 'object' && 'error' in body) {
            return String((body as { error: unknown }).error);
        }
    } catch {
        /* ignore */
    }
    return `${res.status} ${res.statusText}`;
}

async function expect(res: Response): Promise<unknown> {
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
}

export const api = {
    bootstrap: (): Promise<BootstrapBundle> =>
        fetch('/api/bootstrap').then((r) =>
            expect(r),
        ) as Promise<BootstrapBundle>,

    createTask: (
        body: Partial<TaskApi> & {
            id: string;
            name: string;
            start: string;
            end: string;
        },
    ): Promise<TaskApi> =>
        fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then((r) => expect(r)) as Promise<TaskApi>,

    patchTask: (id: string, patch: Partial<TaskApi>): Promise<TaskApi> =>
        fetch(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        }).then((r) => expect(r)) as Promise<TaskApi>,

    deleteTask: (id: string): Promise<{ ok: true }> =>
        fetch(`/api/tasks/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        }).then((r) => expect(r)) as Promise<{ ok: true }>,

    replaceDeps: (id: string, deps: DepApi[]): Promise<TaskApi> =>
        fetch(`/api/tasks/${encodeURIComponent(id)}/dependencies`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deps),
        }).then((r) => expect(r)) as Promise<TaskApi>,

    createResource: (body: {
        id: string;
        name: string;
        group?: string | null;
        order?: number;
    }): Promise<ResourceApi> =>
        fetch('/api/resources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then((r) => expect(r)) as Promise<ResourceApi>,

    deleteResource: (id: string): Promise<{ ok: true }> =>
        fetch(`/api/resources/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        }).then((r) => expect(r)) as Promise<{ ok: true }>,

    createBlocked: (body: {
        resource: string;
        start: string;
        end: string;
        reason?: string | null;
    }): Promise<BlockedSlotApi> =>
        fetch('/api/blocked', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then((r) => expect(r)) as Promise<BlockedSlotApi>,

    deleteBlocked: (id: number): Promise<{ ok: true }> =>
        fetch(`/api/blocked/${id}`, { method: 'DELETE' }).then((r) =>
            expect(r),
        ) as Promise<{ ok: true }>,
};

/** "2025-01-01 08:00" → "2025-01-01T08:00" (HTML datetime-local). */
export const toLocalInput = (iso: string): string =>
    iso ? iso.replace(' ', 'T').slice(0, 16) : '';

/** "2025-01-01T08:00" → "2025-01-01 08:00". */
export const fromLocalInput = (s: string): string =>
    s ? s.replace('T', ' ').slice(0, 16) : '';
