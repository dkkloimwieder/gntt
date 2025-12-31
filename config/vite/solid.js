import { resolve } from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

const root = resolve(__dirname, '../..');

export default defineConfig({
    root,
    plugins: [solidPlugin()],
    build: {
        lib: {
            entry: resolve(root, 'src/index.ts'),
            name: 'Ganttss',
            formats: ['es', 'umd'],
            fileName: (format) => `ganttss.${format}.js`,
        },
        rollupOptions: {
            external: ['solid-js', 'solid-js/web'],
            output: {
                globals: {
                    'solid-js': 'SolidJS',
                    'solid-js/web': 'SolidJSWeb',
                },
                assetFileNames: 'ganttss[extname]',
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
