# Changelog

Notable changes to `ganttss`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — SolidJS 2.0

The SolidJS 2.0 migration (beads epics E0–E7). Decision ids in parentheses
refer to the D1–D13 table in `docs/migration/solid2/PLAN.md`.

### Changed — BREAKING

- **The runtime is SolidJS 2.0.** `solid-js` and `@solidjs/web` at
  `2.0.0-rc.6`, compiled by `@solidjs/vite-plugin` 3.0.0-next.39 with
  `jsxImportSource: '@solidjs/web'`. The library does **not** run on Solid
  1.x. Both runtimes stay external to the published bundle, so the host app
  supplies them — dedupe them (`resolve.dedupe: ['solid-js', '@solidjs/web']`)
  or a nested copy creates a second, disconnected reactive graph. (D2)
- **ESM-only packaging.** The UMD output and its globals map are dropped;
  the library build emits `es` only, and `main`/`module` both point at
  `dist/ganttss.es.js`. Neither Solid 2.0 runtime ships a global build, so a
  UMD bundle could never have resolved its externals in a browser. (D3)
- **Node `^20.19 || >=22.12`** (`engines`). (D1)
- **`GanttConfigStore` setters return `void`.** The twenty `set*` fields move
  from Solid's `Setter<T>` to a new
  `ConfigSetter<T> = (value: Exclude<T, Function> | ((prev: T) => T)) => void`
  — the `Exclude<Function>` guard is what makes a function argument
  unambiguously an updater rather than a value. Solid 2.0 defers writes, so
  there is no post-write value left to return. Statement-position calls are
  unaffected; only code that read a setter's result has to move to the
  updater form (`setColumnWidth((w) => w * 2)`). Exported as a type from
  `src/stores/ganttConfigStore.ts`. (D13)

### Added

- `taskStore.patchTask(id, patch)` — merge a partial task in one draft write.
- `taskStore.setTaskProgress(id, progress)`.
- `taskStore.setBarYs(ys: Map<string, number>)` — one draft write for an
  entire row-layout pass instead of one write per bar.
- An optional explicit id list on the bulk collapse calls:
  `taskStore.collapseAllTasks(ids?)` and `resourceStore.collapseAll(ids?)`.
  With no argument they derive the target list from committed state, exactly
  as before. A caller that has just written the task or resource list in the
  same turn should pass the ids it built — otherwise the read-back answers
  with the pre-write list and the wrong rows collapse.
- **Additive geometry arguments on two `<Gantt>` callbacks.**
  `onDateChange(taskId, { start, end }, position?)` gains a third argument
  and `onResizeEnd(taskId, geometry?)` a second — both
  `{ x: number; width: number }`, the pixel rect the gesture produced and
  the one the dates were derived from. Existing two- and one-argument
  consumers are unaffected; a consumer that needs pixels no longer has to
  read them back off the store, where the producing write may still be
  staged. (D13)

### Fixed

- **Task expansion did nothing.** `ganttConfigStore`'s `toggleTaskExpansion`,
  `expandTask` and `collapseTask` wrote no state and notified no subscriber:
  `expandedTasks` was a `Set` living inside a store, and a `Set` cannot be
  proxied. It is now a signal holding an immutable `Set` that is replaced on
  every mutation. The public accessor still hands back a `Set<string>`.
- **`ColumnPanel` cells were static.** The row callback held a bare store
  read that never re-ran, so a custom column's cell kept its first value for
  the life of the row. Cells now re-render when their task changes.

### Behaviour to be aware of (no signature change)

- **`useGanttStores()` still returns `GanttStores | undefined`** — `undefined`,
  never `null`, outside a `<GanttProvider>`, so `useGanttStores() ?? ownStores`
  keeps working. Solid 2.0 makes a default-less context *throw* in
  `useContext`, so this context is deliberately created with a `null` default
  and the hook maps that back to `undefined`.
- **`TaskStore` readers answer about committed state.** `getTask`,
  `getBarPosition`, `getAllTasks`, `taskCount` and `isTaskCollapsed` — and
  `resourceStore.isGroupCollapsed` — track normally when read from JSX, a
  memo, or an effect's compute. Called immediately after a write in the same
  turn they report the *pre-write* value, because Solid 2.0 stages writes
  until the microtask flush. `flush()` commits early; it is legal in event
  handlers, timers, promise continuations and test bodies, is a silent no-op
  inside an effect's apply, and throws inside `onSettled`.
- **`ColumnDef.render(task, resourceId)` must be pure.** It is called from
  inside a tracking scope on every re-render of its cell: return markup, and
  do not write to a store, start a request, or create a reactive primitive
  from it.
- No public prop, option, or task-data field name changed in this release.

See [README.md](README.md#reactivity--timing) for the consumer-facing timing
rules and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the internals.
