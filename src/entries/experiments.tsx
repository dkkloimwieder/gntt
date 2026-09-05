import { render } from '@solidjs/web';
import GanttExperiments from '../demo/GanttExperiments';

const root = document.getElementById('app');
if (root) {
    render(() => <GanttExperiments />, root);
}
