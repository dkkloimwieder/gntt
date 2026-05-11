// @ts-nocheck
import { Show, createMemo, createSignal, onMount } from 'solid-js';
import { Gantt } from '../components/Gantt';
import { BlockedManager } from './db/BlockedManager';
import { Modal } from './db/Modal';
import { ResourceManager } from './db/ResourceManager';
import { TaskForm } from './db/TaskForm';
import { api, fromLocalInput } from './db/api';
import type { BootstrapBundle, TaskApi } from './db/types';

/**
 * DbDemo — full CRUD over the Drizzle + SQLite + Hono backend.
 *
 * Layout: chart on the left, sticky right panel for editing the
 * selected task. Toolbar opens an Add modal, Resource manager modal,
 * and Blocked-time manager modal. Drag-on-bar still PATCHes start/end.
 *
 * After every mutation we re-fetch the bundle (simple + correct;
 * optimistic updates are a follow-up). The selected task id is
 * preserved across re-fetches so the edit panel stays open.
 *
 * Run via `pnpm dev:all`.
 */

type ModalKind = null | 'add' | 'resources' | 'blocked';

export function DbDemo() {
    const [bundle, setBundle] = createSignal<BootstrapBundle | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [status, setStatus] = createSignal<string>('Loading…');
    const [modal, setModal] = createSignal<ModalKind>(null);
    const [selectedId, setSelectedId] = createSignal<string | null>(null);

    const refetch = async (note?: string) => {
        try {
            const data = await api.bootstrap();
            setBundle(data);
            setError(null);
            setStatus(
                `${note ?? 'Loaded'} — ${data.tasks.length} tasks, ${data.resources.length} resources, ${data.blockedTime.length} blocked · ${new Date().toLocaleTimeString()}`,
            );
        } catch (err) {
            setError(`fetch failed: ${(err as Error).message}`);
            setStatus('Backend unreachable');
        }
    };

    onMount(() => refetch('Loaded'));

    const selectedTask = createMemo<TaskApi | null>(() => {
        const id = selectedId();
        if (!id) return null;
        return bundle()?.tasks.find((t) => t.id === id) ?? null;
    });

    /** Handler for chart drag — PATCH start+end, then refetch. */
    const onDateChange = async (
        id: string,
        range: { start: Date; end: Date },
    ) => {
        const fmt = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        try {
            await api.patchTask(id, {
                start: fmt(range.start),
                end: fmt(range.end),
            });
            await refetch(`PATCH ${id} (drag)`);
        } catch (err) {
            setStatus(`PATCH ${id} failed: ${(err as Error).message}`);
        }
    };

    const onProgressChange = async (id: string, progress: number) => {
        try {
            await api.patchTask(id, { progress });
            await refetch(`PATCH ${id} progress=${progress}`);
        } catch (err) {
            setStatus(`PATCH ${id} progress failed: ${(err as Error).message}`);
        }
    };

    /** Persist task form (create or edit) plus its dependency list. */
    const submitTask = async (
        mode: 'create' | 'edit',
        value: Parameters<typeof TaskForm>[0]['onSubmit'] extends (
            v: infer V,
        ) => unknown
            ? V
            : never,
    ) => {
        const t = value.task;
        if (mode === 'create') {
            await api.createTask({
                id: t.id,
                name: t.name,
                start: t.start,
                end: t.end,
                progress: t.progress,
                resource: t.resource ?? undefined,
                color: t.color ?? undefined,
                constraints: t.constraints ?? undefined,
            });
        } else {
            await api.patchTask(t.id, {
                name: t.name,
                start: t.start,
                end: t.end,
                progress: t.progress,
                resource: t.resource ?? null,
                color: t.color ?? null,
                constraints: t.constraints ?? null,
            });
        }
        await api.replaceDeps(t.id, value.dependencies);
        await refetch(`${mode === 'create' ? 'Created' : 'Updated'} ${t.id}`);
        if (mode === 'create') {
            setModal(null);
            setSelectedId(t.id);
        }
    };

    const deleteSelected = async () => {
        const id = selectedId();
        if (!id) return;
        try {
            await api.deleteTask(id);
            setSelectedId(null);
            await refetch(`Deleted ${id}`);
        } catch (err) {
            setStatus(`DELETE ${id} failed: ${(err as Error).message}`);
        }
    };

    return (
        <div>
            <h2 style={{ margin: '0 0 12px 0' }}>DB-backed Events — CRUD</h2>
            <p
                style={{
                    margin: '0 0 12px 0',
                    color: '#6b7280',
                    'font-size': '14px',
                    'max-width': '820px',
                }}
            >
                Click a bar → edit panel pops out on the right. Drag a bar →
                PATCH fires (auto-saved). Add events / manage resources / manage
                blocked-time via the toolbar buttons. Every mutation re-fetches
                the bundle so the chart stays in sync with the DB.
            </p>

            {/* Toolbar */}
            <div
                style={{
                    display: 'flex',
                    gap: '8px',
                    'align-items': 'center',
                    'margin-bottom': '12px',
                    'flex-wrap': 'wrap',
                }}
            >
                <button style={primaryBtn} onClick={() => setModal('add')}>
                    + Add event
                </button>
                <button
                    style={secondaryBtn}
                    onClick={() => setModal('resources')}
                >
                    Manage resources
                </button>
                <button
                    style={secondaryBtn}
                    onClick={() => setModal('blocked')}
                >
                    Manage blocked time
                </button>
                <button
                    style={secondaryBtn}
                    onClick={() => refetch('Reloaded')}
                >
                    ⟳ Reload
                </button>
                <span
                    style={{
                        'font-family': 'monospace',
                        'font-size': '12px',
                        color: error() ? '#b91c1c' : '#4338ca',
                        'background-color': error() ? '#fee2e2' : '#eef2ff',
                        padding: '4px 8px',
                        'border-radius': '4px',
                        'margin-left': '8px',
                    }}
                >
                    {status()}
                </span>
            </div>

            {/* Chart + sticky edit panel */}
            <div
                style={{
                    display: 'grid',
                    'grid-template-columns': selectedTask()
                        ? 'minmax(0, 1fr) 420px'
                        : '1fr',
                    gap: '16px',
                    'align-items': 'flex-start',
                }}
            >
                <div style={{ 'min-width': '0' }}>
                    <Show
                        when={bundle()}
                        fallback={
                            <div
                                style={{
                                    padding: '40px',
                                    'text-align': 'center',
                                    color: '#6b7280',
                                }}
                            >
                                {error() ? (
                                    <>
                                        <strong>Backend not reachable.</strong>{' '}
                                        Start it with{' '}
                                        <code>pnpm dev:server</code> (or run
                                        everything via <code>pnpm dev:all</code>
                                        ), then click Reload.
                                    </>
                                ) : (
                                    'Loading…'
                                )}
                            </div>
                        }
                    >
                        <Gantt
                            tasks={bundle()!.tasks}
                            options={{ viewMode: 'Day', scrollTo: 'start' }}
                            onDateChange={onDateChange}
                            onProgressChange={onProgressChange}
                            onTaskClick={(id) => setSelectedId(id)}
                        />
                    </Show>
                </div>

                <Show when={selectedTask()}>
                    <div
                        style={{
                            position: 'sticky',
                            top: '12px',
                            'background-color': '#fff',
                            border: '1px solid #e5e7eb',
                            'border-radius': '8px',
                            padding: '16px',
                            'box-shadow': '0 6px 16px -8px rgba(15,23,42,0.1)',
                            'max-height': '85vh',
                            'overflow-y': 'auto',
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                'justify-content': 'space-between',
                                'align-items': 'center',
                                'margin-bottom': '12px',
                            }}
                        >
                            <h3 style={{ margin: 0, 'font-size': '15px' }}>
                                Edit event
                            </h3>
                            <button
                                type="button"
                                style={closeBtn}
                                onClick={() => setSelectedId(null)}
                                aria-label="close edit panel"
                            >
                                ×
                            </button>
                        </div>
                        <TaskForm
                            mode="edit"
                            initial={selectedTask()!}
                            resources={bundle()!.resources}
                            allTasks={bundle()!.tasks}
                            onSubmit={(v) => submitTask('edit', v)}
                            onDelete={deleteSelected}
                        />
                    </div>
                </Show>
            </div>

            {/* Modals */}
            <Show when={modal() === 'add'}>
                <Modal onClose={() => setModal(null)}>
                    <h3 style={{ margin: '0 0 12px 0' }}>Add new event</h3>
                    <TaskForm
                        mode="create"
                        resources={bundle()?.resources ?? []}
                        allTasks={bundle()?.tasks ?? []}
                        onSubmit={(v) => submitTask('create', v)}
                        onCancel={() => setModal(null)}
                        submitLabel="Create"
                    />
                </Modal>
            </Show>
            <Show when={modal() === 'resources'}>
                <Modal onClose={() => setModal(null)}>
                    <ResourceManager
                        resources={bundle()?.resources ?? []}
                        onCreate={async (input) => {
                            await api.createResource(input);
                            await refetch(`Created resource ${input.id}`);
                        }}
                        onDelete={async (id) => {
                            await api.deleteResource(id);
                            await refetch(`Deleted resource ${id}`);
                        }}
                        onClose={() => setModal(null)}
                    />
                </Modal>
            </Show>
            <Show when={modal() === 'blocked'}>
                <Modal onClose={() => setModal(null)} width="720px">
                    <BlockedManager
                        resources={bundle()?.resources ?? []}
                        blocked={bundle()?.blockedTime ?? []}
                        onCreate={async (input) => {
                            await api.createBlocked(input);
                            await refetch(`Added blocked slot`);
                        }}
                        onDelete={async (id) => {
                            await api.deleteBlocked(id);
                            await refetch(`Removed blocked slot ${id}`);
                        }}
                        onClose={() => setModal(null)}
                    />
                </Modal>
            </Show>
        </div>
    );
}

const primaryBtn = {
    padding: '6px 12px',
    'border-radius': '4px',
    border: '1px solid #4f46e5',
    'background-color': '#4f46e5',
    color: '#fff',
    'font-size': '13px',
    cursor: 'pointer',
} as const;

const secondaryBtn = {
    padding: '6px 12px',
    'border-radius': '4px',
    border: '1px solid #d1d5db',
    'background-color': '#fff',
    color: '#1f2937',
    'font-size': '13px',
    cursor: 'pointer',
} as const;

const closeBtn = {
    background: 'transparent',
    border: 'none',
    'font-size': '20px',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px 8px',
} as const;

void fromLocalInput; // (re-exported through api; keep import path clean)

export default DbDemo;
