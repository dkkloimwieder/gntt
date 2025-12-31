import { render } from 'solid-js/web';
import { GanttPerfIsolate } from '../demo/GanttPerfIsolate';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttPerfIsolate />, root);
}
