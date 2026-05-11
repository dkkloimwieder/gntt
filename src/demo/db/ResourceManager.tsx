// @ts-nocheck
import { For, createSignal } from 'solid-js';
import type { ResourceApi } from './types';

interface Props {
    resources: ResourceApi[];
    onCreate: (input: {
        id: string;
        name: string;
        group?: string;
    }) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onClose: () => void;
}

export function ResourceManager(props: Props) {
    const [id, setId] = createSignal('');
    const [name, setName] = createSignal('');
    const [group, setGroup] = createSignal('');
    const [error, setError] = createSignal<string | null>(null);

    const submit = async (e: Event) => {
        e.preventDefault();
        setError(null);
        if (!id().trim() || !name().trim()) {
            setError('id and name are required');
            return;
        }
        try {
            await props.onCreate({
                id: id().trim(),
                name: name().trim(),
                group: group().trim() || undefined,
            });
            setId('');
            setName('');
            setGroup('');
        } catch (err) {
            setError((err as Error).message);
        }
    };

    return (
        <div>
            <h3 style={{ margin: '0 0 12px 0', 'font-size': '15px' }}>
                Manage Resources
            </h3>
            <form
                onSubmit={submit}
                style={{
                    display: 'grid',
                    'grid-template-columns': '1fr 1fr 1fr auto',
                    gap: '6px',
                    'margin-bottom': '12px',
                    'align-items': 'end',
                }}
            >
                <input
                    placeholder="id"
                    style={inputStyle}
                    value={id()}
                    onInput={(e) => setId(e.currentTarget.value)}
                />
                <input
                    placeholder="name"
                    style={inputStyle}
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                />
                <input
                    placeholder="group (optional)"
                    style={inputStyle}
                    value={group()}
                    onInput={(e) => setGroup(e.currentTarget.value)}
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
                <For each={props.resources}>
                    {(r) => (
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
                                <strong>{r.name}</strong>{' '}
                                <span style={{ color: '#9ca3af' }}>
                                    ({r.id}
                                    {r.group ? ` · ${r.group}` : ''})
                                </span>
                            </span>
                            <button
                                type="button"
                                style={deleteStyle}
                                onClick={() =>
                                    confirm(
                                        `Delete resource ${r.name}? Tasks on it will lose their resource.`,
                                    ) && props.onDelete(r.id)
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

export default ResourceManager;
