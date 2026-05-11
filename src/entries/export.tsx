import { render } from 'solid-js/web';
import ExportDemo from '../demo/ExportDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <ExportDemo />, root);
}
