import { render } from 'solid-js/web';
import { Arrow } from '../components/Arrow.jsx';

/**
 * Adapter to make SolidJS Arrow compatible with vanilla Gantt API.
 * Maintains the same constructor signature and update() method as vanilla Arrow.
 */
export class ArrowAdapter {
    constructor(gantt, from_task, to_task, taskStore, svgContainer, arrowConfig = {}) {
        this.gantt = gantt;
        this.from_task = from_task;
        this.to_task = to_task;
        this.taskStore = taskStore;

        // Create a temporary container for the arrow
        const container = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        container.classList.add('arrow-group');

        // Render SolidJS Arrow component with configuration
        this.dispose = render(
            () => (
                <Arrow
                    fromTaskId={from_task.task.id}
                    toTaskId={to_task.task.id}
                    taskStore={taskStore}
                    startAnchor={arrowConfig.startAnchor}
                    endAnchor={arrowConfig.endAnchor}
                    curveRadius={arrowConfig.curveRadius}
                    horizontalGap={arrowConfig.horizontalGap}
                    verticalGap={arrowConfig.verticalGap}
                    arrowSize={arrowConfig.arrowSize}
                    stroke={arrowConfig.stroke}
                    strokeWidth={arrowConfig.strokeWidth}
                />
            ),
            container
        );

        // Store reference to the actual path element (first child)
        this.element = container.firstChild;

        // If svgContainer provided, append to it
        if (svgContainer) {
            svgContainer.appendChild(this.element);
        }
    }

    /**
     * Update arrow path.
     * In SolidJS version, this is handled automatically via reactivity.
     * This method is kept for API compatibility but does nothing.
     */
    update() {
        // SolidJS handles updates reactively - no manual update needed
        // This method exists only for vanilla API compatibility
    }

    /**
     * Cleanup SolidJS rendering.
     */
    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        if (this.dispose) {
            this.dispose();
        }
    }
}
