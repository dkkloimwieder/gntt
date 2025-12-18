---
name: chrome-devtools-cli
description: CLI wrapper for chrome-devtools-mcp providing browser automation, debugging, performance analysis, and page inspection via simple bash commands. Use when needing to automate Chrome, take screenshots, capture network traffic, run performance traces, interact with page elements, or debug web applications. Wraps the official chrome-devtools-mcp server with clean CLI semantics that minimize context overhead.
---

# Chrome DevTools CLI

CLI wrapper around [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) that translates bash commands to MCP tool calls.

## Requirements

- Node.js v20+
- Chrome/Chromium installed on the system

## Usage

```bash
node scripts/devtools.mjs <command> [args...] [options]
```

## Server Options

Pass these before the command to configure Chrome:

| Option | Description |
|--------|-------------|
| `--headless` | Run Chrome without UI |
| `--isolated` | Use temporary profile (clean state) |
| `--channel <ch>` | Chrome channel: stable, beta, canary, dev |
| `--browserUrl <url>` | Connect to existing Chrome (e.g., http://127.0.0.1:9222) |
| `--viewport <WxH>` | Set viewport size (e.g., 1280x720) |

## Commands

### Navigation

```bash
# Navigate to URL
devtools navigate https://example.com

# History navigation
devtools back
devtools forward
devtools reload

# Multi-page
devtools new-page https://example.com
devtools list-pages
devtools select-page 1
devtools close-page 0
```

### Screenshots & Snapshots

```bash
# Screenshot (viewport)
devtools screenshot

# Full page screenshot
devtools screenshot --fullPage=true

# Save to file
devtools screenshot --filePath=page.png

# Accessibility tree snapshot (shows element UIDs)
devtools snapshot
devtools snapshot --verbose=true
```

### Element Interaction

Elements are identified by `uid` from the snapshot output.

```bash
# Get element UIDs first
devtools snapshot

# Then interact
devtools click btn-submit
devtools fill input-email "user@example.com"
devtools hover nav-menu
devtools press-key Enter
devtools press-key "Control+A"
```

### JavaScript Execution

```bash
devtools eval "document.title"
devtools eval "window.scrollTo(0, document.body.scrollHeight)"
```

### Console & Network

```bash
# List console messages
devtools console

# List network requests
devtools list-requests
devtools list-requests --pageSize=10
devtools list-requests --resourceTypes=fetch,xhr

# Get request details
devtools get-request 123
```

### Performance Tracing (MCP-based)

```bash
# Quick trace (auto-stops after 5s)
devtools perf-start --reload=true --autoStop=true

# Manual trace
devtools perf-start --reload=true
# ... interact with page ...
devtools perf-stop

# Analyze specific insight
devtools perf-analyze "insight-set-id" "LCPBreakdown"
```

### Deep Profiling (CDP-based)

For detailed CPU profiles, call trees, and rendering stats, use the profiler directly:

```bash
# Start Chrome with debugging enabled first:
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile

# Full capture: CPU + rendering + metrics
node scripts/profile.mjs capture --duration 5000

# Profile specific URL
node scripts/profile.mjs capture --url https://example.com --duration 10000

# CPU profile with call tree
node scripts/profile.mjs cpu --duration 3000

# Rendering/frame stats only
node scripts/profile.mjs trace --duration 5000

# Current performance metrics
node scripts/profile.mjs metrics

# Heap snapshot
node scripts/profile.mjs heap

# Save to file
node scripts/profile.mjs capture --output profile.json --format json
```

**Profile output includes:**
- Hot functions (sorted by self-time)
- Call tree (hierarchical, filterable by % threshold)
- Rendering stats (FPS, paint times, layout times)
- Long tasks (>50ms blocking)
- GC stats
- DOM metrics (nodes, listeners, etc.)
- Memory usage

### Device Emulation

```bash
devtools emulate "iPhone 15 Pro"
devtools resize 375 812
```

### Wait for Content

```bash
devtools wait-for "Loading complete"
devtools wait-for "Success" --timeout=30000
```

## Examples

### Headless screenshot workflow

```bash
devtools --headless navigate https://example.com
devtools --headless screenshot --filePath=example.png
```

### Performance audit

```bash
devtools navigate https://mysite.com
devtools perf-start --reload=true --autoStop=true
```

### Form interaction

```bash
devtools navigate https://app.example.com/login
devtools snapshot  # Get element UIDs
devtools fill uid-for-email "test@example.com"
devtools fill uid-for-password "secret123"
devtools click uid-for-submit-btn
devtools wait-for "Dashboard"
devtools screenshot --filePath=logged-in.png
```

### Connect to existing browser

Start Chrome with remote debugging:
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

Then connect:
```bash
devtools --browserUrl=http://127.0.0.1:9222 navigate https://example.com
```

## Output

- Text output goes to stdout
- Screenshots saved to specified path or current directory
- Use `--json` option for structured JSON output
- Errors exit with code 1

## Notes

- Each MCP command spawns MCP server → Chrome (adds ~2-3s overhead)
- For multi-step workflows, consider batching or using `--browserUrl` to connect to persistent Chrome
- The `snapshot` command returns element UIDs needed for `click`, `fill`, etc.

## Profiler Architecture

The deep profiling (profile.mjs) uses Chrome DevTools Protocol directly for:

**CPU Profiler (`Profiler` domain)**
- Sampling profiler with configurable interval
- Generates call tree with self/total time per function
- Identifies hot functions by CPU time

**Tracer (`Tracing` domain)**
- Captures timeline events: paints, layouts, script execution, GC
- Calculates frame timing and FPS
- Identifies long tasks (>50ms)

**Performance Metrics (`Performance` domain)**
- DOM node count, event listeners
- Cumulative layout/style recalc time
- JS heap size

**Heap Profiler (`HeapProfiler` domain)**
- Full heap snapshots
- Memory allocation sampling

### Extending the Profiler

To add custom metrics, modify `scripts/lib/profiler.mjs`:

```javascript
// Add new CDP domain calls
await client.send('DomainName.method', { params });

// Subscribe to events
client.on('DomainName.eventName', (params) => {
  // Handle event
});
```

See [Chrome DevTools Protocol docs](https://chromedevtools.github.io/devtools-protocol/) for available domains.
