#!/bin/bash
# Benchmark: ALL combinations of bar variants × virt modes
# 2 bar variants × 3 virt modes × 2 directions × 3 runs = 36 total

mkdir -p perf-traces/runs/logs

BROWSER_URL="http://127.0.0.1:9222"
BASE_URL="http://localhost:5173/examples/experiments.html"
DURATION=5000

echo "=============================================="
echo "FULL MATRIX BENCHMARK - $(date)"
echo "2 bars (baseline,noMemos) × 3 virts (combined,smartCache,splitEquals)"
echo "× 2 directions × 3 runs = 36 total"
echo "Duration: 5s per run, 1s delay before capture"
echo "=============================================="
echo ""

for variant in baseline noMemos; do
  for virt in combined smartCache splitEquals; do
    for test in horizontal vertical; do
      t="${test:0:1}"
      for i in 1 2 3; do
        name="bench-${variant}-${virt}-${t}-${i}"
        url="${BASE_URL}?variant=${variant}&virt=${virt}&test=${test}"

        echo "=== ${name} ==="

        node .claude/skills/chrome-devtools-cli/scripts/devtools.mjs \
          --browserUrl="${BROWSER_URL}" \
          navigate "${url}" > /dev/null 2>&1

        sleep 1

        node .claude/skills/chrome-devtools-cli/scripts/profile.mjs capture \
          --browserUrl="${BROWSER_URL}" \
          --duration="${DURATION}" \
          --output="perf-traces/runs/${name}.json" \
          2>&1 | tee "perf-traces/runs/logs/${name}.log" | grep -E "(Script Duration)" | head -1

        echo ""
      done
    done
  done
done

echo "=============================================="
echo "BENCHMARK COMPLETE"
echo "=============================================="
