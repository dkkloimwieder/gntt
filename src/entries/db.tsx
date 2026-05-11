import { render } from 'solid-js/web';
import DbDemo from '../demo/DbDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <DbDemo />, root);
}
