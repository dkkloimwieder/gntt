import { render } from 'solid-js/web';
import FilterSearchDemo from '../demo/FilterSearchDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <FilterSearchDemo />, root);
}
