/**
 * Mount a real `<Gantt>` into jsdom.
 *
 * jsdom has no layout engine and only a stub SVG implementation, so a bare
 * `render(() => <Gantt .../>)` throws (`ResizeObserver is not defined`) and,
 * even if it did not, would measure a 0x0 viewport and virtualize every bar
 * away. This helper installs exactly the DOM surface the component touches —
 * nothing more — mounts the chart, and hands back the container plus the
 * stores the component publishes on `window`.
 *
 * Stubbed here, and why (grep the library for these names to re-verify):
 *   - `ResizeObserver`                    GanttContainer.tsx (viewport size)
 *   - `Element.clientWidth/clientHeight`  GanttContainer.tsx (initial measure)
 *   - `Element.scrollLeft/scrollTop`      GanttContainer.tsx (scrollTo, onScroll)
 *   - `Element.scrollTo`                  GanttContainer.tsx (smooth scrollTo)
 *   - `SVGSVGElement.createSVGPoint`      useDrag.ts (client -> svg coords)
 *   - `SVGSVGElement.getScreenCTM`        useDrag.ts (client -> svg coords)
 *
 * Every stub is installed unconditionally and the previous descriptor (or its
 * absence) is restored on dispose. Nothing here is conditional on what jsdom
 * happens to ship: a jsdom that grew a layout-less `ResizeObserver` would
 * otherwise leave `viewportHeight` at 0 and silently virtualize every bar
 * away.
 *
 * ── Sizes ────────────────────────────────────────────────────────────────
 * `options.clientWidth` / `options.clientHeight` size the MOUNT CONTAINER —
 * the `<div>` this helper appends to `document.body`. Descendants do NOT all
 * report that size. `GanttContainer` renders a two-track CSS grid
 * (`grid-template-columns: <resourceColumnWidth>px 1fr`,
 * `grid-template-rows: <headerHeight>px 1fr`) and puts `.gantt-scroll-area`
 * at grid-row 2 / grid-column 2, so the real scroll area is inset:
 *
 *     scroll area width  = mount width  - resourceColumnWidth   (default 60)
 *     scroll area height = mount height - headerHeight          (default 60)
 *
 * The stub models that inset by PARSING WHAT THE COMPONENT ACTUALLY RENDERED
 * — the inline `grid-template-columns` / `grid-template-rows` on the grid
 * parent and the inline `grid-column` / `grid-row` on the child — rather than
 * hardcoding 60. `GanttContainer` seeds `containerWidth` from
 * `scrollAreaRef.clientWidth` and then refreshes both dimensions from the
 * `ResizeObserver` entry, so the getter and the observer entry are computed
 * by one shared `effectiveSize()` and always agree.
 *
 * Modelled grid rules, and only these: a track index of 1 gets the first
 * track's px value, an index of 2+ gets `parent - firstTrack`, and anything
 * else (no template on the parent, no line on the child, a non-px first
 * track) inherits the parent's size unchanged. That is exactly the shape
 * `GanttContainer` renders; it is not a CSS grid implementation.
 *
 * ── Coordinates ──────────────────────────────────────────────────────────
 * `getScreenCTM` returns `translate(-scrollLeft, -scrollTop)` accumulated
 * over the svg's ancestors, so at scroll 0 svg coordinates equal client
 * coordinates: a drag test can dispatch `clientX: 140` and expect `_bar.x` to
 * land on 140 (before column snapping). After a scroll the CTM shifts with
 * it, which is what a real browser does. The convention matters beyond
 * deltas: `useBarDrag.ts` consumes `startSvgX` ABSOLUTELY for progress drags
 * (`newProgressX = clamp(startSvgX + deltaX, barX, barX + barWidth)`).
 *
 * The scroll area's own offset from the window is modelled as (0, 0) — there
 * is no layout to derive it from — so a dispatched `clientX` means "px from
 * the scroll area's content origin", NOT "px from the window's left edge past
 * the resource column".
 *
 * `scrollLeft`/`scrollTop` are backed by a real per-element store, so
 * assignments stick and `Element.scrollTo` moves them. Two consequences:
 *   - Nothing dispatches a `scroll` event. jsdom does not, and real browsers
 *     do it asynchronously. A test that wants `GanttContainer.handleScroll`
 *     (and therefore the `scrollLeft()` signal that feeds virtualization and
 *     `range: 'visible'` exports) to observe the new offset must dispatch
 *     `new Event('scroll')` on `.gantt-scroll-area` itself.
 *   - There is no upper clamp. Real browsers clamp to
 *     `scrollWidth - clientWidth`; jsdom has no layout to derive `scrollWidth`
 *     from, so only negative assignments are clamped (to 0, as browsers do).
 *
 * ── Known divergences from a browser ─────────────────────────────────────
 *  1. `SyncResizeObserver` fires the callback synchronously from `observe()`,
 *     whereas a real `ResizeObserver` is asynchronous. It also never fires
 *     again, so a viewport CHANGE cannot be driven through this helper —
 *     size the mount up front via `options`, and re-mount to test another
 *     size.
 *  2. One mount at a time. `useDrag.ts` resolves the drag svg with a
 *     document-wide `querySelector('svg.gantt')`, and `<Gantt>` publishes its
 *     stores on `window.__gantt*` — a second live chart would steal both.
 *     `mountGantt` therefore THROWS if a previous mount has not been
 *     disposed. Dispose (or `afterEach`) between mounts.
 *  3. No real layout: `getBoundingClientRect`, `offsetWidth`, `scrollWidth`
 *     and friends are still jsdom's zeros. Only the properties listed above
 *     are modelled.
 *  4. The post-mount check below only proves that `<Gantt>` ran its component
 *     body — the globals are published there, synchronously, before any DOM
 *     exists. It catches "the component threw before publishing", not "the
 *     chart mounted but rendered nothing". Assert on rendered nodes for that.
 *
 * `render` comes from `@solidjs/web` under SolidJS 2.0 — `solid-js` no
 * longer exports it.
 */
import type { ComponentProps } from 'solid-js';
import { render } from '@solidjs/web';
import { Gantt } from '../../src/components/Gantt';
import { GanttProvider } from '../../src/contexts/GanttStores';
import type { TaskStore } from '../../src/stores/taskStore';
import type { GanttConfigStore } from '../../src/stores/ganttConfigStore';
import type { GanttDateStore } from '../../src/stores/ganttDateStore';
import type { ResourceInput } from '../../src/types';
import { settle } from './settle';

/** Props accepted by `<Gantt>` (the component does not export its own type). */
export type GanttProps = ComponentProps<typeof Gantt>;

export interface MountGanttOptions {
    /** Wrap the chart in `<GanttProvider>` instead of letting it self-create stores. */
    provider?: boolean;
    /** Options for the provider's stores. Defaults to the chart's own `options`. */
    providerOptions?: Record<string, unknown>;
    /** Resources for the provider's store. Defaults to the chart's own `resources`. */
    providerResources?: ResourceInput[];
    /**
     * Reported `clientWidth` of the MOUNT CONTAINER. Default 1200.
     * `.gantt-scroll-area` reports this minus the resource column width.
     */
    clientWidth?: number;
    /**
     * Reported `clientHeight` of the MOUNT CONTAINER. Default 800.
     * `.gantt-scroll-area` reports this minus the header height.
     */
    clientHeight?: number;
}

/**
 * The three stores `<Gantt>` publishes on `window` (see the `declare global`
 * block in Gantt.tsx). The resource store is deliberately absent: the
 * component does not publish it, and the shape stays the same whether or not
 * `provider: true` was used.
 */
export interface MountedStores {
    taskStore: TaskStore;
    ganttConfig: GanttConfigStore;
    dateStore: GanttDateStore;
}

export interface MountedGantt {
    /** The `<div>` appended to `document.body` that the chart rendered into. */
    container: HTMLDivElement;
    stores: MountedStores;
    /** Dispose the root, detach the container, and remove the DOM stubs. Idempotent. */
    dispose: () => void;
}

const DEFAULT_CLIENT_WIDTH = 1200;
const DEFAULT_CLIENT_HEIGHT = 800;

interface StubSize {
    width: number;
    height: number;
}

// Mount containers whose size is stubbed. Descendants derive theirs by
// walking back down through the grid templates the component rendered.
const sizeOverrides = new WeakMap<Element, StubSize>();

// Per-element scroll offsets, so assignments stick the way they do in a
// browser (jsdom's own scrollLeft/scrollTop setters are silent no-ops).
const scrollOffsets = new WeakMap<Element, { left: number; top: number }>();

function scrollOffsetOf(el: Element): { left: number; top: number } {
    let offset = scrollOffsets.get(el);
    if (!offset) {
        offset = { left: 0, top: 0 };
        scrollOffsets.set(el, offset);
    }
    return offset;
}

interface InlineStyle {
    getPropertyValue(property: string): string;
}

const inlineStyleOf = (el: Element): InlineStyle | undefined =>
    (el as Element & { style?: InlineStyle }).style;

/**
 * First track of an inline `grid-template-*`, in px.
 * `undefined` when the element declares no template at all; 0 when it does
 * but the first track is not a px length (`1fr`, `auto`, `minmax(...)`).
 */
function firstTrackPx(el: Element, property: string): number | undefined {
    const value = inlineStyleOf(el)?.getPropertyValue(property);
    if (!value) return undefined;
    const match = /^\s*(-?\d+(?:\.\d+)?)px/.exec(value);
    return match ? Number(match[1]) : 0;
}

/** Leading integer of an inline `grid-column` / `grid-row`, if any. */
function gridLine(el: Element, property: string): number | undefined {
    const value = inlineStyleOf(el)?.getPropertyValue(property);
    if (!value) return undefined;
    const match = /^\s*(\d+)/.exec(value);
    return match ? Number(match[1]) : undefined;
}

/** Size of one axis of a grid child, given its parent's axis size. */
function trackSize(
    parentSize: number,
    firstTrack: number | undefined,
    line: number | undefined,
): number {
    if (firstTrack === undefined || line === undefined) return parentSize;
    if (line === 1) return firstTrack;
    return Math.max(0, parentSize - firstTrack);
}

/**
 * The size this element would report in a browser, derived from the mount
 * container's stubbed size and the grid templates the component rendered
 * between them. `undefined` for anything outside a stubbed mount.
 */
function effectiveSize(el: Element): StubSize | undefined {
    const path: Element[] = [];
    let node: Element | null = el;
    let base: StubSize | undefined;

    while (node) {
        const size = sizeOverrides.get(node);
        if (size) {
            base = size;
            break;
        }
        path.push(node);
        node = node.parentElement;
    }
    if (!base || !node) return undefined;

    let { width, height } = base;
    let parent: Element = node;
    for (let i = path.length - 1; i >= 0; i--) {
        const child = path[i]!;
        width = trackSize(
            width,
            firstTrackPx(parent, 'grid-template-columns'),
            gridLine(child, 'grid-column'),
        );
        height = trackSize(
            height,
            firstTrackPx(parent, 'grid-template-rows'),
            gridLine(child, 'grid-row'),
        );
        parent = child;
    }
    return { width, height };
}

/** Accumulated scroll of every ancestor, as a browser's screen CTM sees it. */
function ancestorScroll(el: Element): { left: number; top: number } {
    let left = 0;
    let top = 0;
    let node: Element | null = el.parentElement;
    while (node) {
        const offset = scrollOffsets.get(node);
        if (offset) {
            left += offset.left;
            top += offset.top;
        }
        node = node.parentElement;
    }
    return { left, top };
}

function makeResizeObserverEntry(target: Element): ResizeObserverEntry {
    const { width, height } = effectiveSize(target) ?? {
        width: 0,
        height: 0,
    };
    const rect = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({ width, height }),
    };
    return {
        target,
        contentRect: rect,
        borderBoxSize: [{ inlineSize: width, blockSize: height }],
        contentBoxSize: [{ inlineSize: width, blockSize: height }],
        devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }],
    } as unknown as ResizeObserverEntry;
}

/**
 * Synchronous ResizeObserver: fires the callback once on `observe` with the
 * modelled size. Real observers are async, but the component reads the size
 * in `onSettled` (GanttContainer.tsx:142) and hands it straight to
 * `onContainerReady`, so firing inline
 * is what makes the viewport non-zero before the first paint is measured.
 */
// Spelled out rather than using lib.dom's `ResizeObserverCallback`: that name
// is type-only, so `no-undef` (which only knows runtime globals) rejects it.
type ResizeCallback = (
    entries: ResizeObserverEntry[],
    observer: ResizeObserver,
) => void;

class SyncResizeObserver {
    private readonly callback: ResizeCallback;
    private readonly targets = new Set<Element>();

    constructor(callback: ResizeCallback) {
        this.callback = callback;
    }

    observe(target: Element): void {
        this.targets.add(target);
        this.callback(
            [makeResizeObserverEntry(target)],
            this as unknown as ResizeObserver,
        );
    }

    unobserve(target: Element): void {
        this.targets.delete(target);
    }

    disconnect(): void {
        this.targets.clear();
    }
}

/** A 2D affine matrix with the sliver of `DOMMatrix` that `useDrag` uses. */
interface StubMatrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
    inverse: () => StubMatrix;
}

function makeMatrix(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
): StubMatrix {
    return {
        a,
        b,
        c,
        d,
        e,
        f,
        inverse(): StubMatrix {
            const det = a * d - b * c;
            if (det === 0) return makeMatrix(1, 0, 0, 1, 0, 0);
            return makeMatrix(
                d / det,
                -b / det,
                -c / det,
                a / det,
                (c * f - d * e) / det,
                (b * e - a * f) / det,
            );
        },
    };
}

// ── Stub installation ───────────────────────────────────────────────────────
// Every stub is installed unconditionally, and the previous own-property
// descriptor (or its absence) is recorded so teardown restores exactly what
// was there before — including anything a future jsdom starts shipping.

interface SavedProperty {
    owner: object;
    key: string;
    previous: PropertyDescriptor | undefined;
}

let stubsInstalled = false;
const savedProperties: SavedProperty[] = [];

function overrideProperty(
    owner: object,
    key: string,
    descriptor: PropertyDescriptor,
): PropertyDescriptor | undefined {
    const previous = Object.getOwnPropertyDescriptor(owner, key);
    savedProperties.push({ owner, key, previous });
    Object.defineProperty(owner, key, { configurable: true, ...descriptor });
    return previous;
}

function installDomStubs(): void {
    if (stubsInstalled) return;
    stubsInstalled = true;

    const previousClientWidth = overrideProperty(
        Element.prototype,
        'clientWidth',
        {
            get(this: Element): number {
                const size = effectiveSize(this);
                if (size) return size.width;
                return (previousClientWidth?.get?.call(this) as number) ?? 0;
            },
        },
    );

    const previousClientHeight = overrideProperty(
        Element.prototype,
        'clientHeight',
        {
            get(this: Element): number {
                const size = effectiveSize(this);
                if (size) return size.height;
                return (previousClientHeight?.get?.call(this) as number) ?? 0;
            },
        },
    );

    overrideProperty(Element.prototype, 'scrollLeft', {
        get(this: Element): number {
            return scrollOffsetOf(this).left;
        },
        set(this: Element, value: number): void {
            scrollOffsetOf(this).left = Math.max(0, Number(value) || 0);
        },
    });

    overrideProperty(Element.prototype, 'scrollTop', {
        get(this: Element): number {
            return scrollOffsetOf(this).top;
        },
        set(this: Element, value: number): void {
            scrollOffsetOf(this).top = Math.max(0, Number(value) || 0);
        },
    });

    overrideProperty(Element.prototype, 'scrollTo', {
        writable: true,
        value: function scrollTo(
            this: Element,
            first?: number | { left?: number; top?: number },
            second?: number,
        ): void {
            // No `scroll` event: jsdom never fires one and browsers fire it
            // asynchronously. Tests that need `handleScroll` dispatch their own.
            if (typeof first === 'object' && first !== null) {
                if (first.left !== undefined) this.scrollLeft = first.left;
                if (first.top !== undefined) this.scrollTop = first.top;
                return;
            }
            if (typeof first === 'number') this.scrollLeft = first;
            if (typeof second === 'number') this.scrollTop = second;
        },
    });

    overrideProperty(SVGSVGElement.prototype, 'createSVGPoint', {
        writable: true,
        value: function createSVGPoint(): DOMPoint {
            return {
                x: 0,
                y: 0,
                matrixTransform(
                    this: { x: number; y: number },
                    m: StubMatrix,
                ): { x: number; y: number } {
                    return {
                        x: m.a * this.x + m.c * this.y + m.e,
                        y: m.b * this.x + m.d * this.y + m.f,
                    };
                },
            } as unknown as DOMPoint;
        },
    });

    overrideProperty(SVGSVGElement.prototype, 'getScreenCTM', {
        writable: true,
        value: function getScreenCTM(this: SVGSVGElement): DOMMatrix {
            // svg user units -> client px. Unscaled, shifted by the scroll of
            // every ancestor, so at scroll 0 this is the identity.
            const scroll = ancestorScroll(this);
            return makeMatrix(
                1,
                0,
                0,
                1,
                -scroll.left,
                -scroll.top,
            ) as unknown as DOMMatrix;
        },
    });

    overrideProperty(globalThis, 'ResizeObserver', {
        writable: true,
        value: SyncResizeObserver as unknown as typeof ResizeObserver,
    });
}

function uninstallDomStubs(): void {
    if (!stubsInstalled) return;
    stubsInstalled = false;

    for (let i = savedProperties.length - 1; i >= 0; i--) {
        const { owner, key, previous } = savedProperties[i]!;
        if (previous) {
            Object.defineProperty(owner, key, previous);
        } else {
            delete (owner as Record<string, unknown>)[key];
        }
    }
    savedProperties.length = 0;
}

/** Whether a mount is currently live. See divergence 2 in the header comment. */
let mountLive = false;

/**
 * Render `<Gantt {...props} />` into a fresh container attached to
 * `document.body` and return it with the published stores.
 *
 * ONE MOUNT AT A TIME — throws if a previous mount is still live. Always
 * dispose (`afterEach`/`onCleanup`); the DOM stubs are global and are only
 * removed when the live mount is disposed.
 */
export function mountGantt(
    props: GanttProps,
    options: MountGanttOptions = {},
): MountedGantt {
    if (mountLive) {
        throw new Error(
            'mountGantt: a previous mount is still live. <Gantt> publishes its ' +
                'stores on window.__gantt* and useDrag resolves the drag svg with a ' +
                'document-wide querySelector("svg.gantt"), so two live charts ' +
                'interfere. Dispose the first mount before mounting another.',
        );
    }

    const container = document.createElement('div');
    container.className = 'gantt-test-root';
    sizeOverrides.set(container, {
        width: options.clientWidth ?? DEFAULT_CLIENT_WIDTH,
        height: options.clientHeight ?? DEFAULT_CLIENT_HEIGHT,
    });
    document.body.appendChild(container);

    installDomStubs();

    // Clear first so a failed mount cannot hand back a previous mount's stores.
    delete window.__ganttTaskStore;
    delete window.__ganttConfig;
    delete window.__ganttDateStore;

    let disposeRoot: (() => void) | undefined;
    let disposed = false;
    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        mountLive = false;
        disposeRoot?.();
        container.remove();
        sizeOverrides.delete(container);
        delete window.__ganttTaskStore;
        delete window.__ganttConfig;
        delete window.__ganttDateStore;
        uninstallDomStubs();
    };

    mountLive = true;

    try {
        disposeRoot = render(() => {
            if (!options.provider) return <Gantt {...props} />;
            return (
                <GanttProvider
                    options={options.providerOptions ?? props.options}
                    resources={options.providerResources ?? props.resources}
                >
                    <Gantt {...props} />
                </GanttProvider>
            );
        }, container);
    } catch (error) {
        dispose();
        throw error;
    }

    settle();

    const taskStore = window.__ganttTaskStore;
    const ganttConfig = window.__ganttConfig;
    const dateStore = window.__ganttDateStore;
    if (!taskStore || !ganttConfig || !dateStore) {
        dispose();
        throw new Error(
            'mountGantt: <Gantt> did not publish its stores on window — ' +
                'the component body threw before reaching the publish site.',
        );
    }

    return {
        container,
        stores: { taskStore, ganttConfig, dateStore },
        dispose,
    };
}

export default mountGantt;
