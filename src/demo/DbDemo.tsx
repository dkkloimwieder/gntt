import { Show, createMemo, createSignal, onSettled } from 'solid-js';
import { Gantt } from '../components/Gantt';
import { GanttProvider, useGanttStores } from '../contexts/GanttStores';
import { format } from '../utils/dateUtils';
import { BlockedManager } from './db/BlockedManager';
import { Modal } from './db/Modal';
import { ResourceManager } from './db/ResourceManager';
import { TaskForm } from './db/TaskForm';
import { api } from './db/api';
import type { BootstrapBundle, TaskApi, TaskPatchBody } from './db/types';

/**
 * DbDemo — full CRUD over the Drizzle + SQLite + Hono backend.
 *
 * Layout: chart on the left, sticky right panel for editing the
 * selected task. Toolbar opens an Add modal, Resource manager modal,
 * and Blocked-time manager modal. Drag-on-bar still PATCHes start/end.
 *
 * Form saves reload the bundle. Chart gestures save the affected dates in
 * place so the chart keeps its current scroll position and selection.
 *
 * Run via `pnpm dev:all`.
 */

type ModalKind = null | 'add' | 'resources' | 'blocked';

const chartOptions = { viewMode: 'Day', scrollTo: 'start' } as const;

export function DbDemo() {
    return (
        <GanttProvider options={chartOptions}>
            <DbDemoContent />
        </GanttProvider>
    );
}

function DbDemoContent() {
    const { taskStore, dateStore } = useGanttStores()!;
    const [bundle, setBundle] = createSignal<BootstrapBundle | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [status, setStatus] = createSignal<string>('Loading…');
    const [modal, setModal] = createSignal<ModalKind>(null);
    const [selectedId, setSelectedId] = createSignal<string | null>(null);

    const dbState = new Map<string, { start: string; end: string }>();
    const savedBars = new Map<string, { x: number; width: number }>();
    const [dragVersion, setDragVersion] = createSignal(0);
    let pendingDateSaves = Promise.resolve();

    const refetch = async (note?: string) => {
        try {
            await pendingDateSaves;
            const data = await api.bootstrap();
            setBundle(data);
            dbState.clear();
            for (const t of data.tasks) {
                dbState.set(t.id, { start: t.start, end: t.end });
            }
            // Compare gestures with the geometry of the newly mounted chart.
            queueMicrotask(() => {
                savedBars.clear();
                for (const { id, _bar } of taskStore.getAllTasks()) {
                    savedBars.set(id, { x: _bar.x, width: _bar.width });
                }
            });
            setError(null);
            setStatus(
                `${note ?? 'Loaded'} — ${data.tasks.length} tasks, ${data.resources.length} resources, ${data.blockedTime.length} blocked · ${new Date().toLocaleTimeString()}`,
            );
        } catch (err) {
            setError(`fetch failed: ${(err as Error).message}`);
            setStatus('Backend unreachable');
        }
    };

    // Block body: `refetch` returns a Promise, and a mount callback may
    // only return undefined or a cleanup function.
    onSettled(() => {
        void refetch('Loaded');
    });

    const selectedTask = createMemo<TaskApi | null>(() => {
        const id = selectedId();
        if (!id) return null;
        // Touch dragVersion so this memo re-runs after each drag-PATCH.
        void dragVersion();
        const base = bundle()?.tasks.find((t) => t.id === id);
        if (!base) return null;
        const fresh = dbState.get(id);
        // dbState has the latest start/end (drag-PATCH updates it in
        // place); bundle has everything else (name, deps, constraints,
        // color, …).
        return fresh ? { ...base, start: fresh.start, end: fresh.end } : base;
    });

    const onDateChange = (
        taskId: string,
        range: { start: Date; end: Date },
        position?: { x: number; width: number },
    ) => {
        // A keyboard resize stages its successor moves after this callback.
        // Capture all final positions before waiting for an earlier save.
        const gesture = Promise.resolve().then(() =>
            taskStore.getAllTasks().map(({ id, _bar }) => {
                const { x, width } =
                    id === taskId && position ? position : _bar;
                return {
                    id,
                    x,
                    width,
                    start: id === taskId ? range.start : dateStore.xToDate(x),
                    end:
                        id === taskId
                            ? range.end
                            : dateStore.xToDate(x + width),
                };
            }),
        );

        pendingDateSaves = pendingDateSaves
            .then(async () => {
                const bars = await gesture;
                const results = await Promise.allSettled(
                    bars.map(async ({ id, x, width, start, end }) => {
                        const previous = savedBars.get(id);
                        if (previous?.x === x && previous.width === width)
                            return;
                        const dates = {
                            start: format(start, 'YYYY-MM-DD HH:mm'),
                            end: format(end, 'YYYY-MM-DD HH:mm'),
                        };
                        const stored = dbState.get(id);
                        if (!stored) return;
                        if (
                            dates.start !== stored.start ||
                            dates.end !== stored.end
                        ) {
                            await api.patchTask(id, dates);
                            dbState.set(id, dates);
                        }
                        savedBars.set(id, { x, width });
                    }),
                );
                setDragVersion((v) => v + 1);
                const failed = results.find((r) => r.status === 'rejected');
                if (failed) throw failed.reason;
                setStatus(
                    `Saved dates for ${taskId} · ${new Date().toLocaleTimeString()}`,
                );
            })
            .catch((err: unknown) => {
                setStatus(`PATCH ${taskId} failed: ${String(err)}`);
            });
    };

    const onProgressChange = async (id: string, progress: number) => {
        try {
            await api.patchTask(id, { progress });
            setStatus(
                `PATCH ${id} progress=${progress} ✓ ${new Date().toLocaleTimeString()}`,
            );
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
        await pendingDateSaves;
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
            const patch: TaskPatchBody = {
                name: t.name,
                start: t.start,
                end: t.end,
                progress: t.progress,
                resource: t.resource ?? null,
                color: t.color ?? null,
                constraints: t.constraints ?? null,
            };
            await api.patchTask(t.id, patch);
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
            await pendingDateSaves;
            await api.deleteTask(id);
            setSelectedId(null);
            await refetch(`Deleted ${id}`);
        } catch (err) {
            setStatus(`DELETE ${id} failed: ${(err as Error).message}`);
        }
    };

    return (
        <div
            style={{
                height: '100%',
                display: 'grid',
                'grid-template-columns': 'minmax(0, 1fr) 420px',
                gap: '12px',
                padding: '12px',
                'min-height': '0',
            }}
        >
            {/* CHART — left column, fills remaining space */}
            <div style={{ 'min-width': '0', 'min-height': '0' }}>
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
                                    Start it with <code>pnpm dev:server</code>{' '}
                                    (or run everything via{' '}
                                    <code>pnpm dev:all</code>), then click
                                    Reload in the side panel.
                                </>
                            ) : (
                                'Loading…'
                            )}
                        </div>
                    }
                >
                    <Gantt
                        tasks={bundle()!.tasks}
                        options={chartOptions}
                        onDateChange={onDateChange}
                        onProgressChange={onProgressChange}
                        onTaskClick={(id) => {
                            setSelectedId(id);
                        }}
                        disableTaskClickModal
                        disableHoverPopup
                    />
                </Show>
            </div>

            {/* RIGHT PANEL — always open. All actions live here.
                Top:   action buttons + status chip
                Below: edit form when a task is selected, otherwise a
                       short "click a bar" placeholder. */}
            <div
                style={{
                    'background-color': '#fff',
                    border: '1px solid #e5e7eb',
                    'border-radius': '8px',
                    'box-shadow': '0 6px 16px -8px rgba(15,23,42,0.1)',
                    display: 'flex',
                    'flex-direction': 'column',
                    'min-height': '0',
                }}
            >
                {/* Header: title + actions */}
                <div
                    style={{
                        padding: '12px 16px',
                        'border-bottom': '1px solid #e5e7eb',
                        'flex-shrink': 0,
                    }}
                >
                    <h2
                        style={{
                            margin: '0 0 10px 0',
                            'font-size': '15px',
                            color: '#111827',
                        }}
                    >
                        DB Events
                    </h2>
                    <div
                        style={{
                            display: 'grid',
                            'grid-template-columns': '1fr 1fr',
                            gap: '6px',
                            'margin-bottom': '8px',
                        }}
                    >
                        <button
                            style={primaryBtn}
                            onClick={() => setModal('add')}
                        >
                            + Add event
                        </button>
                        <button
                            style={secondaryBtn}
                            onClick={() => refetch('Reloaded')}
                        >
                            ⟳ Reload
                        </button>
                        <button
                            style={secondaryBtn}
                            onClick={() => setModal('resources')}
                        >
                            Resources
                        </button>
                        <button
                            style={secondaryBtn}
                            onClick={() => setModal('blocked')}
                        >
                            Blocked time
                        </button>
                    </div>
                    <div
                        style={{
                            'font-family': 'monospace',
                            'font-size': '11px',
                            color: error() ? '#b91c1c' : '#4338ca',
                            'background-color': error() ? '#fee2e2' : '#eef2ff',
                            padding: '4px 8px',
                            'border-radius': '4px',
                            'word-break': 'break-word',
                        }}
                    >
                        {status()}
                    </div>
                </div>

                {/* Body: edit form OR placeholder */}
                <div
                    style={{
                        flex: '1',
                        'overflow-y': 'auto',
                        padding: '16px',
                        'min-height': '0',
                    }}
                >
                    <Show
                        when={selectedTask()}
                        fallback={
                            <div
                                style={{
                                    color: '#9ca3af',
                                    'font-size': '13px',
                                    'text-align': 'center',
                                    padding: '24px 8px',
                                }}
                            >
                                Click a bar in the chart to edit it.
                                <br />
                                Drag a bar to reschedule (auto-saved).
                            </div>
                        }
                    >
                        <div
                            style={{
                                display: 'flex',
                                'justify-content': 'space-between',
                                'align-items': 'center',
                                'margin-bottom': '12px',
                            }}
                        >
                            <h3
                                style={{
                                    margin: 0,
                                    'font-size': '14px',
                                    color: '#1f2937',
                                }}
                            >
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
                            resources={bundle()?.resources ?? []}
                            allTasks={bundle()?.tasks ?? []}
                            onSubmit={(v) => submitTask('edit', v)}
                            onDelete={deleteSelected}
                        />
                    </Show>
                </div>
            </div>

            {/* Modals */}
            <Show when={modal() === 'add'}>
                <Modal
                    onClose={() => {
                        setModal(null);
                    }}
                >
                    <h3 style={{ margin: '0 0 12px 0' }}>Add new event</h3>
                    <TaskForm
                        mode="create"
                        resources={bundle()?.resources ?? []}
                        allTasks={bundle()?.tasks ?? []}
                        onSubmit={(v) => submitTask('create', v)}
                        onCancel={() => {
                            setModal(null);
                        }}
                        submitLabel="Create"
                    />
                </Modal>
            </Show>
            <Show when={modal() === 'resources'}>
                <Modal
                    onClose={() => {
                        setModal(null);
                    }}
                >
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
                        onClose={() => {
                            setModal(null);
                        }}
                    />
                </Modal>
            </Show>
            <Show when={modal() === 'blocked'}>
                <Modal
                    onClose={() => {
                        setModal(null);
                    }}
                    width="720px"
                >
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
                        onClose={() => {
                            setModal(null);
                        }}
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

export default DbDemo;
