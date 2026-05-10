#!/bin/bash
# Virt-mode benchmark: combined vs xySplit (baseline bar variant only)
# 2 virt modes × 2 directions × 5 iterations + 1 warmup × 3000 ms
#
# Prerequisites: dist-demo built (`pnpm build:demo`) and served:
#   npx serve dist-demo -l 5174 &
#
# Output: benchmarks/traces/runs/xysplit-<virt>-<dir>.json
set -euo pipefail

PERF="${HOME}/.claude/skills/chrome-devtools-cli/scripts/perf.mjs"
BASE_URL="http://localhost:5174/examples/experiments"
OUT_DIR="benchmarks/traces/runs"
ITER=5
WARMUP=1
DURATION=3000
VARIANT="baseline"

mkdir -p "${OUT_DIR}"

echo "=============================================="
echo "VIRT MODE COMPARISON - $(date)"
echo "2 virt modes × 2 directions × ${ITER} runs"
echo "=============================================="

for virt in combined xySplit; do
    for test in horizontal vertical; do
        t="${test:0:1}"
        name="xysplit-${virt}-${t}"
        url="${BASE_URL}?variant=${VARIANT}&virt=${virt}&test=${test}"

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
echo "Results: ${OUT_DIR}/xysplit-*.json"
echo "=============================================="
