# Code Quality & Consistency Audit

**Date:** 2026-05-09 (filed) · 2026-05-10 (resolved)
**Status:** ✅ All 15 children + the parent epic closed. See [Resolutions](#resolutions) below.
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

All findings resolved — see commit hash for the per-issue diff.

| bd id | Severity | Summary | Status | Commit |
|---|---|---|---|---|
| `gantt-lld` | **P1** | `pnpm lint` crashes — eslint-plugin-prettier@2.7.0 incompatible with prettier@3 | ✅ | `63fa973` (Phase 2 of dep upgrade) |
| `gantt-3p2` | **P1** | `package.json` `exports` `"style"` condition unreachable | ✅ | `9be660d` |
| `gantt-ltu` | **P1** | Debug `console.log` shipped in `src/components/Bar.tsx` | ✅ | `9be660d` |
| `gantt-i8b` | **P2** | snake_case + camelCase API duals (breaking change) | ✅ | `8be739e` |
| `gantt-84c` | **P2** | ganttConfigStore: 21 signals → single `createStore` | ✅ | `e20bd6a` |
| `gantt-tor` | **P2** | UI defaults duplicated → centralized in `src/constants.ts` | ✅ | `d816938` |
| `gantt-wih` | **P2** | 54 files prettier drift (`pnpm prettier --write`) | ✅ | `c85745f` |
| `gantt-six` | **P2** | docs `.jsx`/`.js` → `.tsx`/`.ts` (7 files, 203 lines) | ✅ | `fc6bc67` |
| `gantt-1fl` | **P3** | Configurable diagnostic handler (`src/utils/diagnostics.ts`) | ✅ | `5822b3a` |
| `gantt-6qn` | **P3** | 5 large components decomposed (sub-issues below) | ✅ | epic |
| `gantt-09w` | **P3** | `src/entries` filenames kebab-case | ✅ | `85a485c` |
| `gantt-8mo` | **P3** | `src/utils/date_utils.ts` → `dateUtils.ts` (file + identifier) | ✅ | `5f3d810` |
| `gantt-c3z` | **P3** | Util default → named exports (4 files) | ✅ | `6eeb7af` |
| `gantt-orl` | **P3** | Bar.tsx layout magic numbers → named constants | ✅ | `dd4d161` |
| `gantt-5jz` | **P4** | vitest configured; existing test runs | ✅ | `9ec0d89` |

### Sub-issues spawned during resolution

| bd id | Origin | Summary | Status | Commit |
|---|---|---|---|---|
| `gantt-jkd` | gantt-fjr | 106 latent ESLint findings exposed by working pipeline | ✅ | `3104bae` |
| `gantt-imx` | gantt-5jz | 2 pre-existing test failures (timezone / fractional month) | ✅ | `7bf2d0c` |
| `gantt-nxz` | gantt-6qn | Decompose `Arrow.tsx` 892 → 285 | ✅ | `eaceb7e` |
| `gantt-yof` | gantt-6qn | Decompose `ArrowLayerBatched.tsx` 547 → 297 | ✅ | `4f4079b` |
| `gantt-e7n` | gantt-6qn | Decompose `TaskLayer.tsx` 584 → 217 | ✅ | `a7cc098` |
| `gantt-bwv` | gantt-6qn | Decompose `Bar.tsx` 803 → 547 | ✅ | `53eae5a` |
| `gantt-0vl` | gantt-6qn | Decompose `Gantt.tsx` 705 → 450 | ✅ | `38c4d28` |

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

## Resolutions

Beyond the 15 audit findings, an additional preparatory effort landed
first — see the dep-upgrade epic `gantt-6jw` (commits `aebcab2`,
`63fa973`, `6af3f52`, `25a9e52`, `12843ba`, `b826a13`). It closed
23 → 0 `pnpm audit` advisories and unblocked `gantt-lld` (the lint
pipeline was incompatible with prettier@3 until eslint-plugin-prettier
jumped from 2.7 → 5.5 in Phase 2).

**Outcomes:**

- `pnpm audit`: 23 advisories → **0**.
- `pnpm lint` exits 0 (was crashing before, then 2531 errors after
  the pipeline was unblocked, now clean).
- `pnpm test` runs (vitest installed; 12/12 passing).
- All 5 large component files trimmed: Arrow 892 → 285 (-68%),
  ArrowLayerBatched 547 → 297 (-46%), TaskLayer 584 → 217 (-63%),
  Bar 803 → 547 (-32%), Gantt 705 → 450 (-36%).
- Public API canonicalized to camelCase (one breaking change for
  consumers who passed snake_case option names).
- New extension points: `src/utils/diagnostics.ts` (configurable
  handler for validation warnings) is exported from `src/index.ts`.
- 30 commits over two days (2026-05-09 → 2026-05-10).
