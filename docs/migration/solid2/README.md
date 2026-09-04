# SolidJS 2.0 (rc.6) migration — planning artifacts

Generated 2026-09-03 by the planning session that produced `PLAN.md` (the approved plan and beads epic tree).

| File | What it is |
|---|---|
| `PLAN.md` | The approved migration plan: decisions D1–D13, working rules, epic tree E0–E7, sequencing, verification. |
| `audit-result.json` | Full read-only audit of every Solid-touching file: 820 migration sites with concrete rewrites, 135 write-then-read hazards, per-area critics, and the cross-file call-chain tracer (chains A–J3). |
| `digest-t1.md` | Batch summaries, structural concerns, critics (missed/disputed/cross-cutting), tracer chains. Start here. |
| `digest-t2.md` | Every high-severity hazard and every structural site, with the prescribed rewrite. |
| `audit-digest.md` | Superset of t1+t2 including medium-severity hazards. |
| `design-result.json` / `design-digest.md` | Three independent design plans (incremental-safety, end-state-idioms, verification-first) and their adversarial reviews; the plan synthesizes them. |
| `sma-report.txt` | Output of the official `solid-migration-assistant@0.2.1` (advisory; pinned to rc.0). |
| `reference/` | Snapshot of the official docs read during planning: `MIGRATION.md`, RFCs 01–09, `CHEATSHEET.md` (ships in solid-js 2.0), and the v2 docs reference pages (`v2/*.mdx`). |

Runtime facts in `PLAN.md` were verified against the published `@solidjs/signals@2.0.0-rc.6` dev build; where the audit's per-agent brief was later corrected by the critics (createRoot signal writes throw, `onSettled` is untracked, `flush()` legality, return-value validation), the plan's text is authoritative.
