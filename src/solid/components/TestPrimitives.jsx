import { createSignal, createEffect, onCleanup } from 'solid-js';
import { createRAF } from '@solid-primitives/raf';
import { throttle, debounce } from '@solid-primitives/scheduled';

/**
 * Test component to verify Solid Primitives are working correctly.
 * This component tests:
 * - createRAF for animation loops
 * - throttle/debounce for rate-limiting
 * - Manual previous value tracking
 */
export function TestPrimitives() {
    const [count, setCount] = createSignal(0);
    const [rafCount, setRafCount] = createSignal(0);
    const [throttledValue, setThrottledValue] = createSignal(0);
    const [debouncedValue, setDebouncedValue] = createSignal(0);

    // Manual previous value tracking (createPrevious doesn't exist in primitives)
    let previousValue = 0;
    const [prevCount, setPrevCount] = createSignal(0);

    // Track count changes
    createEffect(() => {
        const current = count();
        // Set previous before updating
        setPrevCount(previousValue);
        previousValue = current;
    });

    // Test createRAF
    const [isRunning, start, stop] = createRAF((dt) => {
        setRafCount(prev => prev + 1);
        if (rafCount() > 60) {
            stop(); // Stop after ~1 second at 60fps
        }
    });

    // Test throttle - updates max once every 100ms
    const throttledUpdate = throttle((value) => {
        setThrottledValue(value);
    }, 100);

    // Test debounce - updates 300ms after last call
    const debouncedUpdate = debounce((value) => {
        setDebouncedValue(value);
    }, 300);

    // Track count changes
    createEffect(() => {
        const current = count();
        throttledUpdate(current);
        debouncedUpdate(current);
    });

    const handleIncrement = () => {
        setCount(prev => prev + 1);
    };

    const handleStartRAF = () => {
        setRafCount(0);
        start();
    };

    onCleanup(() => {
        stop(); // Cleanup RAF on unmount
    });

    return (
        <div style={{
            padding: '20px',
            'font-family': 'monospace',
            'background-color': '#f5f5f5',
            'border-radius': '8px'
        }}>
            <h2>Solid Primitives Test</h2>

            <div style={{ 'margin-bottom': '20px' }}>
                <h3>createSignal + Manual Previous Value Tracking</h3>
                <p>Current count: {count()}</p>
                <p>Previous count: {prevCount()}</p>
                <p>Changed: {count() !== prevCount() ? 'Yes' : 'No'}</p>
                <button onClick={handleIncrement}>Increment</button>
                <p style={{ 'font-size': '12px', color: '#666' }}>
                    Note: createPrevious doesn't exist in @solid-primitives/memo
                </p>
            </div>

            <div style={{ 'margin-bottom': '20px' }}>
                <h3>Throttle (100ms) & Debounce (300ms)</h3>
                <p>Original value: {count()}</p>
                <p>Throttled value: {throttledValue()}</p>
                <p>Debounced value: {debouncedValue()}</p>
                <p style={{ 'font-size': '12px', color: '#666' }}>
                    Click increment rapidly to see throttle/debounce in action
                </p>
            </div>

            <div style={{ 'margin-bottom': '20px' }}>
                <h3>createRAF (Request Animation Frame)</h3>
                <p>RAF frames counted: {rafCount()}</p>
                <p>Status: {isRunning() ? '🟢 Running' : '🔴 Stopped'}</p>
                <button onClick={handleStartRAF} disabled={isRunning()}>
                    Start RAF (stops at 60 frames)
                </button>
                <p style={{ 'font-size': '12px', color: '#666' }}>
                    RAF should run at ~60fps on 60Hz displays
                </p>
            </div>

            <div style={{
                'margin-top': '30px',
                padding: '10px',
                'background-color': '#e8f5e9',
                'border-radius': '4px'
            }}>
                <strong>✅ All Solid Primitives loaded successfully!</strong>
            </div>
        </div>
    );
}
