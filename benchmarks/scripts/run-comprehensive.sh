#!/bin/bash
# Comprehensive benchmark: 4 bar variants × 2 scroll directions × 5 runs = 40 total

mkdir -p perf-traces/runs/logs

BROWSER_URL="http://127.0.0.1:9222"
BASE_URL="http://localhost:5173/examples/experiments.html"
DURATION=5000
VIRT="combined"  # Using combined (winner)

echo "=============================================="
echo "COMPREHENSIVE BENCHMARK - $(date)"
echo "4 variants × 2 directions × 5 runs = 40 total"
echo "Duration: 5s per run, 1s delay before capture"
echo "=============================================="
echo ""

for variant in baseline noMemos splitMemo minimal; do
  for test in horizontal vertical; do
    t="${test:0:1}"
    for i in 1 2 3 4 5; do
      name="bench-${variant}-${t}-${i}"
      url="${BASE_URL}?variant=${variant}&virt=${VIRT}&test=${test}"

      echo "=== ${name} ==="
      echo "URL: ${url}"

      # Navigate first
      node .claude/skills/chrome-devtools-cli/scripts/devtools.mjs \
        --browserUrl="${BROWSER_URL}" \
        navigate "${url}" > /dev/null 2>&1

      # Wait for page load and stress test to start
      sleep 1

      # Capture profile
      node .claude/skills/chrome-devtools-cli/scripts/profile.mjs capture \
        --browserUrl="${BROWSER_URL}" \
        --duration="${DURATION}" \
        --output="perf-traces/runs/${name}.json" \
        2>&1 | tee "perf-traces/runs/logs/${name}.log" | grep -E "(Script Duration|Layout Duration|HOT FUNCTIONS|%.*ms.*\|)" | head -15

      echo ""
    done
  done
done

echo "=============================================="
echo "BENCHMARK COMPLETE"
echo "Results in: perf-traces/runs/bench-*.json"
echo "Logs in: perf-traces/runs/logs/bench-*.log"
echo "=============================================="
