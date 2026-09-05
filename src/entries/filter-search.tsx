import { render } from '@solidjs/web';
import FilterSearchDemo from '../demo/FilterSearchDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <FilterSearchDemo />, root);
}
