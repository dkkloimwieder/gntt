#!/bin/bash
echo "=== FULL MATRIX BENCHMARK RESULTS ==="
echo ""

for variant in baseline noMemos; do
  for virt in combined smartCache splitEquals; do
    echo "--- $variant + $virt ---"
    for dir in h v; do
      total=0
      count=0
      for f in perf-traces/runs/bench-${variant}-${virt}-${dir}-*.json; do
        if [ -f "$f" ]; then
          script=$(cat "$f" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const s=parseFloat(j.metrics.scriptDuration);console.log(s);});" 2>/dev/null)
          if [ ! -z "$script" ]; then
            total=$(echo "$total + $script" | bc)
            count=$((count + 1))
          fi
        fi
      done
      if [ $count -gt 0 ]; then
        avg=$(echo "scale=1; $total / $count" | bc)
        echo "  ${dir}-scroll: avg ${avg}ms (${count} runs)"
      fi
    done
    echo ""
  done
done
