import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config — used by `pnpm db:generate` to emit SQL migrations
 * from `server/db/schema.ts`. The runtime DB lives at `data/gantt.db`
 * (gitignored); migrations are committed.
 */
export default {
    schema: './server/db/schema.ts',
    out: './server/migrations',
    dialect: 'sqlite',
    dbCredentials: {
        url: './data/gantt.db',
    },
} satisfies Config;
