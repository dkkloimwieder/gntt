import { render } from '@solidjs/web';
import MultiSelectDemo from '../demo/MultiSelectDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <MultiSelectDemo />, root);
}
