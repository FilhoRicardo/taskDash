import { describe, expect, it } from 'vitest';
import {
  appendDailySectionEntry,
  appendPropertyCommentToMd,
  buildNewProjectMd,
  buildNewPropertyMd,
  postponeTaskDatesByMonths,
  replaceDailyTimeClockRows,
  setPropertyCover,
  touchDateModified,
  updateCommentLog,
  updateTaskThreadSubject,
} from '../formatter.js';

describe('daily note mutation helpers', () => {
  it('appends a section entry without damaging Obsidian Bases blocks', () => {
    const raw = `---
date: 2026-05-18
---

# Monday, May 18, 2026

## Due Today

\`\`\`base
filters:
  and:
    - due == "2026-05-18"
\`\`\`

## Notes

- 
`;

    const updated = appendDailySectionEntry(raw, 'notes', 'Call solicitor');

    expect(updated).toContain('```base\nfilters:');
    expect(updated).toContain('## Notes\n\n- Call solicitor');
  });

  it('replaces time clock rows while keeping following sections', () => {
    const raw = `# Day

## Time Clock

| Time | Event |
| --- | --- |
| 09:00 | Clock in |

---

## Notes

- Existing note
`;

    const updated = replaceDailyTimeClockRows(raw, [
      { time: '09:15', event: 'Clock in' },
      { time: '17:30', event: 'Clock out' },
    ]);

    expect(updated).toContain('| 09:15 | Clock in |');
    expect(updated).toContain('| 17:30 | Clock out |');
    expect(updated).toContain('## Notes\n\n- Existing note');
  });
});

describe('comment log mutation helpers', () => {
  it('updates the intended duplicate dated log occurrence', () => {
    const raw = `# Task

### [[2026-05-18]]
Log: [09:00] Same
Log: [10:00] Same

---
`;

    const updated = updateCommentLog(raw, '2026-05-18', '[10:00] Same', 0, '[10:00] Updated');

    expect(updated).toContain('Log: [09:00] Same');
    expect(updated).toContain('Log: [10:00] Updated');
  });

  it('updates multiline dated logs', () => {
    const raw = `# Task

### [[2026-06-04]]
Log: [09:02] First line
Second line

---
`;

    const updated = updateCommentLog(
      raw,
      '2026-06-04',
      '[09:02] First line\nSecond line',
      0,
      '[09:02] First line\nSecond line edited',
    );

    expect(updated).toContain('Log: [09:02] First line\nSecond line edited');
  });

  it('creates property comment sections when missing', () => {
    const updated = appendPropertyCommentToMd('# Building\n', 'First property note');

    expect(updated).toContain('## Property Comments');
    expect(updated).toContain('Log: [');
    expect(updated).toContain('First property note');
  });
});

describe('project and property frontmatter helpers', () => {
  it('builds project Markdown with safe title, project tag, and dateModified', () => {
    const md = buildNewProjectMd({
      title: 'Union Module 4',
      client: 'Acme',
      summary: 'Scope and rollout',
      tags: 'project, union',
      body: '## Scope',
    });

    expect(md).toContain('title: "Union Module 4"');
    expect(md).toContain('tags: [project, union]');
    expect(md).toMatch(/dateModified: \d{4}-\d{2}-\d{2}/);
    expect(md).toContain('client: "[[Acme]]"');
  });

  it('touches dateModified only when frontmatter exists', () => {
    const raw = `---
title: Existing
custom: keep me
---

# Existing
`;

    const updated = touchDateModified(raw);

    expect(updated).toContain('custom: keep me');
    expect(updated).toMatch(/dateModified: \d{4}-\d{2}-\d{2}/);
    expect(touchDateModified('# No frontmatter')).toBe('# No frontmatter');
  });

  it('quotes property cover paths and preserves unknown frontmatter fields', () => {
    const created = buildNewPropertyMd({
      title: '20 Kildare Street',
      client: 'Acme',
      summary: 'City centre',
      tags: 'properties, dublin',
      coverPath: '5 - Attachments/kildare cover.jpg',
    });

    expect(created).toContain('cover: "5 - Attachments/kildare cover.jpg"');

    const updated = setPropertyCover(`---
building: "20 Kildare Street"
custom: keep me
---

# 20 Kildare Street
`, '5 - Attachments/new cover.jpg');

    expect(updated).toContain('custom: keep me');
    expect(updated).toContain('cover: "5 - Attachments/new cover.jpg"');
    expect(updated).toMatch(/dateModified: \d{4}-\d{2}-\d{2}/);
  });
});

describe('task date shortcut helpers', () => {
  it('upserts and removes a task thread subject', () => {
    const raw = `---
title: Existing task
status: none
dateModified: 2026-06-01T08:00:00
---

# Existing task
`;

    const updated = updateTaskThreadSubject(raw, 'Check GBT thread before opening a new one');

    expect(updated).toContain('threadSubject: "Check GBT thread before opening a new one"');
    expect(updated).toMatch(/dateModified: \d{4}-\d{2}-\d{2}T/);

    const cleared = updateTaskThreadSubject(updated, '');

    expect(cleared).not.toContain('threadSubject:');
    expect(cleared).toContain('title: Existing task');
  });

  it('postpones task due and scheduled dates by one calendar month', () => {
    const raw = `---
title: Month-end task
due: 2026-01-31
scheduled: 2026-02-28
---

# Month-end task
`;

    const updated = postponeTaskDatesByMonths(raw, '2026-01-31', '2026-02-28', 1);

    expect(updated).toContain('due: 2026-02-28');
    expect(updated).toContain('scheduled: 2026-03-28');
    expect(updated).toMatch(/dateModified: \d{4}-\d{2}-\d{2}T/);
  });
});
