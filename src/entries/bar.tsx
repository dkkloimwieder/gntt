import { render } from 'solid-js/web';
import { BarDemo } from '../demo/BarDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <BarDemo />, root);
}
