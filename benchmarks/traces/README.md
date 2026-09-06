# Performance Profiling

## Quick Start

```bash
# Build and serve the demo
pnpm build:demo
npx serve dist-demo -l 5174 &

# Profile with automatic Chrome handling
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs \
  'http://localhost:5174/examples/perf-isolate?bar=nochildren&test=horizontal' \
  --iterations 3 --warmup 1 --duration 3000

# Save results to file
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs \
  'http://localhost:5174/examples/perf-isolate?bar=nochildren&headers=1&test=horizontal' \
  --iterations 3 --output benchmarks/traces/runs/my-test.json
```

> `benchmarks/profiler/**/*.js` is deliberately outside the lint/prettier
> globs (`package.json` covers `benchmarks/constraint/**/*.ts` only): it is
> browser-injected instrumentation kept in plain JS. `node --check` it after
> editing.

---

## Important: URL Format

**Use clean URLs without `.html` extension.** The `serve` package redirects `.html` to clean URLs, stripping query parameters:

```bash
# WRONG - params get stripped via 301 redirect
http://localhost:5174/examples/perf-isolate.html?bar=nochildren&test=horizontal

# CORRECT - params preserved
http://localhost:5174/examples/perf-isolate?bar=nochildren&test=horizontal
```

---

## Common Commands

```bash
# Quick single profile
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url> --duration 3000

# Benchmark with statistics
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url> --iterations 5 --warmup 1

# Profile after clicking an element
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url> --click "#start-btn" --duration 5000
```

---

## Test Harnesses

| URL | Purpose |
|-----|---------|
| `/examples/perf-isolate?bar=nochildren&test=horizontal` | Progressive feature testing |
| `/examples/experiments?variant=baseline&test=horizontal` | Reactive pattern comparison |
| `/examples/perf` | Full Gantt stress test |

### Perf-Isolate Parameters

| Param | Values | Description |
|-------|--------|-------------|
| `bar` | nochildren, combined, minimal, etc. | Bar component variant |
| `grid` | 0, 1 | Show SVG grid |
| `headers` | 0, 1 | Show date headers |
| `resources` | 0, 1 | Show resource column |
| `test` | horizontal, vertical, both | Auto-scroll direction |

---

## See Also

- [ANALYSIS.md](./ANALYSIS.md) - Current best practices and benchmark summaries
- [HISTORY.md](./HISTORY.md) - Investigation logs and historical data
- [CLAUDE.md](../CLAUDE.md) - Full Chrome DevTools CLI reference


## Paired A/B between two builds (`ab-blocks.sh`)

Used for the 1.9 → 2.0 comparison (see ANALYSIS.md, "SolidJS 2.0.0-rc.6 vs
1.9.12") and for memo-laziness experiments (E4.5). Build each variant into its
own output dir, serve both statically, then run blocks that alternate sides:

```bash
# 10K dense dataset (generated, not tracked — restore the file afterwards)
pnpm generate:calendar --tasks=10000 --resources=100 --dense
npx vite build --config config/vite/demo.js --outDir dist-demo-10k   # per variant / worktree
git checkout -- src/data/generated/calendar.json
(cd dist-demo-10k && python3 -m http.server 5178 &)                     # side A
(cd ../variant-worktree/dist-demo-10k && python3 -m http.server 5179 &) # side B
benchmarks/scripts/ab-blocks.sh lazy-vs-eager 5178 5179 3
python3 benchmarks/scripts/ab-compare.py benchmarks/traces/runs/ab/lazy-vs-eager eager lazy
```

A scenario is `name|path` or `name|path|click-selector`; the third field is
passed to `perf.mjs --click`, for pages whose stress test is a button rather
than a `?test=` parameter (perf.html: `button:nth-of-type(2)` is H-Scroll,
`button:nth-of-type(1)` is Reload, which re-mounts the 10K set inside the
trace window):

```bash
SCENARIOS='perf-h|perf.html|button:nth-of-type(2);exp-h|experiments.html?variant=baseline&virt=combined&test=horizontal' \
  benchmarks/scripts/ab-blocks.sh perf-pair 5178 5179 3
```

Only one `perf.mjs` may run at a time (it owns Chrome's port 9222); the runner
waits for an idle profiler before starting. `memo-recompute-probe.mjs` and
`drag-bench.mjs` launch their own Chrome on a private port and are **not**
covered by that guard — do not run them while an `ab-blocks.sh` round is in
flight, they would load the machine the blocks are measuring on. Machine load is logged per block;
under a load average above ~4 the script-time CV was ~30 %, so read the
`run.log` load column before trusting a small delta.
