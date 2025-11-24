import { render } from 'solid-js/web';
import { TestPrimitives } from './components/TestPrimitives';

const root = document.getElementById('app');

if (root) {
    render(() => <TestPrimitives />, root);
} else {
    console.error('Root element not found');
}
