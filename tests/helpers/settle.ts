/**
 * Flush point for tests.
 *
 * SolidJS 2.0 stages every signal and store write until the microtask flush.
 * Tests call `settle()` after every write, before reading anything back, so
 * assertions observe committed state. This is `flush` from solid-js under the
 * name the whole suite was written against on 1.9.
 */
export { flush as settle } from 'solid-js';
