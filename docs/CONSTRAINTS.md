# Task constraints

A constraint limits where a task can move. Dependencies set limits relative
to another task. Absolute constraints set limits relative to a date or time.
Locks prevent a move or a resize.

Use the [constraint fixture in the performance demo](http://localhost:5173/examples/perf-isolate.html?data=constraint&bar=dragconst&grid=1&resources=1&arrows=1)
to test the engine with labeled tasks. Run `pnpm dev` first. The fixture is
in [constraint-test.json](../src/data/fixtures/constraint-test.json).

## Dependencies

A predecessor is the task that supplies a time limit. A successor is the
task that must observe it. Put the predecessor ID in the successor's
`dependencies` array.

```ts
const dependencies = [{ id: 'design', type: 'FS', lag: 2, max: 4 }];
```

This Finish-to-Start dependency gives the successor a two-hour minimum gap.
When you move the successor, its start can be two to six hours after Design
finishes.

| Type           | Predecessor reference | Successor reference |
| -------------- | --------------------- | ------------------- |
| `FS` (default) | Finish                | Start               |
| `SS`           | Start                 | Start               |
| `FF`           | Finish                | Finish              |
| `SF`           | Start                 | Finish              |

`lag` is the minimum gap in hours for chart task input. It defaults to
zero. The lower-level engine accepts an additional `min` on a
`Relationship`; the chart's `Dependency` input does not pass it through.

| `max`           | Allowed gap when moving the successor directly         |
| --------------- | ------------------------------------------------------ |
| Omitted         | The gap can grow without an upper bound.               |
| `0`             | The gap must match `lag`.                              |
| Positive number | The gap can grow by this number of hours beyond `lag`. |

## Successor updates

A cascade updates other tasks after you move or resize a task. The engine
pushes successors forward when the new dates would break their minimum gap.
It can pass the update through several successors. Moving a predecessor
earlier leaves its successors in place if they still meet the minimum gap.
The cascade does not pull successors back to meet `max`.

The engine checks all of a successor's predecessors when it computes a
push. It uses staged positions from earlier passes through the graph. It
stops when a pass makes no changes or after 100 passes.

When the chart prepares tasks, it warns if it finds a dependency cycle.
Fix the input graph before you rely on its schedule. The iteration limit
stops a cascade on invalid graphs.

## Locks and date limits

Pointer and keyboard gestures follow the same date locks. The chart shows a resize handle only on an editable edge.

| `constraints.locked` | Move | Resize left edge | Resize right edge |
| -------------------- | ---- | ---------------- | ----------------- |
| `true`               | No   | No               | No                |
| `"start"`            | No   | No               | Yes               |
| `"end"`              | No   | Yes              | No                |
| `"duration"`         | Yes  | No               | No                |

On a focused regular task bar, Shift+Left and Shift+Right change the right edge. If the end is locked, they change the left edge. A duration lock preserves elapsed time when the task moves across columns of different lengths. Partial date locks still allow progress edits.

When you drag a summary, children with a locked start or end keep their dates. Fully locked children also stay in place.

Give `minStart`, `maxStart`, and `maxEnd` as local date strings in
`YYYY-MM-DD HH:MM` format. The direct move resolver uses them to bound the
start and finish. Conflicting limits leave the task in its original
position and return `blockReason: 'conflicting_constraints'`.

The chart projects absolute dates onto its active calendar. It converts hourly lags with the current column width and view step. For duration conversions, a month represents 30 days and a year represents 365 days.

The absolute constraint helpers also accept `minEnd`, `minDuration`,
`maxDuration`, and `fixedDuration`. Their unit tests exercise these
fields. The chart uses only a subset of these limits during drag and resize.

## Engine API

`resolveConstraints(taskId, proposedX, proposedWidth, context)` resolves
a proposed position. Supply `getBarPosition`, the timeline origin
`ganttStartDate`, and `pixelsPerHour`. Supply `getTask` if the resolver
needs task limits. You can pass a `relationships` array or a
`relationshipIndex` built by `buildRelationshipIndex`.

The result gives `constrainedX`, `constrainedWidth`, `blocked`,
`blockReason`, and the map of `cascadeUpdates`. Apply each returned position and any width it includes. A duration-locked task can change width in pixels when it moves into a shorter month. `calculateCascadeUpdates` also returns a map of successor
positions when you already know the proposed position. Neither map includes
the edited task.

The chart passes the new bar rectangle to `resolveResizeCascade` after a
resize. This lets the engine use the new position and width before Solid
commits the store write.

See [the engine](../src/utils/constraintEngine.ts),
[the move and cascade tests](../tests/constraintEngine.test.ts), and
[the absolute constraint tests](../tests/absoluteConstraints.test.ts).
