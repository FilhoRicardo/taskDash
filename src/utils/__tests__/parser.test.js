import { describe, expect, it } from 'vitest';
import { parseDailyNote, parseProperty, parseTask } from '../parser.js';

describe('parseTask', () => {
  it('reads TaskNotes frontmatter, checklist, dates, links, recurrence, and logs', () => {
    const raw = `---
title: Review lease renewal
status: in-progress
priority: high
due: 2026-05-18
scheduled: 2026-05-17
dateCreated: 2026-05-01T09:00:00.000+01:00
contexts:
  - work
projects:
  - "[[Project - Leasing]]"
waitingfor: "[[Jane Smith]]"
client: "[[Acme]]"
building: "[[20 Kildare Street]]"
tags:
  - task
  - recurrent
complete_instances:
  - 2026-05-11
---
- [ ] Confirm rent review
- [x] Draft email

### [[2026-05-18]]
Log: [09:15] Started review

---
`;

    const task = parseTask('Review lease renewal.md', raw);

    expect(task.title).toBe('Review lease renewal');
    expect(task.priority).toBe('high');
    expect(task.status).toBe('in-progress');
    expect(task.due).toBe('2026-05-18');
    expect(task.scheduled).toBe('2026-05-17');
    expect(task.contexts).toEqual(['work']);
    expect(task.projects).toEqual(['Project - Leasing']);
    expect(task.waitingfor).toBe('Jane Smith');
    expect(task.client).toBe('Acme');
    expect(task.building).toBe('20 Kildare Street');
    expect(task.recurrent).toBe(true);
    expect(task.completeInstances).toEqual(['2026-05-11']);
    expect(task.checklistDone).toBe(1);
    expect(task.checklistTotal).toBe(2);
    expect(task.logs).toEqual([{ date: '2026-05-18', text: '[09:15] Started review' }]);
  });

  it('falls back safely when frontmatter is malformed or absent', () => {
    const task = parseTask('Loose note.md', '# Loose note\n\nNo frontmatter here');

    expect(task.title).toBe('Loose note');
    expect(task.priority).toBe('normal');
    expect(task.status).toBe('none');
    expect(task.tags).toEqual([]);
  });
});

describe('parseDailyNote', () => {
  it('extracts time clock rows and editable daily sections while preserving Bases elsewhere', () => {
    const raw = `---
date: 2026-05-18
workStatus: workday
tags:
  - daily-note
---

# Monday, May 18, 2026

## Due Today

\`\`\`base
filters:
  and:
    - due == "2026-05-18"
\`\`\`

## Time Clock

| Time | Event |
| --- | --- |
| 09:00 | Clock in |
| 12:30 | Break start |

---

## Notes

- Follow up with legal

## Reflections

- Good focus

## Brain dump - issues

- Waiting on survey
`;

    const note = parseDailyNote('2026-05-18.md', raw);

    expect(note.timeClock).toEqual([
      { time: '09:00', event: 'Clock in' },
      { time: '12:30', event: 'Break start' },
    ]);
    expect(note.notes).toEqual(['Follow up with legal']);
    expect(note.reflections).toEqual(['Good focus']);
    expect(note.brainDump).toEqual(['Waiting on survey']);
  });
});

describe('parseProperty', () => {
  it('normalizes cover names and chronological property comments', () => {
    const raw = `---
building: "20 Kildare Street"
client: "[[Acme]]"
cover: "5 - Attachments/kildare cover.jpg"
---

# 20 Kildare Street

## Property Comments

### [[2026-05-18]]
Log: [10:20] Checked cover image

---
`;

    const property = parseProperty('20-kildare-street.md', raw);

    expect(property.title).toBe('20 Kildare Street');
    expect(property.client).toBe('Acme');
    expect(property.coverName).toBe('kildare cover.jpg');
    expect(property.comments).toEqual([{ date: '2026-05-18', text: '[10:20] Checked cover image' }]);
  });
});
