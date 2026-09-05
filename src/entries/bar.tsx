import { render } from '@solidjs/web';
import { BarDemo } from '../demo/BarDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <BarDemo />, root);
}
