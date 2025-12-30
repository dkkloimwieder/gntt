import { render } from 'solid-js/web';
import { ConstraintDemo } from '../demo/ConstraintDemo';

const root = document.getElementById('app');

if (root) {
    render(() => <ConstraintDemo />, root);
} else {
    console.error('Root element not found');
}
