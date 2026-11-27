import { resolve } from 'path';
import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
    root,
    plugins: [solid()],
    build: {
        outDir: 'dist-demo',
        rolldownOptions: {
            input: {
                perf: resolve(root, 'examples/perf.html'),
                'perf-isolate': resolve(root, 'examples/perf-isolate.html'),
                experiments: resolve(root, 'examples/experiments.html'),
            },
        },
    },
});
