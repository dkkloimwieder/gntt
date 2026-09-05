import { render } from '@solidjs/web';
import BoxSelectDemo from '../demo/BoxSelectDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <BoxSelectDemo />, root);
}
