import { createMemo, Index, Show } from 'solid-js';

/**
 * DateHeadersOptimized - Uses <Index> with fixed slot pool for zero DOM churn.
 *
 * Instead of rebuilding arrays on scroll, we maintain a fixed number of DOM nodes
 * (visible columns + overscan) and update their content reactively.
 */
export function DateHeadersOptimized(props) {
    // Configuration - use ?? to allow 0 values
    const upperHeaderHeight = () => props.upperHeaderHeight ?? 45;
    const lowerHeaderHeight = () => props.lowerHeaderHeight ?? 30;
    const totalHeaderHeight = () => upperHeaderHeight() + lowerHeaderHeight();
    const gridWidth = () => props.gridWidth || 1000;

    // Date infos from parent (stable array, doesn't change on scroll)
    const dateInfos = () => props.dateInfos || [];

    // Viewport range
    const startCol = () => props.startCol ?? 0;
    const endCol = () => props.endCol ?? dateInfos().length;

    // Fixed slot pool for lower headers (day numbers)
    // Returns array of day indices, length = visible + overscan
    const lowerSlots = createMemo(() => {
        const start = Math.max(0, startCol());
        const end = Math.min(dateInfos().length, endCol());
        const slots = [];
        for (let i = start; i < end; i++) {
            slots.push(i);
        }
        return slots;
    });

    // Upper header slots - need to find group boundaries
    // Each slot is { startIndex, text } for a month/week group
    const upperSlots = createMemo(() => {
        const infos = dateInfos();
        const start = Math.max(0, startCol());
        const end = Math.min(infos.length, endCol());
        if (start >= end) return [];

        const slots = [];
        let currentText = null;
        let groupStartIndex = start;

        // Find the start of the group containing startCol
        const startText = infos[start]?.upperText;
        if (startText) {
            let scanBack = start;
            while (scanBack > 0 && infos[scanBack - 1]?.upperText === startText) {
                scanBack--;
            }
            groupStartIndex = scanBack;
        }

        // Scan forward building slots
        for (let i = groupStartIndex; i < end; i++) {
            const info = infos[i];
            if (info.upperText && info.upperText !== currentText) {
                if (currentText !== null) {
                    // End previous group
                    slots.push({
                        startIndex: groupStartIndex,
                        endIndex: i - 1,
                        text: currentText,
                    });
                }
                currentText = info.upperText;
                groupStartIndex = i;
            }
        }

        // Final group - find where it ends
        if (currentText !== null) {
            let groupEnd = end;
            while (groupEnd < infos.length && infos[groupEnd]?.upperText === currentText) {
                groupEnd++;
            }
            slots.push({
                startIndex: groupStartIndex,
                endIndex: groupEnd - 1,
                text: currentText,
            });
        }

        return slots;
    });

    // Static styles (no functions creating new objects)
    const headerContainerStyle = {
        position: 'sticky',
        top: 0,
        left: 0,
        'z-index': 10,
        'background-color': 'var(--g-header-bg-color, #fff)',
        'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
        display: 'flex',
        'flex-direction': 'column',
        'pointer-events': 'none',
    };

    const upperHeaderStyle = {
        position: 'relative',
        'border-bottom': '1px solid var(--g-grid-line-color, #e0e0e0)',
    };

    const lowerHeaderStyle = {
        position: 'relative',
        display: 'flex',
    };

    const upperTextBaseStyle = {
        position: 'absolute',
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
    };

    const lowerTextBaseStyle = {
        position: 'absolute',
        top: 0,
        height: '100%',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'font-size': '12px',
        color: 'var(--g-header-text-color-secondary, #666)',
        'border-right': '1px solid var(--g-grid-line-color, #e0e0e0)',
        'box-sizing': 'border-box',
    };

    return (
        <div
            class="gantt-headers"
            style={{
                ...headerContainerStyle,
                width: `${gridWidth()}px`,
                height: `${totalHeaderHeight()}px`,
            }}
        >
            {/* Upper header (month/year labels) - skip if height is 0 */}
            <Show when={upperHeaderHeight() > 0}>
                <div
                    class="upper-header"
                    style={{
                        ...upperHeaderStyle,
                        height: `${upperHeaderHeight()}px`,
                    }}
                >
                    <Index each={upperSlots()}>
                        {(slot) => {
                            const startInfo = () => dateInfos()[slot().startIndex];
                            const endInfo = () => dateInfos()[slot().endIndex + 1] || null;
                            const x = () => startInfo()?.x ?? 0;
                            const width = () => {
                                const endX = endInfo()?.x ?? gridWidth();
                                return endX - x();
                            };

                            return (
                                <div
                                    class="upper-text"
                                    style={{
                                        ...upperTextBaseStyle,
                                        left: `${x()}px`,
                                        'max-width': `${width()}px`,
                                    }}
                                >
                                    {slot().text}
                                </div>
                            );
                        }}
                    </Index>
                </div>
            </Show>

            {/* Lower header (day numbers) - fixed slot pool */}
            <div
                class="lower-header"
                style={{
                    ...lowerHeaderStyle,
                    height: `${lowerHeaderHeight()}px`,
                }}
            >
                <Index each={lowerSlots()}>
                    {(dayIndex) => {
                        // dayIndex is a signal - when scroll changes, this updates
                        const entry = () => dateInfos()[dayIndex()];

                        return (
                            <div
                                class="lower-text"
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    height: '100%',
                                    display: 'flex',
                                    'align-items': 'center',
                                    'justify-content': 'center',
                                    'font-size': '12px',
                                    color: 'var(--g-header-text-color-secondary, #666)',
                                    'border-right': '1px solid var(--g-grid-line-color, #e0e0e0)',
                                    'box-sizing': 'border-box',
                                    // Dynamic props - only these should trigger updates
                                    left: `${entry()?.x ?? 0}px`,
                                    width: `${entry()?.width ?? 45}px`,
                                }}
                            >
                                {entry()?.lowerText}
                            </div>
                        );
                    }}
                </Index>
            </div>

            {props.sideHeader}
        </div>
    );
}

export default DateHeadersOptimized;
