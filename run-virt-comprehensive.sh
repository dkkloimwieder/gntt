#!/bin/bash
# Benchmark: xySplit vs combined virtualization (baseline bar variant only)
# 2 virt modes × 2 directions × 5 runs = 20 total

mkdir -p perf-traces/runs/logs

BROWSER_URL="http://127.0.0.1:9222"
BASE_URL="http://localhost:5173/examples/experiments.html"
DURATION=5000
VARIANT="baseline"

echo "=============================================="
echo "XYSPLIT vs COMBINED BENCHMARK - $(date)"
echo "2 virt modes × 2 directions × 5 runs = 20 total"
echo "Duration: 5s per run, 1s delay before capture"
echo "=============================================="
echo ""

for virt in combined xySplit; do
  for test in horizontal vertical; do
    t="${test:0:1}"
    for i in 1 2 3 4 5; do
      name="xysplit-${virt}-${t}-${i}"
      url="${BASE_URL}?variant=${VARIANT}&virt=${virt}&test=${test}"

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

echo "=============================================="
echo "BENCHMARK COMPLETE"
echo "=============================================="
