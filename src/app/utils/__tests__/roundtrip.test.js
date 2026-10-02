import { describe, expect, it } from 'vitest';
import { markTaskDone, updateTaskDates, appendNoteToMd } from '../formatter.js';

// Markdown safety: mutations must be surgical. Unknown frontmatter fields and
// user-written content survive a parse → edit → write round-trip untouched.

const RAW = `---
title: Quarterly report
status: in-progress
due: 2026-07-10
customField: keep me
nested_unknown:
  - alpha
  - beta
tags:
  - work
---
# Quarterly report

Some careful user prose that must never be rewritten.

- [ ] draft outline
- [x] collect data

### 2026-07-01
Log: kicked off
`;

describe('markdown round-trip safety', () => {
  it('markTaskDone changes only status/completedDate/dateModified/tags', () => {
    const updated = markTaskDone(RAW);
    expect(updated).toContain('customField: keep me');
    expect(updated).toContain('nested_unknown:');
    expect(updated).toContain('  - alpha');
    expect(updated).toContain('Some careful user prose that must never be rewritten.');
    expect(updated).toContain('Log: kicked off');
    expect(updated).toContain('status: done');
    expect(updated).toMatch(/completedDate: \d{4}-\d{2}-\d{2}/);
    expect(updated).toMatch(/tags:\n(?:.*\n)*? {2}- archived/);

    const changedLines = updated.split('\n').filter(line => !RAW.includes(line));
    for (const line of changedLines) {
      expect(line).toMatch(/^(status:|completedDate:|dateModified:| {2}- archived)/);
    }
  });

  it('updateTaskDates rewrites only due/scheduled/dateModified', () => {
    const updated = updateTaskDates(RAW, { due: '2026-08-01', scheduled: '2026-07-20' });
    expect(updated).toContain('due: 2026-08-01');
    expect(updated).toContain('customField: keep me');
    expect(updated).toContain('# Quarterly report');
    const changedLines = updated.split('\n').filter(line => !RAW.includes(line));
    for (const line of changedLines) {
      expect(line).toMatch(/^(due:|scheduled:|dateModified:)/);
    }
  });

  it('appendNoteToMd only appends, never rewrites existing content', () => {
    const updated = appendNoteToMd(RAW, 'new log entry', '2026-07-06');
    expect(updated.startsWith(RAW.slice(0, RAW.indexOf('### ')))).toBe(true);
    expect(updated).toContain('new log entry');
    expect(updated).toContain('Log: kicked off');
  });
});
