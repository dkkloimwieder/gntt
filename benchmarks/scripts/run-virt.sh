#!/bin/bash
# Full matrix: 2 bar variants × 3 virt modes × 2 directions
# Each combination: 3 iterations + 1 warmup × 3000 ms
#
# Prerequisites: dist-demo built (`pnpm build:demo`) and served:
#   npx serve dist-demo -l 5174 &
#
# Output: benchmarks/traces/runs/bench-<variant>-<virt>-<dir>.json
set -euo pipefail

PERF="${HOME}/.claude/skills/chrome-devtools-cli/scripts/perf.mjs"
BASE_URL="http://localhost:5174/examples/experiments"
OUT_DIR="benchmarks/traces/runs"
ITER=3
WARMUP=1
DURATION=3000

mkdir -p "${OUT_DIR}"

echo "=============================================="
echo "FULL MATRIX BENCHMARK - $(date)"
echo "2 bars (baseline,noMemos) × 3 virts (combined,smartCache,splitEquals)"
echo "× 2 directions × ${ITER} runs"
echo "=============================================="

for variant in baseline noMemos; do
    for virt in combined smartCache splitEquals; do
        for test in horizontal vertical; do
            t="${test:0:1}"
            name="bench-${variant}-${virt}-${t}"
            url="${BASE_URL}?variant=${variant}&virt=${virt}&test=${test}"

            echo ""
            echo "=== ${name} ==="
            echo "URL: ${url}"

            node "${PERF}" "${url}" \
                --iterations "${ITER}" \
                --warmup "${WARMUP}" \
                --duration "${DURATION}" \
                --output "${OUT_DIR}/${name}.json" \
                2>&1 | grep -E "Script Duration|Layout Duration|FPS:" | head -3
        done
    done
done

echo ""
echo "=============================================="
echo "Results: ${OUT_DIR}/bench-*.json"
echo "=============================================="
