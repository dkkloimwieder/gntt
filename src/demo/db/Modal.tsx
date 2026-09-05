import type { JSX } from '@solidjs/web';
// @ts-nocheck

interface Props {
    onClose: () => void;
    children: JSX.Element;
    width?: string;
}

/** Tiny modal — translucent backdrop + centered white card with a × close. */
export function Modal(props: Props) {
    return (
        <div
            style={{
                position: 'fixed',
                inset: '0',
                'background-color': 'rgba(15, 23, 42, 0.45)',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'z-index': 1000,
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) props.onClose();
            }}
        >
            <div
                style={{
                    'background-color': '#fff',
                    'border-radius': '8px',
                    'box-shadow': '0 20px 50px -10px rgba(0, 0, 0, 0.3)',
                    padding: '20px',
                    width: props.width ?? '640px',
                    'max-width': '90vw',
                    'max-height': '90vh',
                    'overflow-y': 'auto',
                    position: 'relative',
                }}
            >
                <button
                    type="button"
                    onClick={props.onClose}
                    aria-label="close"
                    style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'transparent',
                        border: 'none',
                        'font-size': '20px',
                        color: '#6b7280',
                        cursor: 'pointer',
                        padding: '4px 8px',
                    }}
                >
                    ×
                </button>
                {props.children}
            </div>
        </div>
    );
}

export default Modal;
