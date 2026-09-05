import { render } from '@solidjs/web';
import CustomColumnsDemo from '../demo/CustomColumnsDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <CustomColumnsDemo />, root);
}
