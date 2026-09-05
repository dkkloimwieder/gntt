import { resolve } from 'path';
import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';

const root = resolve(__dirname, '../..');

export default defineConfig({
    root,
    plugins: [solid()],
    build: {
        lib: {
            entry: resolve(root, 'src/index.ts'),
            name: 'Ganttss',
            // ESM only (migration decision D3): neither solid-js 2 nor
            // @solidjs/web ships a global build, so a UMD output could never
            // resolve its externals in a browser anyway.
            formats: ['es'],
            fileName: (format) => `ganttss.${format}.js`,
        },
        rollupOptions: {
            external: ['solid-js', '@solidjs/web'],
            output: {
                assetFileNames: 'ganttss[extname]',
            },
        },
    },
    server: {
        watch: {
            include: ['dist/*', 'src/**/*', 'examples/**/*'],
        },
        // Proxy /api/* to the demo backend (Hono on :3001 — `pnpm dev:server`).
        // Same-origin from the browser's perspective, so no CORS dance.
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
        },
    },
});
