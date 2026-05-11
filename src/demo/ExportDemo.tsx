// @ts-nocheck
import { createSignal } from 'solid-js';
import { Gantt } from '../components/Gantt';
import type { GanttAPI } from '../components/Gantt';

/**
 * ExportDemo — Gantt chart with three download buttons:
 *   - SVG (full chart)        ← `range: 'all'` (default)
 *   - SVG (visible only)      ← clips to current scroll viewport
 *   - PNG (full chart, 2x)    ← rasterized via canvas
 *
 * Demonstrates the imperative `onReady({ exportSvg, exportPng, ... })`
 * API. Note: `range: 'visible'` only includes bars whose geometry
 * intersects the viewport at click-time.
 */
export function ExportDemo() {
    const [api, setApi] = createSignal<GanttAPI | null>(null);
    const [status, setStatus] = createSignal<string>('Ready.');

    const tasks = [
        {
            id: 'plan',
            name: 'Planning',
            start: '2025-01-01',
            end: '2025-01-04',
            progress: 100,
            resource: 'Team A',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'design',
            name: 'Design',
            start: '2025-01-04',
            end: '2025-01-09',
            progress: 60,
            dependencies: [{ id: 'plan' }],
            resource: 'Team A',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'build',
            name: 'Build',
            start: '2025-01-09',
            end: '2025-01-15',
            progress: 0,
            dependencies: [{ id: 'design' }],
            resource: 'Team B',
            color: '#10b981',
            colorProgress: '#047857',
        },
        {
            id: 'docs',
            name: 'Docs',
            start: '2025-01-09',
            end: '2025-01-13',
            progress: 0,
            dependencies: [{ id: 'design' }],
            resource: 'Team C',
            color: '#a855f7',
            colorProgress: '#7e22ce',
        },
        {
            id: 'review',
            name: 'Review',
            start: '2025-01-15',
            end: '2025-01-17',
            progress: 0,
            dependencies: [{ id: 'build' }],
            resource: 'Team A',
            color: '#3b82f6',
            colorProgress: '#1d4ed8',
        },
        {
            id: 'release',
            name: 'Release',
            start: '2025-01-17',
            end: '2025-01-18',
            progress: 0,
            dependencies: [{ id: 'review' }, { id: 'docs' }],
            resource: 'Team B',
            color: '#10b981',
            colorProgress: '#047857',
        },
    ];

    const triggerDownload = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Revoke a tick later so the browser actually starts the download.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const onSvgAll = () => {
        const a = api();
        if (!a) return;
        const blob = a.exportSvgBlob({ range: 'all' });
        triggerDownload(blob, 'gantt.svg');
        setStatus(`Downloaded gantt.svg — ${(blob.size / 1024).toFixed(1)} KB`);
    };

    const onSvgVisible = () => {
        const a = api();
        if (!a) return;
        const blob = a.exportSvgBlob({ range: 'visible' });
        triggerDownload(blob, 'gantt-visible.svg');
        setStatus(
            `Downloaded gantt-visible.svg — ${(blob.size / 1024).toFixed(1)} KB`,
        );
    };

    const onPng = async () => {
        const a = api();
        if (!a) return;
        setStatus('Rasterizing PNG…');
        try {
            const blob = await a.exportPng({ range: 'all', pngScale: 2 });
            triggerDownload(blob, 'gantt.png');
            setStatus(
                `Downloaded gantt.png — ${(blob.size / 1024).toFixed(1)} KB`,
            );
        } catch (err) {
            setStatus(`PNG export failed: ${(err as Error).message}`);
        }
    };

    const buttonStyle = {
        padding: '6px 12px',
        'border-radius': '4px',
        border: '1px solid #d1d5db',
        'background-color': '#fff',
        color: '#1f2937',
        'font-size': '13px',
        cursor: 'pointer',
    };

    return (
        <div>
            <h2 style={{ margin: '0 0 12px 0' }}>SVG / PNG Export</h2>
            <p
                style={{
                    margin: '0 0 12px 0',
                    color: '#6b7280',
                    'font-size': '14px',
                    'max-width': '720px',
                }}
            >
                Download the chart body as a self-contained image. The SVG walks
                task data directly — no DOM snapshot — so{' '}
                <strong>range: 'all'</strong> works even when virtualization has
                unmounted most bars. PNG is rasterized via{' '}
                <code>canvas.toBlob</code>.
            </p>
            <div
                style={{
                    display: 'flex',
                    gap: '8px',
                    'align-items': 'center',
                    'margin-bottom': '12px',
                    'flex-wrap': 'wrap',
                }}
            >
                <button style={buttonStyle} onClick={onSvgAll}>
                    Download SVG (all)
                </button>
                <button style={buttonStyle} onClick={onSvgVisible}>
                    Download SVG (visible)
                </button>
                <button style={buttonStyle} onClick={onPng}>
                    Download PNG (all)
                </button>
                <span
                    style={{
                        'font-family': 'monospace',
                        'font-size': '12px',
                        color: '#4338ca',
                        'background-color': '#eef2ff',
                        padding: '4px 8px',
                        'border-radius': '4px',
                    }}
                >
                    {status()}
                </span>
            </div>
            <Gantt
                tasks={tasks}
                options={{
                    viewMode: 'Day',
                    scrollTo: 'start',
                }}
                onReady={(a) => setApi(a)}
            />
        </div>
    );
}

export default ExportDemo;
