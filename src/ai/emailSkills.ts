// Bundled verbatim copies of the user-selected SKILL.md files.
export const DEFAULT_TASK_SKILL = `---
name: email-to-taskdash
description: "Turn a pasted email, email thread, or forwarded message into exactly five TaskDash-ready bullets: one Context bullet, three Summary bullets, and one Next Action bullet. Use when Ricardo pastes email content and wants the main highlights plus a clear follow-up action for a TaskDash task description."
---

# Email To TaskDash

Use this skill when the user pastes an email and wants a compact TaskDash task description with the main highlights and a clear next step.

## Output Contract

Return exactly five bullets and nothing else:

\`\`\`markdown
- **Context:** ...
- **Summary 1:** ...
- **Summary 2:** ...
- **Summary 3:** ...
- **Next Action:** ...
\`\`\`

Do not add greetings, caveats, confidence notes, references as a sixth bullet, or extra commentary.

## How To Read The Email

1. Focus on the latest meaningful message in the thread.
2. Ignore quoted reply history, signatures, legal footers, tracking notices, and repeated boilerplate unless they change the current request.
3. Preserve concrete names, dates, systems, deadlines, amounts, identifiers, links, attachments, folders, and decisions when they matter.
4. Surface open questions or blockers explicitly instead of smoothing them into generic prose.
5. Do not invent missing commitments, deadlines, owners, or conclusions.
6. Redact passwords, login codes, API keys, and other secrets as \`[REDACTED_SECRET]\`.

## Writing Style

- \`Context\` is one compact sentence explaining why the email matters.
- \`Summary 1\`, \`Summary 2\`, and \`Summary 3\` are the three most useful highlights from the email, ordered by importance.
- \`Next Action\` starts with a verb when follow-up is needed.
- If there is no real follow-up, write \`No action needed.\` for \`Next Action\`.
- Keep every bullet plain, direct, and pasteable into a TaskDash task description.
- Include supporting material such as links, attachments, folders, or document names inside the relevant summary or action bullet; do not create a separate \`References\` bullet.

## Dedicated Conversation Setup

This skill is designed for a dedicated email-processing conversation. Prefer a cheaper medium-capability model for this workflow when the UI allows model selection; the skill itself cannot force a model choice.
`;

export const DEFAULT_COMMENT_SKILL = `---
name: email-context-action
description: "Turn a pasted email into concise TaskDash-ready bullets: always Context and Action, plus References when the email mentions links, attachments, folders, or source material. Use when Ricardo pastes an email, email thread, or forwarded message and wants the task description style distilled into the key context and follow-up."
---

# Email Context Action

Use this skill when the user pastes an email and wants a lightweight TaskDash-ready summary with only the useful context and the next action.

## Output Contract

Return either two or three bullets and nothing else:

\`\`\`markdown
- **Context:** ...
- **Action:** ...
- **References:** ...
\`\`\`

Use \`References\` only when the email mentions concrete supporting material such as links, attachments, file paths, folders, decks, documents, or named source material.

## How To Read The Email

1. Ignore quoted reply history, legal footers, tracking notices, and signature noise unless they change the current request.
2. Preserve concrete names, dates, systems, deadlines, links, amounts, and decisions when they matter.
3. Infer the current state from the latest meaningful message in the thread.
4. Do not invent missing commitments, deadlines, or owners.
5. If there is no real follow-up, write \`No action needed.\` for the action.
6. If source material is mentioned, capture it in \`References\` using the most useful short description available.

## Writing Style

- \`Context\` is one compact sentence explaining why the email matters.
- \`Action\` starts with a verb when follow-up is needed.
- \`References\` is a compact list in one bullet sentence, naming the folder, attachment, link, or document to consult.
- Keep both bullets plain, direct, and pasteable into a TaskDash task description.
- Do not include greetings, meta commentary, confidence notes, or extra bullets.

## Dedicated Conversation Setup

This skill is designed for a dedicated email-processing conversation. Prefer a cheaper medium-capability model for this workflow when the UI allows model selection; the skill itself cannot force a model choice.
`;

