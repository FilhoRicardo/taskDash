# TaskDash 2.2 fix review — 2026-10-02

Reviewed against baseline `4420d20322fd049948fd180e861bbfd214d42957` from independent worktree `/Users/ricardofilho/.codex/worktrees/review-2026-10-02/taskdash-2-2`. Every worker branch and commit tip resolved in the repository. The complete machine-readable disposition is in `integration-manifest.json`.

## Dispositions

Issues 1–23, 25–27 are **APPROVED** for integration, subject to the ordering and conflict resolutions in the manifest. Issue 24 is **CHANGES NEEDED**: its release workflow does not run the JSX lint introduced by issue 26, so the release gate is incomplete until CI runs the final test, build, and lint commands. No issue is blocked; browser/native-host checks are verification gaps, not blockers to integrating the source changes.

## Cross-commit findings

- Recurrence issues 2, 6, 7, and 8 must be integrated as one evaluator stack. Issue 2 is the authoritative evaluator and must retain scalar normalization, skipped-date exclusions, and UTC civil-day arithmetic. The old fallback evaluator must not survive in either calendar or completion paths. Issue 3 is applied after that evaluator and keeps overdue comparison on the occurrence date.
- Formatter/history changes 1, 5, and 9 overlap. Merge CRLF delimiter preservation, list-key replacement, and YAML scalar decoding without allowing duplicate `complete_instances` keys or converting untouched note content. Re-run LF, CRLF, inline, indented, quoted, and unindented history cases.
- IO-2 and IO-3 both replace the same `App.jsx` timer stop path. Keep expected-content stale-write protection from IO-2 and stopEnd/idempotent retry state from IO-3. A retry must append exactly one tracker row and a failed stale write must leave the timer available.
- Issues 11, 14–16, 18–22, and 25 all touch App/integration tests. Resolve by behavior, not whole-file cherry-pick order; preserve draft cancellation, settings refresh, archive retry, focus restoration, picker Escape/activation, labels, and Close coverage together.
- Tooling order is dependency update (23), JSX lint (26), transform cleanup (27), then CI/release wiring (24). Amend CI to invoke lint. Re-run `npm ci`, tests, build, lint, `npm audit --omit=dev`, full audit, and tag validation in an isolated checkout.

## Independent checks

The reviewed worker tips were read directly from Git refs and their registered worktrees. Targeted independent runs passed for the recurrence evaluator branch (95 tests), IO-2 (90), IO-3 (91), and dependency branch (89); the JSX-lint branch's lint command completed without reported findings. These are branch-level checks, not evidence that the combined result is correct. Real browser keyboard/focus behavior, screen-reader semantics, Obsidian host behavior, remote CI, and release publication remain unverified by design. No live-vault installation or release action was performed.

## Review artifact

Review worktree: `/Users/ricardofilho/.codex/worktrees/review-2026-10-02/taskdash-2-2`

The report and manifest are intentionally the only changes in this review worktree. Shared `main` and remotes were not modified.
