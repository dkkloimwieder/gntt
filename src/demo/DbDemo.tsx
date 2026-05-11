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

    /**
     * Side-tables tracking "what's currently in the DB" + "what x each
     * bar was at last refetch", keyed by task id.
     *
     * Why both: on drag end, the chart only fires onDateChange for the
     * dragged bar, but it batch-moves dependents internally. We can't
     * compare new dates against bundle() (we deliberately don't setBundle
     * on drag — that would re-process the tasks array and flash) AND we
     * can't ask the chart's xToDate for hour-precision dates (it snaps
     * to day boundaries in Day mode). So instead:
     *   1. Track each bar's _bar.x at last refetch (`lastX`)
     *   2. After drag, deltaX_per_id = chart_x_now - lastX[id]
     *   3. Convert deltaX → deltaMs via xToDate(deltaX) - xToDate(0)
     *      (linear so precision is preserved)
     *   4. newStart_id = parse(dbState[id].start) + deltaMs (full HH:MM
     *      precision)
     */
    const dbState = new Map<string, { start: string; end: string }>();
    const lastX = new Map<string, number>();
    const lastWidth = new Map<string, number>();
    // Bumped on every successful drag-PATCH so the edit panel re-derives
    // its initial form values from dbState (which has the freshest dates).
    // We deliberately don't setBundle on drag — that would re-process the
    // whole tasks array — but the panel needs SOMETHING to invalidate.
    const [dragVersion, setDragVersion] = createSignal(0);

    /** Parse the API's "YYYY-MM-DD HH:MM" into a local Date. */
    const parseDb = (s: string): Date => {
        const [d, t] = s.split(' ');
        const [y, mo, da] = d.split('-').map(Number);
        const [h, mi] = (t ?? '00:00').split(':').map(Number);
        return new Date(y, mo - 1, da, h, mi);
    };

    /** Snapshot the chart's _bar.x and _bar.width for every known task. */
    const snapshotChartX = () => {
        const ts = (
            window as unknown as {
                __ganttTaskStore?: {
                    tasks: Record<
                        string,
                        { _bar?: { x: number; width: number } } | undefined
                    >;
                };
            }
        ).__ganttTaskStore;
        if (!ts) return;
        lastX.clear();
        lastWidth.clear();
        for (const id of Object.keys(ts.tasks)) {
            const bar = ts.tasks[id]?._bar;
            if (typeof bar?.x === 'number') lastX.set(id, bar.x);
            if (typeof bar?.width === 'number') lastWidth.set(id, bar.width);
        }
    };

    const refetch = async (note?: string) => {
        try {
            const data = await api.bootstrap();
            setBundle(data);
            dbState.clear();
            for (const t of data.tasks) {
                dbState.set(t.id, { start: t.start, end: t.end });
            }
            // Snapshot bar positions on the next tick so processTasks
            // has finished running on the new bundle.
            queueMicrotask(snapshotChartX);
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

    const fmtDate = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    /**
     * Drag-driven mutations: PATCH any task whose `_bar.x` drifted from
     * its last-snapshotted value (the dragged bar + every batch-moved
     * dependent). Apply the per-task pixel delta as a TIME delta to the
     * task's *original* dates from `dbState` — that preserves HH:MM
     * precision instead of going through the chart's day-boundary-snapping
     * `xToDate(absolute_x)`.
     *
     * NO refetch — `setBundle` would re-process the whole tasks array and
     * snap each bar back to a (slightly rounded) position, causing the
     * flash + jump the user reported.
     *
     * Form-based edits (Save in the panel, Add modal, Delete) still
     * refetch because the user has an explicit save-and-sync mental
     * model there.
     */
    const onDateChange = async (
        parentId: string,
        _range: { start: Date; end: Date },
    ) => {
        const taskStore = (
            window as unknown as {
                __ganttTaskStore?: {
                    tasks: Record<
                        string,
                        { _bar?: { x: number; width: number } } | undefined
                    >;
                };
            }
        ).__ganttTaskStore;
        const dateStore = (
            window as unknown as {
                __ganttDateStore?: {
                    unit: () => string;
                    step: () => number;
                    columnWidth: () => number;
                };
            }
        ).__ganttDateStore;
        if (!taskStore || !dateStore) return;

        // ms-per-pixel — derive directly from the chart's `unit` + `step` +
        // `columnWidth`. Do NOT use xToDate(100)-xToDate(0) — that calls
        // dateUtils.add which truncates fractional days (e.g. add(start,
        // 2.5, 'day') drops the .5), yielding a calibration off by up to
        // ~25% depending on whether `100 / columnWidth` is an integer.
        const UNIT_MS: Record<string, number> = {
            millisecond: 1,
            second: 1_000,
            minute: 60_000,
            hour: 3_600_000,
            day: 86_400_000,
            week: 604_800_000,
            month: 2_629_800_000, // avg (Gregorian year / 12)
            year: 31_556_952_000, // avg (Gregorian)
        };
        const unitMs = UNIT_MS[dateStore.unit()] ?? 86_400_000;
        const msPerPx = (unitMs * dateStore.step()) / dateStore.columnWidth();

        // Track BOTH x and width so we catch resizes (not just moves):
        //   move:         Δx ≠ 0, Δwidth = 0   → start += Δx, end += Δx
        //   resize-end:   Δx = 0, Δwidth ≠ 0   → start unchanged, end += Δwidth
        //   resize-start: Δx ≠ 0, Δwidth = -Δx → start += Δx, end unchanged
        // General form: startΔ = Δx, endΔ = Δx + Δwidth.
        const patches: Array<{ id: string; start: string; end: string }> = [];
        for (const id of Object.keys(taskStore.tasks)) {
            const bar = taskStore.tasks[id]?._bar;
            const prevX = lastX.get(id);
            const prevW = lastWidth.get(id);
            const prevDates = dbState.get(id);
            if (
                typeof bar?.x !== 'number' ||
                typeof bar?.width !== 'number' ||
                typeof prevX !== 'number' ||
                typeof prevW !== 'number' ||
                !prevDates
            )
                continue;
            const dxPx = bar.x - prevX;
            const dwPx = bar.width - prevW;
            if (Math.abs(dxPx) < 0.5 && Math.abs(dwPx) < 0.5) continue;
            const startDeltaMs = Math.round(dxPx * msPerPx);
            const endDeltaMs = Math.round((dxPx + dwPx) * msPerPx);
            const newStart = new Date(
                parseDb(prevDates.start).getTime() + startDeltaMs,
            );
            const newEnd = new Date(
                parseDb(prevDates.end).getTime() + endDeltaMs,
            );
            patches.push({
                id,
                start: fmtDate(newStart),
                end: fmtDate(newEnd),
            });
        }

        if (patches.length === 0) {
            setStatus(`Drag of ${parentId} produced no PATCH (no Δ)`);
            return;
        }

        try {
            await Promise.all(
                patches.map((p) =>
                    api.patchTask(p.id, { start: p.start, end: p.end }),
                ),
            );
            for (const p of patches) {
                dbState.set(p.id, { start: p.start, end: p.end });
                const bar = taskStore.tasks[p.id]?._bar;
                if (typeof bar?.x === 'number') lastX.set(p.id, bar.x);
                if (typeof bar?.width === 'number')
                    lastWidth.set(p.id, bar.width);
            }
            setDragVersion((v) => v + 1);
            const extra = patches.length - 1;
            setStatus(
                `PATCH ${parentId} (drag${
                    extra > 0
                        ? ` + ${extra} dependent${extra === 1 ? '' : 's'}`
                        : ''
                }) ✓ ${new Date().toLocaleTimeString()}`,
            );
        } catch (err) {
            setStatus(`PATCH ${parentId} failed: ${(err as Error).message}`);
        }
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
                        options={{ viewMode: 'Day', scrollTo: 'start' }}
                        onDateChange={onDateChange}
                        onProgressChange={onProgressChange}
                        onTaskClick={(id) => setSelectedId(id)}
                        onReady={() => {
                            // Snapshot bar positions once the chart is
                            // mounted; refetches re-snapshot via
                            // queueMicrotask in `refetch`.
                            setTimeout(snapshotChartX, 0);
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
