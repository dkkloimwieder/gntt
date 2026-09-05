import { render } from '@solidjs/web';
import GanttPerfDemo from '../demo/GanttPerfDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttPerfDemo />, root);
}
