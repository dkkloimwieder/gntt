import { render } from 'solid-js/web';
import { GanttMinimalTest } from '../demo/GanttMinimalTest';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttMinimalTest />, root);
}
