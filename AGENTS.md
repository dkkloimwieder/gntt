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

The project uses SolidJS 2.0.4, `@solidjs/web` 2.0.4, and `@solidjs/vite-plugin` 3.0.1.
Import reactivity, stores, and control flow from `solid-js`. Import DOM APIs and JSX types from `@solidjs/web`.
Set `jsxImportSource` to `@solidjs/web`. The package exports ES modules and requires Node 22.12 or later.

The installed `node_modules/solid-js/CHEATSHEET.md` describes the current runtime.
The RC migration plan and its measurements are in `docs/migration/solid2/PLAN.md`.

1. **Deferred writes.** Setters stage the write; reads return the committed value until the microtask flush or an explicit `flush()`. Functional updaters compose against the staged value, and store draft callbacks see staged state — the outer store proxy does not.
2. **Write guard.** Writes throw `REACTIVE_WRITE_IN_OWNED_SCOPE` (dev) inside component bodies, memo bodies, effect *compute* phases and anything they call — `untrack` does **not** clear the owner. The guard covers both store and signal setters inside `createRoot` bodies. Allowed write sites: event handlers, timers, promise continuations, effect *apply*, `onSettled` bodies, and signals created with `{ ownedWrite: true }`.
3. **`onSettled` is the mount hook.** Its body is untracked and children-forbidden (no `onCleanup`, no primitive creation, directly or via a callee); it must return `undefined` or a cleanup *function* — a concise arrow returning a setter result or a Promise throws. `flush()` inside it throws. Never call a consumer callback (`onReady`, `onContainerReady`) synchronously from it; defer with `queueMicrotask`.
4. **Split effects only.** `createEffect(compute, apply, { defer? })` is the only form. `compute` tracks and must return plain values, never store proxies; `apply` is untracked, may write, and may return only a cleanup function. The apply callback runs each time compute reruns, including when it returns the same value. To skip equal values, track a memo. `flush()` inside apply is a silent no-op.
5. **`flush()` legality table.** Legal in event handlers, timers, promise continuations and test bodies · silent no-op in effect apply · throws in `onSettled` and `createTrackedEffect`. The only sanctioned library site is `useDrag.handleMouseUp` (`src/hooks/useDrag.ts`), where the final drag move must commit before `onDragEnd` re-reads the geometry. Do not add another.
6. **Stores.** One draft setter: `setX((s) => { s.k = v; })`. Path setters and object-merge forms are gone and **silently no-op** if you write them — that is the failure mode that broke the showcase demo. `storePath` is the compat helper, `snapshot` replaces the 1.x unwrap, and `reconcile(v, key='id')` returns a draft function. `delete draft[k]` removes a key — assigning `undefined` keeps it. `Set`/`Map`/`Date` inside a store are **not** proxied: replace them, never mutate in place, and prefer a signal holding an immutable collection (as `ganttConfigStore.expandedTasks` and `taskStore.collapsedTasks` now do). Leaf-mutate `task._bar.x`, never replace the task object. A memo returning a store sub-proxy never invalidates, so bindings must read their own leaf.
7. **Memos are eager, and stay eager (D7, measured in E4.5).** A memo recomputes on every source change whether or not anything reads it. `createMemo(fn, { lazy: true })` changes two things you will notice: the compute at creation is skipped (repaid on the first read, which also clears the lazy flag for good), and auto-dispose is turned on — the memo is torn down when its last tracked subscriber leaves, and again on every flush after an *ownerless* read (event handler, timer, rAF, promise continuation, **an effect's apply phase**, `untrack` at a root), so a lazy memo read only from such scopes recomputes once per tick it is read in. With a live tracked subscriber (JSX, another memo, an effect compute) a lazy memo recomputes exactly as often as an eager one — the probe on the 10K experiments page counted identical recomputes per scroll step for both. Use `{ lazy: true }` only for a memo that spends time with **zero** tracked subscribers (behind a `<Show>`, a closed popup), is never read from an ownerless scope while unsubscribed, and is not read by an eager memo in its creation tick (no lint or diagnostic checks that last one — read the wrapper chain). No library memo qualifies today, so none is lazy; the only `{ lazy: true }` in the tree is the demo-only probe switch in `src/demo/GanttExperiments.tsx`. A memo created with no owner gets the same auto-dispose lifecycle without asking. `loadingValue` replaces the 1.x initial value; `createMemo(fn, options)` is the only form. `tests/memoLaziness.test.ts` pins these semantics.
8. **Control flow.** Index-keyed lists are `<For keyed={false}>` — the callback body carries a strict-read label, so store reads stay in JSX or in a memo.
9. **Context.** The context object is itself the provider: `<Ctx value={...}>`. A default-less context makes `useContext` throw, so optional-provider APIs use `createContext<T | null>(null)`.
10. **Tests.** `settle()` (`tests/helpers/settle.ts`) re-exports `flush`; call it after every write, before reading anything back. Create owned observers inside `createRoot`. Write to stores and signals from the test body. Vitest runs two projects: `client` = jsdom over `tests/**/*.test.{ts,tsx}` minus `tests/server/**`, `server` = node over `tests/server/**/*.test.ts`. Component suites mount through `tests/helpers/mountGantt.tsx`, which models the layout jsdom does not, allows one live mount at a time, and throws if a previous mount was never disposed.
11. **Block bodies.** Every callback handed to `onSettled` or to an effect's apply, or crossing a component boundary, gets a block body. Grep for candidates with `grep -rnE '=> set[A-Z]|=> props\.on[A-Z]' src` — most hits are inline JSX event handlers, which rule 2 declares legal write sites; only the ones handed to a lifecycle primitive or across a component boundary are violations.
12. **Data flow.** Producers return their computed values; consumers never read back state they just wrote; store existence guards move inside the draft. Do **not** "fix" what the audit verified safe: functional updaters within one tick (`selectionStore`, the `useBoxSelect` hit loop), `batchMovePositions` reading the draft, and per-frame rAF drag loops (each frame is a separate task).

**Diagnostics gate.** The client suite captures Solid's development diagnostics with `OBSERVE.diagnostics.capture()`. It fails on warnings or errors during chart mount, drag, expansion, a view change, and disposal. A separate test deliberately triggers `STRICT_READ_UNTRACKED` to make sure that capture works. See [the tests](tests/diagnostics.gate.test.tsx).

Use a browser to exercise demo routes and native layout outside those tests. Move a strict read into JSX, a memo, or an effect compute when it must track changes. Use `untrack` for a deliberate one-time read. For `REACTIVE_WRITE_IN_OWNED_SCOPE`, move the write to a permitted scope. The chart's `setDiagnosticHandler()` handles input validation messages separately.

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
