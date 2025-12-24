# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Frappe Gantt** is a Gantt chart library with two implementations:

- **SolidJS** (primary, in `src/`) - The active implementation using reactive stores and fine-grained reactivity
- **Vanilla JS** (legacy, in `vanilla/`) - The original implementation, archived for reference

The library provides drag & drop task management, dependency visualization, constraint enforcement (FS/SS/FF/SF), and theme support.

## Essential Commands

### Build & Development
- `pnpm run dev:solid` - Start SolidJS demo server at http://localhost:5173/examples/
- `pnpm run generate:calendar` - Generate test calendar data (see Performance Testing below)
- `pnpm build:solid` - Build SolidJS production bundle
- `pnpm build:demo` - Build demo pages to `dist-demo/`
- `pnpm dev` - Start vanilla JS dev server (legacy)
- `pnpm build` - Build vanilla JS bundle

### Serving Built Demos for Benchmarking

When benchmarking with built demos (not dev server), use `npx serve dist-demo`:

```bash
pnpm build:demo
npx serve dist-demo -l 5174 &
```

**IMPORTANT: URL format issue with `serve`**

The `serve` package redirects `.html` URLs to clean URLs, **stripping query parameters** in the process:

```bash
# ❌ WRONG - serve redirects and loses query params
http://localhost:5174/examples/perf-isolate.html?bar=nochildren&test=horizontal
# → 301 redirects to /examples/perf-isolate (params lost!)

# ✅ CORRECT - use clean URLs without .html
http://localhost:5174/examples/perf-isolate?bar=nochildren&test=horizontal
```

This affects all benchmark URLs. Always omit the `.html` extension when using `serve`.

### Code Quality
- `pnpm lint` - Lint JavaScript files
- `pnpm prettier` - Format code
- `pnpm prettier-check` - Check formatting without modifying

### Note on Testing
Only one test file exists (`tests/date_utils.test.js`) but no test runner is configured in package.json.

## Architecture

### Directory Structure

```
gantt/
├── src/                        # SolidJS (primary)
│   ├── components/             # UI components (Gantt, Bar, Arrow, Grid, etc.)
│   ├── stores/                 # Reactive stores (taskStore, ganttConfigStore, ganttDateStore)
│   ├── utils/                  # Utilities (barCalculations, constraintResolver, etc.)
│   ├── hooks/                  # useDrag
│   ├── contexts/               # React-style contexts (GanttEvents)
│   ├── entries/                # Entry points for each demo
│   ├── scripts/                # CLI tools (generateCalendar.js)
│   ├── data/                   # Generated test data
│   └── styles/                 # CSS
├── examples/                   # SolidJS demo HTML files
│   ├── index.html              # Demo hub
│   ├── gantt.html              # Main demo
│   ├── subtask.html            # Subtask demo (parent tasks with children)
│   ├── resource-groups.html    # Collapsible resource groups demo
│   ├── perf.html               # Performance test (200+ tasks)
│   ├── profiler.html           # Performance profiling tool
│   ├── arrow.html, bar.html    # Component demos
│   └── constraint.html, showcase.html
├── vanilla/                    # Legacy vanilla JS (archived)
│   ├── src/                    # Original JS source
│   └── examples/               # Original demo
├── docs/
│   ├── ARCHITECTURE.md         # Detailed SolidJS architecture
│   └── SUBTASKS.md             # Subtask feature documentation
└── [config files]
```

### SolidJS Architecture

The SolidJS implementation uses reactive stores for state management:

**Stores:**
- `taskStore.js` - Task data and operations (uses `createStore` for fine-grained reactivity)
- `ganttConfigStore.js` - Configuration (view mode, dimensions, features)
- `ganttDateStore.js` - Timeline calculations and date utilities
- `resourceStore.js` - Resource groups with collapse/expand state

**Performance Note:** The `taskStore` uses SolidJS `createStore({})` instead of `createSignal(Map)` to enable path-level dependency tracking. This allows dragging a task to only update that specific task's Bar component and connected Arrows, achieving 60 FPS with 10K+ tasks.

**Components:**
- `Gantt.jsx` - Main container component
- `Bar.jsx` - Task bars with drag/resize/progress handles
- `SummaryBar.jsx` - Parent/summary task bars (simplified Bar)
- `Arrow.jsx` - Dependency visualization (single arrow)
- `ArrowLayerBatched.jsx` - Batched arrow rendering for performance
- `Grid.jsx` - Background grid and time scale
- `TaskLayer.jsx` - Orchestrates task bar rendering
- `ResourceColumn.jsx` - Resource names column
- `ExpandedTaskContainer.jsx` - Parent task with subtasks (see [SUBTASKS.md](docs/SUBTASKS.md))
- `SubtaskBar.jsx` - Individual subtask bars

**Utilities:**
- `barCalculations.js` - Position/size calculations from dates
- `constraintResolver.js` - Dependency constraint enforcement (FS/SS/FF/SF)
- `hierarchyProcessor.js` - Task hierarchy building and traversal
- `rowLayoutCalculator.js` - Variable row heights for expanded subtasks
- `createVirtualViewport.js` - Simple 2D viewport virtualization
- `resourceProcessor.js` - Resource normalization and group display logic
- `taskProcessor.js` - Task normalization and dependency parsing
- `taskGenerator.js` - Test data generation
- `subtaskGenerator.js` - Generates test data with subtasks
- `date_utils.js` - Date parsing, formatting, and calculations
- `defaults.js` - Default view mode configurations

See `docs/ARCHITECTURE.md` for detailed documentation.

## Performance Testing

The SolidJS implementation includes a task generator for performance testing with realistic calendar data.

### Quick Start
```bash
pnpm run generate:calendar          # Generate 200 tasks
pnpm run dev:solid                   # Start dev server
# Open http://localhost:5173/examples/perf.html
```

### Task Generator

Located at `src/scripts/generateCalendar.js`, generates `src/data/calendar.json`.

**Features:**
- Cross-resource dependency chains (tasks in a group span different resources A-Z)
- No overlap per resource (concurrency = 1)
- Workday-aware scheduling (08:00-17:00, rolls over to next day)
- Mixed FS/SS dependencies with configurable lag
- Seeded random for reproducible results

**CLI Options:**
```bash
node src/scripts/generateCalendar.js --help
node src/scripts/generateCalendar.js --tasks=300 --seed=54321 --ss=30
node src/scripts/generateCalendar.js --tasks=10000 --resources=100 --dense  # Stress test
```

| Option | Default | Description |
|--------|---------|-------------|
| `--tasks=N` | 200 | Total number of tasks |
| `--seed=N` | 12345 | Random seed for reproducibility |
| `--ss=N` | 20 | Percentage of SS (Start-to-Start) dependencies |
| `--minGroup=N` | 5 | Minimum tasks per dependency group |
| `--maxGroup=N` | 20 | Maximum tasks per dependency group |
| `--start=DATE` | 2025-01-01 | Start date (YYYY-MM-DD) |
| `--resources=N` | 26 | Number of resources (A-Z, AA, AB, etc.) |
| `--dense` | false | Dense mode: tightly packed tasks for stress testing |
| `--arrowDensity=N` | 20 | Percentage of tasks with dependencies (dense mode) |
| `--maxRowDistance=N` | 2 | Max row distance for dependencies (dense mode) |

**Generated Data Structure:**
```javascript
{
  id: "task-1",
  name: "G1-1",              // Group 1, Task 1
  start: "2025-01-01 08:00", // Workday-aware
  end: "2025-01-01 16:00",
  progress: 87,
  color: "#3b82f6",
  color_progress: "#3b82f6cc",
  dependencies: "task-0" | { id, type: "SS", lag: 2 },
  resource: "E"              // A-Z, no overlap on same resource
}
```

**Key Files:**
- `src/utils/taskGenerator.js` - Shared generation logic
- `src/scripts/generateCalendar.js` - CLI script
- `src/data/calendar.json` - Generated test data
- `src/components/GanttPerfDemo.jsx` - Performance test UI

### Perf-Isolate (Feature Isolation Testing)

For progressive performance testing, use the perf-isolate harness:

```bash
pnpm run dev:solid
# Open http://localhost:5173/examples/perf-isolate.html?bar=nochildren&test=horizontal
```

**URL Parameters:**
| Param | Values | Description |
|-------|--------|-------------|
| `bar` | nochildren, combined, minimal, etc. | Bar component variant |
| `grid` | 0, 1 | Show SVG grid |
| `headers` | 0, 1 | Show date headers |
| `resources` | 0, 1 | Show resource column |
| `test` | horizontal, vertical, both | Auto-scroll stress test |

**Example:** Test headers overhead:
```bash
# Baseline (no headers)
?bar=nochildren&test=horizontal

# With headers
?bar=nochildren&headers=1&test=horizontal
```

See `perf-traces/ANALYSIS.md` for current best practices and benchmark results.

## Development Workflow

1. Clone and run `pnpm i`
2. Run `pnpm run dev:solid` to start the development server
3. Open http://localhost:5173/examples/ to see the demo hub
4. Edit source files in `src/` - Vite automatically reloads

## Code Style

- ES6 modules with import/export
- 4-space indentation, single quotes
- ESLint + Prettier configured
- JSX for SolidJS components

---

## Browser Automation & Performance Profiling

This project uses the `chrome-devtools-cli` skill for browser automation and performance analysis.

**Skill location:** `~/.claude/skills/chrome-devtools-cli/`

---

## Quick Reference

| Task | Command |
|------|---------|
| Performance profile | `node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url>` |
| Benchmark (5 runs) | `node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url> --iterations 5` |
| Click then profile | `node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs <url> --click "#btn"` |
| Multi-step workflow | `node ~/.claude/skills/chrome-devtools-cli/scripts/workflow.mjs <workflow.json>` |

---

## Performance Profiling

**Always use `perf.mjs` for performance work.** It handles Chrome automatically.

### Single Profile

```bash
# Basic profile (5 seconds)
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com

# Longer duration
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --duration 10000

# Click element first, then profile
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --click "#load-button" --duration 5000

# Save results to file
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --output /tmp/perf.json
```

### Benchmarking (Multiple Iterations)

```bash
# Run 5 iterations, report mean/median/min/max/stddev
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --iterations 5

# With warmup runs (discarded before measuring)
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --iterations 10 --warmup 2

# Benchmark a user interaction
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --click "#submit-btn" --iterations 5 --duration 3000

# Save full benchmark data
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --iterations 5 --output /tmp/benchmark.json
```

### What perf.mjs Does

1. Starts Chrome in **normal mode** (not headless) — required for accurate rendering
2. Navigates to URL and waits for load
3. Clicks element if `--click` specified
4. Captures CPU profile, rendering stats, metrics
5. For benchmarks: reloads page between iterations
6. Reports statistics (mean, median, stddev, etc.)

---

## Multi-Step Workflows

For navigate → interact → screenshot flows, use `workflow.mjs`:

```bash
cat > /tmp/workflow.json << 'EOF'
{
  "url": "https://example.com",
  "headless": false,
  "steps": [
    { "action": "snapshot" },
    { "action": "click", "uid": "login-btn" },
    { "action": "fill", "uid": "email-input", "value": "user@example.com" },
    { "action": "fill", "uid": "password-input", "value": "password123" },
    { "action": "click", "uid": "submit-btn" },
    { "action": "wait", "text": "Dashboard" },
    { "action": "screenshot", "path": "/tmp/logged-in.png" }
  ]
}
EOF

node ~/.claude/skills/chrome-devtools-cli/scripts/workflow.mjs /tmp/workflow.json
```

### Workflow Actions

| Action | Parameters | Example |
|--------|------------|---------|
| `navigate` | `url` | `{ "action": "navigate", "url": "https://..." }` |
| `snapshot` | `verbose` (optional) | `{ "action": "snapshot" }` |
| `click` | `uid` | `{ "action": "click", "uid": "btn-id" }` |
| `fill` | `uid`, `value` | `{ "action": "fill", "uid": "input-id", "value": "text" }` |
| `hover` | `uid` | `{ "action": "hover", "uid": "menu-id" }` |
| `press-key` | `key` | `{ "action": "press-key", "key": "Enter" }` |
| `screenshot` | `path`, `fullPage` | `{ "action": "screenshot", "path": "/tmp/shot.png" }` |
| `wait` | `text`, `timeout` | `{ "action": "wait", "text": "Success" }` |
| `eval` | `expression` | `{ "action": "eval", "expression": "document.title" }` |
| `sleep` | `duration` (ms) | `{ "action": "sleep", "duration": 2000 }` |
| `perf-trace` | `duration` | `{ "action": "perf-trace", "duration": 5000 }` |

### Getting Element UIDs

First run snapshot to see available element UIDs:

```bash
# Start Chrome if not running
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --duration 1000

# Then get snapshot (Chrome stays open on port 9222)
node ~/.claude/skills/chrome-devtools-cli/scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 snapshot
```

---

## Common Mistakes — DO NOT DO THESE

### ❌ WRONG: Using headless mode for performance

```bash
# WRONG - headless has no real rendering, metrics are meaningless
node scripts/devtools.mjs --headless navigate https://example.com
node scripts/devtools.mjs --headless perf-start
```

**✅ RIGHT:** Use `perf.mjs` which runs Chrome in normal mode automatically.

---

### ❌ WRONG: Multiple devtools.mjs commands without --browserUrl

```bash
# WRONG - each command spawns a NEW browser instance
node scripts/devtools.mjs navigate https://example.com   # Browser 1
node scripts/devtools.mjs click btn-submit               # Browser 2 (blank!)
node scripts/devtools.mjs screenshot                      # Browser 3 (blank!)
```

**✅ RIGHT:** Use `workflow.mjs` for multi-step, or `--browserUrl`:

```bash
# Option A: workflow.mjs (preferred)
node scripts/workflow.mjs /tmp/my-workflow.json

# Option B: persistent browser
node scripts/perf.mjs https://example.com --duration 1000  # starts Chrome
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 click btn-submit
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 screenshot
```

---

### ❌ WRONG: Manually starting Chrome for perf.mjs

```bash
# WRONG - unnecessary, perf.mjs handles this
google-chrome --remote-debugging-port=9222 &
node scripts/perf.mjs https://example.com
```

**✅ RIGHT:** Just run perf.mjs, it starts Chrome automatically:

```bash
node scripts/perf.mjs https://example.com
```

---

### ❌ WRONG: Using profile.mjs for simple traces

```bash
# WRONG - profile.mjs is low-level and requires manual Chrome setup
node scripts/profile.mjs capture --url https://example.com
```

**✅ RIGHT:** Use perf.mjs:

```bash
node scripts/perf.mjs https://example.com
```

---

## Files in the Skill

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `perf.mjs` | Performance profiling & benchmarking | **Any performance work** |
| `workflow.mjs` | Multi-step browser automation | Navigate → interact → screenshot flows |
| `devtools.mjs` | Single browser commands | Only with `--browserUrl` for one-off commands |
| `profile.mjs` | Low-level CDP profiling | Advanced use only |

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "Chrome not found" | Chrome not installed | `apt install google-chrome-stable` |
| "ECONNREFUSED 9222" | Chrome not running | Let `perf.mjs` handle it, or start manually |
| "Cannot find module" | npm install not run | `cd ~/.claude/skills/chrome-devtools-cli && npm install` |
| Blank screenshots | Commands used separate browsers | Use `workflow.mjs` or `--browserUrl` |
| No rendering metrics | Used `--headless` | Use `perf.mjs` (never headless for perf) |

---

## Example: Full Performance Audit

```bash
# 1. Single profile to identify issues
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --duration 10000

# 2. Benchmark to get stable measurements
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --iterations 5 --warmup 1

# 3. Profile a specific interaction
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --click "#load-data" --iterations 5

# 4. Save results for comparison
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --iterations 5 --output /tmp/baseline.json

# ... make changes ...

node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://myapp.com --iterations 5 --output /tmp/after-fix.json
```
