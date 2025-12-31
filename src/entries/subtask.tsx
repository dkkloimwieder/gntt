import { render } from 'solid-js/web';
import { GanttProjectDemo } from '../demo/GanttProjectDemo';

const root = document.getElementById('root');
if (root) {
    render(() => <GanttProjectDemo />, root);
}
