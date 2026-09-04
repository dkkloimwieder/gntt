/**
 * Smoke test for the `mountGantt` helper itself (E0.4).
 *
 * The E1 characterization suites all build on this helper, so it has to be
 * exercised by `pnpm test` rather than merely typecheck. Everything asserted
 * here is a property of the HELPER — that a real `<Gantt>` mounts under jsdom
 * and paints bars, that the viewport the component measures is the inset
 * scroll area rather than the mount box, that the SVG coordinate stubs carry
 * a real drag end to end, and that dispose puts the DOM back. The chart's own
 * behaviour (positions, dates, hidden flags) belongs to E1.1.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mountGantt, type MountedGantt } from './helpers/mountGantt';
import { settle } from './helpers/settle';
import type { GanttAPI } from '../src/components/Gantt';
import type { BarPosition, GanttTask } from '../src/types';

/**
 * The two tracks that inset the scroll area. `<Gantt>` hands
 * `resourceColumnWidth` (`options.resourceColumnWidth || 120`, Gantt.tsx:556)
 * and `headerHeight` (`ganttConfig.headerHeight()`) to `GanttContainer`, which
 * renders them as the first track of each grid axis. The helper never
 * hardcodes either — it parses the template the component rendered — so the
 * tests below drive an off-default width through `options` to prove it.
 */
const DEFAULT_RESOURCE_COLUMN_WIDTH = 120;
const ODD_RESOURCE_COLUMN_WIDTH = 137;

const TASKS: GanttTask[] = [
    {
        id: 't1',
        name: 'Task 1',
        start: '2025-01-01 08:00',
        end: '2025-01-03 16:00',
        resource: 'R1',
    },
    {
        id: 't2',
        name: 'Task 2',
        start: '2025-01-04 08:00',
        end: '2025-01-06 16:00',
        resource: 'R2',
    },
    {
        id: 't3',
        name: 'Task 3',
        start: '2025-01-07 08:00',
        end: '2025-01-09 16:00',
        resource: 'R3',
    },
];

let mounted: MountedGantt | undefined;

afterEach(() => {
    mounted?.dispose();
    mounted = undefined;
});

const barFor = (root: HTMLElement, id: string): Element | null =>
    root.querySelector(`.bar-wrapper[data-id="${id}"]`);

const elementOf = (m: MountedGantt, selector: string): HTMLElement => {
    const el = m.container.querySelector(selector);
    expect(el).not.toBe(null);
    return el as HTMLElement;
};

/** Every task's committed bar geometry, straight from the published store. */
const barsOf = (m: MountedGantt): Array<{ id: string; bar: BarPosition }> =>
    Object.entries(m.stores.taskStore.tasks)
        .filter(([, t]) => t?._bar && !t._isHidden)
        .map(([id, t]) => ({ id, bar: t!._bar }));

type Rect = { x: number; y: number; width: number; height: number };

/** Same predicate `svgExport.pickExportTasks` uses for `range: 'visible'`. */
const rectsIntersect = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;

const idsIntersecting = (
    bars: Array<{ id: string; bar: BarPosition }>,
    rect: Rect,
): string[] =>
    bars
        .filter((b) => rectsIntersect(b.bar, rect))
        .map((b) => b.id)
        .sort();

const mouse = (type: string, clientX: number, clientY: number): MouseEvent =>
    new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
    });

describe('mountGantt', () => {
    it('renders one bar per task', () => {
        mounted = mountGantt({ tasks: TASKS });
        settle();

        expect(mounted.container.querySelector('.gantt-container')).not.toBe(
            null,
        );
        for (const task of TASKS) {
            expect(barFor(mounted.container, task.id!)).not.toBe(null);
        }
    });

    it('insets the scroll area by the grid tracks the component rendered', () => {
        mounted = mountGantt(
            {
                tasks: TASKS,
                // Off-default on purpose: if the stub hardcoded a track width
                // instead of parsing the rendered grid, this would still read 120.
                options: { resourceColumnWidth: ODD_RESOURCE_COLUMN_WIDTH },
            },
            { clientWidth: 900, clientHeight: 500 },
        );
        settle();
        const headerHeight = mounted.stores.ganttConfig.headerHeight();
        expect(headerHeight).toBeGreaterThan(0);

        // The mount container and the grid itself keep the configured size…
        expect(mounted.container.clientWidth).toBe(900);
        expect(elementOf(mounted, '.gantt-container').clientHeight).toBe(500);

        // …but the scroll area sits in grid-row 2 / grid-column 2.
        const scrollArea = elementOf(mounted, '.gantt-scroll-area');
        expect(scrollArea.clientWidth).toBe(900 - ODD_RESOURCE_COLUMN_WIDTH);
        expect(scrollArea.clientHeight).toBe(500 - headerHeight);

        // Track 1 on each axis is the fixed one.
        const resourceBody = elementOf(mounted, '.resource-body-wrapper');
        expect(resourceBody.clientWidth).toBe(ODD_RESOURCE_COLUMN_WIDTH);
        expect(resourceBody.clientHeight).toBe(500 - headerHeight);
        const dateHeaders = elementOf(mounted, '.date-headers-wrapper');
        expect(dateHeaders.clientWidth).toBe(900 - ODD_RESOURCE_COLUMN_WIDTH);
        expect(dateHeaders.clientHeight).toBe(headerHeight);
    });

    it('gives the component the inset WIDTH (scrollTo: today derives from it)', () => {
        const clientWidth = 900;
        mounted = mountGantt(
            {
                tasks: TASKS,
                options: {
                    scrollTo: 'today',
                    resourceColumnWidth: ODD_RESOURCE_COLUMN_WIDTH,
                },
            },
            { clientWidth, clientHeight: 500 },
        );
        settle();

        // Gantt.handleContainerReady runs
        //   api.scrollTo(dateToX(today) - api.getContainerWidth() / 4, false)
        // so the landed scroll offset reports back the width the component
        // actually measured — no reading of the stub we configured.
        const scrollArea = elementOf(mounted, '.gantt-scroll-area');
        expect(scrollArea.scrollLeft).toBeGreaterThan(0);

        const todayX = mounted.stores.dateStore.dateToX(new Date());
        const measuredWidth = (todayX - scrollArea.scrollLeft) * 4;
        expect(measuredWidth).toBeCloseTo(
            clientWidth - ODD_RESOURCE_COLUMN_WIDTH,
            0,
        );
        expect(measuredWidth).not.toBeCloseTo(clientWidth, 0);
    });

    it('gives the component the inset HEIGHT (a visible-range export crops with it)', async () => {
        // Bar geometry does not depend on the viewport, so a throwaway mount
        // tells us where the last row sits; the real mount is then sized so
        // the header inset straddles exactly that row.
        const probe = mountGantt({ tasks: TASKS });
        const lastRowY = Math.max(...barsOf(probe).map((b) => b.bar.y));
        const headerHeight = probe.stores.ganttConfig.headerHeight();
        probe.dispose();
        expect(lastRowY).toBeGreaterThan(0);

        const clientHeight = lastRowY + headerHeight;
        const clientWidth = 100000; // wide enough that width never crops
        let api: GanttAPI | undefined;
        mounted = mountGantt(
            {
                tasks: TASKS,
                onReady: (ready) => {
                    api = ready;
                },
            },
            { clientWidth, clientHeight },
        );
        settle();
        await Promise.resolve(); // Gantt defers onReady by a microtask
        expect(api).toBeDefined();

        const bars = barsOf(mounted);
        const inset = {
            x: 0,
            y: 0,
            width: clientWidth - DEFAULT_RESOURCE_COLUMN_WIDTH,
            height: clientHeight - headerHeight,
        };
        const asIfNotInset = {
            x: 0,
            y: 0,
            width: clientWidth,
            height: clientHeight,
        };
        const expected = idsIntersecting(bars, inset);
        const naive = idsIntersecting(bars, asIfNotInset);
        // Guard: without this the assertion below could not tell the two apart.
        expect(expected.length).toBeGreaterThan(0);
        expect(expected).not.toEqual(naive);

        // buildExportInput fills visibleRect from getContainerWidth/Height.
        const svg = api!.exportSvg({ range: 'visible' });
        const painted = bars
            .filter((b) =>
                svg.includes(
                    `x="${b.bar.x}" y="${b.bar.y}" width="${b.bar.width}"`,
                ),
            )
            .map((b) => b.id)
            .sort();
        expect(painted).toEqual(expected);
    });

    it('carries a real bar drag through the SVG coordinate stubs', () => {
        const changes: Array<{ id: string; start: Date; end: Date }> = [];
        mounted = mountGantt({
            tasks: TASKS,
            onDateChange: (id, range) => {
                changes.push({ id, start: range.start, end: range.end });
            },
        });
        settle();

        const { taskStore, ganttConfig, dateStore } = mounted.stores;
        const wrapper = barFor(mounted.container, 't1');
        expect(wrapper).not.toBe(null);

        const before = taskStore.tasks['t1']!._bar.x;
        const columnWidth = ganttConfig.columnWidth();
        const dragPx = 3 * columnWidth;

        wrapper!.dispatchEvent(mouse('mousedown', 100, 20));
        settle();
        document.dispatchEvent(mouse('mousemove', 100 + dragPx, 20));
        settle();
        document.dispatchEvent(mouse('mouseup', 100 + dragPx, 20));
        settle();

        const after = taskStore.tasks['t1']!._bar.x;
        const width = taskStore.tasks['t1']!._bar.width;

        // getScreenCTM is the identity at scroll 0, so the svg delta is the
        // client delta; useBarDrag then snaps to the column grid.
        expect(after).toBeGreaterThan(before);
        expect(after).toBe(
            Math.round((before + dragPx) / columnWidth) * columnWidth,
        );

        expect(changes).toHaveLength(1);
        expect(changes[0]!.id).toBe('t1');
        expect(changes[0]!.start.getTime()).toBe(
            dateStore.xToDate(after).getTime(),
        );
        expect(changes[0]!.end.getTime()).toBe(
            dateStore.xToDate(after + width).getTime(),
        );
    });

    it('lands the scrollTo: start option on the stubbed scroll offset', () => {
        mounted = mountGantt({ tasks: TASKS, options: { scrollTo: 'start' } });
        settle();

        const firstX = mounted.stores.taskStore.tasks['t1']!._bar.x;
        const scrollArea = elementOf(mounted, '.gantt-scroll-area');
        expect(scrollArea.scrollLeft).toBe(Math.max(0, firstX - 50));
    });

    it('publishes the task/config/date stores', () => {
        mounted = mountGantt({ tasks: TASKS });
        settle();

        expect(Object.keys(mounted.stores.taskStore.tasks).sort()).toEqual([
            't1',
            't2',
            't3',
        ]);
        expect(mounted.stores.dateStore.dates().length).toBeGreaterThan(0);
        expect(mounted.stores.ganttConfig.barHeight()).toBeGreaterThan(0);
    });

    it('mounts inside a GanttProvider too', () => {
        mounted = mountGantt({ tasks: TASKS }, { provider: true });
        settle();

        for (const task of TASKS) {
            expect(barFor(mounted.container, task.id!)).not.toBe(null);
        }
    });

    it('refuses a second live mount', () => {
        mounted = mountGantt({ tasks: TASKS });
        expect(() => mountGantt({ tasks: TASKS })).toThrow(
            /previous mount is still live/,
        );
    });

    it('detaches the container and restores every stubbed property on dispose', () => {
        const before = {
            resizeObserver: Object.getOwnPropertyDescriptor(
                globalThis,
                'ResizeObserver',
            ),
            clientWidth: Object.getOwnPropertyDescriptor(
                Element.prototype,
                'clientWidth',
            ),
            scrollLeft: Object.getOwnPropertyDescriptor(
                Element.prototype,
                'scrollLeft',
            ),
            scrollTo: Object.getOwnPropertyDescriptor(
                Element.prototype,
                'scrollTo',
            ),
            getScreenCTM: Object.getOwnPropertyDescriptor(
                SVGSVGElement.prototype,
                'getScreenCTM',
            ),
        };

        mounted = mountGantt({ tasks: TASKS });
        const { container } = mounted;
        mounted.dispose();
        mounted = undefined;

        expect(container.isConnected).toBe(false);
        expect(container.clientWidth).toBe(0);
        expect(
            Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver'),
        ).toEqual(before.resizeObserver);
        expect(
            Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth'),
        ).toEqual(before.clientWidth);
        expect(
            Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft'),
        ).toEqual(before.scrollLeft);
        expect(
            Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo'),
        ).toEqual(before.scrollTo);
        expect(
            Object.getOwnPropertyDescriptor(
                SVGSVGElement.prototype,
                'getScreenCTM',
            ),
        ).toEqual(before.getScreenCTM);
    });
});
