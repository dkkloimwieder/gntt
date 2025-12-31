import { render } from 'solid-js/web';
import GanttDemo from '../demo/GanttDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttDemo />, root);
}
