/**
 * Flush point for tests.
 *
 * On solid-js 1.9 every write is applied synchronously, so there is nothing
 * to drain and this is a deliberate no-op. It exists now so the whole test
 * suite can already be written in the shape SolidJS 2.0 requires: call
 * `settle()` after every write, before reading anything back.
 *
 * E3.1 replaces the body with `export { flush as settle } from 'solid-js'`.
 * Until then, do NOT import `flush` anywhere — it does not exist in this
 * tree.
 */
export function settle(): void {}
