# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## SolidJS 2.0 rules

This repo runs **SolidJS 2.0**: `solid-js` and `@solidjs/web` at `2.0.0-rc.6`, compiled by `@solidjs/vite-plugin` 3.0.0-next.39 with `jsxImportSource: '@solidjs/web'`. The E0–E7 migration flipped in E3, so the rules below are no longer a checklist for a port that has yet to happen — they describe how this code already works, and every new or refactored site must be written this way. Reactivity, stores and control flow import from `solid-js`; DOM APIs (`render`, `Dynamic`, `Portal`, the `JSX` type) import from `@solidjs/web`. The 1.x subpath entry points no longer exist. Node is `^20.19 || >=22.12`, and the published package is ESM-only.

Source of truth: `docs/migration/solid2/PLAN.md` — sections "Runtime facts that shape every issue", "Working rules", and the D1–D13 decision table. Per-site rewrites for the 820 audited sites: `docs/migration/solid2/digest-t1.md` and `docs/migration/solid2/digest-t2.md`. API reference: `docs/migration/solid2/reference/CHEATSHEET.md` and `reference/08-dev-diagnostics.md`.

1. **Deferred writes.** Setters stage the write; reads return the committed value until the microtask flush or an explicit `flush()`. Functional updaters compose against the staged value, and store draft callbacks see staged state — the outer store proxy does not.
2. **Write guard.** Writes throw `REACTIVE_WRITE_IN_OWNED_SCOPE` (dev) inside component bodies, memo bodies, effect *compute* phases and anything they call — `untrack` does **not** clear the owner. Store setters are exempt inside `createRoot` bodies; plain signal setters are **not**. Allowed write sites: event handlers, timers, promise continuations, effect *apply*, `onSettled` bodies, and signals created with `{ ownedWrite: true }`.
3. **`onSettled` is the mount hook.** Its body is untracked and children-forbidden (no `onCleanup`, no primitive creation, directly or via a callee); it must return `undefined` or a cleanup *function* — a concise arrow returning a setter result or a Promise throws. `flush()` inside it throws. Never call a consumer callback (`onReady`, `onContainerReady`) synchronously from it; defer with `queueMicrotask`.
4. **Split effects only.** `createEffect(compute, apply, { defer? })` is the only form. `compute` tracks and must return plain values, never store proxies; `apply` is untracked, may write, and may return only a cleanup function. When `apply` has to run on *every* tracked change, `compute` must return a **fresh** value — an equal return is swallowed. `flush()` inside apply is a silent no-op.
5. **`flush()` legality table.** Legal in event handlers, timers, promise continuations and test bodies · silent no-op in effect apply · throws in `onSettled` and `createTrackedEffect`. The only sanctioned library site is `useDrag.handleMouseUp` (`src/hooks/useDrag.ts`), where the final drag move must commit before `onDragEnd` re-reads the geometry. Do not add another.
6. **Stores.** One draft setter: `setX((s) => { s.k = v; })`. Path setters and object-merge forms are gone and **silently no-op** if you write them — that is the failure mode that broke the showcase demo. `storePath` is the compat helper, `snapshot` replaces the 1.x unwrap, and `reconcile(v, key='id')` returns a draft function. `delete draft[k]` removes a key — assigning `undefined` keeps it. `Set`/`Map`/`Date` inside a store are **not** proxied: replace them, never mutate in place, and prefer a signal holding an immutable collection (as `ganttConfigStore.expandedTasks` and `taskStore.collapsedTasks` now do). Leaf-mutate `task._bar.x`, never replace the task object. A memo returning a store sub-proxy never invalidates, so bindings must read their own leaf.
7. **Memos are eager, and stay eager (D7, measured in E4.5).** A memo recomputes on every source change whether or not anything reads it. `createMemo(fn, { lazy: true })` changes two things you will notice: the compute at creation is skipped (repaid on the first read, which also clears the lazy flag for good), and auto-dispose is turned on — the memo is torn down when its last tracked subscriber leaves, and again on every flush after an *ownerless* read (event handler, timer, rAF, promise continuation, **an effect's apply phase**, `untrack` at a root), so a lazy memo read only from such scopes recomputes once per tick it is read in. With a live tracked subscriber (JSX, another memo, an effect compute) a lazy memo recomputes exactly as often as an eager one — the probe on the 10K experiments page counted identical recomputes per scroll step for both. Use `{ lazy: true }` only for a memo that spends time with **zero** tracked subscribers (behind a `<Show>`, a closed popup), is never read from an ownerless scope while unsubscribed, and is not read by an eager memo in its creation tick (no lint or diagnostic checks that last one — read the wrapper chain). No library memo with a live consumer qualifies today, so none is lazy — the one that formally qualifies, `createVirtualViewport.yRange`, has no reader at all and is slated for deletion; the only `{ lazy: true }` in the tree is the demo-only probe switch in `src/demo/GanttExperiments.tsx`. A memo created with no owner gets the same auto-dispose lifecycle without asking. `loadingValue` replaces the 1.x initial value; `createMemo(fn, options)` is the only form. `tests/memoLaziness.test.ts` pins these semantics.
8. **Control flow.** Index-keyed lists are `<For keyed={false}>` — the callback body carries a strict-read label, so store reads stay in JSX or in a memo.
9. **Context.** The context object is itself the provider: `<Ctx value={...}>`. A default-less context makes `useContext` throw, so optional-provider APIs use `createContext<T | null>(null)`.
10. **Tests.** `settle()` (`tests/helpers/settle.ts`) re-exports `flush`; call it after every write, before reading anything back. Store writes may sit in `createRoot` bodies; plain signal writes may not. Vitest runs two projects: `client` = jsdom over `tests/**/*.test.{ts,tsx}` minus `tests/server/**`, `server` = node over `tests/server/**/*.test.ts`. Component suites mount through `tests/helpers/mountGantt.tsx`, which models the layout jsdom does not, allows one live mount at a time, and throws if a previous mount was never disposed.
11. **Block bodies.** Every callback handed to `onSettled` or to an effect's apply, or crossing a component boundary, gets a block body. Grep for candidates with `grep -rnE '=> set[A-Z]|=> props\.on[A-Z]' src` — most hits are inline JSX event handlers, which rule 2 declares legal write sites; only the ones handed to a lifecycle primitive or across a component boundary are violations.
12. **Data flow.** Producers return their computed values; consumers never read back state they just wrote; store existence guards move inside the draft. Do **not** "fix" what the audit verified safe: functional updaters within one tick (`selectionStore`, the `useBoxSelect` hit loop), `batchMovePositions` reading the draft, and per-frame rAF drag loops (each frame is a separate task).

**Diagnostics gate.** The 2.0 dev build reports these mistakes as console diagnostics rather than as failures, so a green `pnpm test` does not clear them — a browser does. Two codes matter here: `REACTIVE_WRITE_IN_OWNED_SCOPE` (error; rule 2) and `STRICT_READ_UNTRACKED` (warn — a reactive read in a component body, an effect apply or an `onSettled` body). The library path is clean and every demo page loads console-clean apart from the app's own fixture-validation warnings; **adding a diagnostic is a regression**. Fix a strict read either by moving it where it should track (JSX, a memo, an effect compute) or, when it is a deliberate one-shot, by wrapping it in `untrack(() => ...)`, which clears the label. `src/utils/diagnostics.ts` and `setDiagnosticHandler()` are a separate, app-level channel for data-validation messages and are unrelated to the runtime's own diagnostics.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
