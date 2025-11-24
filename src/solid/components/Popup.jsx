import { Show, createSignal } from 'solid-js';

/**
 * SolidJS Popup component for displaying task details.
 *
 * @param {Object} props
 * @param {() => boolean} props.visible - Reactive signal for visibility
 * @param {() => {x: number, y: number}} props.position - Reactive position
 * @param {() => string} props.content - HTML content to display
 * @param {string} props.class - Additional CSS classes
 */
export function Popup(props) {
    return (
        <Show when={props.visible()}>
            <div
                class={`popup-wrapper ${props.class || ''}`}
                style={{
                    position: 'absolute',
                    left: `${props.position().x + 10}px`,
                    top: `${props.position().y - 10}px`,
                    'z-index': 1000
                }}
                innerHTML={props.content()}
            />
        </Show>
    );
}

/**
 * Structured Popup component with title, subtitle, details, and actions.
 * Used when popup_func returns undefined (default structure).
 */
export function StructuredPopup(props) {
    return (
        <Show when={props.visible()}>
            <div
                class="popup-wrapper"
                style={{
                    position: 'absolute',
                    left: `${props.position().x + 10}px`,
                    top: `${props.position().y - 10}px`,
                    'z-index': 1000
                }}
            >
                <div class="title" innerHTML={props.title()} />
                <div class="subtitle" innerHTML={props.subtitle()} />
                <div class="details" innerHTML={props.details()} />
                <Show when={props.actions() && props.actions().length > 0}>
                    <div class="actions">
                        {props.actions().map(action => (
                            <button
                                class="action-btn"
                                onClick={action.onClick}
                                innerHTML={action.html}
                            />
                        ))}
                    </div>
                </Show>
            </div>
        </Show>
    );
}
