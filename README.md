# TaskDash

TaskDash is a personal mission-control app for an Obsidian vault. It gives a focused browser interface for tasks, daily notes, projects, and property management while keeping the source of truth as normal Markdown files in the vault.

The app is intentionally simple: Vercel hosts the React app code, the browser asks for permission to specific local folders, and TaskDash reads/writes files directly on the device through the File System Access API.

## What This Is

TaskDash is built for a personal Obsidian workflow using:

- Obsidian Markdown files as the database.
- TaskNotes-style task files.
- Daily notes in `YYYY-MM-DD.md` format.
- Project notes named like `Project - Example.md`.
- Property notes with `cover` frontmatter and comment logs.
- Obsidian Sync as the backup/sync layer.

It is not a separate cloud database. It does not upload your vault to Vercel. Vercel serves the app bundle; your browser handles local file access after you grant folder permissions.

## Recommended Browser

Use Chrome or Microsoft Edge.

TaskDash depends on the browser File System Access API, which is not supported consistently in every browser.

## Data Flow

```text
Vercel hosted app
  -> browser folder permission
  -> local Obsidian vault files
  -> Obsidian Sync handles backup/sync
```

Your task notes, project notes, property notes, daily notes, and attachments stay in your Obsidian vault. Vercel receives normal web traffic for serving the app, but the vault content is read and written locally by the browser.

## Folder Setup

The first time TaskDash runs on a device, open **Configure folders** and pick the folders it should use. This is remembered per device/browser.

| Folder | Access | Required | Purpose |
| --- | --- | --- | --- |
| Tasks | Read/write | Yes | Reads TaskNotes task files, creates tasks, appends logs, closes tasks. |
| Projects | Read/write | Optional | Reads project files, creates project files, edits project Markdown. |
| Properties | Read/write | Optional | Reads property notes, creates property notes, writes property comments. |
| Clients | Read-only | Optional | Autocomplete for client fields. |
| People | Read-only | Optional | Autocomplete for waiting-for fields. |
| Attachments | Read/write | Optional | Reads property covers and saves uploaded cover images. |
| Daily Notes | Read/write | Optional | Auto-creates and updates daily notes. |

Suggested vault mapping from the current workflow:

| TaskDash folder | Example Obsidian folder |
| --- | --- |
| Tasks | `TaskNotes/Tasks` |
| Projects | `7 - Projects` |
| Properties | `4 - Main notes/wiki/properties` |
| Clients | `4 - Main notes/wiki/org` |
| People | `4 - Main notes/wiki/people` |
| Attachments | `5 - Attachments` |
| Daily Notes | `1 - Rough notes` |

Files named `index`, files starting with `_`, and hidden folders are ignored. Project references are filtered to files whose first word is `Project`.

## Features

### Today Mission Control

The Today tab is the main command surface. It shows:

- Daily note panels for Notes, Reflections, and Brain dump.
- Tasks due or scheduled today.
- Overdue tasks.
- Recurrent tasks separated from dated work.
- Task queues sorted by `dateCreated`, oldest first, so stale work is easier to tackle.
- Start/stop timer controls for tasks.
- Quick creation of a new task.

If a Daily Notes folder is configured, TaskDash automatically creates today's note as `YYYY-MM-DD.md` when the app loads or syncs for the day.

### Daily Notes

Generated daily notes follow the current Obsidian format:

````markdown
---
date: YYYY-MM-DD
tags:
  - daily-note
---

# Monday, May 4, 2026

---

## Due Today

```base
...
```

## Overdue

```base
...
```

## Notes

-

---

## Reflections

-

---

## Brain dump - issues

-
````

The app interface writes bullet entries into the matching sections. The embedded Obsidian Bases blocks remain in the Markdown file for use inside Obsidian.

### Tasks

The Tasks tab supports:

- Reading active TaskNotes task files.
- Filtering all, today, overdue, and done tasks.
- Creating new tasks from the app.
- Adding chronological task log entries.
- Starting/stopping timers.
- Tracking email, meeting, and ad-hoc time.
- Closing a task by setting `status: done`, adding `archived`, setting `completedDate`, and updating `dateModified`.

Task log entries are written in chronological date sections. New logs use:

```markdown
### [[YYYY-MM-DD]]
Log: [HH:mm] Example note

---
```

### Task Creation

New task files are created in the configured Tasks folder. The form mirrors the TaskNotes intake workflow and supports:

- Title
- Priority
- Status
- Due date
- Scheduled date
- Contexts
- Client
- Building
- Projects
- Waiting for
- Extra tags
- Time estimate
- Recurrent flag
- Initial details

### Projects

The Projects tab supports:

- Reading project files whose names start with `Project`.
- Creating files named `Project - <name>.md`.
- Editing and saving project Markdown directly.
- Updating `dateModified` when project frontmatter exists.
- Client autocomplete from the Clients folder.

This is intentionally flexible because project files often become working notes rather than rigid records.

### Properties

The Properties tab supports:

- Card-style property browsing.
- Property cover images from the Attachments folder.
- Creating new property notes.
- Uploading a cover image when creating a property.
- Replacing/uploading a cover for an existing property.
- Adding property comments into the property Markdown file.

Property comments use the same chronological log style as task notes.

### Cover Uploads

When a cover is uploaded:

- The image is saved into the configured Attachments folder.
- The property frontmatter is updated with a `cover` path.
- The property card refreshes to use the new image.

Example:

```yaml
cover: 5 - Attachments/example-cover.png
```

### Time Tracking

TaskDash can track time for:

- A selected task.
- Email.
- Meeting.
- Ad-hoc work.

Timer output is written to `timetracker.md` in the Tasks folder.

## Local Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deployment

The app is designed to deploy cleanly on Vercel as a Vite/React project.

For this personal use case, Vercel's free Hobby plan is enough in normal use because the app is mostly static frontend code and does not store vault data on Vercel.

## Privacy And Reliability

TaskDash is safe to use as a personal mission-control interface as long as Obsidian Sync or another backup system is active.

Important notes:

- Vercel hosts the app code, not the vault data.
- Folder permissions are stored per browser/device.
- Each new device needs folder setup once.
- Avoid editing the exact same note in Obsidian and TaskDash at the exact same moment.
- Obsidian Sync is the recommended backup/sync layer.
- The Markdown files remain usable even if TaskDash is unavailable.

## Current Limitations

- Browser support depends on the File System Access API.
- There is no conflict-resolution UI if Obsidian and TaskDash edit the same file simultaneously.
- There is no separate database or server-side audit log.
- Automated test coverage is light; production builds are used as the main verification step.

## Suggested Daily Workflow

1. Open TaskDash in Chrome or Edge.
2. Click Sync if the dashboard looks stale.
3. Use Today to review Notes, Overdue, Today, and Recurrent work.
4. Start a timer on the task currently being handled.
5. Add daily notes, reflections, and brain-dump items during the day.
6. Close tasks from TaskDash when done.
7. Use Obsidian for deeper writing, linking, review, and long-form thinking.

## Closing Note

TaskDash is built to be a personal cockpit over an Obsidian vault. The vault remains the durable system; the app is the fast command surface.
