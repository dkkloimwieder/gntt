import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { Popup, StructuredPopup } from '../components/Popup.jsx';

/**
 * Adapter to make SolidJS Popup compatible with vanilla Gantt API.
 * Exposes show() and hide() methods like the vanilla Popup class.
 */
export class PopupAdapter {
    constructor(parent, popup_func, gantt) {
        this.parent = parent;
        this.popup_func = popup_func;
        this.gantt = gantt;

        // Create reactive state
        const [visible, setVisible] = createSignal(false);
        const [position, setPosition] = createSignal({ x: 0, y: 0 });
        const [content, setContent] = createSignal('');
        const [title, setTitle] = createSignal('');
        const [subtitle, setSubtitle] = createSignal('');
        const [details, setDetails] = createSignal('');
        const [actions, setActions] = createSignal([]);
        const [useCustomHTML, setUseCustomHTML] = createSignal(false);

        // Store setters for public API
        this.setVisible = setVisible;
        this.setPosition = setPosition;
        this.setContent = setContent;
        this.setTitle = setTitle;
        this.setSubtitle = setSubtitle;
        this.setDetails = setDetails;
        this.setActions = setActions;
        this.setUseCustomHTML = setUseCustomHTML;

        // Store getters for popup_func callbacks
        this.visible = visible;
        this.position = position;
        this.content = content;
        this.title = title;
        this.subtitle = subtitle;
        this.details = details;
        this.actions = actions;
        this.useCustomHTML = useCustomHTML;

        // Render SolidJS component
        this.dispose = render(
            () => {
                // Conditionally render custom HTML or structured popup
                if (this.useCustomHTML()) {
                    return (
                        <Popup
                            visible={visible}
                            position={position}
                            content={content}
                        />
                    );
                } else {
                    return (
                        <StructuredPopup
                            visible={visible}
                            position={position}
                            title={title}
                            subtitle={subtitle}
                            details={details}
                            actions={actions}
                        />
                    );
                }
            },
            parent
        );
    }

    /**
     * Show popup at position with task data.
     * Maintains vanilla Popup API.
     */
    show({ x, y, task, target }) {
        // Reset actions
        this.setActions([]);

        // Create API object for popup_func (same as vanilla)
        const popupAPI = {
            task,
            chart: this.gantt,
            get_title: () => {
                // Return a mock element with innerHTML getter
                return { innerHTML: this.title() };
            },
            set_title: (titleHTML) => {
                this.setTitle(titleHTML);
            },
            get_subtitle: () => {
                return { innerHTML: this.subtitle() };
            },
            set_subtitle: (subtitleHTML) => {
                this.setSubtitle(subtitleHTML);
            },
            get_details: () => {
                return { innerHTML: this.details() };
            },
            set_details: (detailsHTML) => {
                this.setDetails(detailsHTML);
            },
            add_action: (html, func) => {
                // Convert function-based HTML
                if (typeof html === 'function') {
                    html = html(task);
                }

                // Add to actions array
                this.setActions(prev => [
                    ...prev,
                    {
                        html,
                        onClick: (e) => func(task, this.gantt, e)
                    }
                ]);
            }
        };

        // Call popup_func (user customization)
        const result = this.popup_func(popupAPI);

        // Handle different return values (same as vanilla)
        if (result === false) {
            // Don't show popup
            return;
        }

        if (result) {
            // Custom HTML provided
            this.setUseCustomHTML(true);
            this.setContent(result);
        } else {
            // Use structured popup (default)
            this.setUseCustomHTML(false);
        }

        // Set position and show
        this.setPosition({ x, y });
        this.setVisible(true);
    }

    /**
     * Hide popup.
     * Maintains vanilla Popup API.
     */
    hide() {
        this.setVisible(false);
    }

    /**
     * Cleanup SolidJS rendering.
     */
    destroy() {
        this.dispose();
    }
}
