import { render } from 'solid-js/web';
import GanttResourceGroupsDemo from '../demo/GanttResourceGroupsDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttResourceGroupsDemo />, root);
}
