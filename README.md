# TaskDash

Local-first Obsidian dashboard with editable local email-drafting skills.

## Contents

- `manifest.json` — Obsidian plugin metadata
- `main.js` — bundled plugin JavaScript
- `styles.css` — plugin styles
- `data.json` — folder mappings and timer configuration

## Installation

Copy the contents of this folder into an Obsidian vault at:

```text
.obsidian/plugins/taskdash/
```

Then enable **TaskDash** in Obsidian’s community plugins settings. Disable the older **TaskDash 2.2 Preview** before switching; retain a backup of its `data.json` if migrating its folder settings. Do not run both dashboards simultaneously. The numeric manifest version and legacy internal view/storage identifiers remain for compatibility; they are not part of the visible name.

# Development

Use Node.js 22. The build toolchain requires Node.js 22.12 or newer (or 20.19 or newer).

## Local email assistant

TaskDash can draft a task or activity comment from a pasted email using local Ollama and `gemma4:12b` with an 8K context. Comments are three-sentence thread recaps. Tasks add a short title and an action only for a clear pending request or your unfinished promise. Drafts are editable: generating or using a draft never saves a task/comment; the normal **Create Task** or **Add** action does that.

On an Apple Silicon Mac, install the runtime natively:

```sh
brew install ollama
brew services start ollama
ollama pull gemma4:12b
```

For local-only operation, set `"disable_ollama_cloud": true` in Ollama's `~/.ollama/server.json` and restart the service. TaskDash uses only `http://127.0.0.1:11434` and the fixed local model; it has no cloud fallback. The model is downloaded separately, not included in this plugin or GitHub repository.

Open **Obsidian Settings → TaskDash → Local email assistant** to enable/disable drafting, set **Your name** (required for task-owner attribution), and edit the two skill texts. Each skill can be reset to its default. Settings are saved per vault; changes apply to the next generation. Fixed output/safety constraints remain in the application.

The defaults include the complete, verbatim **email-to-taskdash** and **email-context-action** skill files, bundled in `src/ai/emailSkills.ts`. They remain editable references; a separate instruction overrides their older bullet formats with the recap workflow. Both default and custom skills use the same structured output contract. Informational threads and already-sent check-ins can produce a neutral title and recap without an action. Only the previous built-in paragraph prompts migrate automatically; custom skill text remains untouched. Reset a customized editor to load the full default.

In the new-task form, expand **Draft task from email**. In a selected task's Activity area, expand **Draft comment from email**. Paste only the relevant email, generate, check every factual claim, edit the preview, and use the draft. Then explicitly save through the usual task/comment controls. There is no mailbox connection, background inference, automatic task matching or automatic metadata assignment.

Email input is limited to 8,000 UTF-8 bytes; each skill to 4,000 bytes. Long emails must be shortened explicitly. Generation can be cancelled and times out after two minutes. Missing runtime/model or invalid output leaves the normal TaskDash workflow available. Local models can still omit or invent facts; editable previews and human approval are required.

Obvious AI-rule override text is rejected with a request to remove that quoted material. Recognized numeric dates, clock times and named-month dates absent from the source are also rejected. Relative phrases such as “tomorrow” and “next Friday” are not covered. These conservative checks are not a comprehensive prompt-injection detector or a factuality guarantee, and can reject legitimate quoted material or reformatted dates.

Run the optional fictional local-model evaluation (requires installed Ollama/model):

```sh
node --experimental-strip-types scripts/evaluate-local-email.mjs
```

This uses no vault data. Automated schema/error/UI tests run with `npm test` without a model installed. See [the feature specification](docs/specs/local-email-assistant.md) for scope and verification boundaries.

Drafting labels common latest-message/signature/reply boundaries and the thread subject, while retaining the complete redacted thread for historical context and document references. This does not guarantee that the model prioritizes the latest message correctly; quoted-only bodies are rejected rather than guessed. The earlier Qwen and original Gemma candidates failed the old action contract. The clarified recap workflow and current verification are documented in [the completion report](docs/review/email-assistant-completion-2026-10-03.md).

The [earlier skill review](docs/review/local-email-skills-2026-10-03.md) found that models copy access codes despite prompt instructions. Clearly labelled access/login codes, passwords and API keys are now replaced with `[REDACTED_SECRET]` before inference, with an output echo guard for detected values of at least four characters. This is limited pattern-based protection, not comprehensive secret detection: remove secrets yourself before pasting. The optional evaluation includes credential copying, question-as-fact, recipient attribution and shipment-uncertainty checks. Ordinary application tests passing does not mean that model-quality checks passed.
