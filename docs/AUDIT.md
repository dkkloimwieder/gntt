# Code Quality & Consistency Audit

**Date:** 2026-05-09
**Scope:** Library source — `src/components/`, `src/stores/`, `src/utils/`, `src/hooks/`, `src/contexts/`, `src/entries/`, `src/scripts/`, `src/index.ts`, top-level configs (`package.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`, vite configs), and `docs/`.
**Out of scope:** `src/demo/` (demo-only per CLAUDE.md), `benchmarks/`, `dist*/`, `node_modules/`.
**Tracking:** Parent epic [`gantt-qa9`](#) — every finding below is a bd issue and depends-on-blocks the parent.

## Methodology

1. **Tooling baseline** — ran `pnpm typecheck`, `pnpm lint`, `pnpm prettier-check`, `pnpm build`. Raw output saved to `/tmp/audit-{typecheck,lint,prettier,build}.log` (not committed).
2. **Targeted grep sweeps** — file size ranking, console statements, snake/camel API drift, handler naming, export style, store reactivity counts, magic numbers, duplicated logic.
3. **Two parallel Explore agents** for cross-file synthesis (structure survey + smell hunt).
4. **Issue triage** — each finding scored P1 (correctness/public surface), P2 (impedes contribution), P3 (hygiene), P4 (nice-to-have).

This audit is **report-only**. No source code modified — only `docs/AUDIT.md` (new) and `.beads/` (issue creation). Fixes ship as separate, reviewable diffs per issue.

## Findings

| bd id | Category | Severity | File(s) | Summary |
|---|---|---|---|---|
| [`gantt-lld`](#) | Tooling | **P1** | `eslint.config.mjs` deps | `pnpm lint` crashes — eslint-plugin-prettier@2.7.0 incompatible with prettier@3 |
| [`gantt-3p2`](#) | Build | **P1** | `package.json:32-36` | `exports` field: `"style"` condition unreachable (after `import`/`require`); CSS subpath broken for bundlers |
| [`gantt-ltu`](#) | Hygiene | **P1** | `src/components/Bar.tsx:551` | Debug `console.log('[Bar task-0]', …)` shipped in production |
| [`gantt-i8b`](#) | Public API | **P2** | `src/types.ts:273-309`, `src/utils/defaults.ts`, `src/stores/gantt{Config,Date}Store.ts` | Both snake_case (`column_width`) and camelCase (`columnWidth`) accepted; types declare both |
| [`gantt-84c`](#) | Pattern drift | **P2** | `src/stores/ganttConfigStore.ts` | 21 raw `createSignal` calls; outlier vs `taskStore` (createStore) and `ganttDateStore`/`resourceStore` (signals + memos) |
| [`gantt-tor`](#) | Duplication | **P2** | 6 files (Bar, Grid, DateHeaders, barCalculations, gantt{Config,Date}Store) | `columnWidth ?? 45` default duplicated; same for `barHeight ?? 30` |
| [`gantt-wih`](#) | Formatting | **P2** | 54 files | Prettier drift across all of `src/` and `tests/`; not enforced in CI |
| [`gantt-six`](#) | Docs | **P2** | `docs/{DEMOS,EXPERIMENTS,MINIMAL_TEST,PERFORMANCE}.md` | All references say `.jsx`/`.js`; codebase is `.tsx`/`.ts` |
| [`gantt-1fl`](#) | Hygiene | **P3** | `src/utils/{taskProcessor,hierarchyProcessor}.ts` | Validation `console.warn`/`console.error` not routed through a configurable handler |
| [`gantt-6qn`](#) | Decomposition | **P3** | `src/components/{Arrow,Bar,Gantt,TaskLayer,ArrowLayerBatched}.tsx` | 5 components 488–845 lines, mixing render + state + event wiring |
| [`gantt-09w`](#) | Naming | **P3** | `src/entries/` | kebab-case (`perf-isolate.tsx`) mixed with camelCase (`indexTest.tsx`) |
| [`gantt-8mo`](#) | Naming | **P3** | `src/utils/date_utils.ts` | snake_case filename; peers in `src/utils/` use camelCase |
| [`gantt-c3z`](#) | Pattern drift | **P3** | `src/utils/{date_utils,rowLayoutCalculator,subtaskGenerator,taskProcessor}.ts` | Default-export object in 4 utils; rest use named exports |
| [`gantt-orl`](#) | Magic numbers | **P3** | `src/components/Bar.tsx:359,362,649,719` | Hardcoded label/progress offsets and percentage caps; pattern from `Arrow.tsx` (ARROW_DEFAULTS block) not applied |
| [`gantt-5jz`](#) | Test infra | **P4** | `package.json`, `tests/` | No test runner configured; sole `tests/date_utils.test.js` cannot run |

## Heatmap

**By severity:**
| P1 | P2 | P3 | P4 |
|----|----|----|----|
| 3 | 5 | 6 | 1 |

**By category:**
| Category | Count |
|---|---|
| Pattern drift / duplication | 4 |
| Naming / public API | 4 |
| Tooling / build / formatting | 3 |
| Hygiene (console / magic numbers) | 3 |
| Test infra | 1 |

**Top files by finding density:**
| File | Findings |
|---|---|
| `src/components/Bar.tsx` | 3 (`gantt-ltu`, `gantt-tor`, `gantt-orl`) |
| `src/stores/ganttConfigStore.ts` | 3 (`gantt-i8b`, `gantt-84c`, `gantt-tor`) |
| `src/utils/defaults.ts` | 1 (`gantt-i8b`) |
| `src/components/Grid.tsx`, `DateHeaders.tsx` | 1 each (`gantt-tor`) |
| `package.json` | 1 (`gantt-3p2`) |

## Recommended order of attack

1. **Public-surface bugs first** — `gantt-3p2` (exports field), `gantt-ltu` (debug log), `gantt-i8b` (snake/camel API). These are visible to consumers; fix before any cleanup work that might depend on the canonical API name.
2. **Restore tooling** — `gantt-lld` (lint pipeline) so subsequent changes get automated linting. Then `gantt-wih` (prettier --write) lands as one commit immediately after, leaving the tree clean.
3. **Docs alignment** — `gantt-six` (.jsx → .tsx in docs). Trivial mechanical change; do once tooling is restored to verify there are no other doc paths referencing files that have moved.
4. **Pattern consolidation** — `gantt-84c` (ganttConfigStore → createStore) before `gantt-tor` (default duplication), since the consolidated store becomes the single source of truth for defaults.
5. **Hygiene & decomposition** — `gantt-1fl`, `gantt-orl`, `gantt-c3z`, `gantt-8mo`, `gantt-09w` are independent low-risk diffs; can land in any order.
6. **Decomposition epic** — `gantt-6qn` is itself an epic; spawn per-component sub-issues when ready. Don't tackle alongside other component-touching changes.
7. **Test infra** — `gantt-5jz`. Standalone; best done once `gantt-i8b` (API canonicalization) has stabilized so tests aren't rewritten.

## Out of scope (explicit non-goals)

- **`src/demo/`** — known bloat (e.g., `ShowcaseDemo.tsx` 2023 lines, duplicated `useDrag` boilerplate across 8+ files). Deferrable.
- **Performance audits** — covered by `benchmarks/` and `docs/PERFORMANCE.md`.
- **`src/components/BarMinimal.tsx` and `TaskLayerMinimal.tsx`** — investigated as suspected dead code, but `Gantt.tsx:18,592` actively imports `TaskLayerMinimal`; not dead.
- **`src/utils/constraintEngine.ts` (954 lines)** — single self-contained algorithm with extensive ASCII-diagram docs. Decomposing would cost more than it saves.
- **Implementation of any fix** — every finding above is a tracked bd issue; fixes land separately.

## Verification of this audit

- `bd list --status=open` — should list 16 issues (1 epic + 15 children).
- `bd show gantt-qa9` — should show 15 dependencies (all children).
- All cited `file:line` references were captured from a clean tree at commit `c41d217` and verified by re-running the grep sweeps before each issue was filed.
