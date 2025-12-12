import { resolve } from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
    plugins: [solidPlugin()],
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.js'),
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
    server: {
        watch: {
            include: ['dist/*', 'src/**/*', 'examples/**/*']
        }
    }
});
