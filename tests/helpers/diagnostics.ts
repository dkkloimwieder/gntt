import { DEV, OBSERVE, type DiagnosticEvent } from 'solid-js';

export interface DiagnosticSession {
    take(): DiagnosticEvent[];
    stop(): DiagnosticEvent[];
}

export function startDiagnostics(): DiagnosticSession {
    if (!DEV || !OBSERVE) {
        throw new Error(
            'Solid diagnostics tests require the development runtime.',
        );
    }
    const capture = OBSERVE.diagnostics.capture();
    return {
        take() {
            const events = [...capture.events];
            capture.clear();
            return events;
        },
        stop: () => capture.stop(),
    };
}

export function withDiagnostics<T>(fn: () => T): {
    result: T;
    events: DiagnosticEvent[];
} {
    const session = startDiagnostics();
    try {
        return { result: fn(), events: session.take() };
    } finally {
        session.stop();
    }
}

export function formatDiagnostics(events: DiagnosticEvent[]): string[] {
    return events
        .filter((event) => event.severity !== 'info')
        .map((event) => `${event.severity} ${event.code}: ${event.message}`);
}
