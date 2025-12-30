import { render } from 'solid-js/web';
import { ArrowDemo } from '../demo/ArrowDemo';

const root = document.getElementById('app');

if (root) {
    render(() => <ArrowDemo />, root);
} else {
    console.error('Root element not found');
}
