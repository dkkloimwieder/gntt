#!/bin/bash
# Comprehensive benchmark: 4 reactive-pattern variants × 2 scroll directions
# Each combination: 5 iterations + 1 warmup × 3000 ms
#
# Prerequisites: dist-demo built (`pnpm build:demo`) and served:
#   npx serve dist-demo -l 5174 &
#
# Output: benchmarks/traces/runs/bench-<variant>-<dir>.json
set -euo pipefail

PERF="${HOME}/.claude/skills/chrome-devtools-cli/scripts/perf.mjs"
BASE_URL="http://localhost:5174/examples/experiments"
OUT_DIR="benchmarks/traces/runs"
ITER=5
WARMUP=1
DURATION=3000
VIRT="combined"  # combined wins per ANALYSIS.md

mkdir -p "${OUT_DIR}"

echo "=============================================="
echo "REACTIVE-PATTERN MATRIX - $(date)"
echo "4 variants × 2 directions × ${ITER} runs"
echo "Duration: ${DURATION}ms per run, ${WARMUP} warmup"
echo "=============================================="

for variant in baseline noMemos splitMemo minimal; do
    for test in horizontal vertical; do
        t="${test:0:1}"
        name="bench-${variant}-${t}"
        url="${BASE_URL}?variant=${variant}&virt=${VIRT}&test=${test}"

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

echo ""
echo "=============================================="
echo "Results: ${OUT_DIR}/bench-*.json"
echo "=============================================="
