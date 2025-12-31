import { render } from 'solid-js/web';
import ShowcaseDemo from '../demo/ShowcaseDemo';

const root = document.getElementById('app');
if (root) {
    render(() => <ShowcaseDemo />, root);
}
