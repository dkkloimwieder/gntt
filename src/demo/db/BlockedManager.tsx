// @ts-nocheck
import { For, createSignal } from 'solid-js';
import { fromLocalInput, toLocalInput } from './api';
import type { BlockedSlotApi, ResourceApi } from './types';

interface Props {
    resources: ResourceApi[];
    blocked: BlockedSlotApi[];
    onCreate: (input: {
        resource: string;
        start: string;
        end: string;
        reason?: string;
    }) => Promise<void>;
    onDelete: (id: number) => Promise<void>;
    onClose: () => void;
}

export function BlockedManager(props: Props) {
    const [resource, setResource] = createSignal('');
    const [start, setStart] = createSignal('');
    const [end, setEnd] = createSignal('');
    const [reason, setReason] = createSignal('');
    const [error, setError] = createSignal<string | null>(null);

    const submit = async (e: Event) => {
        e.preventDefault();
        setError(null);
        if (!resource() || !start() || !end()) {
            setError('resource, start, end are required');
            return;
        }
        try {
            await props.onCreate({
                resource: resource(),
                start: fromLocalInput(start()),
                end: fromLocalInput(end()),
                reason: reason().trim() || undefined,
            });
            setStart('');
            setEnd('');
            setReason('');
        } catch (err) {
            setError((err as Error).message);
        }
    };

    return (
        <div>
            <h3 style={{ margin: '0 0 12px 0', 'font-size': '15px' }}>
                Manage Blocked Time
            </h3>
            <p
                style={{
                    margin: '0 0 12px 0',
                    color: '#6b7280',
                    'font-size': '12px',
                }}
            >
                Stored as flat metadata. The constraint engine does not consult
                these slots — they're informational only (blocking is the
                planner's responsibility).
            </p>
            <form
                onSubmit={submit}
                style={{
                    display: 'grid',
                    'grid-template-columns': '1fr 1fr 1fr 1fr auto',
                    gap: '6px',
                    'margin-bottom': '12px',
                    'align-items': 'end',
                }}
            >
                <select
                    style={inputStyle}
                    value={resource()}
                    onInput={(e) => setResource(e.currentTarget.value)}
                >
                    <option value="">— resource —</option>
                    <For each={props.resources}>
                        {(r) => <option value={r.id}>{r.name}</option>}
                    </For>
                </select>
                <input
                    type="datetime-local"
                    style={inputStyle}
                    value={start()}
                    onInput={(e) => setStart(e.currentTarget.value)}
                    placeholder="start"
                />
                <input
                    type="datetime-local"
                    style={inputStyle}
                    value={end()}
                    onInput={(e) => setEnd(e.currentTarget.value)}
                    placeholder="end"
                />
                <input
                    placeholder="reason (optional)"
                    style={inputStyle}
                    value={reason()}
                    onInput={(e) => setReason(e.currentTarget.value)}
                />
                <button type="submit" style={primaryStyle}>
                    Add
                </button>
            </form>
            {error() && (
                <div
                    style={{
                        'background-color': '#fee2e2',
                        color: '#b91c1c',
                        padding: '4px 8px',
                        'border-radius': '4px',
                        'font-size': '12px',
                        'margin-bottom': '12px',
                    }}
                >
                    {error()}
                </div>
            )}
            <div
                style={{
                    'max-height': '240px',
                    'overflow-y': 'auto',
                    border: '1px solid #e5e7eb',
                    'border-radius': '4px',
                }}
            >
                <For each={props.blocked}>
                    {(b) => (
                        <div
                            style={{
                                display: 'flex',
                                'justify-content': 'space-between',
                                'align-items': 'center',
                                padding: '6px 10px',
                                'border-bottom': '1px solid #f3f4f6',
                                'font-size': '13px',
                            }}
                        >
                            <span>
                                <strong>{b.resource}</strong>{' '}
                                <span style={{ color: '#9ca3af' }}>
                                    {b.start} → {b.end}
                                    {b.reason ? ` · ${b.reason}` : ''}
                                </span>
                            </span>
                            <button
                                type="button"
                                style={deleteStyle}
                                onClick={() =>
                                    confirm('Delete this blocked slot?') &&
                                    props.onDelete(b.id)
                                }
                            >
                                ×
                            </button>
                        </div>
                    )}
                </For>
            </div>
            <div
                style={{
                    display: 'flex',
                    'justify-content': 'flex-end',
                    'margin-top': '12px',
                }}
            >
                <button
                    type="button"
                    style={secondaryStyle}
                    onClick={props.onClose}
                >
                    Close
                </button>
            </div>
        </div>
    );
}

const inputStyle = {
    padding: '4px 8px',
    'font-size': '13px',
    border: '1px solid #d1d5db',
    'border-radius': '4px',
} as const;

const primaryStyle = {
    padding: '4px 12px',
    'border-radius': '4px',
    border: '1px solid #4f46e5',
    'background-color': '#4f46e5',
    color: '#fff',
    'font-size': '13px',
    cursor: 'pointer',
} as const;

const secondaryStyle = {
    padding: '6px 12px',
    'border-radius': '4px',
    border: '1px solid #d1d5db',
    'background-color': '#fff',
    color: '#1f2937',
    'font-size': '13px',
    cursor: 'pointer',
} as const;

const deleteStyle = {
    padding: '2px 8px',
    'border-radius': '4px',
    border: '1px solid #fca5a5',
    'background-color': '#fff',
    color: '#b91c1c',
    'font-size': '14px',
    cursor: 'pointer',
} as const;

export default BlockedManager;

// avoid unused-import lint when toLocalInput isn't used (it's symmetric; kept for parity)
void toLocalInput;
