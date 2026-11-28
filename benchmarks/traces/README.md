# Performance profiling

Use the built demos for browser timing measurements.
The build includes `perf.html`, `perf-isolate.html`, and `experiments.html`.
Use the development server for the other [demo pages](../../docs/DEMOS.md).

## Run a browser benchmark

From the repository root, build the benchmark pages.

```bash
pnpm build:demo
```

Keep Vite preview running in a separate terminal. The matrix scripts use port 5174.

```bash
pnpm exec vite preview --config config/vite/demo.js --port 5174 --strictPort
```

Vite preview serves both `/examples/experiments` and `/examples/experiments.html` without a redirect.
If you use the external `serve` package, use extensionless URLs because its redirects can drop query parameters.
Python's static server needs the `.html` extension.

For automatic browser traces, install the external `chrome-devtools-cli` tool and Chrome.
The benchmark scripts expect `perf.mjs` at the path below.
The project dependencies and build do not install that file.
Run the tool on a machine with a desktop session for headed Chrome.

```bash
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs \
  'http://localhost:5174/examples/perf-isolate?bar=nochildren&test=horizontal' \
  --iterations 3 --warmup 1 --duration 3000 --output /tmp/gantt-isolate.json
```

See [the demo reference](../../docs/DEMOS.md#feature-isolation) for the isolation switches.
See [the Experiments guide](../../docs/EXPERIMENTS.md) for the variant selectors and stress tests.

### Benchmark commands

| Command | Workload |
|---|---|
| `pnpm bench:browser` | Four bar patterns, two scroll directions, and five measured runs per case. |
| `pnpm bench:browser:virt` | `combined` and `xySplit`, two scroll directions, and five measured runs per case. |
| `pnpm bench:browser:matrix` | Two bar patterns, three filters, two directions, and three measured runs per case. |
| `pnpm bench` | Constraint engine on a 200-task linear chain. Runs in Node. |
| `pnpm bench:all` | Constraint engine on all preset datasets. Runs in Node. |
| `pnpm bench:scaling` | Constraint engine at several dependency counts. Runs in Node. |

Each browser matrix case has one warmup run and a 3-second trace per measured run.
Some versions of the external profiler wait about a minute after saving results while their DevTools command timers expire.
The matrix scripts write fixed names in `benchmarks/traces/runs/`.
Use a scratch worktree if you want to keep the tracked results intact.
The Node benchmarks do not use Vite preview or Chrome.

## Compare two builds

The paired runner alternates which build goes first in each round.
The runner requires Bash, Python 3 for the comparison, and a Linux host for its machine-load log.
Use a different build directory for each variant.
If you need the dense fixture, generate the same data in both scratch worktrees before building.

```bash
pnpm generate:calendar --tasks=10000 --resources=100 --dense
pnpm build:demo
```

Serve each build in a separate terminal. Replace `../variant-worktree` with the path to the other checkout.

```bash
python3 -m http.server 5178 --bind 127.0.0.1 --directory dist-demo
python3 -m http.server 5179 --bind 127.0.0.1 --directory ../variant-worktree/dist-demo
```

Run the comparison in the checkout that will hold the results.
Choose a new label to collect new traces. The runner skips nonempty result files with the same label.

```bash
benchmarks/scripts/ab-blocks.sh eager-vs-variant 5178 5179 3
python3 benchmarks/scripts/ab-compare.py benchmarks/traces/runs/ab/eager-vs-variant eager variant
```

The default scenarios scroll horizontally in the isolation and Experiments pages.
Use `SCENARIOS` to override them. Each entry has the form `name|path` or `name|path|click-selector`.
Separate entries with semicolons. The path starts after `/examples/`.

```bash
SCENARIOS='perf-h|perf.html|button:nth-of-type(2);exp-h|experiments.html?variant=baseline&virt=combined&test=horizontal' \
  benchmarks/scripts/ab-blocks.sh perf-pair 5178 5179 3
```

In `perf.html`, the second button starts horizontal scrolling. The first button reprocesses the existing fixture.
Read `run.log` for failures and machine load before comparing the results.

Run one browser profiler at a time.
The matrix and paired scripts use the profiler's Chrome debugging port.
The standalone memo and drag scripts use private ports but still compete for CPU and display resources.

## References

- [Analysis and benchmark results](./ANALYSIS.md)
- [Investigation history](./HISTORY.md)
- [Repository tooling and testing](../../CLAUDE.md)
