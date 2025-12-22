# AGENTS.md

Agent-specific guidance for browser automation and performance profiling.

## Decision Tree

```
Need browser automation?
│
├─ Performance profiling/benchmarking?
│  └─ USE: perf.mjs
│     node scripts/perf.mjs <url> [--iterations N] [--click "selector"]
│
├─ Multi-step workflow (navigate → click → fill → screenshot)?
│  └─ USE: workflow.mjs
│     Create JSON workflow, run: node scripts/workflow.mjs workflow.json
│
└─ Single command on existing browser?
   └─ USE: devtools.mjs --browserUrl=http://127.0.0.1:9222 <command>
```

---

## Command Patterns

### Performance Profile

```bash
# Single run
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com

# With click before profiling
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --click "#button-id"

# Benchmark (multiple iterations with stats)
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --iterations 5

# Full benchmark with warmup
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --iterations 10 --warmup 2 --duration 5000
```

### Multi-Step Workflow

```bash
cat > /tmp/workflow.json << 'EOF'
{
  "url": "https://example.com",
  "headless": false,
  "steps": [
    { "action": "snapshot" },
    { "action": "click", "uid": "element-uid" },
    { "action": "wait", "text": "Expected text" },
    { "action": "screenshot", "path": "/tmp/result.png" }
  ]
}
EOF
node ~/.claude/skills/chrome-devtools-cli/scripts/workflow.mjs /tmp/workflow.json
```

### Get Element UIDs

```bash
# Start browser and navigate
node ~/.claude/skills/chrome-devtools-cli/scripts/perf.mjs https://example.com --duration 1000

# Get accessibility snapshot (Chrome stays open)
node ~/.claude/skills/chrome-devtools-cli/scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 snapshot
```

---

## Critical Rules

### 1. Never Use Headless for Performance

```bash
# ❌ WRONG
node scripts/devtools.mjs --headless perf-start

# ✅ RIGHT  
node scripts/perf.mjs https://example.com
```

### 2. Never Chain devtools.mjs Without --browserUrl

```bash
# ❌ WRONG (each spawns new browser)
node scripts/devtools.mjs navigate https://example.com
node scripts/devtools.mjs click btn-id

# ✅ RIGHT (use workflow.mjs)
node scripts/workflow.mjs workflow.json

# ✅ RIGHT (use persistent browser)
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 navigate https://example.com
node scripts/devtools.mjs --browserUrl=http://127.0.0.1:9222 click btn-id
```

### 3. Let perf.mjs Handle Chrome

```bash
# ❌ WRONG (manual Chrome management)
google-chrome --remote-debugging-port=9222 &
node scripts/profile.mjs capture

# ✅ RIGHT (automatic)
node scripts/perf.mjs https://example.com
```

---

## Workflow Actions Reference

| Action | Required | Optional | Notes |
|--------|----------|----------|-------|
| `navigate` | `url` | — | Go to URL |
| `snapshot` | — | `verbose` | Returns element UIDs |
| `click` | `uid` | — | Click element |
| `fill` | `uid`, `value` | — | Fill input |
| `hover` | `uid` | — | Hover element |
| `press-key` | `key` | — | e.g., "Enter", "Tab" |
| `screenshot` | — | `path`, `fullPage` | Capture page |
| `wait` | `text` | `timeout` | Wait for text |
| `eval` | `expression` | — | Run JavaScript |
| `sleep` | `duration` | — | Wait N ms |
| `perf-trace` | — | `duration` | Capture perf trace |
| `console` | — | — | Get console logs |
| `network` | — | `pageSize` | Get network requests |

---

## Benchmark Output Interpretation

```
📊 RENDERING PERFORMANCE
  FPS: mean=58.42 median=59.10 min=52.30 max=61.20 stddev=3.21
       ↑ Higher is better. Target: 60 FPS. stddev shows consistency.

⏱️  TIMING  
  Script Duration: mean=45.23ms ...
       ↑ Lower is better. Time spent executing JavaScript.
  
  Layout Duration: mean=12.34ms ...
       ↑ Lower is better. Time calculating element positions.

⚠️  BLOCKING
  Long Task Count: mean=2.40 ...
       ↑ Lower is better. Tasks >50ms block main thread.

🔥 HOT FUNCTIONS
  34.21ms ±5.32 | functionName
       ↑ Functions consuming most CPU time.
```

---

## Output Files

| Flag | Output |
|------|--------|
| `--output /tmp/perf.json` | Single run: full profile data |
| `--output /tmp/bench.json` | Benchmark: config, stats, all runs |

### JSON Structure (Benchmark)

```json
{
  "config": {
    "url": "https://example.com",
    "duration": 5000,
    "iterations": 5,
    "warmup": 1
  },
  "stats": {
    "fps": { "mean": 58.4, "median": 59.1, "min": 52.3, "max": 61.2, "stddev": 3.2 },
    "scriptDuration": { ... },
    "hotFunctions": [...]
  },
  "runs": [
    { "fps": 59.1, "scriptDuration": 44.1, ... },
    { "fps": 58.2, "scriptDuration": 45.3, ... }
  ]
}
```

---

## Skill Location

```
~/.claude/skills/chrome-devtools-cli/
├── SKILL.md
├── CLAUDE.md        # This guidance
├── AGENTS.md        # Agent-specific patterns
├── package.json
└── scripts/
    ├── perf.mjs     # Performance profiling (USE THIS)
    ├── workflow.mjs # Multi-step automation
    ├── devtools.mjs # Single commands
    └── profile.mjs  # Low-level CDP (advanced)
```

---

## Setup

```bash
cd ~/.claude/skills/chrome-devtools-cli
npm install
```

Requires: Node.js v20+, Chrome/Chromium
