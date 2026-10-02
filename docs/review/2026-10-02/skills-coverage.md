# TaskDash: coverage of 37 project skills

Evaluated 2026-10-02. Scope: workflow instructions only; no source audit, tests, builds, tracker operations, outbound writes, or chats. The only write is this requested report. The parent review delegates independent evaluations to subagents; this report covers the skill inventory.

**Conclusion:** these are instructions for producing and reviewing work, not 37 executable tests. The strongest review coverage comes from `code-review`, `tdd`, `diagnosing-bugs`, `triage`, `improve-codebase-architecture`, `codebase-design`, and `retro`. Several other skills feed those workflows or package their evidence. None establishes a complete TaskDash acceptance suite or proves the current code is covered.

## Coverage matrix and exact read skills

Every row below is an exact skill folder whose entire `SKILL.md` was read. All 37 paths are `<root>/<skill>/SKILL.md`, where `<root>` is `/Users/ricardofilho/Documents/Projects/active/taskdash-2-2/.agents/skills`. Classification is by primary purpose; secondary review value is stated separately. Reading the instructions did not invoke their workflows.

| Exact skill | Primary classification | Review/test contribution and limit |
|---|---|---|
| ask-matt | Planning/router | Routes work to TDD, review, diagnosis, and retro; performs no checks itself. |
| claude-handoff | Unrelated: coordination | Launches a fresh background Claude agent with a redacted summary; no independent verification. Not invoked. |
| code-review | Relevant review | Separate Standards and Spec axes over a pinned merge-base diff; does not run tests. |
| codebase-design | Relevant review reference | Interface depth, deletion test, locality, dependencies, and test surface; design heuristics, not functional proof. |
| diagnosing-bugs | Relevant test/diagnosis | Exact-symptom red-capable loop, minimization, falsifiable hypotheses, regression and original-scenario verification. Requires a specific bug. |
| domain-modeling | Planning/modeling | Tests terminology against concrete scenarios and code; glossary/ADR consistency supports review but is not a behavior suite. |
| git-guardrails-claude-code | Setup | Claude hooks block dangerous Git commands; verifies synthetic push input exits 2. Protects operations, not product behavior. |
| grill-me | Planning | Stateless wrapper around grilling; no code verification. |
| grill-with-docs | Planning | Grilling plus domain-modeling and retained decisions; no runtime checks. |
| grilling | Planning | Resolves dependent decisions, delegates fact gathering, and confirms shared understanding; no executable test coverage. |
| handoff | Unrelated: coordination | Portable redacted summary with artifact pointers; no review or tests. |
| implement | Implementation | Requires regular typechecks and single-file tests, full suite at end, then code-review; commits work. Not a read-only review workflow. |
| implement-spec | Implementation/orchestration | TDD per ticket and final integration-branch code-review; no explicit final integration-wide full-suite rerun in this file. Creates branches/merges and may change tracker/PR state. |
| improve-codebase-architecture | Relevant architecture review | Hotspot-driven friction scan, glossary/ADRs, deletion test, untested/hard-to-test seams, candidate ranking. Proposes refactors; does not validate behavior. |
| loop-me | Planning | Designs recurring-life workflow specs; no TaskDash product test requirement. |
| migrate-to-shoehorn | Implementation: test maintenance | Replaces TypeScript test assertions with partial/invalid fixtures; explicitly requires typecheck. Does not require behavior-suite execution or add coverage itself. |
| pr | Unrelated: evidence/reporting | Requires before/after evidence, visual summary, reversibility and blast-radius discussion. Supports review handoff; is not a test runner or approval gate. |
| prototype | Implementation: exploration | Runnable logic/state or UI experiment with visible state; explicitly skips tests. A prototype verdict is not production regression evidence. |
| research | Planning/research | Primary-source investigation with citations and a background agent; useful for disputed contracts, not current runtime correctness. |
| retro | Relevant process review | Session evidence, navigation, existing lint/check/CI wiring, missing guardrails, mechanical checks versus judgment standards. Reviews the agent environment, not product acceptance. |
| scaffold-exercises | Unrelated: education | Course-folder lint via `pnpm ai-hero-cli internal lint`; not TaskDash validation. |
| setup-matt-pocock-skills | Setup | Tracker, label and domain-doc configuration; enables workflows without testing product behavior. |
| setup-pre-commit | Setup | Husky, staged formatting, optional existing typecheck/test scripts and hook smoke test; missing scripts may be omitted, so installation alone proves little. |
| setup-ts-deep-modules | Setup: architecture guardrail | Dependency-cruiser entry-point, test-import and cycle rules; observed pass/fail/pass for a forbidden import. Layout/applicability must be verified before use. |
| tdd | Relevant test workflow | Public, pre-agreed seams; independent expected values; observed red before green; one vertical slice at a time. Does not specify TaskDash cases or coverage thresholds. |
| teach | Unrelated: education | Stateful lessons and learning feedback; no product verification. |
| to-questionnaire | Planning | Elicits missing stakeholder facts/decisions; covers stated information gaps, not code behavior. |
| to-spec | Planning | Defines user stories, testing decisions, highest existing seams and user confirmation. Acceptance input for Spec review; publishes to tracker. |
| to-tickets | Planning | Complete demoable/verifiable vertical slices, acceptance criteria, blockers, expand–contract for wide refactors. Defines work, does not execute tests. |
| triage | Relevant claim verification | Reproduce reported bugs; for PRs run relevant tests/commands and confirm claims; redundancy/prior-rejection checks. Full workflow also writes labels/comments/closes issues. |
| wait-what | Unrelated: communication | Re-explains using domain vocabulary; no review checks. |
| wayfinder | Planning | Decision map and research/prototype/grilling tickets for large uncertain efforts; defaults to decisions rather than deliverables. |
| wizard | Setup/manual operations | Shell syntax, optional shellcheck, static value-flow and CI-secret-name checks; no end-to-end execution by agent. Not a product test suite. |
| writing-beats | Unrelated: editorial | Article journey and concept grounding; no product review. |
| writing-for-agents | Unrelated: documentation support | Clear exhaustive completion criteria, context pointers, authoritative references; improves review briefs, not runtime coverage. |
| writing-fragments | Unrelated: editorial | Captures raw writing material; no product review. |
| writing-shape | Unrelated: editorial | Shapes an article from existing material; no product review. |

Additional references read in full: `.agents/skills/tdd/tests.md`, `.agents/skills/tdd/mocking.md`, `.agents/skills/codebase-design/DEEPENING.md`, and `.agents/skills/codebase-design/DESIGN-IT-TWICE.md`. Other linked templates/scripts/references were not evaluated; setup behavior and auxiliary branches are described only as promised by their SKILL.md instructions.

## Concrete requirements of relevant workflows

1. **Diff review (`code-review`):** resolve the supplied base ref, require a nonempty `git diff <base>...HEAD`, capture `git log <base>..HEAD --oneline`, locate originating spec and documented standards. Run separate parallel reviewers; preserve separate Standards/Spec findings. Standards includes 12 labeled Fowler heuristics: mysterious names, duplication, feature envy, data clumps, primitive obsession, repeated switches, shotgun surgery, divergent change, speculative generality, message chains, middle man, refused bequest. Repo rules override heuristics; tooling-enforced checks are excluded. Spec checks missing/partial requirements, unrequested behavior, and wrong implementation against quoted requirements. Missing spec must be explicit.
2. **Behavior-test quality (`tdd` + references):** confirm seams before creating tests; use public observable outcomes and independent expectations; avoid private-method/internal-mock/call-count assertions and tautologies. Mock system boundaries such as time, randomness and sometimes filesystem, rather than owned collaborators. For implementation, demonstrate one failing test followed by minimal code and a passing test per slice; refactoring belongs to review.
3. **Bug/performance verification (`diagnosing-bugs`):** show an already-run, fast, deterministic, unattended command asserting the exact symptom before theories; minimize the repro; rank 3–5 falsifiable hypotheses; change one variable per probe. Measure performance baseline before fixes/bisection. Add a failing regression at the real call-site seam when available; after a fix rerun both regression and original scenario. Document an absent seam, remove tagged debug artifacts, and record the proven cause.
4. **Incoming-claim verification (`triage`):** read full report/PR context; check already-implemented behavior and prior rejection; reproduce reporter steps or execute relevant PR tests. Report confirmed/failed/insufficient detail. This supplies evidence for a brief, not broad product coverage.
5. **Architecture coverage (`improve-codebase-architecture` + `codebase-design`):** scope to named areas or commit hotspots; consume glossary/ADRs; identify scattered knowledge, shallow interfaces, coupled seams and tests that miss real caller interactions. Apply the deletion test, classify dependencies and adapters, and assess locality/testability. Report recommendation strength and ADR conflicts. Design-it-twice requires 3+ distinct interface proposals only when exploring a chosen redesign; it is not required for ordinary review.
6. **Verification-system review (`retro`):** inspect primary session evidence and the repo's actual check/CI commands; flag missing, unwired or silently broken guardrails. Prefer deterministic tooling for mechanical violations and documented standards for judgment calls. The skill's prescribed next actions can mutate the environment; this evaluation only identifies their review value.

Supporting requirements: `implement` adds a final full suite, `to-spec`/`to-tickets` supply test decisions and acceptance criteria, `domain-modeling` checks domain contradictions, `research` provides cited contract evidence, and `pr` requires before/after evidence and merge-risk communication. Setup workflows require proof their guardrails work, not just config-file presence.

## Practical gaps and what to review first

These are proposed review obligations, **not findings that current TaskDash tests are missing or failing**. No source, suite, scripts, or runtime was audited here.

1. **Establish scope and evidence first.** Pin baseline, distinguish committed changes from staged/unstaged/untracked work, identify spec/acceptance criteria, standards, domain decisions, and available check commands. The prescribed three-dot review excludes working-tree changes and unchanged legacy code. Arrange a separate scope for whole-product review; verify tooling checks because Standards deliberately skips them.
2. **Prioritize user actions and data preservation.** Trace intended acceptance checks from selecting a task through edit/save/close/complete and reload/readback; verify correct task identity, recurring-task transitions, dates/time zones, metadata preservation, and failure recovery using disposable fixtures. Avoid shallow helper-only tests when the risk is in UI event arguments, multiple callers or persistence integration. Use real public readback paths and a sandbox vault rather than live task edits.
3. **Then verify Obsidian and UI integration.** Require host behavior beyond mocks: reload/lifecycle, external vault changes and stale state, dialogs/keyboard interactions, ordinary pane widths, and startup/load timing with explicit baselines. Define relevant accessibility, platform and responsive cases rather than treating screenshots or generic passing tests as exhaustive coverage.
4. **Finally establish artifact and guardrail evidence.** Run the project's relevant checks and final build; verify installed bundle/manifest/styles parity and release-package contents where release scope requires them. Check CI/hook execution and architecture-rule applicability. Skills do not provide a universal build, packaging, install, security/dependency, performance-budget or cross-platform gate.

Historical context only: prior TaskDash notes described a Close action identity regression, ordinary-width layout verification, load-speed expectations, and source/installed/release artifact distinctions. Those notes motivate priorities 2–4; they are not verified facts about this checkout. Source: `/Users/ricardofilho/.codex/memories/MEMORY.md:753–800` (historical rollout IDs `01a0424b-937e-7793-8b29-9ea24b40cac1`, `01a05d24-5e68-7ad0-9a7e-613483376636`).

**Limits:** no numeric line/branch/mutation coverage target, complete risk/case inventory, or guaranteed host/adapter fidelity is supplied by this skill set. `setup-ts-deep-modules` checks dependency structure, not semantic depth, and leaves layering as a stub. `setup-pre-commit` can omit absent test/typecheck scripts. `implement-spec` does not explicitly demand a full-suite run after final integration. `prototype` explicitly skips tests. Missing spec, unsuitable seams, unavailable reviewer subagents, or missing tracker configuration reduce workflow completeness and must be reported rather than counted as a pass. Invoking all 37 skills would add unrelated work and state changes; select the relevant workflow and require concrete evidence for the chosen acceptance cases.
