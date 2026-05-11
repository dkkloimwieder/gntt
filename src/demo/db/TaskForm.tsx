// @ts-nocheck
import { For, Show, createSignal } from 'solid-js';
import { fromLocalInput, toLocalInput } from './api';
import type {
    DepApi,
    DepType,
    ResourceApi,
    TaskApi,
    TaskConstraintsApi,
} from './types';

/**
 * TaskForm — shared editor used by both the Add modal and the Edit
 * panel. Maintains its own internal state; emits the full payload via
 * `onSubmit({ task, dependencies })`. The parent decides whether to
 * call POST (create) or PATCH+PUT (edit).
 *
 * Sections: basic fields (name, dates, progress, color, resource),
 * constraints (toggleable per-field), dependencies (multi-row).
 */

interface DepRow {
    id: string;
    type: DepType;
    lag: number;
    /** UI-local: 'elastic' (max=undef), 'fixed' (max=0), 'bounded' (max=N) */
    maxMode: 'elastic' | 'fixed' | 'bounded';
    maxValue: number;
}

interface ConstraintRow {
    locked: '' | 'true' | 'start' | 'end' | 'duration';
    minStart: string; // datetime-local, '' = unset
    maxStart: string;
    minEnd: string;
    maxEnd: string;
    minDuration: string; // numeric string, '' = unset
    maxDuration: string;
    fixedDuration: string;
}

const DEFAULT_CONSTRAINTS: ConstraintRow = {
    locked: '',
    minStart: '',
    maxStart: '',
    minEnd: '',
    maxEnd: '',
    minDuration: '',
    maxDuration: '',
    fixedDuration: '',
};

function depFromApi(d: DepApi): DepRow {
    let maxMode: DepRow['maxMode'] = 'elastic';
    let maxValue = 0;
    if (d.max === 0) maxMode = 'fixed';
    else if (typeof d.max === 'number') {
        maxMode = 'bounded';
        maxValue = d.max;
    }
    return {
        id: d.id,
        type: d.type ?? 'FS',
        lag: d.lag ?? 0,
        maxMode,
        maxValue,
    };
}

function depToApi(r: DepRow): DepApi {
    const out: DepApi = { id: r.id, type: r.type, lag: r.lag };
    if (r.maxMode === 'fixed') out.max = 0;
    else if (r.maxMode === 'bounded') out.max = r.maxValue;
    return out;
}

function constraintsFromApi(c?: TaskConstraintsApi): ConstraintRow {
    if (!c) return { ...DEFAULT_CONSTRAINTS };
    let locked: ConstraintRow['locked'] = '';
    if (c.locked === true) locked = 'true';
    else if (
        c.locked === 'start' ||
        c.locked === 'end' ||
        c.locked === 'duration'
    )
        locked = c.locked;
    return {
        locked,
        minStart: toLocalInput(c.minStart ?? ''),
        maxStart: toLocalInput(c.maxStart ?? ''),
        minEnd: toLocalInput(c.minEnd ?? ''),
        maxEnd: toLocalInput(c.maxEnd ?? ''),
        minDuration: c.minDuration != null ? String(c.minDuration) : '',
        maxDuration: c.maxDuration != null ? String(c.maxDuration) : '',
        fixedDuration: c.fixedDuration != null ? String(c.fixedDuration) : '',
    };
}

function constraintsToApi(c: ConstraintRow): TaskConstraintsApi | undefined {
    const out: TaskConstraintsApi = {};
    if (c.locked === 'true') out.locked = true;
    else if (c.locked) out.locked = c.locked;
    if (c.minStart) out.minStart = fromLocalInput(c.minStart);
    if (c.maxStart) out.maxStart = fromLocalInput(c.maxStart);
    if (c.minEnd) out.minEnd = fromLocalInput(c.minEnd);
    if (c.maxEnd) out.maxEnd = fromLocalInput(c.maxEnd);
    if (c.minDuration) out.minDuration = Number(c.minDuration);
    if (c.maxDuration) out.maxDuration = Number(c.maxDuration);
    if (c.fixedDuration) out.fixedDuration = Number(c.fixedDuration);
    return Object.keys(out).length > 0 ? out : undefined;
}

export interface TaskFormSubmit {
    /** Fields suitable for POST body or PATCH body. */
    task: {
        id: string;
        name: string;
        start: string;
        end: string;
        progress: number;
        resource: string | null;
        color: string | null;
        constraints: TaskConstraintsApi | null;
    };
    /** Replaces ALL incoming dependencies for the task. */
    dependencies: DepApi[];
}

export interface TaskFormProps {
    mode: 'create' | 'edit';
    /** Existing task when editing; undefined when creating. */
    initial?: TaskApi;
    /** All resources for the resource dropdown. */
    resources: ResourceApi[];
    /** All tasks (for the dependency-predecessor dropdown). */
    allTasks: TaskApi[];
    onSubmit: (value: TaskFormSubmit) => void | Promise<void>;
    onCancel?: () => void;
    onDelete?: () => void | Promise<void>;
    submitLabel?: string;
}

const labelStyle = {
    display: 'block',
    'font-size': '12px',
    'font-weight': '600',
    color: '#374151',
    'margin-bottom': '4px',
} as const;

const inputStyle = {
    width: '100%',
    padding: '4px 8px',
    'font-size': '13px',
    border: '1px solid #d1d5db',
    'border-radius': '4px',
    'background-color': '#fff',
} as const;

const sectionStyle = {
    'margin-bottom': '16px',
    'padding-bottom': '12px',
    'border-bottom': '1px solid #e5e7eb',
} as const;

const sectionHeaderStyle = {
    'font-size': '13px',
    'font-weight': '700',
    color: '#1f2937',
    'margin-bottom': '8px',
    'text-transform': 'uppercase',
    'letter-spacing': '0.04em',
} as const;

const buttonStyle = {
    padding: '6px 12px',
    'border-radius': '4px',
    border: '1px solid #d1d5db',
    'background-color': '#fff',
    color: '#1f2937',
    'font-size': '13px',
    cursor: 'pointer',
} as const;

const primaryButtonStyle = {
    ...buttonStyle,
    'background-color': '#4f46e5',
    'border-color': '#4f46e5',
    color: '#fff',
} as const;

const dangerButtonStyle = {
    ...buttonStyle,
    'background-color': '#fff',
    'border-color': '#fca5a5',
    color: '#b91c1c',
} as const;

export function TaskForm(props: TaskFormProps) {
    const init = props.initial;
    const today = new Date();
    const fmtDefault = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00`;

    const [id, setId] = createSignal(init?.id ?? '');
    const [name, setName] = createSignal(init?.name ?? '');
    const [start, setStart] = createSignal(
        init ? toLocalInput(init.start) : fmtDefault(today),
    );
    const [end, setEnd] = createSignal(
        init
            ? toLocalInput(init.end)
            : fmtDefault(today).replace('09:00', '17:00'),
    );
    const [progress, setProgress] = createSignal(init?.progress ?? 0);
    const [resource, setResource] = createSignal(init?.resource ?? '');
    const [color, setColor] = createSignal(init?.color ?? '#3b82f6');
    const [constraints, setConstraints] = createSignal<ConstraintRow>(
        constraintsFromApi(init?.constraints),
    );
    const [deps, setDeps] = createSignal<DepRow[]>(
        (init?.dependencies ?? []).map(depFromApi),
    );
    const [error, setError] = createSignal<string | null>(null);
    const [submitting, setSubmitting] = createSignal(false);

    const updateConstraint = <K extends keyof ConstraintRow>(
        key: K,
        value: ConstraintRow[K],
    ) => setConstraints({ ...constraints(), [key]: value });

    const addDep = () =>
        setDeps([
            ...deps(),
            { id: '', type: 'FS', lag: 0, maxMode: 'elastic', maxValue: 0 },
        ]);

    const removeDep = (idx: number) =>
        setDeps(deps().filter((_, i) => i !== idx));

    const updateDep = (idx: number, patch: Partial<DepRow>) => {
        const next = deps().map((d, i) => (i === idx ? { ...d, ...patch } : d));
        setDeps(next);
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setError(null);
        if (!id().trim()) {
            setError('id is required');
            return;
        }
        if (!name().trim()) {
            setError('name is required');
            return;
        }
        // Validate deps: each row must have a predecessor selected.
        const cleanDeps = deps().filter((d) => d.id);
        if (cleanDeps.some((d) => d.id === id())) {
            setError('a task cannot depend on itself');
            return;
        }

        setSubmitting(true);
        try {
            await props.onSubmit({
                task: {
                    id: id().trim(),
                    name: name().trim(),
                    start: fromLocalInput(start()),
                    end: fromLocalInput(end()),
                    progress: Math.max(
                        0,
                        Math.min(100, Math.round(Number(progress()))),
                    ),
                    resource: resource() || null,
                    color: color() || null,
                    constraints: constraintsToApi(constraints()) ?? null,
                },
                dependencies: cleanDeps.map(depToApi),
            });
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} style={{ 'font-size': '13px' }}>
            {/* Basic fields */}
            <div style={sectionStyle}>
                <div style={sectionHeaderStyle}>Event</div>
                <div style={{ 'margin-bottom': '8px' }}>
                    <label style={labelStyle}>id</label>
                    <input
                        style={inputStyle}
                        value={id()}
                        onInput={(e) => setId(e.currentTarget.value)}
                        disabled={props.mode === 'edit'}
                        placeholder="unique identifier"
                    />
                </div>
                <div style={{ 'margin-bottom': '8px' }}>
                    <label style={labelStyle}>name</label>
                    <input
                        style={inputStyle}
                        value={name()}
                        onInput={(e) => setName(e.currentTarget.value)}
                        placeholder="display name"
                    />
                </div>
                <div
                    style={{
                        display: 'grid',
                        'grid-template-columns': '1fr 1fr',
                        gap: '8px',
                        'margin-bottom': '8px',
                    }}
                >
                    <div>
                        <label style={labelStyle}>start</label>
                        <input
                            type="datetime-local"
                            style={inputStyle}
                            value={start()}
                            onInput={(e) => setStart(e.currentTarget.value)}
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>end</label>
                        <input
                            type="datetime-local"
                            style={inputStyle}
                            value={end()}
                            onInput={(e) => setEnd(e.currentTarget.value)}
                        />
                    </div>
                </div>
                <div
                    style={{
                        display: 'grid',
                        'grid-template-columns': '1fr 1fr 1fr',
                        gap: '8px',
                    }}
                >
                    <div>
                        <label style={labelStyle}>progress</label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            style={inputStyle}
                            value={progress()}
                            onInput={(e) =>
                                setProgress(Number(e.currentTarget.value))
                            }
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>resource</label>
                        <select
                            style={inputStyle}
                            value={resource()}
                            onInput={(e) => setResource(e.currentTarget.value)}
                        >
                            <option value="">— none —</option>
                            <For each={props.resources}>
                                {(r) => <option value={r.id}>{r.name}</option>}
                            </For>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>color</label>
                        <input
                            type="color"
                            style={{
                                ...inputStyle,
                                padding: '2px',
                                height: '28px',
                            }}
                            value={color()}
                            onInput={(e) => setColor(e.currentTarget.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Constraints */}
            <div style={sectionStyle}>
                <div style={sectionHeaderStyle}>Constraints (optional)</div>
                <div style={{ 'margin-bottom': '8px' }}>
                    <label style={labelStyle}>locked</label>
                    <select
                        style={inputStyle}
                        value={constraints().locked}
                        onInput={(e) =>
                            updateConstraint(
                                'locked',
                                e.currentTarget
                                    .value as ConstraintRow['locked'],
                            )
                        }
                    >
                        <option value="">— not locked —</option>
                        <option value="true">fully locked</option>
                        <option value="start">start locked</option>
                        <option value="end">end locked</option>
                        <option value="duration">duration locked</option>
                    </select>
                </div>
                <div
                    style={{
                        display: 'grid',
                        'grid-template-columns': '1fr 1fr',
                        gap: '8px',
                        'margin-bottom': '8px',
                    }}
                >
                    <div>
                        <label style={labelStyle}>min start</label>
                        <input
                            type="datetime-local"
                            style={inputStyle}
                            value={constraints().minStart}
                            onInput={(e) =>
                                updateConstraint(
                                    'minStart',
                                    e.currentTarget.value,
                                )
                            }
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>max start</label>
                        <input
                            type="datetime-local"
                            style={inputStyle}
                            value={constraints().maxStart}
                            onInput={(e) =>
                                updateConstraint(
                                    'maxStart',
                                    e.currentTarget.value,
                                )
                            }
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>min end</label>
                        <input
                            type="datetime-local"
                            style={inputStyle}
                            value={constraints().minEnd}
                            onInput={(e) =>
                                updateConstraint(
                                    'minEnd',
                                    e.currentTarget.value,
                                )
                            }
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>max end (deadline)</label>
                        <input
                            type="datetime-local"
                            style={inputStyle}
                            value={constraints().maxEnd}
                            onInput={(e) =>
                                updateConstraint(
                                    'maxEnd',
                                    e.currentTarget.value,
                                )
                            }
                        />
                    </div>
                </div>
                <div
                    style={{
                        display: 'grid',
                        'grid-template-columns': '1fr 1fr 1fr',
                        gap: '8px',
                    }}
                >
                    <div>
                        <label style={labelStyle}>min duration (h)</label>
                        <input
                            type="number"
                            min="0"
                            style={inputStyle}
                            value={constraints().minDuration}
                            onInput={(e) =>
                                updateConstraint(
                                    'minDuration',
                                    e.currentTarget.value,
                                )
                            }
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>max duration (h)</label>
                        <input
                            type="number"
                            min="0"
                            style={inputStyle}
                            value={constraints().maxDuration}
                            onInput={(e) =>
                                updateConstraint(
                                    'maxDuration',
                                    e.currentTarget.value,
                                )
                            }
                        />
                    </div>
                    <div>
                        <label style={labelStyle}>fixed duration (h)</label>
                        <input
                            type="number"
                            min="0"
                            style={inputStyle}
                            value={constraints().fixedDuration}
                            onInput={(e) =>
                                updateConstraint(
                                    'fixedDuration',
                                    e.currentTarget.value,
                                )
                            }
                        />
                    </div>
                </div>
            </div>

            {/* Dependencies */}
            <div style={sectionStyle}>
                <div
                    style={{
                        display: 'flex',
                        'justify-content': 'space-between',
                        'align-items': 'center',
                        'margin-bottom': '8px',
                    }}
                >
                    <div style={sectionHeaderStyle}>Dependencies</div>
                    <button type="button" style={buttonStyle} onClick={addDep}>
                        + add
                    </button>
                </div>
                <Show
                    when={deps().length > 0}
                    fallback={
                        <div
                            style={{
                                color: '#9ca3af',
                                'font-size': '12px',
                                padding: '6px 0',
                            }}
                        >
                            no dependencies
                        </div>
                    }
                >
                    <For each={deps()}>
                        {(dep, idx) => (
                            <div
                                style={{
                                    display: 'grid',
                                    'grid-template-columns':
                                        '2fr 0.6fr 0.6fr 0.8fr 0.6fr auto',
                                    gap: '6px',
                                    'margin-bottom': '6px',
                                    'align-items': 'center',
                                }}
                            >
                                <select
                                    style={inputStyle}
                                    value={dep.id}
                                    onInput={(e) =>
                                        updateDep(idx(), {
                                            id: e.currentTarget.value,
                                        })
                                    }
                                >
                                    <option value="">— predecessor —</option>
                                    <For
                                        each={props.allTasks.filter(
                                            (t) => t.id !== id(),
                                        )}
                                    >
                                        {(t) => (
                                            <option value={t.id}>
                                                {t.name} ({t.id})
                                            </option>
                                        )}
                                    </For>
                                </select>
                                <select
                                    style={inputStyle}
                                    value={dep.type}
                                    onInput={(e) =>
                                        updateDep(idx(), {
                                            type: e.currentTarget
                                                .value as DepType,
                                        })
                                    }
                                >
                                    <option value="FS">FS</option>
                                    <option value="SS">SS</option>
                                    <option value="FF">FF</option>
                                    <option value="SF">SF</option>
                                </select>
                                <input
                                    type="number"
                                    style={inputStyle}
                                    value={dep.lag}
                                    title="lag (hours)"
                                    onInput={(e) =>
                                        updateDep(idx(), {
                                            lag: Number(e.currentTarget.value),
                                        })
                                    }
                                />
                                <select
                                    style={inputStyle}
                                    value={dep.maxMode}
                                    title="gap behavior"
                                    onInput={(e) =>
                                        updateDep(idx(), {
                                            maxMode: e.currentTarget
                                                .value as DepRow['maxMode'],
                                        })
                                    }
                                >
                                    <option value="elastic">elastic</option>
                                    <option value="fixed">fixed</option>
                                    <option value="bounded">bounded</option>
                                </select>
                                <input
                                    type="number"
                                    style={{
                                        ...inputStyle,
                                        opacity:
                                            dep.maxMode === 'bounded' ? 1 : 0.4,
                                    }}
                                    disabled={dep.maxMode !== 'bounded'}
                                    value={dep.maxValue}
                                    title="max gap (hours)"
                                    onInput={(e) =>
                                        updateDep(idx(), {
                                            maxValue: Number(
                                                e.currentTarget.value,
                                            ),
                                        })
                                    }
                                />
                                <button
                                    type="button"
                                    style={{
                                        ...buttonStyle,
                                        padding: '4px 8px',
                                        color: '#b91c1c',
                                    }}
                                    onClick={() => removeDep(idx())}
                                    aria-label="remove dependency"
                                >
                                    ×
                                </button>
                            </div>
                        )}
                    </For>
                </Show>
            </div>

            <Show when={error()}>
                <div
                    style={{
                        'background-color': '#fee2e2',
                        color: '#b91c1c',
                        padding: '6px 10px',
                        'border-radius': '4px',
                        'font-size': '12px',
                        'margin-bottom': '12px',
                    }}
                >
                    {error()}
                </div>
            </Show>

            <div
                style={{
                    display: 'flex',
                    gap: '8px',
                    'justify-content': 'space-between',
                    'align-items': 'center',
                }}
            >
                <Show when={props.mode === 'edit' && props.onDelete}>
                    <button
                        type="button"
                        style={dangerButtonStyle}
                        disabled={submitting()}
                        onClick={() => {
                            if (
                                confirm(
                                    `Delete ${name() || id()}? This also removes its dependencies.`,
                                )
                            ) {
                                props.onDelete?.();
                            }
                        }}
                    >
                        Delete
                    </button>
                </Show>
                <div
                    style={{
                        display: 'flex',
                        gap: '8px',
                        'margin-left': 'auto',
                    }}
                >
                    <Show when={props.onCancel}>
                        <button
                            type="button"
                            style={buttonStyle}
                            disabled={submitting()}
                            onClick={() => props.onCancel?.()}
                        >
                            Cancel
                        </button>
                    </Show>
                    <button
                        type="submit"
                        style={primaryButtonStyle}
                        disabled={submitting()}
                    >
                        {submitting()
                            ? 'Saving…'
                            : (props.submitLabel ??
                              (props.mode === 'create' ? 'Create' : 'Save'))}
                    </button>
                </div>
            </div>
        </form>
    );
}

export default TaskForm;
