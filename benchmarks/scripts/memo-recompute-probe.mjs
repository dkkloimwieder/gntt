// E4.5 memo-recompute probe (benchmarks/scripts/memo-recompute-probe.mjs): counts TestBarBaseline `t` memo recomputes per
// scroll step on the experiments page, eager vs lazy, with the 10K dataset.
//
// Launches its OWN Chrome (never port 9222, never touches the user's browser)
// and its own python3 http.server for dist-demo-10k.
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
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

// usage: node benchmarks/scripts/memo-recompute-probe.mjs <dist-dir> [out.json]
//   <dist-dir>  a demo build (e.g. dist-demo-10k) whose experiments page carries
//               the E4.5 instrumentation (window.__memoStats, ?lazy=1)
//   [out.json]  default ./memo-recompute-probe.json
const DIST = process.argv[2];
if (!DIST) {
    console.error('usage: node memo-recompute-probe.mjs <dist-dir> [out.json]');
    process.exit(2);
}
const OUT = process.argv[3] || 'memo-recompute-probe.json';
const PROFILE = mkdtempSync(join(tmpdir(), 'memo-probe-'));

const CDP_PORT = 9400 + Math.floor(Math.random() * 300);
const HTTP_PORT = 8400 + Math.floor(Math.random() * 300);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (path) =>
    new Promise((res, rej) => {
        const q = httpRequest(
            { hostname: '127.0.0.1', port: CDP_PORT, path },
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

// ── static server ────────────────────────────────────────────────────────────
const server = spawn(
    'python3',
    ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'],
    { cwd: DIST, stdio: 'ignore', detached: true },
);
server.on('error', (e) => {
    console.error(`python3 http.server failed to start: ${e.message}`);
    process.exit(1);
});
const killServer = () => {
    try {
        process.kill(-server.pid);
    } catch {
        try {
            server.kill('SIGKILL');
        } catch {}
    }
};

// wait for the static server
for (let i = 0; i < 60; i++) {
    const ok = await new Promise((res) => {
        const q = httpRequest(
            {
                hostname: '127.0.0.1',
                port: HTTP_PORT,
                path: '/examples/experiments.html',
            },
            (r) => {
                r.resume();
                res(r.statusCode === 200);
            },
        );
        q.on('error', () => res(false));
        q.end();
    });
    if (ok) break;
    if (i === 59) {
        killServer();
        throw new Error(
            `no /examples/experiments.html on :${HTTP_PORT} from ${DIST} — is it a demo build dir?`,
        );
    }
    await sleep(250);
}

// ── chrome ───────────────────────────────────────────────────────────────────
const chrome = spawn(
    process.env.CHROME || '/usr/bin/google-chrome',
    [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--window-size=1600,1000',
        'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
);
chrome.on('error', (e) => {
    console.error(`google-chrome failed to start: ${e.message}`);
    killServer();
    process.exit(1);
});
const killChrome = () => {
    try {
        process.kill(-chrome.pid);
    } catch {
        try {
            chrome.kill('SIGKILL');
        } catch {}
    }
};

for (let i = 0; i < 80; i++) {
    try {
        await getJson('/json/version');
        break;
    } catch {
        await sleep(500);
    }
}
const target = (await getJson('/json/list')).find((t) => t.type === 'page');
const client = new CDPClient();
await client.connectWebSocket(target.webSocketDebuggerUrl);
await client.send('Page.enable');
await client.send('Runtime.enable');

const consoleLog = [];
client.on('Runtime.exceptionThrown', (e) =>
    consoleLog.push(
        'EXC ' +
            (e.exceptionDetails?.exception?.description || '')
                .split('\n')[0]
                .slice(0, 200),
    ),
);
client.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'log') return;
    consoleLog.push(
        e.type.toUpperCase() +
            ' ' +
            e.args
                .map((a) => a.value ?? a.description ?? '')
                .join(' ')
                .slice(0, 200),
    );
});

const ev = async (expression) => {
    const r = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
    });
    if (r.exceptionDetails)
        throw new Error(
            r.exceptionDetails.exception?.description?.slice(0, 400) ||
                'eval failed',
        );
    return r.result.value;
};

// Two rAFs + a macrotask: the scroll event dispatches, Solid's deferred write
// flushes, and the re-render lands before we sample the counter.
const SETTLE = `new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 0))))`;

async function runArm(lazy) {
    const url =
        `http://127.0.0.1:${HTTP_PORT}/examples/experiments.html` +
        `?variant=baseline&virt=combined` +
        (lazy ? '&lazy=1' : '');
    consoleLog.length = 0;
    await client.send('Page.navigate', { url });

    // wait for bars
    let domBars = 0;
    for (let i = 0; i < 80; i++) {
        await sleep(250);
        try {
            domBars = await ev(
                `document.querySelectorAll('[data-testbar="baseline"]').length`,
            );
        } catch {
            domBars = 0;
        }
        if (domBars > 0) break;
    }
    await sleep(1000);

    const stats0 = await ev(
        `JSON.stringify({ lazy: window.__memoStats.lazy, bars: window.__memoStats.bars, recomputes: window.__memoStats.recomputes })`,
    );
    const mount = JSON.parse(stats0);

    const geom = await ev(`(() => {
        const el = document.querySelector('.gantt-scroll-area');
        return JSON.stringify({
            clientWidth: el.clientWidth, clientHeight: el.clientHeight,
            scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
        });
    })()`);

    const scrollArm = async (axis, stepPx, steps) => {
        // reset scroll position + counter
        await ev(`(async () => {
            const el = document.querySelector('.gantt-scroll-area');
            el.scrollLeft = 0; el.scrollTop = 0;
            await ${SETTLE};
            window.__memoStats.reset();
        })()`);
        await sleep(300);
        await ev(`window.__memoStats.reset()`);

        const perStep = [];
        let prev = 0;
        for (let i = 0; i < steps; i++) {
            const prop = axis === 'horizontal' ? 'scrollLeft' : 'scrollTop';
            const now = await ev(`(async () => {
                const el = document.querySelector('.gantt-scroll-area');
                el.${prop} += ${stepPx};
                await ${SETTLE};
                return window.__memoStats.recomputes;
            })()`);
            perStep.push(now - prev);
            prev = now;
        }
        const onScreen = await ev(
            `document.querySelectorAll('[data-testbar="baseline"]').length`,
        );
        const barsAfter = await ev(`window.__memoStats.bars`);
        const total = prev;
        return {
            axis,
            stepPx,
            steps,
            total,
            perStep,
            meanPerStep: +(total / steps).toFixed(1),
            onScreenBarsAfter: onScreen,
            barsCreatedCumulative: barsAfter,
        };
    };

    const horizontal = await scrollArm('horizontal', 100, 30);
    const vertical = await scrollArm('vertical', 60, 30);

    return {
        arm: lazy ? 'lazy' : 'eager',
        url,
        lazyFlagSeenByPage: mount.lazy,
        domBarsAtMount: domBars,
        barsCreatedAtMount: mount.bars,
        recomputesAtMount: mount.recomputes,
        scrollAreaGeometry: JSON.parse(geom),
        horizontal,
        vertical,
        console: consoleLog.slice(0, 20),
    };
}

let out;
try {
    const eager = await runArm(false);
    const lazyArm = await runArm(true);
    out = {
        generatedAt: new Date().toISOString(),
        dist: DIST,
        dataset:
            'whatever src/data/generated/calendar.json held when <dist-dir> was built (E4.5: regenerated with --tasks=10000 --resources=100 --dense)',
        page: 'examples/experiments.html?variant=baseline&virt=combined',
        headless: true,
        note: 'counts, not timings: the headless viewport decides how many bars exist, so compare arms within one run only',
        cdpPort: CDP_PORT,
        httpPort: HTTP_PORT,
        eager,
        lazy: lazyArm,
    };
    writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

    const row = (a) =>
        `  ${a.arm.padEnd(6)} | H total ${String(a.horizontal.total).padStart(7)} (${String(a.horizontal.meanPerStep).padStart(7)}/step) | V total ${String(a.vertical.total).padStart(7)} (${String(a.vertical.meanPerStep).padStart(7)}/step) | bars created ${a.barsCreatedAtMount} @mount, ${a.vertical.barsCreatedCumulative} cumulative | on-screen ${a.domBarsAtMount} @mount, ${a.horizontal.onScreenBarsAfter} after H, ${a.vertical.onScreenBarsAfter} after V`;
    console.log(
        '=== E4.5 memo recompute probe (10K, experiments/baseline) ===',
    );
    console.log(
        `  viewport scrollArea ${eager.scrollAreaGeometry.clientWidth}x${eager.scrollAreaGeometry.clientHeight}, content ${eager.scrollAreaGeometry.scrollWidth}x${eager.scrollAreaGeometry.scrollHeight}`,
    );
    console.log(row(eager));
    console.log(row(lazyArm));
    console.log(
        `  lazy flag seen by page: eager=${eager.lazyFlagSeenByPage} lazy=${lazyArm.lazyFlagSeenByPage}`,
    );
    console.log(
        `  H per-step (eager, first 10): ${eager.horizontal.perStep.slice(0, 10).join(' ')}`,
    );
    console.log(
        `  H per-step (lazy,  first 10): ${lazyArm.horizontal.perStep.slice(0, 10).join(' ')}`,
    );
    console.log(
        `  V per-step (eager, first 10): ${eager.vertical.perStep.slice(0, 10).join(' ')}`,
    );
    console.log(
        `  V per-step (lazy,  first 10): ${lazyArm.vertical.perStep.slice(0, 10).join(' ')}`,
    );
    console.log(`  console (eager): ${JSON.stringify(eager.console)}`);
    console.log(`  console (lazy):  ${JSON.stringify(lazyArm.console)}`);
    console.log(`  wrote ${OUT}`);
} catch (e) {
    console.error('PROBE FAILED:', e.message);
    console.error('console log:', consoleLog.slice(0, 20));
    process.exitCode = 1;
} finally {
    await client.send('Browser.close').catch(() => {});
    killChrome();
    killServer();
    try {
        if (existsSync(PROFILE))
            rmSync(PROFILE, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
}
process.exit(process.exitCode || 0);
