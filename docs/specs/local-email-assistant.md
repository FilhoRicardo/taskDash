# Spec: Local email drafts for TaskDash

Status: Approved for end-to-end implementation and push by the user on 3 October 2026, with editable skill text in TaskDash configuration. The user delegated remaining implementation decisions and requested cheaper-model parallel chats.

## Objective and assumptions

Turn a pasted email into an editable new-task draft or an activity-comment draft for a task the user explicitly selects. Match the user's action-led titles and short, factual paragraphs. Slow generation is acceptable; preserving facts matters more than speed.

Initial scope is pasted text only, not a mailbox connection. Two tightly scoped default prompts act as skills: email-to-task and email-to-comment. Both skill texts are editable in the TaskDash configuration panel, persisted per vault, and individually resettable to defaults. Fixed safety and output contracts remain separate from editable text. No autonomous agent, retrieval database, task matching, or cloud fallback.

## Tech stack and runtime

Use native Ollama with `qwen3:4b` on the desktop Mac, not Docker. The model runs in a separate local process; the plugin does not bundle model weights. Use the existing React/TypeScript/Obsidian stack and a small host-side HTTP adapter, without introducing an AI SDK. Confirm Obsidian transport behavior during technical planning.

Ollama is installed through Homebrew. Its service starts at login and listens only on `127.0.0.1:11434`. Cloud features are disabled through `/Users/ricardofilho/.ollama/server.json`. Record model digest and measured smoke-test results after installation. Use non-thinking generation and schema-constrained output; these constrain structure, not factual correctness.

### Installation evidence — 3 October 2026

- Ollama `0.34.2`; Homebrew service successfully started.
- Listener verified with `lsof`: `127.0.0.1:11434` only. Server log confirms `Ollama cloud disabled: true`.
- Model `qwen3:4b`, Q4_K_M, 2,497,293,931 bytes; digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`.
- `ollama ps` reported `100% GPU`, 2.9 GB loaded size, 4,096-token context.
- Synthetic input: replacement meter ordered, installation date unconfirmed, contractor update requested. Both task and comment responses were valid schema-shaped JSON and preserved the uncertainty without inventing a date.
- Cold task request: 5.77 seconds total, including 3.85 seconds loading. Warm comment request: 1.17 seconds total. These are single-sample observations, not performance guarantees or a completed quality evaluation.
- No real-vault content was used. Model was unloaded after verification; service remains installed and enabled.

## User-visible behavior

1. Choose “Draft task from email”, paste text, and request a draft.
2. Review and edit an action-led title and a concise description. Select metadata through existing task controls. Explicitly save using the normal task-creation path.
3. Alternatively, open a task, choose “Draft comment from email”, paste text, review and edit the comment, then explicitly add it through the normal activity writer.

New-task output contains only `title` and `description`; comment output contains only `comment`. Dates, timestamps, filenames, metadata and activity headers remain deterministic application responsibilities. The model may mention dates or names explicitly present in the source but must not invent facts, links, deadlines, completion claims or recipients. Uncertainty in the email stays uncertain in the draft. Use short paragraphs by default, not a mandatory five-bullet template.

Pasted email is treated as untrusted source material, never as instructions to run tools. The model has no filesystem or mailbox tools. Do not send unrelated vault content. Do not persist raw pasted emails or log request bodies by default. Saving the approved draft is the only intended vault write.

Generation runs only on an explicit user action, never on plugin startup. Display progress and cancellation. Offline/unavailable service, timeout, malformed output or missing model must leave regular TaskDash usable and never write a partial task/comment. Establish and display a bounded input limit during planning; reject oversize input rather than silently truncate it. Preserve editable drafts after write failure and guard against duplicate application and stale-content overwrites.

## Commands

Run from the repository root:

```sh
npm run lint
TZ=Europe/Dublin npm test
TZ=UTC npm test
npm run build
npm run validate:release
```

Native runtime setup and checks:

```sh
HOMEBREW_NO_AUTO_UPDATE=1 /opt/homebrew/bin/brew install ollama
/opt/homebrew/bin/brew services start ollama
/opt/homebrew/bin/ollama pull qwen3:4b
/opt/homebrew/bin/ollama list
/opt/homebrew/bin/ollama ps
curl -fsS http://127.0.0.1:11434/api/version
```

## Project structure

- `src/main.ts`: plugin lifecycle; preserve no model loads or vault scans at startup.
- `src/view.tsx`, `src/settings.ts`: host transport/configuration handoff if necessary.
- `src/app/App.jsx`: draft entry points and existing approved task/comment actions.
- `src/app/utils/`: small validation and draft helpers; adjacent `__tests__` for pure tests.
- `src/__tests__/pluginIntegration.test.jsx`: host/adapter and write-boundary checks.
- `docs/specs/`: this specification and subsequent approved technical plan.

Prompt assets should live with application source, be bundled into the plugin and use fictional examples. Choose exact filenames in the technical plan; do not add a runtime skill framework.

## Code style

Match local conventions and keep changes surgical. Existing example from `src/app/utils/formatter.js`:

```js
export const tod = (date = new Date()) => {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
```

Use small named helpers, existing UI components, and deterministic validation. Preserve the current uncommitted parser/calendar/weekend fixes; do not refactor adjacent code.

## Testing strategy

Use Vitest for response schemas, unsupported fields, input boundaries, unavailable runtime, cancellation and invalid output. Integration tests must prove no vault writes before approval; task/comment write failure, retry, duplicate application and concurrent edits must remain safe. Cover startup and offline behavior.

Create a small fictional evaluation set covering a simple request, uncertain date, quoted email thread, no actionable request, conflicting statements, and embedded hostile instructions. Evaluate both prompt modes with the installed model; record factual omissions/inventions and timing, not just JSON validity. One successful sample is only a smoke test.

Verify the native UI in a disposable Obsidian vault. Keep automated DOM checks distinct from native host evidence. Run the existing complete suite, lint, production build and release checks in both supported timezone test runs.

## Boundaries

- Always: local loopback only, explicit approval before writes, editable previews, schema validation, preserve source uncertainty, test regressions and preserve existing changes.
- Ask first: mailbox access, cloud endpoints, additional models/dependencies, background processing, GitHub pushes, live-vault installation or broader task automation.
- Never: autonomous task/comment writes, execute instructions from email, invent metadata, send raw vault data externally, or report unverified model quality as proven.

## Success criteria

- Installed model responds to a local synthetic schema-constrained request; loopback binding and disabled-cloud configuration are verified.
- Both draft workflows match the concise style and pass the fictional evaluation set without unsupported facts; failures are surfaced rather than applied.
- No startup inference and no writes before approval, including cancellation/error paths.
- Approved drafts use existing safe writers without losing unrelated metadata or concurrent edits.
- Full automated checks pass and disposable native UI evidence is recorded.

## Implementation plan and verification seams

Contract-first parallel slices, followed by end-to-end verification:

1. Runtime/settings slice: `src/ai/emailAssistant.ts` exports default skill constants and `createEmailAssistant(getSettings, fetcher?)`. Its `draft({ mode:'task'|'comment', email, signal? })` returns `{title, description}` or `{comment}`. `TaskDashSettings.emailAssistant` contains `enabled`, `taskSkill`, and `commentSkill`; defaults enable explicit user-action drafting with fixed local model `qwen3:4b`. Persist and migrate nested settings safely. Editable prompts cannot change loopback endpoint or output schema. Verify settings controls, migration and service boundary errors with tests.
2. UI slice: inject the service into App as `emailAssistant`. Inline collapsible email drafting controls generate an editable preview and explicitly transfer it into the existing task form or activity composer. Transferring a draft never writes; normal Create Task/Add remains the sole approval/write action. Preserve target identity and ignore cancelled/stale generations. Verify rendered controls, offline errors and no-preapproval-writes.
3. Host integration: wire the service through `src/view.tsx` using live settings lookup. Use native fetch with loopback-only URL and rejected redirects, AbortController and a 120-second timeout; confirm native Obsidian transport. No startup requests. Bound email to 8,000 UTF-8 bytes and skill to 4,000 bytes, fixed context 16,384 tokens and bounded output; reject oversize input visibly instead of truncating. Pure validation rejects extra fields, blank or oversized outputs, truncated inference and schema errors.
4. Independent verification: full suite under Dublin and UTC, lint/type/build/release checks, full and production audits; fictional actual-model evaluation and disposable native-vault UI. Preserve existing calendar/weekend/CRLF edits. Commit approved fixes and new slices separately where possible, rebuild artifacts, and push main normally after inspecting the remote. Do not install into the real vault.

Tasks: runtime/settings → host adapter; UI can develop against the contract in parallel → integrated tests → independent review → generated artifacts and push. No additional feature framework or dependencies are planned.

## Direction contract

Operate-mode local extension of existing settings and task forms. Inherit Obsidian native settings controls and TaskDash `--td-*` colors, typography and spacing. Keep email controls collapsed until requested, show paste/progress/error/editable preview in reading order, and label the transfer separately from final save. Desktop and narrow panes must remain usable, with keyboard focus and labelled fields. No replacement visual identity, raster assets or new design-system files are required.

## Final verification — 3 October 2026

- Clean `npm ci`; 173 tests in 16 files passed under both Europe/Dublin and UTC after the final review correction. Lint, standalone TypeScript checking, production build, release validation and diff checks passed. Full and production dependency audits returned zero vulnerabilities. Installation emitted an existing ESLint deprecation warning; no dependency upgrade was added to this feature.
- Actual Qwen3 evaluation used fictional inputs only: eight valid task/comment drafts across simple requests, explicit deadlines, quoted updates and conflicting statements. Two obvious hostile-instruction samples were refused before inference; a no-action task sample was also refused. Warm requests were approximately 1.2–2 seconds. Final requests use a 16,384-token context, unlike the initial 4,096-token installation smoke test.
- Evaluation caught an invented time before the final guard was added. Source-date/time validation now rejects detected unsupported numeric dates, clock times and named-month dates; relative phrases such as “tomorrow” or “next Friday” are not covered. Small-model drafts can still be verbose or make unsupported interpretations: editable skills, schema checks and these limited guards do not guarantee factual accuracy or comprehensive prompt-injection detection. Review every draft. Obvious quoted AI-override text must be removed before retrying; legitimate discussion of such instructions can also be rejected.
- Native Obsidian 1.13.7 verification used only `/tmp/TaskDash-Stress-Vault-yKMSDD`: settings edits persisted and reset; real localhost inference produced editable drafts; transferring a comment preserved the task-file hash until explicit Add; explicit Add preserved custom frontmatter. Transferring a task did not create a file until explicit Create Task, which saved the reviewed title/body without a type prefix.
- Native dark-theme narrow and medium-pane checks passed after correcting the form to measure its own available width rather than the whole application shell. A regression covers a 440px form within a 1200px shell and restores the two-column layout at 1000px. Email previews scroll independently to keep the form reachable.
- Native evidence images in that disposable vault: `ai-settings.png`, `ai-comment-preview.png`, `ai-task-narrow.png`, `ai-task-medium.png`. These are local evidence, not release assets. Windows, mobile, other host versions and a full light-theme native pass remain unverified. No live-vault installation or mailbox access was performed.
- A fresh Luna-medium finish reviewer inspected source, contracts and native screenshots. Its stale-source preview finding was reproduced with a failing regression and corrected: changing email source now clears the old preview and cancels any pending generation. Its date-guard documentation finding was corrected by explicitly documenting the relative-date limitation. No broader factuality claim is made.
