---
name: chrome-devtools-cli
description: Browser automation and performance profiling via CLI. Use for screenshots, network capture, performance traces, element interaction, form filling, or web debugging. Supports multi-step workflows. Requires Chrome.
---

# Chrome DevTools CLI

Browser automation and debugging via bash commands wrapping chrome-devtools-mcp.

## First-Time Setup

Run once before using this skill:

```bash
npm install
```

## Commands

Run from this skill's directory:

```bash
node scripts/devtools.mjs [server-options] <command> [args] [options]
```

### Server Options (add BEFORE command)

| Option | Description |
|--------|-------------|
| `--headless` | Run Chrome without UI (recommended) |
| `--isolated` | Use temporary profile (clean state) |
| `--browserUrl <url>` | Connect to existing Chrome |
| `--viewport <WxH>` | Set viewport (e.g., 1280x720) |

### Navigation

```bash
node scripts/devtools.mjs --headless navigate https://example.com
node scripts/devtools.mjs --headless back
node scripts/devtools.mjs --headless forward
node scripts/devtools.mjs --headless reload
```

### Screenshots

```bash
node scripts/devtools.mjs --headless screenshot
node scripts/devtools.mjs --headless screenshot --fullPage=true
node scripts/devtools.mjs --headless screenshot --filePath=/tmp/page.png
```

### Page Inspection

```bash
# Accessibility tree with element UIDs
node scripts/devtools.mjs --headless snapshot

# Execute JavaScript
node scripts/devtools.mjs --headless eval "document.title"
node scripts/devtools.mjs --headless eval "JSON.stringify([...document.querySelectorAll('a')].map(a=>a.href))"

# Console messages
node scripts/devtools.mjs --headless console
```

### Element Interaction

First get element UIDs via `snapshot`, then:

```bash
node scripts/devtools.mjs --headless click <uid>
node scripts/devtools.mjs --headless fill <uid> "value"
node scripts/devtools.mjs --headless hover <uid>
node scripts/devtools.mjs --headless press-key Enter
node scripts/devtools.mjs --headless press-key "Control+A"
```

### Network

```bash
node scripts/devtools.mjs --headless list-requests
node scripts/devtools.mjs --headless get-request <id>
```

### Performance Trace

```bash
node scripts/devtools.mjs --headless perf-start --reload=true --autoStop=true
node scripts/devtools.mjs --headless perf-stop
```

### Device Emulation

```bash
node scripts/devtools.mjs --headless emulate "iPhone 15 Pro"
node scripts/devtools.mjs --headless resize 375 812
```

### Wait

```bash
node scripts/devtools.mjs --headless wait-for "Success"
```

## Deep Profiling (CPU, Rendering, Memory)

For detailed performance data, first start Chrome with debugging:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile &
sleep 2
```

Then use the profiler:

```bash
# Full capture (CPU + rendering + metrics)
node scripts/profile.mjs capture --duration 5000

# Profile specific URL
node scripts/profile.mjs capture --url https://example.com --duration 5000

# CPU profile with call tree
node scripts/profile.mjs cpu --duration 3000

# Rendering stats (FPS, paints, layouts)
node scripts/profile.mjs trace --duration 3000

# Current metrics
node scripts/profile.mjs metrics

# Heap snapshot
node scripts/profile.mjs heap

# Save to file
node scripts/profile.mjs capture --output /tmp/profile.json --format json
```

### Profile Output Includes

- Hot functions (sorted by self-time)
- Call tree (hierarchical)
- Rendering stats (FPS, paint times, layout times)
- Long tasks (>50ms blocking)
- GC stats
- DOM metrics (nodes, listeners)
- Memory usage

## Example Workflows

### Screenshot a page

```bash
node scripts/devtools.mjs --headless --isolated navigate https://example.com
node scripts/devtools.mjs --headless --isolated screenshot --filePath=/tmp/example.png --fullPage=true
```

### Scrape data

```bash
node scripts/devtools.mjs --headless navigate https://example.com
node scripts/devtools.mjs --headless eval "JSON.stringify({title: document.title, h1: document.querySelector('h1')?.textContent})"
```

### Fill a form

```bash
node scripts/devtools.mjs --headless navigate https://example.com/login
node scripts/devtools.mjs --headless snapshot  # get element UIDs
node scripts/devtools.mjs --headless fill uid-email "user@example.com"
node scripts/devtools.mjs --headless fill uid-password "secret"
node scripts/devtools.mjs --headless click uid-submit
node scripts/devtools.mjs --headless wait-for "Dashboard"
```

### Full performance audit

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile &
sleep 2
node scripts/profile.mjs capture --url https://example.com --duration 10000
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| Cannot find module | Dependencies not installed | Run `npm install` in skill directory |
| Chrome not found | Chrome not installed | Install Chrome or use `--executablePath` |
| ECONNREFUSED 9222 | Profiler needs debug Chrome | Start Chrome with `--remote-debugging-port=9222` |

## Notes

- Each command spawns Chrome (~2-3s overhead)
- For multi-step workflows, use `--browserUrl` to reuse a browser
- `snapshot` returns element UIDs needed for `click`, `fill`, etc.

## Multi-Step Workflows (IMPORTANT)

**Problem:** Each `devtools.mjs` command spawns a NEW Chrome instance, so state is lost between commands.

**Solution 1: Persistent Browser**

```bash
# Start Chrome once
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug &
sleep 2

# All commands share the same browser
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 navigate https://example.com
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 snapshot
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 click btn-submit
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 perf-start
```

**Solution 2: Workflow Script (Recommended)**

Use `workflow.mjs` for multi-step operations in a single session:

```bash
# Create workflow JSON
cat > /tmp/my-workflow.json << 'EOF'
{
  "url": "https://example.com",
  "headless": true,
  "steps": [
    { "action": "snapshot" },
    { "action": "click", "uid": "btn-login" },
    { "action": "fill", "uid": "input-email", "value": "user@example.com" },
    { "action": "fill", "uid": "input-password", "value": "secret123" },
    { "action": "click", "uid": "btn-submit" },
    { "action": "wait", "text": "Dashboard" },
    { "action": "screenshot", "path": "/tmp/logged-in.png" },
    { "action": "perf-trace", "duration": 5000 }
  ]
}
EOF

# Run it
node scripts/workflow.mjs /tmp/my-workflow.json
```

### Workflow Actions

| Action | Parameters |
|--------|------------|
| `navigate` | `url` |
| `snapshot` | `verbose` (optional) |
| `click` | `uid` |
| `fill` | `uid`, `value` |
| `hover` | `uid` |
| `press-key` | `key` |
| `screenshot` | `path`, `fullPage` (optional) |
| `wait` | `text`, `timeout` (optional) |
| `eval` | `expression` |
| `perf-start` | `reload` (optional) |
| `perf-stop` | — |
| `perf-trace` | `duration` (combined start + wait + stop) |
| `sleep` | `duration` (ms) |
| `console` | — |
| `network` | `pageSize` (optional) |

### Click Button + Capture Performance Example

```json
{
  "url": "https://myapp.com",
  "headless": true,
  "steps": [
    { "action": "snapshot" },
    { "action": "click", "uid": "load-data-btn" },
    { "action": "perf-trace", "duration": 5000 },
    { "action": "screenshot", "path": "/tmp/after-click.png" }
  ]
}
```

### Interactive Mode

For exploration, use interactive mode:

```bash
node scripts/workflow.mjs --interactive --url https://example.com

# Then type JSON steps:
{"action": "snapshot"}
{"action": "click", "uid": "some-button"}
{"action": "perf-trace", "duration": 3000}
```
