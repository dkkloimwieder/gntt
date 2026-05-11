import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

// Vitest config for the test suite.
// Uses the SolidJS plugin so solid-js resolves to its client/dev build —
// this is what makes createEffect / createRoot reactive in tests.
// We do NOT add a DOM environment (jsdom/happy-dom): all current suites are
// pure-function or store-level reactive, none touch document/window.
export default defineConfig({
    plugins: [solidPlugin()],
    resolve: {
        conditions: ['development', 'browser'],
    },
    test: {
        environment: 'node',
        globals: false,
    },
});
