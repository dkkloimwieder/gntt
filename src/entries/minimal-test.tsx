import { render } from '@solidjs/web';
import { GanttMinimalTest } from '../demo/GanttMinimalTest';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttMinimalTest />, root);
}
