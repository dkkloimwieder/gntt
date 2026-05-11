// @ts-nocheck
import { createSignal, onMount, Show } from 'solid-js';
import { Gantt } from '../components/Gantt';

/**
 * DbDemo — chart sourced from the Drizzle + SQLite + Hono backend.
 *
 * On mount: GET /api/bootstrap → render. On drag/edit: PATCH the task
 * row. The "Reload from DB" button re-fetches and proves changes
 * persisted (drag a bar, click reload, the bar stays put).
 *
 * Run via `pnpm dev:all` — that boots Vite (which proxies /api/* to
 * Hono) and the Hono backend together.
 */
interface Bundle {
    tasks: unknown[];
    resources: unknown[];
    blockedTime: unknown[];
}

export function DbDemo() {
    const [bundle, setBundle] = createSignal<Bundle | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [status, setStatus] = createSignal<string>('Loading…');

    const fetchBundle = async () => {
        setStatus('Loading from /api/bootstrap…');
        try {
            const res = await fetch('/api/bootstrap');
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data: Bundle = await res.json();
            setBundle(data);
            setError(null);
            setStatus(
                `Loaded ${data.tasks.length} tasks, ${data.resources.length} resources at ${new Date().toLocaleTimeString()}`,
            );
        } catch (err) {
            setError(`fetch failed: ${(err as Error).message}`);
            setStatus('Backend unreachable');
        }
    };

    onMount(fetchBundle);

    const patchTask = async (id: string, patch: Record<string, unknown>) => {
        try {
            const res = await fetch(`/api/tasks/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error ?? `${res.status} ${res.statusText}`);
            }
            setStatus(
                `PATCH ${id} ${JSON.stringify(patch)} ✓ ${new Date().toLocaleTimeString()}`,
            );
        } catch (err) {
            setStatus(`PATCH ${id} failed: ${(err as Error).message}`);
        }
    };

    const onDateChange = (id: string, range: { start: Date; end: Date }) => {
        const fmt = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        patchTask(id, { start: fmt(range.start), end: fmt(range.end) });
    };

    const onProgressChange = (id: string, progress: number) =>
        patchTask(id, { progress });

    const buttonStyle = {
        padding: '6px 12px',
        'border-radius': '4px',
        border: '1px solid #d1d5db',
        'background-color': '#fff',
        color: '#1f2937',
        'font-size': '13px',
        cursor: 'pointer',
    };

    return (
        <div>
            <h2 style={{ margin: '0 0 12px 0' }}>DB-backed Events</h2>
            <p
                style={{
                    margin: '0 0 12px 0',
                    color: '#6b7280',
                    'font-size': '14px',
                    'max-width': '720px',
                }}
            >
                Tasks loaded from a SQLite DB via Drizzle through a Hono API on{' '}
                <code>:3001</code> (Vite proxies <code>/api/*</code>). Drag a
                bar or change progress → see <code>PATCH /api/tasks/:id</code>{' '}
                fire in DevTools. Click <strong>Reload from DB</strong> to
                re-fetch and prove the change persisted.
            </p>
            <div
                style={{
                    display: 'flex',
                    gap: '8px',
                    'align-items': 'center',
                    'margin-bottom': '12px',
                    'flex-wrap': 'wrap',
                }}
            >
                <button style={buttonStyle} onClick={fetchBundle}>
                    Reload from DB
                </button>
                <span
                    style={{
                        'font-family': 'monospace',
                        'font-size': '12px',
                        color: error() ? '#b91c1c' : '#4338ca',
                        'background-color': error() ? '#fee2e2' : '#eef2ff',
                        padding: '4px 8px',
                        'border-radius': '4px',
                    }}
                >
                    {status()}
                </span>
            </div>
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
                                <strong>Backend not reachable.</strong> Start it
                                with <code>pnpm dev:server</code> (or run
                                everything via <code>pnpm dev:all</code>), then
                                click Reload.
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
                />
            </Show>
        </div>
    );
}

export default DbDemo;
