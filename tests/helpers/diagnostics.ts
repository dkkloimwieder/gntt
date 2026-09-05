/**
 * Capture SolidJS 2.0's dev diagnostics around a block of test code.
 *
 * 2.0 emits every dev-mode complaint — untracked strict reads, write-guard
 * violations, lifecycle misuse, no-owner effects — on a structured channel
 * as well as on the console. `DEV.diagnostics.capture()` (verified present
 * in solid-js 2.0.0-rc.6: `dist/dev.js` re-exports `DEV` from
 * `@solidjs/signals`, whose `diagnostics.capture()` returns
 * `{ events, clear(), stop() }`) registers a sink for the duration, so a
 * test can assert on the *absence* of diagnostics instead of eyeballing a
 * browser console.
 *
 * `DEV` is `undefined` in a production build of solid-js. Vitest resolves
 * the dev build (the SolidJS vite plugin prepends the `development`
 * condition, see the comment in `vitest.config.ts`), but rather than let a
 * resolution change silently turn this gate into a no-op, the capture falls
 * back to intercepting `console.warn` / `console.error` and reports which
 * channel it used through `source`. A test that cares should assert on
 * `source`.
 *
 * Severity note: `error`-severity diagnostics are emitted *before* the
 * runtime throws, so a capture still holds the event when the block below
 * blows up. `stop()` therefore runs in a `finally`.
 */
import { DEV } from 'solid-js';

/** Which channel the events came off. */
export type DiagnosticSource = 'DEV' | 'console';

/**
 * One diagnostic, flattened to the fields a gate needs. Deliberately not the
 * package's `DiagnosticEvent`: `@solidjs/signals` is a transitive dependency
 * with no entry in the root `node_modules`, so its types are not importable
 * here.
 */
export interface DiagnosticRecord {
    /** e.g. `STRICT_READ_UNTRACKED`. `UNKNOWN` for an unparsable console line. */
    code: string;
    /** e.g. `strict-read`. `console` when reconstructed from a console call. */
    kind: string;
    severity: 'info' | 'warn' | 'error';
    message: string;
}

/** The slice of `DEV.diagnostics` this helper uses. */
interface CapturedEvent {
    code: string;
    kind: string;
    severity: 'info' | 'warn' | 'error';
    message: string;
}

export interface DiagnosticSession {
    readonly source: DiagnosticSource;
    /** Events seen since the session started or since the last `take()`. */
    take(): DiagnosticRecord[];
    /** Stop capturing. Returns the events not yet taken. */
    stop(): DiagnosticRecord[];
}

/** `[CODE] message` — the prefix every solid diagnostic message carries. */
const CODE_PREFIX = /^\[([A-Z0-9_]+)\]\s*/;

function fromConsole(
    severity: 'warn' | 'error',
    args: unknown[],
): DiagnosticRecord {
    const message = args
        .map((a) => (typeof a === 'string' ? a : String(a)))
        .join(' ');
    const match = CODE_PREFIX.exec(message);
    return {
        code: match ? match[1]! : 'UNKNOWN',
        kind: 'console',
        severity,
        message,
    };
}

/**
 * Begin capturing diagnostics. Always pair with `stop()` (a `finally`, an
 * `afterEach`) — the sink is global and outlives the test otherwise.
 */
export function startDiagnostics(): DiagnosticSession {
    if (DEV) {
        const capture = DEV.diagnostics.capture();
        let live = true;
        const drain = (): DiagnosticRecord[] => {
            const events = (capture.events as readonly CapturedEvent[]).map(
                (e): DiagnosticRecord => ({
                    code: e.code,
                    kind: e.kind,
                    severity: e.severity,
                    message: e.message,
                }),
            );
            capture.clear();
            return events;
        };
        return {
            source: 'DEV',
            take: () => (live ? drain() : []),
            stop: () => {
                if (!live) return [];
                const rest = drain();
                capture.stop();
                live = false;
                return rest;
            },
        };
    }

    // Fallback: no structured channel. Reconstruct from the console.
    const collected: DiagnosticRecord[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]): void => {
        collected.push(fromConsole('warn', args));
    };
    console.error = (...args: unknown[]): void => {
        collected.push(fromConsole('error', args));
    };
    let live = true;
    const drain = (): DiagnosticRecord[] =>
        collected.splice(0, collected.length);
    return {
        source: 'console',
        take: () => (live ? drain() : []),
        stop: () => {
            if (!live) return [];
            const rest = drain();
            console.warn = originalWarn;
            console.error = originalError;
            live = false;
            return rest;
        },
    };
}

export interface DiagnosticsRun<T> {
    result: T;
    events: DiagnosticRecord[];
    source: DiagnosticSource;
}

/**
 * Run `fn` with diagnostics captured. The capture is torn down even when
 * `fn` throws — which an `error`-severity diagnostic makes it do.
 */
export function withDiagnostics<T>(fn: () => T): DiagnosticsRun<T> {
    const session = startDiagnostics();
    let result: T;
    try {
        result = fn();
    } catch (error) {
        // The diagnostics emitted before the throw are usually the reason for
        // it; hand them to the caller on the error instead of discarding them.
        const events = session.stop();
        if (error instanceof Error) {
            (
                error as Error & { diagnostics?: DiagnosticRecord[] }
            ).diagnostics = events;
        }
        throw error;
    }
    return { result, events: session.stop(), source: session.source };
}

/** One line per diagnostic, for an assertion message. */
export function formatDiagnostics(events: DiagnosticRecord[]): string[] {
    return events.map((e) => `${e.severity} ${e.kind} ${e.code}: ${e.message}`);
}
