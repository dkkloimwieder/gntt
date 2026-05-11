import { describe, it, expect } from 'vitest';
import {
    buildExportSvg,
    computeContentBounds,
    pickExportTasks,
    svgToBlob,
} from '../src/utils/svgExport';
import type { ProcessedTask, Relationship } from '../src/types';

function makeTask(
    id: string,
    bar: { x: number; y: number; width: number; height: number } | null,
    extra: Partial<ProcessedTask> = {},
): ProcessedTask {
    return {
        id,
        name: id,
        start: '2025-01-01',
        _start: new Date(2025, 0, 1),
        _end: new Date(2025, 0, 2),
        _index: 0,
        progress: 0,
        constraints: { locked: false },
        dependencies: [],
        _children: [],
        _depth: 0,
        _bar: bar ?? undefined,
        _resourceIndex: 0,
        _isHidden: false,
        ...extra,
    } as unknown as ProcessedTask;
}

describe('computeContentBounds', () => {
    it('returns zeros when there are no tasks', () => {
        expect(computeContentBounds({})).toEqual({
            minX: 0,
            minY: 0,
            maxX: 0,
            maxY: 0,
        });
    });

    it('returns zeros when all tasks are hidden', () => {
        const tasks = {
            a: makeTask(
                'a',
                { x: 10, y: 10, width: 20, height: 20 },
                { _isHidden: true },
            ),
        };
        expect(computeContentBounds(tasks)).toEqual({
            minX: 0,
            minY: 0,
            maxX: 0,
            maxY: 0,
        });
    });

    it('computes the union of all visible bar rects', () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
            b: makeTask('b', { x: 200, y: 50, width: 50, height: 30 }),
        };
        expect(computeContentBounds(tasks)).toEqual({
            minX: 0,
            minY: 0,
            maxX: 250,
            maxY: 80,
        });
    });

    it('skips tasks with no _bar', () => {
        const tasks = {
            a: makeTask('a', { x: 10, y: 10, width: 100, height: 20 }),
            b: makeTask('b', null),
        };
        expect(computeContentBounds(tasks).maxX).toBe(110);
    });
});

describe('pickExportTasks', () => {
    const tasks = {
        a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
        b: makeTask('b', { x: 200, y: 50, width: 50, height: 30 }),
        c: makeTask(
            'c',
            { x: 500, y: 0, width: 30, height: 30 },
            { _isHidden: true },
        ),
    };

    it("range='all' returns every visible task", () => {
        const ids = pickExportTasks(tasks, 'all')
            .map((t) => t.id)
            .sort();
        expect(ids).toEqual(['a', 'b']);
    });

    it("range='visible' filters by overlap with visibleRect", () => {
        const ids = pickExportTasks(tasks, 'visible', {
            x: 0,
            y: 0,
            width: 150,
            height: 200,
        }).map((t) => t.id);
        expect(ids).toEqual(['a']);
    });

    it("range='visible' without a rect returns nothing", () => {
        expect(pickExportTasks(tasks, 'visible')).toEqual([]);
    });

    it('always excludes hidden tasks', () => {
        const ids = pickExportTasks(tasks, 'all').map((t) => t.id);
        expect(ids).not.toContain('c');
    });
});

describe('buildExportSvg', () => {
    it('produces a valid <svg> root with width/height/viewBox', () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
        };
        const svg = buildExportSvg({ tasks, relationships: [] });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toMatch(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
        expect(svg).toMatch(/viewBox="-8 -8 116 46"/); // padding=8 default
        expect(svg.endsWith('</svg>')).toBe(true);
    });

    it('emits a <rect> per visible bar with the task colour', () => {
        const tasks = {
            a: makeTask(
                'a',
                { x: 0, y: 0, width: 100, height: 30 },
                { color: '#ff0000', colorProgress: '#aa0000', progress: 50 },
            ),
        };
        const svg = buildExportSvg({
            tasks,
            relationships: [],
            showLabels: false,
        });
        // bar background
        expect(svg).toMatch(/<rect [^/]*fill="#ff0000"[^/]*\/>/);
        // progress overlay (50% = width 50)
        expect(svg).toMatch(/<rect [^/]*width="50"[^/]*fill="#aa0000"[^/]*\/>/);
    });

    it('emits text labels when showLabels !== false', () => {
        const tasks = {
            a: makeTask(
                'a',
                { x: 0, y: 0, width: 100, height: 30 },
                { name: 'Hello' },
            ),
        };
        const svg = buildExportSvg({ tasks, relationships: [] });
        expect(svg).toMatch(/<text [^>]*>Hello<\/text>/);
    });

    it('escapes XML-unsafe characters in task names', () => {
        const tasks = {
            a: makeTask(
                'a',
                { x: 0, y: 0, width: 100, height: 30 },
                { name: 'A & <b> "test"' },
            ),
        };
        const svg = buildExportSvg({ tasks, relationships: [] });
        expect(svg).toMatch(/A &amp; &lt;b&gt; &quot;test&quot;/);
        expect(svg).not.toMatch(/<b>/);
    });

    it('skips text labels when showLabels === false', () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
        };
        const svg = buildExportSvg({
            tasks,
            relationships: [],
            showLabels: false,
        });
        expect(svg).not.toMatch(/<text /);
    });

    it('renders an arrow path when a relationship connects two exported bars', () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
            b: makeTask('b', { x: 200, y: 50, width: 100, height: 30 }),
        };
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0, elastic: true },
        ];
        const svg = buildExportSvg({ tasks, relationships: rels });
        // line path + chevron head
        expect(svg).toMatch(/<path d="M[^"]*" fill="none"/);
        expect(svg).toMatch(/<path d="M[^"]*" fill="#94a3b8"\/>/);
    });

    it('skips arrows whose endpoints are not in the export set', () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
        };
        const rels: Relationship[] = [
            { from: 'a', to: 'missing', type: 'FS', lag: 0, elastic: true },
        ];
        const svg = buildExportSvg({ tasks, relationships: rels });
        // No path elements
        expect(svg).not.toMatch(/<path /);
    });

    it("range='visible' crops bars and arrows to the rect", () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
            b: makeTask('b', { x: 500, y: 0, width: 100, height: 30 }),
        };
        const rels: Relationship[] = [
            { from: 'a', to: 'b', type: 'FS', lag: 0, elastic: true },
        ];
        const svg = buildExportSvg({
            tasks,
            relationships: rels,
            range: 'visible',
            visibleRect: { x: 0, y: 0, width: 200, height: 200 },
        });
        // Only `a` rendered → no arrow (b out of range)
        expect(svg).not.toMatch(/<path /);
        // Bar rect for `a` only
        const rectCount = (svg.match(/<rect /g) || []).length;
        // 1 background + 1 bar = 2
        expect(rectCount).toBe(2);
    });

    it('omits the background when background is set to empty string', () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
        };
        const svg = buildExportSvg({
            tasks,
            relationships: [],
            background: '',
            showLabels: false,
        });
        // Only the bar rect, no background
        const rectCount = (svg.match(/<rect /g) || []).length;
        expect(rectCount).toBe(1);
    });

    it('uses the default background colour when background is undefined', () => {
        const tasks = {
            a: makeTask('a', { x: 0, y: 0, width: 100, height: 30 }),
        };
        const svg = buildExportSvg({
            tasks,
            relationships: [],
            showLabels: false,
        });
        expect(svg).toMatch(/<rect [^/]*fill="#ffffff"[^/]*\/>/);
    });

    it('handles empty input by emitting an empty SVG with padding-only size', () => {
        const svg = buildExportSvg({ tasks: {}, relationships: [] });
        expect(svg).toMatch(/<svg/);
        expect(svg).toMatch(/width="16"/); // 2 * default padding (8)
        expect(svg).toMatch(/height="16"/);
        expect(svg).not.toMatch(/<text /);
    });
});

describe('svgToBlob', () => {
    it('wraps the SVG string in a Blob with the SVG mime type', () => {
        const blob = svgToBlob('<svg/>');
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    });
});
