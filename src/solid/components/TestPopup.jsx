import { onMount, onCleanup } from 'solid-js';
import { PopupAdapter } from '../adapters/PopupAdapter.jsx';

/**
 * Test component for Popup and PopupAdapter.
 * Demonstrates vanilla API compatibility.
 */
export function TestPopup() {
    let popupContainer;
    let popup;

    onMount(() => {
        // Mock gantt object (minimal for testing)
        const mockGantt = {
            create_el: ({ classes, type, append_to }) => {
                const el = document.createElement(type || 'div');
                el.className = classes;
                if (append_to) append_to.appendChild(el);
                return el;
            }
        };

        // Create popup with default structured layout
        popup = new PopupAdapter(
            popupContainer,
            ({ task, set_title, set_subtitle, set_details, add_action }) => {
                set_title(`Task: ${task.name}`);
                set_subtitle(`${task.start} → ${task.end}`);
                set_details(`Progress: ${task.progress}%`);

                add_action('Edit', (task, gantt, e) => {
                    alert(`Edit task: ${task.name}`);
                });

                add_action('Delete', (task, gantt, e) => {
                    alert(`Delete task: ${task.name}`);
                });
            },
            mockGantt
        );
    });

    const showDefaultPopup = (e) => {
        popup.show({
            x: e.clientX,
            y: e.clientY,
            task: {
                name: 'Design Homepage',
                start: '2024-01-01',
                end: '2024-01-15',
                progress: 65
            }
        });
    };

    const showCustomPopup = (e) => {
        // Create popup with custom HTML
        const customPopup = new PopupAdapter(
            popupContainer,
            ({ task }) => {
                return `
                    <div style="padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px;">
                        <h3 style="margin: 0 0 10px 0;">${task.name}</h3>
                        <p style="margin: 5px 0;">Custom HTML Popup!</p>
                        <p style="margin: 5px 0; font-size: 12px;">Progress: ${task.progress}%</p>
                    </div>
                `;
            },
            {}
        );

        customPopup.show({
            x: e.clientX,
            y: e.clientY,
            task: {
                name: 'Build Backend API',
                start: '2024-01-10',
                end: '2024-02-01',
                progress: 45
            }
        });

        // Auto-hide after 3 seconds
        setTimeout(() => customPopup.hide(), 3000);
    };

    const hidePopup = () => {
        popup.hide();
    };

    onCleanup(() => {
        if (popup) popup.destroy();
    });

    return (
        <div style={{
            padding: '20px',
            'font-family': 'monospace'
        }}>
            <h2>Popup Adapter Test</h2>

            <div style={{ 'margin-bottom': '20px' }}>
                <h3>Structured Popup (Default)</h3>
                <button
                    onClick={showDefaultPopup}
                    style={{
                        padding: '10px 20px',
                        'margin-right': '10px',
                        'background-color': '#4CAF50',
                        color: 'white',
                        border: 'none',
                        'border-radius': '4px',
                        cursor: 'pointer'
                    }}
                >
                    Show Default Popup
                </button>
                <button
                    onClick={hidePopup}
                    style={{
                        padding: '10px 20px',
                        'background-color': '#f44336',
                        color: 'white',
                        border: 'none',
                        'border-radius': '4px',
                        cursor: 'pointer'
                    }}
                >
                    Hide Popup
                </button>
                <p style={{ 'font-size': '12px', color: '#666', 'margin-top': '10px' }}>
                    Click button to show popup with title, subtitle, details, and actions
                </p>
            </div>

            <div style={{ 'margin-bottom': '20px' }}>
                <h3>Custom HTML Popup</h3>
                <button
                    onClick={showCustomPopup}
                    style={{
                        padding: '10px 20px',
                        'background-color': '#2196F3',
                        color: 'white',
                        border: 'none',
                        'border-radius': '4px',
                        cursor: 'pointer'
                    }}
                >
                    Show Custom Popup (auto-hides)
                </button>
                <p style={{ 'font-size': '12px', color: '#666', 'margin-top': '10px' }}>
                    Click button to show custom HTML popup (hides after 3 seconds)
                </p>
            </div>

            {/* Popup container */}
            <div
                ref={popupContainer}
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '400px',
                    border: '2px dashed #ccc',
                    'border-radius': '8px',
                    'background-color': '#fafafa'
                }}
            >
                <p style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: '#999',
                    'text-align': 'center'
                }}>
                    Popup Container
                    <br />
                    <small>Click buttons above to show popups</small>
                </p>
            </div>

            <div style={{
                'margin-top': '30px',
                padding: '15px',
                'background-color': '#e3f2fd',
                'border-radius': '4px',
                'border-left': '4px solid #2196F3'
            }}>
                <strong>✅ Phase 2 Complete!</strong>
                <ul style={{ 'margin-top': '10px', 'padding-left': '20px' }}>
                    <li>SolidJS Popup component created</li>
                    <li>PopupAdapter maintains vanilla API (show/hide)</li>
                    <li>Supports structured layout and custom HTML</li>
                    <li>Reactive positioning and visibility</li>
                </ul>
            </div>
        </div>
    );
}
