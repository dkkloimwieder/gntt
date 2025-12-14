import { resolve } from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

const root = resolve(__dirname, '../..');

export default defineConfig({
    root,
    plugins: [solidPlugin()],
    build: {
        outDir: 'dist-demo',
        rollupOptions: {
            input: {
                perf: resolve(root, 'examples/perf.html'),
            },
        },
    },
});
