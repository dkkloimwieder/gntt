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
  --iterations 3 --output perf-traces/runs/my-test.json
```

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
