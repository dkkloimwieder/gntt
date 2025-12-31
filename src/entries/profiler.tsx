import { render } from 'solid-js/web';
import { GanttProfiler } from '../demo/GanttProfiler';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttProfiler />, root);
}
