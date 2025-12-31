import { createMemo, For, Show, JSX } from 'solid-js';
import type { DateInfo } from '../types';

interface UpperTextEntry {
    text: string;
    x: number;
    width: number;
    startIndex: number;
    endIndex: number;
}

interface LowerTextEntry {
    text: string;
    x: number;
    width: number;
    index: number;
}

interface DateHeadersProps {
    upperHeaderHeight?: number;
    lowerHeaderHeight?: number;
    columnWidth?: number;
    gridWidth?: number;
    dateInfos?: DateInfo[];
    startCol?: number;
    endCol?: number;
    sideHeader?: JSX.Element;
}

/**
 * DateHeaders - Renders the upper and lower date headers.
 * Uses HTML divs for sticky positioning (not SVG).
 */
export function DateHeaders(props: DateHeadersProps): JSX.Element {
    // Configuration - use ?? to allow 0 values
    const upperHeaderHeight = () => props.upperHeaderHeight ?? 45;
    const lowerHeaderHeight = () => props.lowerHeaderHeight ?? 30;
    const totalHeaderHeight = () => upperHeaderHeight() + lowerHeaderHeight();
    const columnWidth = () => props.columnWidth || 45;
    const gridWidth = () => props.gridWidth || 1000;

    // Date infos from ganttDateStore
    const dateInfos = () => props.dateInfos || [];

    // Viewport range for virtualization
    const startCol = () => props.startCol ?? 0;
    const endCol = () => props.endCol ?? dateInfos().length;

    // Group upper text entries - only process visible range + find group boundaries
    const upperTextEntries = createMemo<UpperTextEntry[]>(() => {
        const infos = dateInfos();
        const start = Math.max(0, startCol());
        const end = Math.min(infos.length, endCol());
        if (start >= end) return [];

        const entries: UpperTextEntry[] = [];

        // Find the start of the group containing startCol by scanning backwards
        let groupStart = start;
        const startInfo = infos[start];
        const startText = startInfo?.upperText;
        if (startText) {
            while (groupStart > 0 && infos[groupStart - 1]?.upperText === startText) {
                groupStart--;
            }
        }

        // Now scan forward from groupStart to end, building entries
        let currentText: string | null = null;
        let startX = 0;
        let startIndex = 0;

        for (let i = groupStart; i < end; i++) {
            const info = infos[i];
            if (!info) continue;

            if (info.upperText && info.upperText !== currentText) {
                // End previous entry
                if (currentText !== null) {
                    entries.push({
                        text: currentText,
                        x: startX,
                        width: info.x - startX,
                        startIndex,
                        endIndex: i - 1,
                    });
                }
                // Start new entry
                currentText = info.upperText;
                startX = info.x;
                startIndex = i;
            }
        }

        // Add final entry - find where this group ends
        if (currentText !== null) {
            let groupEnd = end;
            while (groupEnd < infos.length && infos[groupEnd]?.upperText === currentText) {
                groupEnd++;
            }
            const endInfo = infos[groupEnd];
            const endX = endInfo ? endInfo.x : gridWidth();
            entries.push({
                text: currentText,
                x: startX,
                width: endX - startX,
                startIndex,
                endIndex: groupEnd - 1,
            });
        }

        return entries;
    });

    // Lower text entries - VIRTUALIZED: only visible range
    const lowerTextEntries = createMemo<LowerTextEntry[]>(() => {
        const infos = dateInfos();
        const start = Math.max(0, startCol());
        const end = Math.min(infos.length, endCol());

        const entries: LowerTextEntry[] = [];
        for (let i = start; i < end; i++) {
            const info = infos[i];
            if (!info) continue;
            entries.push({
                text: info.lowerText,
                x: info.x,
                width: info.width || columnWidth(),
                index: i,
            });
        }
        return entries;
    });

    // Styles
    const headerContainerStyle = () => ({
        position: 'sticky' as const,
        top: '0',
        left: '0',
        'z-index': 10,
        width: `${gridWidth()}px`,
        height: `${totalHeaderHeight()}px`,
        'background-color': 'var(--g-header-bg-color, #fff)',
        'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
        display: 'flex',
        'flex-direction': 'column' as const,
        'pointer-events': 'none' as const,
    });

    const upperHeaderStyle = () => ({
        position: 'relative' as const,
        height: `${upperHeaderHeight()}px`,
        'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
    });

    const lowerHeaderStyle = () => ({
        position: 'relative' as const,
        height: `${lowerHeaderHeight()}px`,
        display: 'flex',
    });

    const upperTextStyle = (entry: UpperTextEntry) => ({
        position: 'absolute' as const,
        left: `${entry.x}px`,
        top: '0',
        height: '100%',
        display: 'flex',
        'align-items': 'center',
        'padding-left': '8px',
        'font-size': '14px',
        'font-weight': '500',
        color: 'var(--g-header-text-color, #333)',
        'white-space': 'nowrap' as const,
        overflow: 'hidden',
        'text-overflow': 'ellipsis',
        'max-width': `${entry.width}px`,
    });

    const lowerTextStyle = (entry: LowerTextEntry) => ({
        position: 'absolute' as const,
        left: `${entry.x}px`,
        top: '0',
        width: `${entry.width}px`,
        height: '100%',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'font-size': '12px',
        color: 'var(--g-header-text-color-secondary, #666)',
        'border-right': '1px solid var(--g-grid-line-color, #e0e0e0)',
        'box-sizing': 'border-box' as const,
    });

    return (
        <div class="gantt-headers" style={headerContainerStyle()}>
            {/* Upper header (month/year labels) - skip if height is 0 */}
            <Show when={upperHeaderHeight() > 0}>
                <div class="upper-header" style={upperHeaderStyle()}>
                    <For each={upperTextEntries()}>
                        {(entry) => (
                            <Show when={entry.text}>
                                <div
                                    class="upper-text"
                                    style={upperTextStyle(entry)}
                                >
                                    {entry.text}
                                </div>
                            </Show>
                        )}
                    </For>
                </div>
            </Show>

            {/* Lower header (day numbers) */}
            <div class="lower-header" style={lowerHeaderStyle()}>
                <For each={lowerTextEntries()}>
                    {(entry) => (
                        <Show when={entry.text}>
                            <div
                                class="lower-text"
                                style={lowerTextStyle(entry)}
                                data-date-index={entry.index}
                            >
                                {entry.text}
                            </div>
                        </Show>
                    )}
                </For>
            </div>

            {/* Side header slot (for Today button, view selector) */}
            {props.sideHeader}
        </div>
    );
}

export default DateHeaders;
