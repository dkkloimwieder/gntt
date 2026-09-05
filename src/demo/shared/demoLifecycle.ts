/**
 * Shared lifecycle helpers for the performance harnesses under `src/demo`.
 *
 * Five harnesses used to copy-paste the same
 * mount + measure + ResizeObserver + RAF/interval + cleanup body, and
 * seven start/stop toggles guarded themselves by reading back the very signal
 * they had just written. Both patterns live here now:
 *
 * - one place registers `onSettled` + a single returned disposer, so every
 *   harness inherits the lifecycle shape from one file;
 * - every RAF loop is cancelled on cleanup instead of running until the page
 *   goes away;
 * - `createLatch` keeps a plain closure boolean as the synchronous truth and
 *   uses the signal purely as a render mirror, so a toggle never depends on
 *   when a signal write becomes visible.
 *
 * Demo-only: nothing under `src/demo` ships in the npm bundle.
 */
import { createSignal, onSettled } from 'solid-js';
import type { Accessor } from 'solid-js';

/** A teardown function collected by the helpers below. */
export type Cleanup = () => void;

/**
 * `onSettled` plus a single merged cleanup.
 *
 * `setup` runs once after mount and may return one disposer that tears down
 * everything it registered — listeners, timers and animation frames together.
 */
export function useDemoMount(setup: () => Cleanup | void): void {
    onSettled(() => {
        const dispose = setup();
        return dispose || undefined;
    });
}

/** A measured element size, in CSS pixels. */
export interface ViewportSize {
    width: number;
    height: number;
}

export interface ViewportSizeOptions {
    /**
     * Element the ResizeObserver watches. Defaults to the measured element;
     * return `null`/`undefined` to skip the observer entirely.
     */
    observe?: () => Element | null | undefined;
    /**
     * Delay in ms before the first measurement. `0` measures synchronously on
     * mount; a positive value waits for layout to settle. The pending timer is
     * cleared by the cleanup.
     */
    initialDelay?: number;
    /** Reads the size off the element. Defaults to `clientWidth`/`clientHeight`. */
    measure?: (el: Element) => ViewportSize;
    /** Runs after every measurement, once both signals have been written. */
    onMeasure?: (size: ViewportSize) => void;
    /** Value of the width signal until the first measurement. */
    initialWidth?: number;
    /** Value of the height signal until the first measurement. */
    initialHeight?: number;
    /**
     * Also re-measure on `window` resize. Defaults to `false`: a ResizeObserver
     * on the container already catches every layout change these harnesses
     * make, and the extra listener would force a synchronous layout read (and
     * re-render) inside the resize event itself. Only opt in where the harness
     * genuinely has no observer.
     */
    windowResize?: boolean;
}

const defaultMeasure = (el: Element): ViewportSize => ({
    width: el.clientWidth,
    height: el.clientHeight,
});

/**
 * Tracks the size of a demo's scroll viewport.
 *
 * Measures `getEl()`, keeps measuring through a ResizeObserver and (optionally)
 * `window`'s resize event, and disposes observer, listener and the initial
 * timer through one cleanup. Returns the `[width, height]` accessors the
 * harnesses feed into their virtualization memos.
 */
export function useViewportSize(
    getEl: () => Element | null | undefined,
    options: ViewportSizeOptions = {},
): [Accessor<number>, Accessor<number>] {
    const {
        observe = getEl,
        initialDelay = 0,
        measure = defaultMeasure,
        onMeasure,
        initialWidth = 0,
        initialHeight = 0,
        windowResize = false,
    } = options;

    const [width, setWidth] = createSignal(initialWidth);
    const [height, setHeight] = createSignal(initialHeight);

    const update = () => {
        const el = getEl();
        if (!el) return;
        const size = measure(el);
        setWidth(size.width);
        setHeight(size.height);
        onMeasure?.(size);
    };

    useDemoMount(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (initialDelay > 0) timer = setTimeout(update, initialDelay);
        else update();

        const observed = observe();
        let observer: ResizeObserver | null = null;
        if (observed) {
            observer = new ResizeObserver(update);
            observer.observe(observed);
        }

        if (windowResize) window.addEventListener('resize', update);

        return () => {
            if (timer !== undefined) clearTimeout(timer);
            observer?.disconnect();
            if (windowResize) window.removeEventListener('resize', update);
        };
    });

    return [width, height];
}

/**
 * A per-frame callback. Returning `false` stops the loop, which mirrors the
 * `return;`-instead-of-rescheduling idiom the harnesses used inline.
 */
export type RafTick = (timestamp: number) => boolean | void;

export interface RafLoop {
    /**
     * (Re)starts the loop from the next animation frame, optionally swapping in
     * a new tick — stress tests build a fresh closure per run. Restarting an
     * already-running loop cancels the pending frame first, so there is never
     * more than one chain alive.
     */
    start: (tick?: RafTick) => void;
    /** Cancels the pending frame, if any. Safe to call from inside the tick. */
    stop: Cleanup;
    /** Whether a frame is currently scheduled. */
    isRunning: () => boolean;
}

/**
 * A requestAnimationFrame loop that is cancelled on cleanup.
 *
 * Must be called from a component body so the cleanup binds to the component.
 * The tick body itself is unchanged from the inline versions apart from the
 * self-rescheduling call, which the loop owns, and the stop condition, which
 * becomes `return false`.
 */
export function useRafLoop(tick?: RafTick): RafLoop {
    let current = tick;
    let frame: number | null = null;
    let running = false;
    // Bumped by every stop() (and so by every start(), which stops first).
    // A tick that restarts the loop leaves the frame it was called from with a
    // stale generation, so that frame must not schedule anything: the restart
    // already did, and a second chain could never be cancelled.
    let generation = 0;

    const step = (timestamp: number) => {
        const gen = generation;
        frame = null;
        const result = current?.(timestamp);
        if (gen !== generation) return; // the tick called start() or stop()
        if (result === false) {
            running = false;
            return;
        }
        if (running) frame = requestAnimationFrame(step);
    };

    const stop = () => {
        generation++;
        running = false;
        if (frame !== null) {
            cancelAnimationFrame(frame);
            frame = null;
        }
    };

    const start = (next?: RafTick) => {
        if (next) current = next;
        stop();
        if (!current) return;
        running = true;
        frame = requestAnimationFrame(step);
    };

    onSettled(() => {
        return stop;
    });

    return { start, stop, isRunning: () => running };
}

/**
 * A start/stop toggle whose truth is a plain closure boolean.
 *
 * Returns `[mirror, set, peek]`: read `mirror()` from JSX and memos, call
 * `set(next)` to flip both halves, and guard the toggle itself with `peek()`,
 * which is correct even in the same tick as the write that preceded it.
 */
export type Latch = [Accessor<boolean>, (next: boolean) => void, () => boolean];

export function createLatch(initial = false): Latch {
    let value = initial;
    const [mirror, setMirror] = createSignal(initial);
    const set = (next: boolean) => {
        value = next;
        setMirror(next);
    };
    return [mirror, set, () => value];
}
