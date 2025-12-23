import { createMemo, For, Show } from 'solid-js';

/**
 * DateHeaders - Renders the upper and lower date headers.
 * Uses HTML divs for sticky positioning (not SVG).
 */
export function DateHeaders(props) {
    // Configuration
    const upperHeaderHeight = () => props.upperHeaderHeight || 45;
    const lowerHeaderHeight = () => props.lowerHeaderHeight || 30;
    const totalHeaderHeight = () => upperHeaderHeight() + lowerHeaderHeight();
    const columnWidth = () => props.columnWidth || 45;
    const gridWidth = () => props.gridWidth || 1000;

    // Date infos from ganttDateStore
    const dateInfos = () => props.dateInfos || [];

    // Viewport range for virtualization
    const startCol = () => props.startCol ?? 0;
    const endCol = () => props.endCol ?? dateInfos().length;

    // Group upper text entries - only process visible range + find group boundaries
    const upperTextEntries = createMemo(() => {
        const infos = dateInfos();
        const start = Math.max(0, startCol());
        const end = Math.min(infos.length, endCol());
        if (start >= end) return [];

        const entries = [];

        // Find the start of the group containing startCol by scanning backwards
        let groupStart = start;
        const startText = infos[start]?.upperText;
        if (startText) {
            while (groupStart > 0 && infos[groupStart - 1]?.upperText === startText) {
                groupStart--;
            }
        }

        // Now scan forward from groupStart to end, building entries
        let currentText = null;
        let startX = 0;
        let startIndex = 0;

        for (let i = groupStart; i < end; i++) {
            const info = infos[i];

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
            const endX = groupEnd < infos.length ? infos[groupEnd].x : gridWidth();
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
    const lowerTextEntries = createMemo(() => {
        const infos = dateInfos();
        const start = Math.max(0, startCol());
        const end = Math.min(infos.length, endCol());

        const entries = [];
        for (let i = start; i < end; i++) {
            const info = infos[i];
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
        position: 'sticky',
        top: 0,
        left: 0,
        'z-index': 10,
        width: `${gridWidth()}px`,
        height: `${totalHeaderHeight()}px`,
        'background-color': 'var(--g-header-bg-color, #fff)',
        'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
        display: 'flex',
        'flex-direction': 'column',
        'pointer-events': 'none',
    });

    const upperHeaderStyle = () => ({
        position: 'relative',
        height: `${upperHeaderHeight()}px`,
        'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
    });

    const lowerHeaderStyle = () => ({
        position: 'relative',
        height: `${lowerHeaderHeight()}px`,
        display: 'flex',
    });

    const upperTextStyle = (entry) => ({
        position: 'absolute',
        left: `${entry.x}px`,
        top: 0,
        height: '100%',
        display: 'flex',
        'align-items': 'center',
        'padding-left': '8px',
        'font-size': '14px',
        'font-weight': '500',
        color: 'var(--g-header-text-color, #333)',
        'white-space': 'nowrap',
        overflow: 'hidden',
        'text-overflow': 'ellipsis',
        'max-width': `${entry.width}px`,
    });

    const lowerTextStyle = (entry) => ({
        position: 'absolute',
        left: `${entry.x}px`,
        top: 0,
        width: `${entry.width}px`,
        height: '100%',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'font-size': '12px',
        color: 'var(--g-header-text-color-secondary, #666)',
        'border-right': '1px solid var(--g-grid-line-color, #e0e0e0)',
        'box-sizing': 'border-box',
    });

    return (
        <div class="gantt-headers" style={headerContainerStyle()}>
            {/* Upper header (month/year labels) */}
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
