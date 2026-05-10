# RFC: Undo / Redo

**Status:** Proposed — awaiting maintainer sign-off
**Issue:** gantt-8kw (P2)
**Author:** dkk + Claude
**Date:** 2026-05-10

## Why an RFC

Undo/redo is a small surface but a load-bearing one: the choices we
make about granularity, scope, and persistence calcify quickly because
consumer apps build flows on top of them. Six questions need answers
before any code lands. This document proposes answers; v1 implementation
follows once the maintainer signs off.

## 1. Scope — which mutations are undoable in v1?

**Proposal:** The three mutations users can already perform via direct
manipulation today.

| Mutation | Trigger surfaces | In v1? |
|---|---|---|
| Move (change `_bar.x`) | drag, keyboard arrow | ✅ |
| Resize (change `_bar.width`) | left/right handle drag, Shift+arrow | ✅ |
| Progress change | progress handle drag | ✅ |
| Resource reassignment | (no UX exists yet) | ❌ defer |
| Dependency edit | (no UX exists yet) | ❌ defer |
| View-mode change | toolbar | ❌ never — that's a navigation, not data |

Rationale: every mutation that has a polished input surface should be
undoable, and nothing else. Adding undoability for resource/dependency
edits before those edit flows exist would lock in an action shape that
might not match the eventual UX. Easy to add later — the action
registry is open.

## 2. Granularity — one undo per pointer move, or per gesture?

**Proposal:** Coalesce per gesture.

- **Drag/resize:** one undo entry per `mousedown → mouseup` cycle.
  Captured at drag-start, committed at drag-end. Mid-drag pointer
  moves do not push entries.
- **Keyboard:** coalesce arrow-key runs by a 500 ms idle gap. Pressing
  `→ → → →` quickly = one undo entry; pausing 500 ms then pressing `→`
  = two entries. Same rule for `Shift+→` resize and progress nudges
  (if added later).

Why: per-pointer-move coalescing produces 60 undo entries for a
half-second drag — unusable. Per-gesture matches what users perceive
as a single edit.

## 3. Persistence — memory only, localStorage, or consumer-provided?

**Proposal:** Memory only by default, with a consumer escape hatch.

- Default: in-memory ring buffer, capped at 50 entries (configurable
  via `<GanttProvider historyDepth={N}>`).
- Escape hatch: `useHistory()` exposes `serialize()` and `deserialize()`
  so a consumer that wants localStorage / IndexedDB / a backend can
  wire it themselves. We do not ship a localStorage adapter — the
  serialization shape is tiny enough that consumers can persist it in
  three lines.
- The history is cleared on `tasks` prop replacement (different dataset
  → different history). A `clear()` method exists too.

Why: localStorage in v1 invites version-skew bugs (loaded actions
referring to taskIds that no longer exist). Memory-only keeps v1 honest
about scope while leaving the door open.

## 4. API shape — imperative, declarative, or both?

**Proposal:** A `useHistory()` hook with default keyboard bindings.

```tsx
import { GanttProvider, Gantt, useHistory } from 'ganttss';

function Toolbar() {
    const h = useHistory();
    return (
        <>
            <button disabled={!h.canUndo()} onClick={h.undo}>Undo</button>
            <button disabled={!h.canRedo()} onClick={h.redo}>Redo</button>
        </>
    );
}

function App() {
    return (
        <GanttProvider>
            <Toolbar />
            <Gantt tasks={tasks} />
        </GanttProvider>
    );
}
```

Hook surface:
```ts
interface History {
    undo: () => void;
    redo: () => void;
    canUndo: Accessor<boolean>;
    canRedo: Accessor<boolean>;
    clear: () => void;
    serialize: () => string;
    deserialize: (json: string) => void;
}
```

Default keyboard bindings, attached at the chart container:
- `Cmd/Ctrl+Z` → undo
- `Cmd/Ctrl+Shift+Z` and `Cmd/Ctrl+Y` → redo

Opt out via `<GanttProvider keyboardShortcuts={false}>` for apps with
their own shortcut systems.

No imperative `gantt.undo()` ref-based API. The hook + provider pattern
is already idiomatic SolidJS (we just shipped `gantt-kfx`); a parallel
ref-based API would split the surface for no benefit.

## 5. Constraint cascades — undo the whole cascade or just the user's edit?

**Proposal:** Undo the whole cascade.

When a user moves task A and the constraint engine cascades
successors B, C, D, the recorded action captures the before/after
position of *all* affected tasks. Undo restores all four. Redo
re-applies all four directly (no re-running the constraint engine —
the after-state is already known).

Why: the user's mental model is "I made one change." Undoing only the
direct edit and leaving cascaded successors in their new state would
feel broken. It also avoids re-running constraint resolution on undo,
which is what the engine itself was designed to express in one pass.

## 6. Multi-user — keep the door open

**Proposal:** Action descriptors, not snapshots.

Each undo entry is an action object, not a binary snapshot:

```ts
type HistoryEntry = {
    type: 'move' | 'resize' | 'progress';
    timestamp: number;
    changes: Array<{
        taskId: string;
        before: Partial<BarPosition> | { progress: number };
        after:  Partial<BarPosition> | { progress: number };
    }>;
};
```

This shape is JSON-serialisable today, transmittable over the wire
tomorrow, and convertible into yjs/Loro operations the day after. We
do not ship CRDT integration in v1; we just don't preclude it.

Snapshot-based history (whole-store dumps) was rejected: cheaper to
write, but ~50 KB per entry × 50 entries = 2.5 MB resident, and it
collapses the whole multi-user story before it starts.

## What v1 does *not* include

- localStorage / IndexedDB persistence (consumer-provided only)
- yjs / CRDT integration (future v2 — design accommodates it)
- Undo grouping across multiple gestures ("undo this whole batch")
- Visual indicator of how many undo steps are pending
- Undo of view-mode / config changes
- A "history panel" component

Each of these is a future bd issue once v1 ships.

## Open questions

1. Should `undo` while the user is *mid-drag* be a no-op or cancel the
   drag? Proposal: no-op. Mid-drag undo via keyboard is a confusing
   surface, and Escape already cancels drags in flight (TODO confirm).
2. Should we expose a `subscribe(fn)` on the history so consumers can
   react to undo/redo events without polling `canUndo()`? Proposal:
   yes, low-cost addition.
3. Should keyboard shortcuts fire only when focus is inside the chart,
   or globally on the document? Proposal: only inside the chart, to
   avoid hijacking app-level shortcuts.

## Implementation plan (sketch — only after sign-off)

1. New `src/utils/historyStore.ts` — pure ring buffer + apply/inverse
   logic, no Solid dependencies.
2. New `src/hooks/useHistory.ts` — Solid wrapper exposing accessors +
   keyboard binding effect.
3. Wire `taskStore.batchMovePositions`, `updateBarPosition`, and the
   progress-change path to push history entries — guarded by an
   "is recording?" flag so undo's own re-application doesn't push
   itself.
4. Default keyboard listener at `GanttContainer` root.
5. README section + minimal demo.
6. Tests (vitest): apply → undo → redo → verify state matches; cascade
   round-trip; depth cap; serialize round-trip.

Estimated 250–350 LOC. One commit if it stays under that; split if it
grows.

## Decision needed

Maintainer to sign off, request changes, or veto. Three explicit
choice points:

- **Q1 scope** — accept the three-mutation v1, or push for resource /
  dependency edits in v1 too?
- **Q3 persistence** — accept memory-only-with-escape-hatch, or ship a
  localStorage adapter in v1?
- **Q4 API** — accept hook-only, or add an imperative ref API too?

The other three (granularity, cascades, multi-user-friendly action
shape) are proposed as the only reasonable answer; flag if not.
