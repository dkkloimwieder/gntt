import { render } from 'solid-js/web';
import GanttPerfDemo from '../demo/GanttPerfDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttPerfDemo />, root);
}
