import { createSignal, createEffect } from 'solid-js';

/**
 * Track the previous value of a reactive signal.
 *
 * @param {() => any} value - Accessor function that returns the current value
 * @returns {() => any} Accessor function that returns the previous value
 *
 * @example
 * const [count, setCount] = createSignal(0);
 * const prevCount = usePrevious(() => count());
 *
 * createEffect(() => {
 *   console.log('Current:', count());
 *   console.log('Previous:', prevCount());
 * });
 */
export function usePrevious(value) {
    let prev;
    const [previous, setPrevious] = createSignal();

    createEffect(() => {
        const current = value();
        setPrevious(prev);
        prev = current;
    });

    return previous;
}
