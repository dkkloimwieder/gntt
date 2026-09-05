import { render } from '@solidjs/web';
import CriticalPathDemo from '../demo/CriticalPathDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <CriticalPathDemo />, root);
}
