/**
 * Flush point for tests.
 *
 * SolidJS 2.0 stages every signal and store write until the microtask flush.
 * Tests call `settle()` after every write, before reading anything back, so
 * assertions observe committed state. `settle` is the suite-wide alias for
 * solid-js's `flush`.
 */
export { flush as settle } from 'solid-js';
