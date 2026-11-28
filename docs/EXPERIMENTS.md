# Gantt Experiments

The Experiments demo compares bar reactivity and task filtering in SolidJS.
A memo caches the result of a reactive calculation.
Virtualization limits rendering to the visible area and a surrounding buffer.

## Run the demo

Start `pnpm dev` and open [experiments.html](http://localhost:5173/examples/experiments.html).
Choose a bar pattern and a visible-task filter in the two menus.
Click **V-Scroll**, **H-Scroll**, or **Both** to start a 10-second test.

Use [the benchmark runner guide](../benchmarks/traces/README.md) to compare built pages with browser traces.
Keep the data, window size, run length, and scroll direction fixed when comparing variants.
The [benchmark archive](../benchmarks/traces/ANALYSIS.md) records earlier results.

## URL parameters

Use [this example](http://localhost:5173/examples/experiments.html?variant=baseline&virt=combined&test=horizontal) to open the default variants and start a horizontal scroll.

| Parameter | Behavior |
|---|---|
| `variant` | Selects the bar pattern. Defaults to `baseline`. |
| `virt` | Selects the visible-task filter. Defaults to `combined`. |
| `test` | Accepts `horizontal`, `vertical`, or `both`. The page starts about 500 ms after mount. |
| `lazy` | Set to `1` to compare a lazy baseline bar memo. The demo exposes recompute counts on `window.__memoStats`. |

## Bar patterns

| Pattern | Behavior |
|---|---|
| `baseline` | Collects bar data in one memo. |
| `noMemos` | Reads the store directly. |
| `splitMemo` | Uses separate memos for static and changing data. |
| `minimal` | Draws bars without drag handlers. |

## Visible-task filters

| Filter | Behavior |
|---|---|
| `combined` | Filters rows and horizontal bounds in one memo. |
| `xySplit` | Filters rows first, then filters by horizontal bounds. |
| `smartCache` | Reuses the row results while the row range stays the same. |
| `splitEquals` | Uses task ID lists with custom equality. |
| `untracked` | Reads tasks without subscriptions during the filtering pass. |
| `plainLookup` | Filters against the initial task objects. |
| `xBucket` | Looks up tasks by horizontal bucket and removes duplicates. |
| `xBucketStart` | Looks up tasks by their starting horizontal bucket. |
| `2D` | Looks up tasks by row and horizontal bucket. |

Some filters use precomputed data or skip subscriptions. Measure their scroll behavior separately from their response to task edits.

## Add an experiment

Edit [GanttExperiments.tsx](../src/demo/GanttExperiments.tsx).
For a bar pattern, add its component to `BAR_VARIANTS` and add an option to the bar selector.
For a task filter, add its memo to the visible-task dispatcher and add an option to the filter selector.
Test the menu option and its matching query parameter before recording a comparison.
