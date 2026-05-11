/**
 * Gantt → SVG / PNG export.
 *
 * Walks task data directly (no DOM), so virtualization isn't a problem:
 * `range: 'all'` produces a complete snapshot even when most bars are
 * unmounted. Output is a self-contained `<svg>` string with bars as
 * `<rect>` elements and dependency arrows as `<path>` elements (reusing
 * the same right-angle path generator the runtime uses).
 *
 * Out of scope for this MVP: date headers, resource column, custom
 * left-panel columns. The chart body (bars + arrows) is what
 * stakeholders typically want for slide decks.
 */
import type { ProcessedTask, Relationship, BarPosition } from '../types';
import { generateArrow } from './arrowBatchPaths';

export interface BuildExportSvgInput {
    /** All tasks keyed by id (typically `taskStore.tasks`). */
    tasks: Record<string, ProcessedTask | undefined>;
    /** Dependency edges (typically the `relationships` signal value). */
    relationships: Relationship[];
    /**
     * 'all' = full chart geometry; 'visible' = clip to a sub-rect (in
     * chart-content coords). Caller passes the visible rect when 'visible'.
     */
    range?: 'all' | 'visible';
    /** Required when range === 'visible'. */
    visibleRect?: { x: number; y: number; width: number; height: number };
    /** Background fill (default white). Set to null/empty to skip. */
    background?: string | null;
    /** Optional explicit width/height overrides; otherwise computed from bars. */
    width?: number;
    height?: number;
    /** Padding around the content extent (default 8px). */
    padding?: number;
    /** Arrow head size (px) — matches the runtime default if omitted. */
    arrowHeadSize?: number;
    /** Arrow stroke colour (default '#94a3b8'). */
    arrowColor?: string;
    /** Curve param passed to `generateArrow` (default 0 — right-angle). */
    arrowCurve?: number;
    /** Show task name label inside bar (default true). */
    showLabels?: boolean;
}

/** Default arrow visuals — match the runtime's defaults so exports look familiar. */
const DEFAULT_ARROW_HEAD = 8;
const DEFAULT_ARROW_COLOR = '#94a3b8';
const DEFAULT_BAR_COLOR = '#a3a3ff';
const DEFAULT_PROGRESS_COLOR = 'rgba(0, 0, 0, 0.2)';
const DEFAULT_LABEL_COLOR = '#1f2937';

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

interface ContentBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Compute the bounding box of all non-hidden bars. Returns zeros for empty input. */
export function computeContentBounds(
    tasks: Record<string, ProcessedTask | undefined>,
): ContentBounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;

    for (const id of Object.keys(tasks)) {
        const t = tasks[id];
        if (!t || t._isHidden || !t._bar) continue;
        any = true;
        const b = t._bar;
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.width > maxX) maxX = b.x + b.width;
        if (b.y + b.height > maxY) maxY = b.y + b.height;
    }

    if (!any) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
}

/** True if rect a intersects rect b (open intervals — touching edges don't count). */
function rectsIntersect(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
): boolean {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

/**
 * Pick the tasks that should appear in the export. For 'all', that's
 * every visible task; for 'visible', it's tasks whose `_bar` overlaps
 * the visible rect.
 */
export function pickExportTasks(
    tasks: Record<string, ProcessedTask | undefined>,
    range: 'all' | 'visible',
    visibleRect?: { x: number; y: number; width: number; height: number },
): ProcessedTask[] {
    const out: ProcessedTask[] = [];
    for (const id of Object.keys(tasks)) {
        const t = tasks[id];
        if (!t || t._isHidden || !t._bar) continue;
        if (range === 'visible') {
            if (!visibleRect) continue;
            if (!rectsIntersect(t._bar, visibleRect)) continue;
        }
        out.push(t);
    }
    return out;
}

/** Render a single bar (background + progress overlay + optional label) as SVG. */
function renderBar(task: ProcessedTask, showLabel: boolean): string {
    const bar = task._bar;
    if (!bar) return '';
    const color = (task.color as string) || DEFAULT_BAR_COLOR;
    const progressColor =
        (task.colorProgress as string) || DEFAULT_PROGRESS_COLOR;
    const progressFrac = Math.max(0, Math.min(100, task.progress || 0)) / 100;
    const progressWidth = Math.round(bar.width * progressFrac);

    const parts: string[] = [];
    parts.push(
        `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" rx="3" fill="${color}"/>`,
    );
    if (progressWidth > 0) {
        parts.push(
            `<rect x="${bar.x}" y="${bar.y}" width="${progressWidth}" height="${bar.height}" rx="3" fill="${progressColor}"/>`,
        );
    }
    if (showLabel && task.name) {
        const tx = bar.x + bar.width / 2;
        const ty = bar.y + bar.height / 2 + 4;
        parts.push(
            `<text x="${tx}" y="${ty}" fill="${DEFAULT_LABEL_COLOR}" font-size="11" font-family="sans-serif" text-anchor="middle">${escapeXml(task.name)}</text>`,
        );
    }
    return parts.join('');
}

/** Render every dependency arrow whose endpoints are both in the export set. */
function renderArrows(
    tasks: ProcessedTask[],
    relationships: Relationship[],
    color: string,
    headSize: number,
    curve: number,
): string {
    const byId = new Map<string, BarPosition>();
    for (const t of tasks) {
        if (t._bar) byId.set(t.id, t._bar);
    }

    const parts: string[] = [];
    for (const rel of relationships) {
        const from = byId.get(rel.from);
        const to = byId.get(rel.to);
        if (!from || !to) continue; // arrow has at least one endpoint outside the export set
        const { linePath, headPath } = generateArrow(
            from,
            to,
            rel.type,
            curve,
            headSize,
        );
        if (linePath) {
            parts.push(
                `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="1.5"/>`,
            );
        }
        if (headPath) {
            parts.push(`<path d="${headPath}" fill="${color}"/>`);
        }
    }
    return parts.join('');
}

/**
 * Build a self-contained SVG string for the given Gantt state.
 */
export function buildExportSvg(input: BuildExportSvgInput): string {
    const range = input.range ?? 'all';
    const padding = input.padding ?? 8;
    const tasks = pickExportTasks(input.tasks, range, input.visibleRect);

    // Bounds: from selected tasks (so 'visible' produces a tight crop).
    let minX = 0;
    let minY = 0;
    let maxX = input.width ?? 0;
    let maxY = input.height ?? 0;
    if (tasks.length > 0) {
        minX = Infinity;
        minY = Infinity;
        maxX = -Infinity;
        maxY = -Infinity;
        for (const t of tasks) {
            const b = t._bar!;
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
            if (b.x + b.width > maxX) maxX = b.x + b.width;
            if (b.y + b.height > maxY) maxY = b.y + b.height;
        }
    }

    const width = (input.width ?? Math.max(0, maxX - minX)) + padding * 2;
    const height = (input.height ?? Math.max(0, maxY - minY)) + padding * 2;

    const bgFill =
        input.background === undefined ? '#ffffff' : (input.background ?? '');

    const arrows = renderArrows(
        tasks,
        input.relationships,
        input.arrowColor ?? DEFAULT_ARROW_COLOR,
        input.arrowHeadSize ?? DEFAULT_ARROW_HEAD,
        input.arrowCurve ?? 0,
    );

    const bars = tasks
        .map((t) => renderBar(t, input.showLabels ?? true))
        .join('');

    // viewBox shifts so (minX, minY) maps to (padding, padding).
    const vbX = minX - padding;
    const vbY = minY - padding;

    const bg = bgFill
        ? `<rect x="${vbX}" y="${vbY}" width="${width}" height="${height}" fill="${bgFill}"/>`
        : '';

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${vbX} ${vbY} ${width} ${height}">` +
        bg +
        // Arrows render BEHIND bars to match runtime z-order.
        arrows +
        bars +
        `</svg>`
    );
}

/**
 * Wrap an SVG string in a Blob with the proper MIME type.
 */
export function svgToBlob(svg: string): Blob {
    return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * Rasterize an SVG string to a PNG Blob via a canvas. Browser-only — relies
 * on `Image` and `<canvas>`. The caller is responsible for awaiting the
 * returned promise (the underlying Image load is async).
 */
export function svgToPngBlob(
    svg: string,
    options: { scale?: number; background?: string } = {},
): Promise<Blob> {
    const scale = options.scale ?? 2; // 2x for crisp screen rendering by default
    const url = URL.createObjectURL(svgToBlob(svg));

    return new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                // Use the SVG's own intrinsic dimensions when possible.
                const w = (img.naturalWidth || img.width) * scale;
                const h = (img.naturalHeight || img.height) * scale;
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(w));
                canvas.height = Math.max(1, Math.round(h));
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Could not get 2d context'));
                    return;
                }
                if (options.background) {
                    ctx.fillStyle = options.background;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(url);
                    if (blob) resolve(blob);
                    else reject(new Error('toBlob returned null'));
                }, 'image/png');
            } catch (err) {
                URL.revokeObjectURL(url);
                reject(err);
            }
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });
}
