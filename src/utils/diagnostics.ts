/**
 * Validation diagnostics emitted by data-processing utilities (e.g.,
 * taskProcessor, hierarchyProcessor) when input shape is unexpected.
 *
 * Defaults to console.warn / console.error. Consumers can route the
 * messages elsewhere — silence in tests, send to an error tracker,
 * surface in a UI panel — via setDiagnosticHandler().
 */

export type DiagnosticLevel = 'warn' | 'error';

export type DiagnosticHandler = (
    level: DiagnosticLevel,
    message: string,
    ...args: unknown[]
) => void;

const defaultHandler: DiagnosticHandler = (level, message, ...args) => {
    if (level === 'error') {
        console.error(message, ...args);
    } else {
        console.warn(message, ...args);
    }
};

let handler: DiagnosticHandler = defaultHandler;

/** Replace the active diagnostic handler. Pass null to restore default. */
export function setDiagnosticHandler(next: DiagnosticHandler | null): void {
    handler = next ?? defaultHandler;
}

export function diagnosticWarn(message: string, ...args: unknown[]): void {
    handler('warn', message, ...args);
}

export function diagnosticError(message: string, ...args: unknown[]): void {
    handler('error', message, ...args);
}
