#!/bin/bash
# Paired A/B browser benchmark, block-interleaved so time-varying machine load
# cancels: each perf.mjs call profiles 3 iterations without restarting Chrome,
# the two builds alternate per block, the order flips every round.
#
# usage: benchmarks/scripts/ab-blocks.sh <label> <portA> <portB> [rounds=3]
#   env SCENARIOS  — "name|path" pairs separated by ';' (default: the two
#                    canonical horizontal-scroll workloads)
#   env DURATION   — ms per iteration (default 3000)
# Serve each build statically first, e.g.
#   (cd dist-demo-10k && python3 -m http.server 5178 &)   # build A
#   (cd ../other-worktree/dist-demo-10k && python3 -m http.server 5179 &)  # build B
# `npx serve` is NOT used: it strips query strings on .html redirects and was
# not installable offline; python's http.server serves ".html?query" fine.
# Results: benchmarks/traces/runs/ab/<label>/{A,B}-<scenario>-r<n>.json
# Compare: python3 benchmarks/scripts/ab-compare.py benchmarks/traces/runs/ab/<label>
set -uo pipefail
LABEL=$1; PA=$2; PB=$3; ROUNDS=${4:-3}
OUT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/benchmarks/traces/runs/ab/$LABEL"
mkdir -p "$OUT"
PERF="$HOME/.claude/skills/chrome-devtools-cli/scripts/perf.mjs"
SCENARIOS=${SCENARIOS:-"isolate-h|perf-isolate.html?bar=nochildren&test=horizontal;exp-h|experiments.html?variant=baseline&virt=combined&test=horizontal"}
DURATION=${DURATION:-3000}
# never start while another profiler owns Chrome's debug port (pattern anchored
# so pgrep does not match this script's own command line)
while pgrep -f "node .*chrome-devtools-cli/scripts/perf\.mjs" > /dev/null; do sleep 3; done
IFS=';' read -ra SPECS <<< "$SCENARIOS"
for r in $(seq 1 "$ROUNDS"); do
  for spec in "${SPECS[@]}"; do
    name=${spec%%|*}; path=${spec##*|}
    if (( r % 2 )); then order="A:$PA B:$PB"; else order="B:$PB A:$PA"; fi
    for side in $order; do
      tag=${side%%:*}; port=${side##*:}
      out="$OUT/$tag-$name-r$r.json"
      [ -s "$out" ] && continue
      echo "[$(date +%H:%M:%S)] $LABEL round $r $tag $name load=$(cut -d' ' -f1 /proc/loadavg)" | tee -a "$OUT/run.log"
      node "$PERF" "http://localhost:$port/examples/$path" --iterations 3 --warmup 1 --duration "$DURATION" --output "$out" > "$OUT/last.log" 2>&1 || { echo "  FAILED $tag $name r$r" | tee -a "$OUT/run.log"; tail -3 "$OUT/last.log"; }
      echo "$(date +%s) $(cut -d' ' -f1 /proc/loadavg)" >> "$OUT/load.log"
    done
  done
done
echo "=== $LABEL DONE ===" | tee -a "$OUT/run.log"
