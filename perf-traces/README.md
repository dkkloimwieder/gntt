# Performance Profiling Workflow

## Prerequisites

Chrome must be running with remote debugging enabled:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile
```

## Profiling Commands

All commands use the chrome-devtools-cli skill located at:
`.claude/skills/chrome-devtools-cli/scripts/`

### Navigate to Test URL

```bash
node .claude/skills/chrome-devtools-cli/scripts/devtools.mjs \
  --browserUrl=http://127.0.0.1:9222 \
  navigate "http://localhost:5173/examples/experiments.html?variant=baseline&test=vertical"
```

URL Parameters:
- `variant`: baseline | noMemos | splitMemo | minimal
- `test`: vertical | horizontal | both

Test auto-starts 500ms after page load and runs for 10 seconds.

### Capture Profile

```bash
node .claude/skills/chrome-devtools-cli/scripts/profile.mjs capture \
  --browserUrl=http://127.0.0.1:9222 \
  --duration=3000 \
  --output=/path/to/output.json \
  --format=json
```

Options:
- `--duration`: Capture duration in ms (recommend 3000)
- `--output`: Output file path
- `--format`: json or summary

### Profile Types

```bash
# Full capture (CPU + metrics)
profile.mjs capture --duration=3000

# CPU profile only
profile.mjs cpu --duration=3000

# Timeline trace
profile.mjs trace --duration=3000

# Heap snapshot
profile.mjs heap

# Current metrics
profile.mjs metrics
```

## Benchmarking Protocol

For reliable results:

1. **Multiple runs**: Capture 3 profiles per variant, use average
2. **Consistent timing**: Navigate, wait 1s for test to start, then capture 3s
3. **Isolated browser**: Use `--user-data-dir=/tmp/chrome-profile` to avoid extension interference
4. **Same conditions**: Close other apps, same Chrome window position

## Combined Navigate + Profile

```bash
node .claude/skills/chrome-devtools-cli/scripts/devtools.mjs \
  --browserUrl=http://127.0.0.1:9222 \
  navigate "URL" && \
sleep 1 && \
node .claude/skills/chrome-devtools-cli/scripts/profile.mjs capture \
  --browserUrl=http://127.0.0.1:9222 \
  --duration=3000 \
  --output=output.json \
  --format=json
```

The 1s sleep ensures the stress test has started before profiling begins.
