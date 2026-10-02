import { describe, expect, it } from 'vitest';
import {
  appendDailySectionEntry,
  appendPropertyCommentToMd,
  buildNewOrganizationMd,
  buildNewProjectMd,
  buildNewPropertyMd,
  finishRecurrentTaskInstance,
  kebabSlug,
  postponeTaskDatesByMonths,
  replaceDailyTimeClockRows,
  setPropertyCover,
  touchDateModified,
  finishRecurrentTaskInstance,
  updateCommentLog,
  updateTaskMetadata,
  updateTaskThreadSubject,
} from '../formatter.js';
import { parseFrontmatter } from '../parser.js';

describe('finishRecurrentTaskInstance', () => {
  it.each([
    ['inline', 'complete_instances: [2026-09-21]'],
    ['quoted inline', 'complete_instances: ["2026-09-21"]'],
    ['unindented block', 'complete_instances:\n- 2026-09-21'],
    ['indented block', 'complete_instances:\n  - 2026-09-21'],
  ])('writes one completion list from an %s field', (_format, completionField) => {
    const raw = `---\ntitle: Weekly task\ndue: 2026-09-28\nrecurrence: FREQ=WEEKLY\n${completionField}\ncustom: keep\n---\n\n# Weekly task\nBody stays.\n`;

    const updated = finishRecurrentTaskInstance(raw, '2026-09-28');
    const frontmatter = updated.match(/^---\n([\s\S]*?)\n---/)[1];

    expect(frontmatter.match(/^complete_instances:/gm)).toHaveLength(1);
    if (_format === 'quoted inline') expect(frontmatter).toContain('  - "2026-09-21"');
    expect(parseFrontmatter(updated).complete_instances).toEqual(['2026-09-21', '2026-09-28']);
    expect(parseFrontmatter(updated).due).toBe('2026-10-05');
    expect(updated).toContain('custom: keep');
    expect(updated).toContain('# Weekly task\nBody stays.');
    const repeated = finishRecurrentTaskInstance(updated, '2026-09-28');
    expect(parseFrontmatter(repeated).complete_instances).toEqual(['2026-09-21', '2026-09-28']);
    expect(repeated.match(/^complete_instances:/gm)).toHaveLength(1);
  });
});

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

describe('recurrent task completion', () => {
  it.each([
    ['FREQ=DAILY'],
    ['RRULE:FREQ=DAILY'],
    ['"FREQ=DAILY"'],
  ])('advances a daily recurrence written as %s by one day', recurrence => {
    const raw = `---\ntitle: Daily task\ndue: 2026-10-01\nrecurrence: ${recurrence}\n---\n`;

    const updated = finishRecurrentTaskInstance(raw, '2026-10-01');

    expect(updated).toContain('due: 2026-10-02');
  });

  it.each(['DTSTART:20261001', 'DTSTART=20261001'])(
    'keeps DTSTART values using %s syntax working', dtstart => {
      const raw = `---\ntitle: Daily task\ndue: 2026-10-01\nrecurrence: FREQ=DAILY;${dtstart}\n---\n`;

      const updated = finishRecurrentTaskInstance(raw, '2026-10-01');

      expect(updated).toContain('due: 2026-10-02');
    },
  );
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
  it('skips excluded recurrence dates and records only the completed instance', () => {
    const raw = `---
title: Weekly task
due: 2026-09-28
recurrence: FREQ=WEEKLY;BYDAY=MO;DTSTART=20260928
skipped_instances:
  - 2026-10-05
---

# Weekly task
`;

    const updated = finishRecurrentTaskInstance(raw, '2026-09-28');

    expect(updated).toContain('due: 2026-10-12');
    expect(updated).toMatch(/skipped_instances:\n  - 2026-10-05/);
    expect(updated).toMatch(/complete_instances:\n  - 2026-09-28/);
    expect(updated.match(/complete_instances:\n((?:  - .+\n?)+)/)?.[1]).toBe('  - 2026-09-28\n');
  it('advances a daily recurring task by calendar days across spring DST', () => {
    const raw = `---
title: DST task
due: 2026-03-28
recurrence: DTSTART:20260328;FREQ=DAILY;INTERVAL=2
---
`;

    const updated = finishRecurrentTaskInstance(raw, '2026-03-28');

    expect(updated).toContain('due: 2026-03-30');
    
  });

  it('updates task metadata while preserving unknown fields and task content', () => {
    const raw = `---
title: Existing task
status: none
priority: normal
contexts:
  - work
tags:
  - task
  - recurrent
custom: keep me
---

### Task Log
Log: Keep this
`;

    const updated = updateTaskMetadata(raw, {
      priority:'high',
      status:'in-progress',
      contexts:['work', 'phone'],
      client:'Acme',
      building:'20 Kildare Street',
      projects:['Project - Leasing'],
      waitingfor:'Jane Smith',
      tags:['urgent'],
      timeEstimate:'45',
      recurrent:false,
    });

    expect(updated).toContain('priority: high');
    expect(updated).toContain('status: in-progress');
    expect(updated).toContain('  - "phone"');
    expect(updated).toContain('client: "[[Acme]]"');
    expect(updated).toContain('building: "[[20 Kildare Street]]"');
    expect(updated).toContain('  - "[[Project - Leasing]]"');
    expect(updated).toContain('waitingfor: "[[Jane Smith]]"');
    expect(updated).toContain('timeEstimate: 45');
    expect(updated).toContain('custom: keep me');
    expect(updated).toContain('Log: Keep this');
    expect(updated).not.toContain('Recurrent:');
    expect(updated).not.toContain('  - recurrent');
  });

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

  it('postpones task by due date and removes legacy scheduled date', () => {
    const raw = `---
title: Month-end task
due: 2026-01-31
scheduled: 2026-02-28
---

# Month-end task
`;

    const updated = postponeTaskDatesByMonths(raw, '2026-01-31', '2026-02-28', 1);

    expect(updated).toContain('due: 2026-02-28');
    expect(updated).not.toContain('scheduled:');
    expect(updated).toMatch(/dateModified: \d{4}-\d{2}-\d{2}T/);
  });
});

describe('kebabSlug', () => {
  it('converts names to the kebab-case filename convention', () => {
    expect(kebabSlug('Paula Chipont')).toBe('paula-chipont');
  });

  it('strips accents and symbols', () => {
    expect(kebabSlug('José & María Núñez')).toBe('jose-and-maria-nunez');
    expect(kebabSlug('  The Spire (Dublin) #1  ')).toBe('the-spire-dublin-1');
  });

  it('falls back when nothing slugs', () => {
    expect(kebabSlug('', 'new-person')).toBe('new-person');
    expect(kebabSlug('***')).toBe('untitled');
  });
});

describe('buildNewOrganizationMd', () => {
  it('writes organization frontmatter and heading', () => {
    const md = buildNewOrganizationMd({ name:'Acme Corp', industry:'Real estate', website:'https://acme.example', email:'', phone:'', tags:'organizations, client', body:'' });
    expect(md).toContain('type: organization');
    expect(md).toContain('organization: "Acme Corp"');
    expect(md).toContain('industry: "Real estate"');
    expect(md).toContain('tags: [organizations, client]');
    expect(md).toContain('# Acme Corp');
    expect(md).not.toContain('email:');
  });
});
