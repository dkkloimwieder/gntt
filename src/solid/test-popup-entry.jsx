import { render } from 'solid-js/web';
import { TestPopup } from './components/TestPopup';

const root = document.getElementById('app');

if (root) {
    render(() => <TestPopup />, root);
} else {
    console.error('Root element not found');
}
