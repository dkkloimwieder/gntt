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

## SolidJS 2.0 migration rules (in progress until E3 lands)

This repo is still on `solid-js` 1.9.x. The migration to SolidJS 2.0 is tracked as beads epics E0–E7: E0–E2 land on `main` and **must be 100% behaviour-preserving on 1.9**, the flip to 2.0 happens in E3 on the `solid-2` branch. Until E3 lands, do **not** import from `@solidjs/web` or `@solidjs/signals` and do not use `onSettled` or `flush()` — none of it exists yet here. Instead write every new or refactored site in the shape 2.0 requires (each rule below is a no-op or a plain refactor on 1.9), keep `onMount`/`createEffect` shapes that E3 can rewrite mechanically, and use the `settle()` test helper in place of `flush()`.

Source of truth: `docs/migration/solid2/PLAN.md` — sections "Runtime facts that shape every issue", "Working rules", and the D1–D13 decision table. Per-site rewrites for the 820 audited sites: `docs/migration/solid2/digest-t1.md` and `docs/migration/solid2/digest-t2.md`. API reference: `docs/migration/solid2/reference/CHEATSHEET.md` and `reference/08-dev-diagnostics.md`.

1. **Deferred writes.** Setters stage the write; reads return the committed value until the microtask flush or an explicit `flush()`. Functional updaters compose against the staged value, and store draft callbacks see staged state — the outer store proxy does not.
2. **Write guard.** Writes throw `REACTIVE_WRITE_IN_OWNED_SCOPE` (dev) inside component bodies, memo bodies, effect *compute* phases and anything they call — `untrack` does **not** clear the owner. Store setters are exempt inside `createRoot` bodies; plain signal setters are **not**. Allowed write sites: event handlers, timers, promise continuations, effect *apply*, `onSettled` bodies, and signals created with `{ ownedWrite: true }`.
3. **`onSettled` replaces `onMount`.** Its body is untracked and children-forbidden (no `onCleanup`, no primitive creation, directly or via a callee); it must return `undefined` or a cleanup *function* — a concise arrow returning a setter result or a Promise throws. `flush()` inside it throws. Never call a consumer callback (`onReady`, `onContainerReady`) synchronously from it; defer with `queueMicrotask`.
4. **Split effects only.** `createEffect(compute, apply, { defer? })` is the only form. `compute` tracks and must return plain values, never store proxies; `apply` is untracked, may write, and may return only a cleanup function. `flush()` inside apply is a silent no-op.
5. **`flush()` legality table.** Legal in event handlers, timers, promise continuations and test bodies · silent no-op in effect apply · throws in `onSettled` and `createTrackedEffect`. The only sanctioned library site is `useDrag`'s mouseup.
6. **Stores.** One draft setter: path setters, `produce` and `unwrap` are gone — `storePath` is the compat helper, `snapshot` replaces `unwrap`, and `reconcile(v, key='id')` now returns a draft function. `delete draft[k]` removes a key — assigning `undefined` keeps it. `Set`/`Map`/`Date` inside a store are **not** proxied: replace them, never mutate in place, and prefer a signal holding an immutable collection. Leaf-mutate `task._bar.x`, never replace the task object. A memo returning a store sub-proxy never invalidates, so bindings must read their own leaf.
7. **Memos are eager.** `{ lazy: true }` also opts into autodisposal; `loadingValue` replaces the 1.x initial value; `createMemo(fn, options)` is the only form.
8. **Control flow.** `<Index>` becomes `<For keyed={false}>` — same callback shape, but the callback body now carries a strict-read label, so store reads stay in JSX or memos.
9. **Context.** The context object is itself the provider: `<Ctx value={...}>`. A default-less context makes `useContext` throw, so optional-provider APIs use `createContext<T | null>(null)`.
10. **Tests.** Call `settle()` after every write (a no-op on 1.9, `flush` after the flip). Store writes may sit in `createRoot` bodies; signal writes may not. Once E0.4 lands, Vitest runs two projects: `client` = jsdom (`tests/*.test.{ts,tsx}`), `server` = node (`tests/server/**`).
11. **Block bodies.** Every callback handed to `onSettled` or to an effect's apply, or crossing a component boundary, gets a block body. Grep for candidates with `grep -rnE '=> set[A-Z]|=> props\.on[A-Z]' src` — most hits are inline JSX event handlers, which rule 2 declares legal write sites; only the ones handed to a lifecycle primitive or across a component boundary are violations.
12. **Data flow.** Producers return their computed values; consumers never read back state they just wrote; store existence guards move inside the draft. Do **not** "fix" what the audit verified safe: functional updaters within one tick (`selectionStore`, the `useBoxSelect` hit loop), `batchMovePositions` reading the draft, and per-frame rAF drag loops (each frame is a separate task).

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
