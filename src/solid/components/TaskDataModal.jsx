import { Show, createMemo, createSignal } from 'solid-js';
import { formatTaskFull, highlightJSON } from '../utils/jsonFormatter.js';

/**
 * Full modal dialog for displaying complete task data
 *
 * @param {Object} props
 * @param {() => boolean} props.visible - Reactive visibility signal
 * @param {() => Object|null} props.task - Reactive task object
 * @param {() => Object|null} props.barPosition - Reactive bar position
 * @param {() => Array} props.relationships - Reactive relationships array
 * @param {Function} props.onClose - Close callback
 */
export function TaskDataModal(props) {
    const [copyFeedback, setCopyFeedback] = createSignal('');

    const formatted = createMemo(() => {
        const task = props.task?.();
        if (!task) return null;
        return formatTaskFull(
            task,
            props.barPosition?.(),
            props.relationships?.() || []
        );
    });

    const handleCopy = async () => {
        const data = formatted();
        if (data?.raw) {
            try {
                await navigator.clipboard.writeText(data.raw);
                setCopyFeedback('Copied!');
                setTimeout(() => setCopyFeedback(''), 2000);
            } catch (err) {
                setCopyFeedback('Failed to copy');
                setTimeout(() => setCopyFeedback(''), 2000);
            }
        }
    };

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            props.onClose?.();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            props.onClose?.();
        }
    };

    return (
        <Show when={props.visible?.()}>
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    'z-index': 2000,
                }}
                onClick={handleBackdropClick}
                onKeyDown={handleKeyDown}
                tabIndex={-1}
            >
                <div style={{
                    background: '#fff',
                    'border-radius': '8px',
                    width: '90%',
                    'max-width': '600px',
                    'max-height': '80vh',
                    overflow: 'hidden',
                    display: 'flex',
                    'flex-direction': 'column',
                    'box-shadow': '0 10px 40px rgba(0,0,0,0.3)',
                }}>
                    {/* Header */}
                    <div style={{
                        display: 'flex',
                        'justify-content': 'space-between',
                        'align-items': 'center',
                        padding: '16px 20px',
                        'border-bottom': '1px solid #eee',
                        'flex-shrink': 0,
                    }}>
                        <h3 style={{ margin: 0, 'font-size': '16px', 'font-weight': 600 }}>
                            Task Data: {props.task?.()?.name || 'Unknown'}
                        </h3>
                        <button
                            onClick={() => props.onClose?.()}
                            style={{
                                border: 'none',
                                background: 'none',
                                'font-size': '24px',
                                cursor: 'pointer',
                                padding: '4px 8px',
                                color: '#666',
                                'line-height': 1,
                            }}
                            title="Close (Esc)"
                        >
                            &times;
                        </button>
                    </div>

                    {/* Body */}
                    <div style={{
                        padding: '20px',
                        overflow: 'auto',
                        flex: 1,
                    }}>
                        {/* Raw Task Data */}
                        <div style={{ 'margin-bottom': '20px' }}>
                            <div style={{
                                display: 'flex',
                                'justify-content': 'space-between',
                                'align-items': 'center',
                                'margin-bottom': '8px',
                            }}>
                                <span style={{
                                    'font-size': '11px',
                                    'font-weight': 600,
                                    'text-transform': 'uppercase',
                                    color: '#999',
                                    'letter-spacing': '0.5px',
                                }}>
                                    Raw Task Object
                                </span>
                                <button
                                    onClick={handleCopy}
                                    style={{
                                        padding: '4px 10px',
                                        background: copyFeedback() === 'Copied!' ? '#d4edda' : '#e3f2fd',
                                        border: 'none',
                                        'border-radius': '3px',
                                        cursor: 'pointer',
                                        'font-size': '11px',
                                        color: copyFeedback() === 'Copied!' ? '#155724' : '#1976d2',
                                        transition: 'background 0.2s',
                                    }}
                                >
                                    {copyFeedback() || 'Copy JSON'}
                                </button>
                            </div>
                            <pre
                                style={{
                                    background: '#f8f9fa',
                                    'border-radius': '4px',
                                    padding: '12px',
                                    'font-family': 'monospace',
                                    'font-size': '12px',
                                    'white-space': 'pre-wrap',
                                    'word-break': 'break-all',
                                    overflow: 'auto',
                                    'max-height': '200px',
                                    margin: 0,
                                    'line-height': '1.5',
                                }}
                                innerHTML={highlightJSON(formatted()?.sections?.rawTask || '')}
                            />
                        </div>

                        {/* Position */}
                        <div style={{ 'margin-bottom': '20px' }}>
                            <span style={{
                                'font-size': '11px',
                                'font-weight': 600,
                                'text-transform': 'uppercase',
                                color: '#999',
                                'letter-spacing': '0.5px',
                                display: 'block',
                                'margin-bottom': '8px',
                            }}>
                                Computed Position ($bar)
                            </span>
                            <pre
                                style={{
                                    background: '#f8f9fa',
                                    'border-radius': '4px',
                                    padding: '12px',
                                    'font-family': 'monospace',
                                    'font-size': '12px',
                                    margin: 0,
                                    'line-height': '1.5',
                                }}
                                innerHTML={highlightJSON(formatted()?.sections?.position || '')}
                            />
                        </div>

                        {/* Relationships */}
                        <div>
                            <span style={{
                                'font-size': '11px',
                                'font-weight': 600,
                                'text-transform': 'uppercase',
                                color: '#999',
                                'letter-spacing': '0.5px',
                                display: 'block',
                                'margin-bottom': '8px',
                            }}>
                                Relationships
                            </span>
                            <pre style={{
                                background: '#fff8e1',
                                'border-radius': '4px',
                                padding: '12px',
                                'font-family': 'monospace',
                                'font-size': '12px',
                                'white-space': 'pre-wrap',
                                margin: 0,
                                'line-height': '1.5',
                                color: '#5d4037',
                            }}>
                                {formatted()?.sections?.relationships}
                            </pre>
                        </div>
                    </div>
                </div>
            </div>
        </Show>
    );
}
