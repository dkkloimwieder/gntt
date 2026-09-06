#!/usr/bin/env node
/**
 * drag-bench.mjs — measure the SCRIPT cost of drag gestures on a built page.
 *
 * Scroll benchmarks miss the failure mode that lazy memos introduce:
 * auto-dispose churn on handler-only reads. Drag is the gesture that
 * exercises those reads, so it has to be measured directly.
 *
 * Usage (the URL is the only positional and must start with http):
 *   node benchmarks/scripts/drag-bench.mjs <url> [--drags N=12] [--out file.json] [--headless] [--quiet]
 *
 * Launches its OWN Chrome (headed by default, like perf.mjs — headless has no
 * real rendering and the numbers are meaningless) on a private port in the
 * 9400+ range with a throwaway --user-data-dir. Never touches port 9222 and
 * never kills anything it did not spawn.
 */

import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The CDP client ships with the chrome-devtools-cli skill (same dependency
// as perf.mjs, which ab-blocks.sh drives).
const { CDPClient } = await import(
    pathToFileURL(
        join(
            homedir(),
            '.claude/skills/chrome-devtools-cli/scripts/lib/cdp-client.mjs',
        ),
    ).href
);

const CHROME = process.env.CHROME || '/usr/bin/google-chrome';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const url = argv.find((a) => /^https?:\/\//.test(a));
if (!url) {
    console.error(
        'usage: node drag-bench.mjs <url> [--drags N] [--out file.json] [--headless] [--quiet]',
    );
    process.exit(2);
}
const flag = (name, dflt) => {
    const hit = argv.find(
        (a) => a === `--${name}` || a.startsWith(`--${name}=`),
    );
    if (!hit) return dflt;
    if (hit.includes('=')) return hit.split('=').slice(1).join('=');
    const i = argv.indexOf(hit);
    const next = argv[i + 1];
    return next && !next.startsWith('--') ? next : true;
};
const DRAGS = Number(flag('drags', 12)) || 12;
const OUT = typeof flag('out', null) === 'string' ? flag('out', null) : null;
const HEADLESS =
    argv.includes('--headless') || flag('headless', false) === 'true';

// Private port well away from the user's 9222 session.
const PORT = 9400 + Math.floor(Math.random() * 480); // 9400..9879
if (PORT === 9222) throw new Error('refusing to use port 9222');
const PROFILE = mkdtempSync(join(tmpdir(), `drag-bench-${PORT}-`));

const VERBOSE = flag('quiet', false) === false;
const t0 = Date.now();
const dbg = (...a) => {
    if (VERBOSE)
        console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
    const s = xs
        .filter((v) => Number.isFinite(v))
        .slice()
        .sort((a, b) => a - b);
    if (!s.length) return null;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v, d = 2) =>
    v === null ? null : Math.round(v * 10 ** d) / 10 ** d;

const getJson = (path) =>
    new Promise((res, rej) => {
        const q = httpRequest(
            { hostname: '127.0.0.1', port: PORT, path },
            (r) => {
                let d = '';
                r.on('data', (c) => (d += c));
                r.on('end', () => {
                    try {
                        res(JSON.parse(d));
                    } catch (e) {
                        rej(e);
                    }
                });
            },
        );
        q.on('error', rej);
        q.end();
    });

// Which ?bar= / ?variant= is under test — recorded in the output.
const variant = (() => {
    try {
        const u = new URL(url);
        return (
            u.searchParams.get('bar') ||
            u.searchParams.get('variant') ||
            'default'
        );
    } catch {
        return 'default';
    }
})();

// ── page-side helper, installed before any page script runs ─────────────────
// Collects long tasks, and knows how to find bar elements on either harness:
//   - production / showcase Gantt: elements carrying [data-id]
//   - perf-isolate + experiments:  absolutely positioned divs whose inline
//     transform is a translate() (that is exactly how every Bar variant in
//     GanttPerfIsolate.tsx and every TestBar* in GanttExperiments.tsx paints
//     itself; the grid is an <svg>, the bars layer / content sizer carry no
//     translate, so this selects bars and nothing else).
const PAGE_HELPER = `
(() => {
  const S = (window.__dragbench = window.__dragbench || {});
  S.lt = S.lt || [];
  if (!S.obs) {
    try {
      S.obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) S.lt.push({ start: e.startTime, dur: e.duration });
      });
      S.obs.observe({ entryTypes: ['longtask'] });
    } catch (e) { S.obsError = String(e); }
  }
  S.isBar = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const st = el.style;
    if (st.position !== 'absolute') return false;
    const tr = st.transform || '';
    if (!/^translate\\(/.test(tr)) return false;
    const w = parseFloat(st.width), h = parseFloat(st.height);
    return w >= 4 && h >= 4 && h <= 80;
  };
  S.bars = () => {
    let list = Array.from(document.querySelectorAll('[data-id]')).filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    if (!list.length) list = Array.from(document.querySelectorAll('div')).filter(S.isBar);
    return list;
  };
  S.visibleBars = () => {
    const W = window.innerWidth, H = window.innerHeight;
    return S.bars().filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 12 && r.height >= 6 && r.left >= 0 && r.top >= 0 &&
             r.right <= W && r.bottom <= H;
    });
  };
  S.tx = (el) => {
    const m = /translate\\(\\s*(-?[\\d.]+)px[, ]\\s*(-?[\\d.]+)px/.exec(el.style.transform || '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  };
  // Best-effort read of the store-side position, when a demo exposes one.
  S.storeX = (id) => {
    const cands = [window.__tasks, window.__taskStore && window.__taskStore.tasks, window.tasks];
    for (const c of cands) {
      const t = c && c[id];
      if (t) {
        if (typeof t.startHours === 'number') return t.startHours;
        if (t._bar && typeof t._bar.x === 'number') return t._bar.x;
      }
    }
    return null;
  };
  S.snap = (el) => {
    const r = el.getBoundingClientRect();
    const t = S.tx(el);
    const id = el.dataset ? (el.dataset.id || null) : null;
    return { rectX: r.x, rectY: r.y, w: r.width, h: r.height,
             tx: t && t.x, ty: t && t.y, cursor: el.style.cursor || null,
             id, storeX: id ? S.storeX(id) : null };
  };
})();
`;

// ── launch ──────────────────────────────────────────────────────────────────
const chromeArgs = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1600,1000',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
];
if (HEADLESS) chromeArgs.push('--headless=new', '--disable-gpu');
chromeArgs.push('about:blank');

const chrome = spawn(CHROME, chromeArgs, { detached: true, stdio: 'ignore' });
let closed = false;
const shutdown = async (client) => {
    if (closed) return;
    closed = true;
    try {
        if (client) await client.send('Browser.close');
    } catch {}
    await sleep(300);
    try {
        process.kill(-chrome.pid, 'SIGTERM'); // only our own process group
    } catch {}
    await sleep(200);
    try {
        process.kill(-chrome.pid, 'SIGKILL');
    } catch {}
    try {
        if (existsSync(PROFILE))
            rmSync(PROFILE, { recursive: true, force: true });
    } catch {}
};

let client = null;
const errors = [];

try {
    let ok = false;
    for (let i = 0; i < 60; i++) {
        try {
            await getJson('/json/version');
            ok = true;
            break;
        } catch {
            await sleep(500);
        }
    }
    if (!ok) throw new Error(`chrome did not open CDP on ${PORT}`);
    dbg('cdp up on', PORT, 'pid', chrome.pid);

    let page = null;
    for (let i = 0; i < 20 && !page; i++) {
        page = (await getJson('/json/list')).find((t) => t.type === 'page');
        if (!page) await sleep(250);
    }
    if (!page) throw new Error('no page target');

    client = new CDPClient();
    await client.connectWebSocket(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Performance.enable');

    client.on('Runtime.exceptionThrown', (e) => {
        errors.push(
            'EXCEPTION ' +
                String(
                    e.exceptionDetails?.exception?.description ||
                        e.exceptionDetails?.text ||
                        '',
                )
                    .split('\n')[0]
                    .slice(0, 240),
        );
    });
    client.on('Runtime.consoleAPICalled', (e) => {
        if (e.type === 'error' || e.type === 'assert') {
            errors.push(
                'CONSOLE ' +
                    e.args
                        .map((a) => a.value ?? a.description ?? '')
                        .join(' ')
                        .slice(0, 240),
            );
        }
    });

    await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: PAGE_HELPER,
    });

    const ev = async (expression) => {
        const r = await client.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (r.exceptionDetails) {
            throw new Error(
                'eval: ' +
                    (r.exceptionDetails.exception?.description ||
                        r.exceptionDetails.text),
            );
        }
        return r.result.value;
    };
    const mouse = (type, x, y) =>
        client.send('Input.dispatchMouseEvent', {
            type,
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: type === 'mouseMoved' ? 0 : 1,
            buttons: type === 'mouseReleased' ? 0 : 1,
        });

    const metrics = async () => {
        const { metrics: m } = await client.send('Performance.getMetrics');
        const g = (n) => (m.find((x) => x.name === n) || { value: 0 }).value;
        return {
            script: g('ScriptDuration'),
            task: g('TaskDuration'),
            layout: g('LayoutDuration'),
            style: g('RecalcStyleDuration'),
        };
    };

    dbg('navigating');
    await client.send('Page.navigate', { url });
    await sleep(1200);
    dbg('navigated');
    // The helper is installed on the new document, but re-inject defensively in
    // case the navigation raced the install.
    await ev(PAGE_HELPER);

    // wait for bars
    let barCount = 0;
    for (let i = 0; i < 80; i++) {
        barCount = await ev('window.__dragbench.visibleBars().length');
        if (barCount > 0) break;
        await sleep(250);
    }
    if (!barCount) throw new Error('no bar elements found after 20s');
    const obsError = await ev('window.__dragbench.obsError || null');
    if (obsError) errors.push('LONGTASK-OBSERVER ' + obsError);
    dbg(
        'bars visible:',
        barCount,
        'longtask observer:',
        obsError ? obsError : 'ok',
    );
    await sleep(600); // let the first paint settle

    const drags = [];
    for (let i = 0; i < DRAGS; i++) {
        // Pick the i-th visible bar, tag it so we can re-find it after the drag.
        const picked = await ev(`(() => {
            const S = window.__dragbench;
            document.querySelectorAll('[data-dragbench]').forEach(e => e.removeAttribute('data-dragbench'));
            const bars = S.visibleBars();
            if (!bars.length) return null;
            const el = bars[${i} % bars.length];
            el.setAttribute('data-dragbench', 'target');
            el.scrollIntoView({ block: 'center', inline: 'center' });
            return { count: bars.length, idx: ${i} % bars.length };
        })()`);
        if (!picked) {
            drags.push({ i, error: 'no visible bars' });
            continue;
        }
        await sleep(250);

        const before = await ev(`(() => {
            const S = window.__dragbench;
            const el = document.querySelector('[data-dragbench="target"]');
            return el ? S.snap(el) : null;
        })()`);
        if (!before) {
            drags.push({ i, error: 'target lost after scrollIntoView' });
            continue;
        }

        const ltBefore = await ev('window.__dragbench.lt.length');
        const m0 = await metrics();

        // centre of the bar, kept off the 6px resize zones at each edge
        const cx =
            before.rectX + Math.min(Math.max(before.w / 2, 10), before.w - 10);
        const cy = before.rectY + before.h / 2;

        await mouse('mouseMoved', cx, cy);
        await sleep(30);
        await mouse('mousePressed', cx, cy);
        await sleep(16);

        let mid = null;
        for (let s = 1; s <= 12; s++) {
            await mouse('mouseMoved', cx + s * 8, cy);
            await sleep(16);
            if (s === 6) {
                mid = await ev(`(() => {
                    const S = window.__dragbench;
                    const el = document.querySelector('[data-dragbench="target"]');
                    return el ? S.snap(el) : null;
                })()`);
            }
        }
        await mouse('mouseReleased', cx + 12 * 8, cy);
        await sleep(150);

        const m1 = await metrics();
        const ltAfter = await ev(`(() => {
            const S = window.__dragbench;
            const n = S.lt.length;
            const slice = S.lt.slice(${ltBefore});
            return { count: slice.length, totalMs: slice.reduce((a, e) => a + e.dur, 0),
                     maxMs: slice.reduce((a, e) => Math.max(a, e.dur), 0), n };
        })()`);

        const after = await ev(`(() => {
            const S = window.__dragbench;
            const el = document.querySelector('[data-dragbench="target"]');
            if (!el) return null;
            const s = S.snap(el);
            el.removeAttribute('data-dragbench');
            return s;
        })()`);

        const dTx =
            after && before && after.tx !== null && before.tx !== null
                ? after.tx - before.tx
                : null;
        const dRect = after && before ? after.rectX - before.rectX : null;
        const dStore =
            after && before && after.storeX !== null && before.storeX !== null
                ? after.storeX - before.storeX
                : null;
        const movedPx = dTx !== null && dTx !== 0 ? dTx : dRect;
        const moved = Boolean(
            (dTx !== null && Math.abs(dTx) > 0.5) ||
            (dStore !== null && Math.abs(dStore) > 1e-6) ||
            (dTx === null && dRect !== null && Math.abs(dRect) > 0.5),
        );
        // Did the drag gesture actually engage, even if the bar is pinned?
        const engaged = Boolean(
            moved ||
            (mid && before && mid.cursor && mid.cursor !== before.cursor) ||
            (mid && ['grabbing', 'ew-resize'].includes(mid && mid.cursor)),
        );

        drags.push({
            i,
            barIndex: picked.idx,
            visibleBars: picked.count,
            scriptMs: round((m1.script - m0.script) * 1000),
            taskMs: round((m1.task - m0.task) * 1000),
            layoutMs: round((m1.layout - m0.layout) * 1000),
            recalcStyleMs: round((m1.style - m0.style) * 1000),
            longTasks: ltAfter.count,
            longTaskMs: round(ltAfter.totalMs),
            longTaskMaxMs: round(ltAfter.maxMs),
            movedPx: movedPx === null ? null : round(movedPx),
            deltaTransformX: dTx === null ? null : round(dTx),
            deltaRectX: dRect === null ? null : round(dRect),
            deltaStoreX: dStore === null ? null : round(dStore, 4),
            moved,
            engaged,
            cursorBefore: before.cursor,
            cursorMidDrag: mid ? mid.cursor : null,
        });
        dbg(
            'drag',
            i,
            'done',
            JSON.stringify(drags[drags.length - 1]).slice(0, 160),
        );
    }

    const good = drags.filter((d) => !d.error);
    const movedCount = good.filter((d) => d.moved).length;
    const result = {
        url,
        variant,
        headless: HEADLESS,
        port: PORT,
        dragsRequested: DRAGS,
        drags,
        median: {
            scriptMs: round(median(good.map((d) => d.scriptMs))),
            taskMs: round(median(good.map((d) => d.taskMs))),
            layoutMs: round(median(good.map((d) => d.layoutMs))),
            recalcStyleMs: round(median(good.map((d) => d.recalcStyleMs))),
            longTaskMs: round(median(good.map((d) => d.longTaskMs))),
            movedPx: round(median(good.map((d) => Math.abs(d.movedPx ?? 0)))),
            moved: movedCount > good.length / 2,
            movedCount,
            movedRate: good.length ? round(movedCount / good.length, 3) : 0,
            engagedCount: good.filter((d) => d.engaged).length,
            n: good.length,
        },
        errors,
    };

    if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result.median, null, 2));
    console.log(
        `variant=${variant} n=${result.median.n} scriptMs=${result.median.scriptMs} taskMs=${result.median.taskMs} layoutMs=${result.median.layoutMs} moved=${result.median.moved} (${movedCount}/${good.length}) errors=${errors.length}`,
    );
    if (errors.length) console.log('errors:', errors.slice(0, 10));
    if (!OUT) console.log(JSON.stringify(result));
    await shutdown(client);
    process.exit(0);
} catch (err) {
    errors.push('HARNESS ' + String(err && err.message ? err.message : err));
    const result = { url, variant, drags: [], median: null, errors };
    if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(JSON.stringify(result, null, 2));
    await shutdown(client);
    process.exit(1);
}
