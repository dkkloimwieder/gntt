import { render } from 'solid-js/web';
import { TestArrow } from './components/TestArrow';

const root = document.getElementById('app');

if (root) {
    render(() => <TestArrow />, root);
} else {
    console.error('Root element not found');
}
