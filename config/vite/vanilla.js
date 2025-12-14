import { resolve } from 'path';
import { defineConfig } from 'vite';

const root = resolve(__dirname, '../..');

export default defineConfig({
    root,
    build: {
        lib: {
            entry: resolve(root, 'src/index.js'),
            name: 'Gantt',
            fileName: 'frappe-gantt',
        },
        rollupOptions: {
            output: {
                format: 'cjs',
                assetFileNames: 'frappe-gantt[extname]',
                entryFileNames: 'frappe-gantt.[format].js'
            },
        },
    },
    output: { interop: 'auto' },
    server: { watch: { include: ['dist/*', 'src/*'] } }
});
