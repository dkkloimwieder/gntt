import { configDefaults, defineConfig } from 'vitest/config';
import solid from '@solidjs/vite-plugin';

// Both projects inherit the Solid plugin. It selects the browser runtime for
// jsdom and the server runtime for Node. Keep reactive tests in the client
// project because server effects do not run. Root-relative globs exclude
// tests from nested worktrees.
export default defineConfig({
    plugins: [solid()],
    test: {
        globals: false,
        // Limit concurrent jsdom suites so chart mounts meet the default timeout on Node 22.
        maxWorkers: 2,
        projects: [
            {
                extends: true,
                test: {
                    name: 'client',
                    environment: 'jsdom',
                    include: ['tests/**/*.test.{ts,tsx}'],
                    exclude: [...configDefaults.exclude, 'tests/server/**'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'server',
                    environment: 'node',
                    include: ['tests/server/**/*.test.ts'],
                },
            },
        ],
    },
});
